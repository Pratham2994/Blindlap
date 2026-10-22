// One round: lights out, an anonymous lap, the model reading corners, your guess, the reveal.
import { gearRatios, EngineSynth } from "../audio/engine";
import type { Index, LapData, Session } from "../data";
import { careerLine, loadCareers, loadSession } from "../data";
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

function readScore(): Score {
  try {
    const s = JSON.parse(localStorage.getItem(SCORE_KEY) ?? "");
    if (typeof s?.you === "number") return s;
  } catch {
    /* first visit or storage blocked */
  }
  return { you: 0, model: 0, rounds: 0 };
}

function writeScore(s: Score) {
  try {
    localStorage.setItem(SCORE_KEY, JSON.stringify(s));
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
  private score = readScore();
  private disposed = false;
  private keyHandler = (e: KeyboardEvent) => this.onKey(e);

  private dailyResults: DailyResult[] = [];

  constructor(
    private world: World,
    private engine: EngineSynth,
    private index: Index,
    private daily: { date: string; plan: DailyLap[] } | null = null,
    private challenge: DailyLap | null = null,
  ) {
    this.root = document.createElement("div");
    this.root.className = "hud";
    window.addEventListener("keydown", this.keyHandler);
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
    this.radio?.pause();
    this.engine.setVolume(false);
    document.body.classList.remove("playing");
  }

  private async newRound() {
    this.phase = "loading";
    this.radio?.pause();
    this.root.innerHTML = `<div class="countdown"><p class="caps load-note">Loading a lap…</p></div>`;
    const sessions = this.index.sessions;
    // A challenge link plays its lap first; after that the rounds are random again.
    const planned = this.daily?.plan[this.dailyResults.length] ?? this.challenge ?? undefined;
    this.challenge = null;
    let summary = sessions.find((s) => s.key === planned?.key);
    if (!summary) {
      const pool = sessions.filter((s) => !recent.includes(String(s.key)));
      const pickFrom = pool.length ? pool : sessions;
      summary = pickFrom[Math.floor(Math.random() * pickFrom.length)];
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
    const withRadio = this.session.laps.filter((l) => l.radio);
    const laps = withRadio.length > 6 ? withRadio : this.session.laps;
    this.lap = planned
      ? this.session.laps[planned.lapIndex % this.session.laps.length]
      : laps[Math.floor(Math.random() * laps.length)];
    this.player = new LapPlayer(this.lap);
    this.guesser = new Guesser(this.session, this.index);
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
    this.engine.setVolume(!this.engine.muted);
  }

  private buildHud() {
    const s = this.session;
    this.root.innerHTML = "";
    this.root.classList.remove("revealed");
    const head = document.createElement("div");
    head.className = "hud-session";
    head.innerHTML = `<p class="display where">${s.circuit}</p><p class="caps meta num">${s.date.slice(0, 4)} qualifying · ${(s.length / 1000).toFixed(3)} km · ${
      this.daily
        ? `Daily five · lap ${this.dailyResults.length + 1} of ${this.daily.plan.length}`
        : `Round ${this.score.rounds + 1} · You ${this.score.you} – Model ${this.score.model}`
    }</p>`;

    const controls = document.createElement("div");
    controls.className = "hud-controls";
    controls.innerHTML = `
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
      if (b.dataset.speed) {
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
        this.engine.setVolume(on);
        b.setAttribute("aria-pressed", String(on));
        b.innerHTML = `${on ? icons.soundOn : icons.soundOff}Sound`;
      }
    });

    this.lineup = new Lineup(this.guesser.codes, s.drivers);
    this.lineup.update(this.guesser.guesses(), 0);

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
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === " " && this.phase === "lap") {
      this.paused = !this.paused;
      e.preventDefault();
    } else if (e.key === "c" || e.key === "C") {
      this.setCamera(this.world.mode === "chase" ? "heli" : "chase");
    } else if (e.key === "Enter" && this.phase === "reveal") {
      void this.newRound();
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
      this.world.update(dt, smp.speed);
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
    this.engine.setVolume(false, 2.5);
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
    writeScore(this.score);
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
      <ol class="caption">${best
        .map((e) => `<li><b>${e.label}</b><span>${capitalise(e.sentence)}${cornerById.get(e.corner)?.braked === false ? " (no braking)" : ""}.</span></li>`)
        .join("")}</ol>
      ${this.lap.radio ? `<div class="radio"><button type="button" aria-label="Play team radio">${icons.play}</button><span class="wave">${"<i></i>".repeat(36)}</span><span class="label caps">Team radio, this session</span></div>` : ""}
      <div class="actions"><button type="button" class="btn primary" data-next>${lastDaily ? "Today's result" : "Next lap"} ${icons.next}</button>${
        rival ? `<button type="button" class="btn" data-duel>Race it against ${rival.code}</button>` : ""
      }<a class="btn" href="#/dna">See ${truth}'s DNA</a><button type="button" class="btn" data-challenge>Copy challenge link</button></div>
      <p class="caps share-note" aria-live="polite"></p>`;
    this.root.classList.add("revealed");
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
    this.phase = "reveal";
    this.engine.setVolume(false);
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
    this.paused = false;
    this.root.classList.add("dueling");
    this.world.mode = "heli";
    this.world.snapCamera();
    this.engine.setVolume(!this.engine.muted);
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
    const gap = Math.min(this.t, this.player.duration) - timeAt(d.lap, a.s);
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
    this.world.setCarS(0);
    this.world.mode = "orbit";
    this.engine.setVolume(false, 1.5);
    this.root.classList.remove("dueling");
    this.root.querySelector(".duel")?.remove();
  }

  private setupRadio(box: HTMLElement, url: string) {
    const audio = new Audio(url);
    audio.preload = "auto";
    this.radio = audio;
    const btn = box.querySelector("button")!;
    const bars = [...box.querySelectorAll<HTMLElement>(".wave i")];
    // Bars show playback position (the clip's host does not allow reading its waveform).
    const heights = bars.map((_, i) => 25 + Math.abs(Math.sin(i * 1.7) * 55 + Math.sin(i * 0.6) * 20));
    const paint = () => {
      const f = audio.duration ? audio.currentTime / audio.duration : 0;
      bars.forEach((b, i) => (b.style.height = i / bars.length < f || audio.paused ? `${heights[i]}%` : "20%"));
      bars.forEach((b, i) => (b.style.opacity = i / bars.length < f ? "1" : "0.45"));
      if (!audio.paused) requestAnimationFrame(paint);
    };
    const toggle = () => {
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
    // The reveal is the moment for the radio: play it after the engine fades.
    setTimeout(() => {
      if (!this.disposed && this.radio === audio) void audio.play().catch(() => {});
    }, 1400);
  }
}

/** Time at which a lap reached distance s, by interpolating its (s, t) samples. */
function timeAt(lap: LapData, s: number): number {
  const S = lap.s;
  let lo = 0;
  let hi = S.length - 1;
  if (s <= S[0]) return lap.t[0];
  if (s >= S[hi]) return lap.t[hi];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (S[mid] <= s) lo = mid;
    else hi = mid;
  }
  const u = (s - S[lo]) / (S[hi] - S[lo] || 1);
  return lap.t[lo] + (lap.t[hi] - lap.t[lo]) * u;
}

function capitalise(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
