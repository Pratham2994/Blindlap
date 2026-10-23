// One round: lights out, an anonymous lap, the model reading corners, your guess, the reveal.
import { gearRatios, EngineSynth } from "../audio/engine";
import type { Index, LapData, Session } from "../data";
import { careerLine, loadCareers, loadRadio, loadSession } from "../data";
import { formatLapTime, LapPlayer } from "../lap";
import type { Evidence } from "../model";
import { Guesser } from "../model";
import type { World } from "../scene/world";
import { icons } from "./icons";
import type { DailyLap, DailyResult } from "./daily";
import { readDaily, shareText, summaryHtml, writeDaily } from "./daily";
import { Lineup } from "./lineup";
import { TyreGauge } from "./tyre";

type Phase = "loading" | "lights" | "lap" | "reveal" | "duel";

interface Score {
  you: number;
  model: number;
  rounds: number;
}

const SCORE_KEY = "blindlap.score.v1";
const SPEED_KEY = "blindlap.speed.v1";

function readScore(key = SCORE_KEY): Score {
  try {
    const s = JSON.parse(localStorage.getItem(key) ?? "");
    if (typeof s?.you === "number") return s;
  } catch {
    /* first visit or storage blocked */
  }
  return { you: 0, model: 0, rounds: 0 };
}

function writeScore(s: Score, key = SCORE_KEY) {
  try {
    localStorage.setItem(key, JSON.stringify(s));
  } catch {
    /* storage blocked: score lives for this tab only */
  }
}

function readSpeed(): number {
  try {
    const v = Number(localStorage.getItem(SPEED_KEY));
    if ([1, 2, 4].includes(v)) return v;
  } catch {
    /* ignore */
  }
  return 1;
}

const recent: string[] = [];

export class PlayView {
  /** The model the player last chose; kept across rounds. */
  static model: string | null = null;
  readonly root: HTMLDivElement;
  private phase: Phase = "loading";
  private session!: Session;
  private lap!: LapData;
  private player!: LapPlayer;
  private guesser!: Guesser;
  private lineup!: Lineup;
  private tyre!: TyreGauge;
  private ratios: number[] = [];
  private t = 0;
  private nextCorner = 0;
  private evidence: Evidence[] = [];
  private speed = readSpeed();
  private paused = false;
  private lightsAt = 0;
  private goAt = 0;
  private radio: HTMLAudioElement | null = null;
  private duel: { lap: LapData; player: LapPlayer; code: string } | null = null;
  private score: Score;
  private scoreKey: string;
  private team = "";
  private disposed = false;
  private keyHandler = (e: KeyboardEvent) => this.onKey(e);
  // Leaving the tab (or minimising) pauses the lap and silences audio; it stays paused on return.
  private visibilityHandler = () => {
    if (document.hidden) {
      if (this.phase === "lap" || this.phase === "duel") this.setPaused(true);
      this.radio?.pause();
      this.engine.suspend();
    } else {
      this.engine.resume();
    }
  };

  private dailyResults: DailyResult[] = [];
  private nextKey: number | null = null;

  constructor(
    private world: World,
    private engine: EngineSynth,
    private index: Index,
    private daily: { date: string; plan: DailyLap[] } | null = null,
    private challenge: DailyLap | null = null,
    private mates = false, // teammate mode: same car, two drivers, which one is it?
  ) {
    this.scoreKey = mates ? `${SCORE_KEY}.mates` : SCORE_KEY;
    this.score = readScore(this.scoreKey);
    this.root = document.createElement("div");
    this.root.className = "hud";
    window.addEventListener("keydown", this.keyHandler);
    document.addEventListener("visibilitychange", this.visibilityHandler);
    if (daily) {
      this.dailyResults = readDaily(daily.date);
      if (this.dailyResults.length >= daily.plan.length) {
        this.showDailySummary();
        return;
      }
    }
    void this.newRound();
  }

  dispose() {
    this.disposed = true;
    window.removeEventListener("keydown", this.keyHandler);
    document.removeEventListener("visibilitychange", this.visibilityHandler);
    this.radio?.pause();
    this.engine.setActive(false);
    document.body.classList.remove("playing");
  }

  private async newRound() {
    this.phase = "loading";
    this.paused = false;
    this.root.classList.remove("paused");
    this.radio?.pause();
    this.radio = null;
    this.root.innerHTML = `<div class="countdown"><p class="caps load-note">Loading a lap…</p></div>`;
    const sessions = this.index.sessions;
    // A challenge link plays its lap first; after that the rounds are random again.
    const planned = this.daily?.plan[this.dailyResults.length] ?? this.challenge ?? undefined;
    this.challenge = null;
    let summary = sessions.find((s) => s.key === (planned?.key ?? this.nextKey));
    this.nextKey = null;
    if (!summary) {
      const pool = sessions.filter((s) => !recent.includes(String(s.key)));
      const pickFrom = pool.length ? pool : sessions;
      summary = pickFrom[Math.floor(Math.random() * pickFrom.length)];
    }
    if (!planned) {
      recent.push(String(summary.key));
      if (recent.length > Math.min(6, sessions.length - 1)) recent.shift();
    }

    try {
      this.session = await loadSession(summary.key);
    } catch (e) {
      this.root.innerHTML = `<div class="error"><p>Could not load ${summary.circuit}. ${(e as Error).message}. <a href="#/play">Try another lap</a></p></div>`;
      return;
    }
    if (this.disposed) return;
    const teamOf = (code: string) => Object.values(this.session.drivers).find((d) => d.code === code)?.team ?? "";
    const known = new Set(this.session.model.classes);
    const mateOf = (code: string) =>
      [...new Set(this.session.laps.map((l) => l.code))].find((c) => c !== code && teamOf(c) === teamOf(code) && known.has(c));
    // In teammate mode only laps whose teammate also set a lap can be played.
    const pool = this.mates ? this.session.laps.filter((l) => mateOf(l.code)) : this.session.laps;
    const withRadio = pool.filter((l) => l.radio);
    const laps = withRadio.length > 6 ? withRadio : pool;
    // A planned lap index of -1 means "this circuit, any lap".
    this.lap =
      planned && planned.lapIndex >= 0
        ? this.session.laps[planned.lapIndex % this.session.laps.length]
        : laps[Math.floor(Math.random() * laps.length)];
    this.player = new LapPlayer(this.lap);
    this.team = teamOf(this.lap.code);
    this.guesser = new Guesser(this.session, this.index, this.mates ? [this.lap.code, mateOf(this.lap.code)!] : undefined, PlayView.model ?? undefined);
    this.ratios = gearRatios(this.lap.v, this.lap.rpm, this.lap.gear);
    this.evidence = [];
    this.nextCorner = 0;
    this.t = 0;

    this.world.setSession(this.session);
    this.world.setLap(this.lap);
    this.world.setCarS(0);
    this.world.showCar(true);
    this.world.mode = "chase";
    this.world.snapCamera();
    document.body.classList.add("playing");
    this.buildHud();
    this.phase = "lights";
    this.lightsAt = performance.now();
    this.goAt = this.lightsAt + 5 * 700 + 400 + Math.random() * 900;
    this.engine.setActive(true);
  }

  private buildHud() {
    const s = this.session;
    this.root.innerHTML = "";
    this.root.classList.remove("revealed");
    this.root.classList.toggle("mates", this.mates);
    const head = document.createElement("div");
    head.className = "hud-session";
    const chip = Object.values(s.drivers).find((d) => d.team === this.team)?.colour ?? "#888";
    head.innerHTML = `<p class="display where">${s.circuit}</p>${
      this.mates ? `<p class="caps meta mates"><span class="chip" style="background:${chip}"></span>Which ${this.team} driver?</p>` : ""
    }<p class="caps meta num">${s.date.slice(0, 4)} qualifying · ${(s.length / 1000).toFixed(3)} km · ${
      this.mates
        ? `Teammates · round ${this.score.rounds + 1} · You ${this.score.you} – Model ${this.score.model}`
        : this.daily
        ? `Daily five · lap ${this.dailyResults.length + 1} of ${this.daily.plan.length}`
        : `Round ${this.score.rounds + 1} · You ${this.score.you} – Model ${this.score.model}`
    }</p>`;

    const controls = document.createElement("div");
    controls.className = "hud-controls";
    controls.innerHTML = `
      <div class="seg"><button type="button" data-pause aria-pressed="false" title="Pause (Space)">${icons.pause}Pause</button></div>
      <div class="seg" role="group" aria-label="Playback speed">
        ${[1, 2, 4].map((v) => `<button type="button" data-speed="${v}" aria-pressed="${v === this.speed}">${v}×</button>`).join("")}
      </div>
      <div class="seg" role="group" aria-label="Camera">
        <button type="button" data-cam="chase" aria-pressed="true">${icons.chase}Chase</button>
        <button type="button" data-cam="heli" aria-pressed="false">${icons.heli}Above</button>
      </div>
      <div class="seg"><button type="button" data-sound aria-pressed="${!this.engine.muted}" aria-label="Engine sound">${this.engine.muted ? icons.soundOff : icons.soundOn}Sound</button></div>`;
    controls.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("button");
      if (!b) return;
      if (b.hasAttribute("data-pause")) {
        if (this.phase === "lap" || this.phase === "duel") this.setPaused(!this.paused);
        b.blur();
      } else if (b.dataset.speed) {
        this.speed = Number(b.dataset.speed);
        try {
          localStorage.setItem(SPEED_KEY, String(this.speed));
        } catch {
          /* ignore */
        }
        controls.querySelectorAll("[data-speed]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      } else if (b.dataset.cam) {
        this.setCamera(b.dataset.cam as "chase" | "heli");
      } else if (b.hasAttribute("data-sound")) {
        const on = this.engine.muted;
        this.engine.setMuted(!on);
        b.setAttribute("aria-pressed", String(on));
        b.innerHTML = `${on ? icons.soundOn : icons.soundOff}Sound`;
      }
    });

    this.lineup = new Lineup(this.guesser.codes, s.drivers);
    this.lineup.update(this.guesser.guesses(), 0);
    // Three models read the same corners; the grid follows whichever one you pick.
    const switcher = document.createElement("div");
    switcher.className = "seg model-switch";
    switcher.setAttribute("role", "group");
    switcher.setAttribute("aria-label", "Which model guesses");
    const short: Record<string, string> = { gbm: "Boosted", forest: "Forest", logreg: "Logistic" };
    switcher.innerHTML = this.index.models
      .map((m) => `<button type="button" data-model="${m.id}" aria-pressed="${m.id === this.guesser.model}" title="${m.name}: right ${Math.round(m.top1 * 100)}% of the time on unseen circuits">${short[m.id] ?? m.name}</button>`)
      .join("");
    switcher.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-model]");
      if (!b || this.phase === "reveal" || this.phase === "duel") return;
      PlayView.model = b.dataset.model!;
      this.guesser.useModel(PlayView.model, this.lap);
      this.lineup.update(this.guesser.guesses(), this.guesser.seen);
      switcher.querySelectorAll("[data-model]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      b.blur();
    });
    this.lineup.root.querySelector("header")!.after(switcher);

    this.tyre = new TyreGauge(s);

    const ev = document.createElement("div");
    ev.className = "evidence";
    ev.setAttribute("aria-live", "polite");
    ev.innerHTML = `<span class="t">${icons.flag.replace("<svg", '<svg width="18" height="18"')}</span><span class="what">The model reads every corner as the car leaves it.</span><span class="who"></span>`;

    const cd = document.createElement("div");
    cd.className = "countdown";
    cd.innerHTML = `<div class="lights" role="img" aria-label="Start lights">${"<i></i>".repeat(5)}</div>`;

    this.root.append(this.tyre.root, head, controls, this.lineup.root, ev, cd);
  }

  private setCamera(mode: "chase" | "heli") {
    if (this.phase === "reveal") return;
    if (this.phase === "duel") {
      this.world.mode = mode;
      return;
    }
    this.world.mode = mode;
    this.root.querySelectorAll("[data-cam]").forEach((x) => x.setAttribute("aria-pressed", String((x as HTMLElement).dataset.cam === mode)));
  }

  private onKey(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.key === " ") {
      // Space always means pause here: stop the browser from also "pressing" whatever button
      // has focus (a driver row, a speed button), which used to change the guess or the speed.
      e.preventDefault();
      if (e.repeat) return;
      if (this.phase === "lap" || this.phase === "duel") this.setPaused(!this.paused);
    } else if (e.key === "c" || e.key === "C") {
      this.setCamera(this.world.mode === "chase" ? "heli" : "chase");
    } else if (e.key === "Enter" && this.phase === "reveal") {
      void this.newRound();
    }
  }

  /** How each of the three models ranked the real driver after the whole lap. */
  private modelTable(truth: string): string {
    const only = this.mates ? this.guesser.codes : undefined;
    const rows = this.index.models.map((m) => {
      const g = new Guesser(this.session, this.index, only, m.id);
      this.session.corners.forEach((_, c) => g.ingest(this.lap, c));
      const list = g.guesses();
      const k = list.findIndex((x) => x.code === truth);
      const p = list[k]?.p ?? 0;
      return `<tr${m.id === this.guesser.model ? ' class="current"' : ""}><td>${m.name}</td><td class="num">${list[0].code === truth ? "<b>right</b>" : `P${k + 1}`}</td><td class="num">${Math.round(p * 100)}%</td><td><span class="bar"><i style="width:${p * 100}%"></i></span></td></tr>`;
    });
    return `<table class="model-table"><caption class="caps">How each model ranked ${truth}</caption><tbody>${rows.join("")}</tbody></table>`;
  }

  private setPaused(on: boolean) {
    this.paused = on;
    // Silence the engine while paused; otherwise it drones on its last note.
    this.engine.setActive(!on, 0.15);
    this.root.classList.toggle("paused", on);
    const btn = this.root.querySelector<HTMLButtonElement>("[data-pause]");
    if (btn) {
      btn.innerHTML = on ? `${icons.play}Resume` : `${icons.pause}Pause`;
      btn.setAttribute("aria-pressed", String(on));
    }
  }

  /** Called every animation frame by the app. */
  frame(dt: number) {
    if (this.phase === "lights") {
      const now = performance.now();
      const lit = Math.min(5, Math.floor((now - this.lightsAt) / 700));
      this.root.querySelectorAll(".lights i").forEach((l, i) => l.classList.toggle("on", i < lit && now < this.goAt));
      this.engine.update(lit >= 5 ? 9000 + Math.random() * 1500 : 4200 + lit * 300, lit >= 5 ? 40 : 4, 0, 1);
      if (now >= this.goAt) {
        this.root.querySelector(".countdown")?.remove();
        this.phase = "lap";
      }
      this.world.update(dt, 0);
      return;
    }
    if (this.phase === "lap" && !this.paused) {
      this.t = Math.min(this.t + dt * this.speed, this.player.duration);
      const smp = this.player.at(this.t);
      const ratio = this.ratios[smp.gear];
      const rpm = ratio > 0 && smp.speed > 40 ? smp.speed * ratio : smp.rpm;
      this.engine.update(rpm, smp.throttle, smp.speed, smp.gear);
      this.world.setCarS(smp.s);
      this.tyre.update(smp.s, smp.speed, smp.gear, smp.throttle, smp.brake);
      const corners = this.session.corners;
      while (this.nextCorner < corners.length && smp.s > corners[this.nextCorner].hi) this.readCorner(this.nextCorner++);
      if (this.t >= this.player.duration) {
        while (this.nextCorner < corners.length) this.readCorner(this.nextCorner++);
        this.reveal();
      }
      this.world.update(dt, smp.speed, smp.brake);
      return;
    }
    if (this.phase === "duel" && this.duel && !this.paused) {
      this.duelFrame(dt);
      return;
    }
    this.world.update(dt, this.phase === "lap" ? this.player.at(this.t).speed : 0);
  }

  private readCorner(i: number) {
    const ev = this.guesser.ingest(this.lap, i);
    this.evidence.push(ev);
    const c = this.session.corners[i];
    this.world.markEvidence(i, c.lo, c.hi, ev.short);
    this.tyre.markCorner(i);
    this.lineup.update(this.guesser.guesses(), this.guesser.seen);
    const box = this.root.querySelector(".evidence") as HTMLElement | null;
    if (box) {
      box.innerHTML = `<span class="t">${ev.label}</span><span class="what">${capitalise(ev.sentence)}</span><span class="who caps">points to ${ev.movers.map((m) => `<b>${m}</b>`).join(" ")}</span>`;
      box.classList.remove("flash");
      void box.offsetWidth;
      box.classList.add("flash");
    }
  }

  private async reveal() {
    this.phase = "reveal";
    this.engine.update(5000, 0, 0, 0);
    // Cut the engine quickly: the team radio is quiet and must not fight it.
    this.engine.setActive(false, 0.3);
    this.world.mode = "orbit";
    this.world.revealLine(true);
    const truth = this.lap.code;
    const careers = await loadCareers();
    if (this.disposed) return;
    const career = careerLine(careers.drivers[truth]);
    const driver = Object.values(this.session.drivers).find((d) => d.code === truth)!;
    const guesses = this.guesser.guesses();
    const modelPick = guesses[0].code;
    const rank = guesses.findIndex((g) => g.code === truth) + 1;
    const teamOf = (code: string) => Object.values(this.session.drivers).find((d) => d.code === code)?.team;
    const grade = (code: string | null) => (code === truth ? 3 : code && teamOf(code) === driver.team ? 1 : 0);
    const you = grade(this.lineup.pick);
    const model = grade(modelPick);
    this.score = { you: this.score.you + you, model: this.score.model + model, rounds: this.score.rounds + 1 };
    writeScore(this.score, this.scoreKey);
    const lastDaily = !!this.daily && this.dailyResults.length + 1 >= this.daily.plan.length;
    if (this.daily) {
      this.dailyResults.push({ you, model, truth, circuit: this.session.circuit });
      writeDaily(this.daily.date, this.dailyResults);
    }
    this.lineup.reveal(truth);

    const tag = (who: string, pts: number, code: string | null) =>
      `<span class="tag ${pts === 3 ? "win" : pts === 1 ? "half" : "miss"}">${who}: ${code ?? "no guess"} · ${pts === 3 ? "right" : pts === 1 ? "teammate" : "wrong"}</span>`;

    // The corners that pointed hardest at the real driver, as a ruled caption.
    const best = [...this.evidence].sort((a, b) => (b.deltas[truth] ?? 0) - (a.deltas[truth] ?? 0)).slice(0, 3);
    const cornerById = new Map(this.session.corners.map((c, i) => [i, c]));

    // The duel rival: whoever the model picked, or its runner-up when it was right.
    const rivalCode = modelPick !== truth ? modelPick : guesses[1]?.code;
    const rival = [...this.session.laps].filter((l) => l.code === rivalCode).sort((a, b) => a.lapTime - b.lapTime)[0];

    const card = document.createElement("section");
    card.className = "reveal";
    card.setAttribute("aria-live", "polite");
    card.innerHTML = `
      <div class="verdicts">${tag("You", you, this.lineup.pick)}${tag("Model", model, modelPick)}</div>
      <div class="who"><div><h2 class="display">${driver.name.replace(/\s(\S+)$/, " <br>$1")}</h2><p class="caps team"><span class="chip" style="background:${driver.colour}"></span>${driver.team} · lap ${this.lap.lapNumber}</p>${career ? `<p class="career num">${career} <span>career, ${careers.source}</span></p>` : ""}</div></div>
      <div class="stats caps num">
        <span>Lap time<b>${formatLapTime(this.lap.lapTime)}</b></span>
        <span>Model ranked them<b>P${rank} of ${guesses.length}</b></span>
        <span>Final confidence<b>${Math.round((guesses.find((g) => g.code === truth)?.p ?? 0) * 100)}%</b></span>
      </div>
      ${this.modelTable(truth)}
      <ol class="caption">${best
        .map((e) => `<li><b>${e.label}</b><span>${capitalise(e.sentence)}${cornerById.get(e.corner)?.braked === false ? " (no braking)" : ""}.</span></li>`)
        .join("")}</ol>
      ${
        this.lap.radio
          ? `<div class="radio"><button type="button" aria-label="Play team radio">${icons.play}</button><span class="wave">${"<i></i>".repeat(36)}</span><span class="label caps">Team radio, this session</span></div>`
          : `<div class="radio none"><span class="dot" aria-hidden="true"></span><span class="label caps">No team radio from ${truth} in this session</span></div>`
      }
      <div class="actions"><button type="button" class="btn primary" data-next>${lastDaily ? "Today's result" : "Next lap"} ${icons.next}</button>${
        rival ? `<button type="button" class="btn" data-duel>Race it against ${rival.code}</button>` : ""
      }<a class="btn" href="#/dna">See ${truth}'s DNA</a><button type="button" class="btn" data-challenge>Copy challenge link</button></div>
      <p class="caps share-note" aria-live="polite"></p>`;
    this.root.classList.add("revealed");
    // Fetch the next random circuit while the player reads the reveal.
    if (!this.daily) {
      const pool = this.index.sessions.filter((x) => !recent.includes(String(x.key)));
      const next = pool[Math.floor(Math.random() * pool.length)];
      if (next) {
        this.nextKey = next.key;
        void loadSession(next.key).catch(() => (this.nextKey = null));
      }
    }
    this.root.appendChild(card);
    card.querySelector("[data-next]")!.addEventListener("click", () => (lastDaily ? this.showDailySummary() : void this.newRound()));
    if (rival) card.querySelector("[data-duel]")!.addEventListener("click", () => this.startDuel(rival));
    card.querySelector("[data-challenge]")!.addEventListener("click", async () => {
      // The link names the lap by its position in the session file, so it does not give the driver away.
      const link = `${location.origin}${location.pathname}#/play/${this.session.key}.${this.session.laps.indexOf(this.lap)}`;
      const note = card.querySelector(".share-note")!;
      try {
        await navigator.clipboard.writeText(link);
        note.textContent = "Link copied. Whoever opens it gets this exact lap, with the name hidden.";
      } catch {
        note.textContent = link;
      }
    });
    if (this.lap.radio) this.setupRadio(card.querySelector(".radio")!, this.lap.radio);
    (card.querySelector("[data-next]") as HTMLElement).focus({ preventScroll: true });
  }

  private showDailySummary() {
    const d = this.daily!;
    this.radio?.pause();
    this.radio = null;
    this.phase = "reveal";
    this.engine.setActive(false);
    this.root.classList.remove("revealed", "dueling");
    this.root.innerHTML = "";
    const card = document.createElement("section");
    card.className = "reveal daily";
    card.innerHTML = `${summaryHtml(d.date, this.dailyResults)}
      <div class="actions">
        <button type="button" class="btn primary" data-copy>Copy result</button>
        <a class="btn" href="#/play">Keep playing</a>
      </div>
      <p class="caps share-note" aria-live="polite">New five at midnight, your time.</p>`;
    card.querySelector("[data-copy]")!.addEventListener("click", async () => {
      const note = card.querySelector(".share-note")!;
      try {
        await navigator.clipboard.writeText(shareText(d.date, this.dailyResults));
        note.textContent = "Copied. Paste it anywhere.";
      } catch {
        note.textContent = "Could not reach the clipboard. Select the table and copy it instead.";
      }
    });
    this.root.appendChild(card);
    this.world.mode = "orbit";
  }

  private startDuel(rival: LapData) {
    this.radio?.pause();
    this.duel = { lap: rival, player: new LapPlayer(rival), code: rival.code };
    this.player = new LapPlayer(this.lap);
    this.t = 0;
    this.phase = "duel";
    this.setPaused(false);
    this.root.classList.add("dueling");
    this.world.mode = "heli";
    // Keep both cars clear of the driver grid on the right.
    this.world.setFrameShift(window.innerWidth > 860 ? -0.12 : 0);
    this.world.snapCamera();
    this.engine.setActive(true);
    const bar = document.createElement("div");
    bar.className = "duel";
    bar.innerHTML = `
      <span class="car hard"></span><b>${this.lap.code}</b><span class="caps">vs</span><span class="car soft"></span><b>${rival.code}</b>
      <span class="gap num">+0.000 s</span>
      <span class="caps where">Same session</span>
      <button type="button" class="btn" data-back>Back to result</button>`;
    bar.querySelector("[data-back]")!.addEventListener("click", () => this.endDuel());
    this.root.appendChild(bar);
  }

  private duelFrame(dt: number) {
    const d = this.duel!;
    const end = Math.max(this.player.duration, d.player.duration);
    this.t = Math.min(this.t + dt * this.speed, end);
    const a = this.player.at(Math.min(this.t, this.player.duration));
    const b = d.player.at(Math.min(this.t, d.player.duration));
    const ratio = this.ratios[a.gear];
    this.engine.update(ratio > 0 && a.speed > 40 ? a.speed * ratio : a.rpm, a.throttle, a.speed, a.gear);
    this.world.setCarS(a.s);
    this.world.setGhostS(b.s);
    // Gap at the white car's position: how long ago the red car passed the same point.
    const gap = Math.min(this.t, this.player.duration) - d.player.timeAt(a.s);
    const gapEl = this.root.querySelector(".duel .gap");
    const whereEl = this.root.querySelector(".duel .where");
    if (gapEl) {
      gapEl.textContent = `${gap >= 0 ? "+" : "-"}${Math.abs(gap).toFixed(3)} s`;
      gapEl.classList.toggle("ahead", gap < 0);
    }
    if (whereEl) {
      const c = this.session.corners.find((x) => a.s < x.hi);
      whereEl.textContent = `${this.lap.code} ${gap < 0 ? "ahead" : "behind"}${c ? ` · into T${c.n}` : " · to the line"}`;
    }
    this.world.update(dt, a.speed);
    if (this.t >= end) this.endDuel();
  }

  private endDuel() {
    this.duel = null;
    this.phase = "reveal";
    this.world.setGhostS(null);
    this.world.setFrameShift(0);
    this.world.setCarS(0);
    this.world.mode = "orbit";
    this.engine.setActive(false, 1.5);
    this.root.classList.remove("dueling");
    this.root.querySelector(".duel")?.remove();
  }

  private async setupRadio(box: HTMLElement, url: string) {
    const audio = new Audio(url);
    audio.preload = "auto";
    this.radio = audio;
    // Start where the speech starts; many clips open with seconds of silence.
    const timing = (await loadRadio())[url];
    const start = timing?.start ?? 0;
    const fromStart = () => {
      if (audio.currentTime < start || audio.ended) audio.currentTime = start;
    };
    // Seeking before the file's header has loaded is ignored by some browsers; seek again then.
    audio.addEventListener("loadedmetadata", fromStart, { once: true });
    // Captions: one quiet line under the waveform, following the audio.
    const lines = timing?.lines ?? [];
    if (lines.length) {
      const cap = document.createElement("p");
      cap.className = "radio-caption";
      cap.setAttribute("aria-live", "polite");
      cap.innerHTML = `<span class="caps">Auto captions</span><span class="line">${lines.map((l) => l.text).join(" ")}</span>`;
      box.after(cap);
      const line = cap.querySelector(".line")!;
      audio.addEventListener("timeupdate", () => {
        const now = audio.currentTime;
        const current = lines.find((l) => now >= l.t0 - 0.1 && now <= l.t1 + 0.4);
        if (current) line.textContent = current.text;
      });
      audio.addEventListener("ended", () => (line.textContent = lines.map((l) => l.text).join(" ")));
    }
    const btn = box.querySelector("button")!;
    const bars = [...box.querySelectorAll<HTMLElement>(".wave i")];
    // Bars show playback position (the clip's host does not allow reading its waveform).
    const heights = bars.map((_, i) => 25 + Math.abs(Math.sin(i * 1.7) * 55 + Math.sin(i * 0.6) * 20));
    const paint = () => {
      const f = audio.duration ? Math.max(0, (audio.currentTime - start) / (audio.duration - start)) : 0;
      bars.forEach((b, i) => (b.style.height = i / bars.length < f || audio.paused ? `${heights[i]}%` : "20%"));
      bars.forEach((b, i) => (b.style.opacity = i / bars.length < f ? "1" : "0.45"));
      if (!audio.paused) requestAnimationFrame(paint);
    };
    const toggle = () => {
      fromStart();
      if (audio.paused) void audio.play().catch(() => box.querySelector(".label")!.replaceChildren("Radio clip unavailable"));
      else audio.pause();
    };
    audio.addEventListener("play", () => {
      box.classList.add("playing");
      btn.innerHTML = icons.pause;
      paint();
    });
    audio.addEventListener("pause", () => {
      box.classList.remove("playing");
      btn.innerHTML = icons.play;
    });
    audio.addEventListener("ended", () => {
      box.classList.remove("playing");
      btn.innerHTML = icons.play;
    });
    btn.addEventListener("click", toggle);
    paint();
    // The reveal is the moment for the radio: play it once the engine is silent.
    setTimeout(() => {
      // Only if the player is still looking at this reveal (not a new lap or the duel).
      if (!this.disposed && this.radio === audio && this.phase === "reveal" && !this.duel) {
        fromStart();
        void audio.play().catch(() => {});
      }
    }, 700);
  }
}

function capitalise(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
