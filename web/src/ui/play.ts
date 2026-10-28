// One round: lights out, an anonymous lap, the model reading corners, your guess, the reveal.
// Layout: a bar with the way back, the framed stage, the ranking column, and a band underneath
// that carries the telemetry during the lap and becomes the reveal afterwards.
import { gearRatios, EngineSynth, VOLUME_KEY } from "../audio/engine";
import type { DriverInfo, Index, LapData, LapRef, Session, SessionResult } from "../data";
import { careerLine, loadCareers, loadDna, loadRadio, loadResults, loadSession, prefetchSurroundings } from "../data";
import { formatLapTime, LapPlayer } from "../lap";
import type { Evidence } from "../model";
import { Guesser } from "../model";
import type { CameraMode, World } from "../scene/world";
import { icons } from "./icons";
import { Lineup } from "./lineup";
import { dockStage } from "./stage";
import { Minimap } from "./minimap";
import { Telemetry } from "./telemetry";

type Phase = "loading" | "intro" | "lights" | "lap" | "reveal" | "duel";

interface Score {
  you: number;
  model: number;
  rounds: number;
}

const SCORE_KEY = "blindlap.score.v1";
const SPEED_KEY = "blindlap.speed.v1";
const INTRO_KEY = "blindlap.intro.v1"; // set once the visitor has read the rules

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key: string) {
  try {
    localStorage.setItem(key, "1");
  } catch {
    // A private window may refuse storage: the intro just shows again next time.
  }
}
// The cameras offered during a lap, in the order C cycles through them.
const CAMERAS: [CameraMode, string, string][] = [
  ["chase", "Chase", "Behind the car"],
  ["onboard", "Onboard", "From the cockpit"],
  ["side", "Side", "Alongside the car"],
  ["tv", "TV", "A broadcast camera, high and zoomed in"],
  ["heli", "Above", "From above"],
];

const SHORT_MODEL: Record<string, string> = { blend: "Blend", gbm: "Boosted trees", forest: "Random forest", logreg: "Logistic" };

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

/** Ink or paper, whichever reads on a team colour. */
function inkOn(hex: string): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.35 ? "#111111" : "#f3f2ee";
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
  private telemetry!: Telemetry;
  private minimap!: Minimap;
  private band!: HTMLElement;
  private ratios: number[] = [];
  private t = 0;
  private nextCorner = 0;
  private evidence: Evidence[] = [];
  private hints = 0; // hints taken this round: each lowers what a right guess is worth
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

  private nextKey: number | null = null;

  constructor(
    private world: World,
    private engine: EngineSynth,
    private index: Index,
    private challenge: LapRef | null = null,
    private mates = false, // teammate mode: same car, two drivers, which one is it?
  ) {
    this.scoreKey = mates ? `${SCORE_KEY}.mates` : SCORE_KEY;
    this.score = readScore(this.scoreKey);
    this.root = document.createElement("div");
    this.root.className = "play";
    window.addEventListener("keydown", this.keyHandler);
    document.addEventListener("visibilitychange", this.visibilityHandler);
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

  private modeLabel(): string {
    if (this.mates) return "Teammates";
    return `Quick lap · round ${this.score.rounds + 1}`;
  }

  private async newRound() {
    this.phase = "loading";
    this.paused = false;
    this.radio?.pause();
    this.radio = null;
    this.root.dataset.phase = "loading";
    // Park the canvas first: clearing the view while it is inside would take it off the page.
    dockStage(null);
    this.root.innerHTML = `<p class="loading caps">Loading a lap…</p>`;
    const sessions = this.index.sessions;
    // A challenge link plays its lap first; after that the rounds are random again.
    const planned = this.challenge ?? undefined;
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
      // The surroundings come with the lap, so stands and buildings appear with the track.
      [this.session] = await Promise.all([loadSession(summary.key), prefetchSurroundings(summary.key)]);
    } catch (e) {
      this.root.innerHTML = `<div class="error"><p>Couldn't load ${summary.circuit}: ${(e as Error).message}.</p><a class="btn" href="#/">Back to menu</a></div>`;
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
    this.hints = 0;
    this.nextCorner = 0;
    this.t = 0;

    this.world.setSession(this.session);
    this.world.setLap(this.lap);
    this.world.setCarS(0);
    this.world.hideLivery();
    this.world.showCar(true);
    this.world.mode = "chase";
    this.world.snapCamera();
    document.body.classList.add("playing");
    this.buildHud();
    // The first lap of a visitor's life starts with the rules and a button; after that the
    // lights go straight away, with one line of reminder.
    if (!readFlag(INTRO_KEY)) {
      this.phase = "intro";
      this.root.dataset.phase = "intro";
      const go = this.root.querySelector<HTMLButtonElement>("[data-go]")!;
      go.addEventListener("click", () => this.startLights());
      go.focus({ preventScroll: true });
      return;
    }
    this.startLights();
  }

  private startLights() {
    writeFlag(INTRO_KEY);
    this.phase = "lights";
    this.root.dataset.phase = "lights";
    this.lightsAt = performance.now();
    this.goAt = this.lightsAt + 5 * 700 + 400 + Math.random() * 900;
    this.engine.start();
    this.engine.setActive(true);
  }

  private buildHud() {
    const s = this.session;
    this.root.innerHTML = "";
    this.root.classList.toggle("mates", this.mates);
    const teamColour = Object.values(s.drivers).find((d) => d.team === this.team)?.colour ?? "#888";

    const bar = document.createElement("header");
    bar.className = "play-bar";
    bar.innerHTML = `
      <a class="back" href="#/">${icons.back}<span>Menu</span></a>
      <div class="where">
        <h1 class="display">${s.circuit} <span class="year">${s.date.slice(0, 4)}</span></h1>
        <p class="caps">${this.modeLabel()} · ${(s.length / 1000).toFixed(3)} km</p>
      </div>
      ${
        this.mates
          ? `<p class="mates-q"><span class="chip" style="background:${teamColour}"></span>Which ${this.team} driver?</p>`
          : `<p class="score caps num">You <b>${this.score.you}</b> <span>·</span> Model <b>${this.score.model}</b></p>`
      }
      <div class="controls">
        <button type="button" class="ctl" data-pause aria-pressed="false" title="Pause (Space)">${icons.pause}<span>Pause</span></button>
        <div class="seg" role="group" aria-label="Playback speed">
          ${[1, 2, 4].map((v) => `<button type="button" data-speed="${v}" aria-pressed="${v === this.speed}">${v}×</button>`).join("")}
        </div>
        <div class="seg cams" role="group" aria-label="Camera">
          ${CAMERAS.map(([id, label, title]) => `<button type="button" data-cam="${id}" aria-pressed="${id === "chase"}" title="${title} (C to cycle, drag the view to look around)"><span>${label}</span></button>`).join("")}
        </div>
        <button type="button" class="ctl" data-sound aria-pressed="${!this.engine.muted}" aria-label="Engine sound">${this.engine.muted ? icons.soundOff : icons.soundOn}<span>Sound</span></button>
        <label class="volume"><span class="caps">Vol</span><input type="range" min="0" max="100" step="1" value="${Math.round(this.engine.volume * 100)}" aria-label="Volume"></label>
      </div>`;
    // One level for the engine and the team radio, remembered between visits.
    bar.querySelector<HTMLInputElement>(".volume input")!.addEventListener("input", (e) => {
      const v = Number((e.target as HTMLInputElement).value) / 100;
      this.engine.setVolume(v);
      if (this.radio) this.radio.volume = v;
      try {
        localStorage.setItem(VOLUME_KEY, String(v));
      } catch {
        /* ignore */
      }
    });
    bar.querySelector(".controls")!.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("button");
      if (!b) return;
      if (b.hasAttribute("data-pause")) {
        if (this.phase === "lap" || this.phase === "duel") this.setPaused(!this.paused);
      } else if (b.dataset.speed) {
        this.speed = Number(b.dataset.speed);
        try {
          localStorage.setItem(SPEED_KEY, String(this.speed));
        } catch {
          /* ignore */
        }
        bar.querySelectorAll("[data-speed]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      } else if (b.dataset.cam) {
        this.setCamera(b.dataset.cam as CameraMode);
      } else if (b.hasAttribute("data-sound")) {
        const on = this.engine.muted;
        this.engine.setMuted(!on);
        b.setAttribute("aria-pressed", String(on));
        b.innerHTML = `${on ? icons.soundOn : icons.soundOff}<span>Sound</span>`;
      }
      b.blur();
    });

    const stage = document.createElement("div");
    stage.className = "stage-frame";
    stage.innerHTML = `<div class="stage-slot"></div>
      <div class="countdown"><div class="lights" role="img" aria-label="Start lights">${"<i></i>".repeat(5)}</div>
        <div class="intro">
          <p class="caps intro-h">${this.mates ? `Which ${this.team} driver?` : "Who is driving?"}</p>
          <ol>
            <li><b>Watch the lap.</b> A real qualifying lap with the name hidden.</li>
            <li><b>Read the corners.</b> Where they brake, how fast they turn in, when they get back on the power: every driver does it differently. Three models read the same corners on the right.</li>
            <li><b>Tap your driver</b> any time before the flag. Right: 3 points, their teammate: 1. Stuck? Take a hint; each one costs a point.</li>
          </ol>
          <button type="button" class="btn primary" data-go>Start the lap ${icons.next}</button>
        </div>
        <p class="caps reminder">Watch how they take each corner. Tap your driver before the flag.</p></div>
      <p class="paused-note caps" aria-live="polite">Paused · Space to resume</p>`;
    const w = this.world;
    this.minimap = new Minimap(s.circuit, w.outline(), s.corners.map((c) => ({ s: c.s, n: c.n })), s.length, (d) => w.pointAt(d));
    stage.appendChild(this.minimap.root);

    // Hold the left button (or a finger) and drag to look around the car; double-click to reset.
    let drag: { x: number; y: number; id: number } | null = null;
    stage.addEventListener("pointerdown", (e) => {
      // Not on a button (the intro's start button), and not before the lap is running.
      if (e.button !== 0 || this.phase === "loading" || this.phase === "intro" || this.phase === "lights") return;
      if ((e.target as HTMLElement).closest("button, a, input, select")) return;
      drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
      stage.setPointerCapture(e.pointerId);
      stage.classList.add("dragging");
    });
    stage.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      this.world.nudgeView(e.clientX - drag.x, e.pointerType === "touch" ? 0 : e.clientY - drag.y);
      drag.x = e.clientX;
      drag.y = e.clientY;
    });
    const endDrag = () => {
      drag = null;
      stage.classList.remove("dragging");
    };
    stage.addEventListener("pointerup", endDrag);
    stage.addEventListener("pointercancel", endDrag);
    stage.addEventListener("dblclick", () => this.world.resetView());

    const side = document.createElement("aside");
    side.className = "side";
    this.lineup = new Lineup(this.guesser.codes, s.drivers);
    this.lineup.update(this.guesser.guesses(), 0);
    // Three models read the same corners; the ranking follows whichever one you pick.
    const switcher = document.createElement("div");
    switcher.className = "seg model-switch";
    switcher.setAttribute("role", "group");
    switcher.setAttribute("aria-label", "Which model guesses");
    switcher.innerHTML = this.index.models
      .map((m) => `<button type="button" data-model="${m.id}" aria-pressed="${m.id === this.guesser.model}" title="${m.name}: right ${Math.round(m.top1 * 100)}% of the time on circuits it never saw">${SHORT_MODEL[m.id] ?? m.name}</button>`)
      .join("");
    switcher.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-model]");
      if (!b || this.phase === "loading" || this.phase === "lights") return;
      PlayView.model = b.dataset.model!;
      this.guesser.useModel(PlayView.model, this.lap);
      this.lineup.update(this.guesser.guesses(), this.guesser.seen);
      switcher.querySelectorAll("[data-model]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      b.blur();
    });
    this.lineup.root.querySelector("header")!.after(switcher);
    side.appendChild(this.lineup.root);
    side.appendChild(this.buildHints());

    this.band = document.createElement("section");
    this.band.className = "band";
    this.telemetry = new Telemetry(
      s,
      (metres) => this.seekTo(this.player.timeAt(metres)),
      (seconds) => this.seekTo(this.t + seconds),
    );
    this.telemetry.setSeekable(false);
    const ev = document.createElement("div");
    ev.className = "evidence";
    ev.setAttribute("aria-live", "polite");
    this.band.append(this.telemetry.root, ev);
    this.showEvidence(null);

    this.root.append(bar, stage, side, this.band);
    dockStage(stage.querySelector(".stage-slot"));
  }

  private setCamera(mode: CameraMode) {
    if (this.phase === "reveal") return;
    this.world.mode = mode;
    if (this.phase === "duel") return;
    this.root.querySelectorAll("[data-cam]").forEach((x) => x.setAttribute("aria-pressed", String((x as HTMLElement).dataset.cam === mode)));
  }

  private onKey(e: KeyboardEvent) {
    // Keys typed into a field belong to it; sliders (lap bar, volume) still let Space and the arrows
    // control the lap, or Space could not resume after a seek.
    const t = e.target;
    if (t instanceof HTMLSelectElement || (t instanceof HTMLInputElement && t.type !== "range")) return;
    if (e.key === " ") {
      // Space always means pause here: stop the browser from also "pressing" whatever button
      // has focus (a driver row, a speed button), which used to change the guess or the speed.
      e.preventDefault();
      if (e.repeat) return;
      if (this.phase === "lap" || this.phase === "duel") this.setPaused(!this.paused);
    } else if (e.key === "c" || e.key === "C") {
      const i = CAMERAS.findIndex(([id]) => id === this.world.mode);
      this.setCamera(CAMERAS[(i + 1) % CAMERAS.length][0]);
    } else if (e.key === "Escape") {
      location.hash = "#/";
    } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && this.phase === "lap") {
      e.preventDefault();
      this.seekTo(this.t + (e.key === "ArrowLeft" ? -5 : 5));
    } else if (e.key === "Enter" && this.phase === "reveal") {
      void this.newRound();
    }
  }

  /** Hints for the player (the models get none): the driver's style from their DNA, the team,
   * the car number. Each one taken lowers a right guess from 3 points by one, to at least 1. */
  private buildHints(): HTMLElement {
    const box = document.createElement("section");
    box.className = "hints";
    const kinds: [string, string][] = [["style", "Driving style"], ...(this.mates ? [] : [["team", "Team"] as [string, string]]), ["number", "Car number"]];
    box.innerHTML = `
      <p class="caps hints-h"><span>Stuck? Take a hint</span><span class="num" data-k="worth">right = 3 pts</span></p>
      <div class="hint-buttons">${kinds.map(([k, label]) => `<button type="button" data-hint="${k}">${label}</button>`).join("")}</div>
      <ul class="hint-list" aria-live="polite"></ul>`;
    const list = box.querySelector(".hint-list")!;
    const worth = box.querySelector("[data-k=worth]")!;
    box.querySelector(".hint-buttons")!.addEventListener("click", async (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-hint]");
      if (!b || b.disabled || this.phase === "reveal" || this.phase === "duel" || this.phase === "loading") return;
      b.disabled = true;
      b.blur();
      this.hints++;
      const n = Math.max(1, 3 - this.hints);
      worth.textContent = `right = ${n} pt${n === 1 ? "" : "s"}`;
      const code = this.lap.code;
      const d = this.driverOf(code);
      let text = "";
      if (b.dataset.hint === "style") {
        const dna = await loadDna().catch(() => null);
        const tell = dna?.drivers.find((x) => x.code === code)?.tells?.[0];
        text = tell ? `This driver ${tell}.` : "No style data for this driver yet.";
      } else if (b.dataset.hint === "team") {
        text = `Drives for ${d.team}.`;
        this.lineup.highlight(Object.values(this.session.drivers).filter((x) => x.team === d.team).map((x) => x.code));
      } else {
        const number = Object.entries(this.session.drivers).find(([, x]) => x.code === code)?.[0];
        text = `Car number ${number}.`;
      }
      const li = document.createElement("li");
      li.textContent = text;
      list.appendChild(li);
    });
    return box;
  }

  /** "Saturday 5 April 2025 · Q3 · their best Q3 lap · qualified P1": when and where in qualifying
   * the lap was set, and how the driver's session ended. Parts without data are left out. */
  private sessionLine(result: SessionResult | undefined): string {
    const date = new Date(`${this.session.date}T12:00:00Z`).toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    const parts = [date];
    const seg = result?.segments[this.lap.id];
    const fin = result?.drivers[String(this.lap.driver)];
    if (seg) {
      const best = fin?.best?.[Number(seg[1]) - 1];
      parts.push(`Qualifying ${seg}`);
      if (best && Math.abs(best - this.lap.lapTime) < 0.002) parts.push(`their best ${seg} lap`);
    }
    if (fin?.status) parts.push(fin.status.toUpperCase());
    else if (fin?.pos) parts.push(fin.pos === 1 ? "took pole" : `qualified P${fin.pos}`);
    return parts.map((p) => `<span>${p}</span>`).join(" · ");
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
      return `<tr${m.id === this.guesser.model ? ' class="current"' : ""}><td>${m.name}</td><td class="num">${list[0].code === truth ? "<b>Right</b>" : `P${k + 1}`}</td><td class="num">${Math.round(p * 100)}%</td></tr>`;
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
      btn.innerHTML = on ? `${icons.play}<span>Resume</span>` : `${icons.pause}<span>Pause</span>`;
      btn.setAttribute("aria-pressed", String(on));
    }
  }

  /** Called every animation frame by the app. */
  frame(dt: number) {
    if (this.phase === "loading") return;
    if (this.phase === "lights") {
      const now = performance.now();
      const lit = Math.min(5, Math.floor((now - this.lightsAt) / 700));
      this.root.querySelectorAll(".lights i").forEach((l, i) => l.classList.toggle("on", i < lit && now < this.goAt));
      this.engine.update(lit >= 5 ? 9000 + Math.random() * 1500 : 4200 + lit * 300, lit >= 5 ? 40 : 4, 0, 1);
      if (now >= this.goAt) {
        this.root.querySelector(".countdown")?.remove();
        this.telemetry.setSeekable(true);
        this.phase = "lap";
        this.root.dataset.phase = "lap";
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
      this.telemetry.update(smp.s, this.t, smp.speed, smp.gear, smp.throttle, smp.brake);
      const corners = this.session.corners;
      while (this.nextCorner < corners.length && smp.s > corners[this.nextCorner].hi) this.readCorner(this.nextCorner++);
      if (this.t >= this.player.duration) {
        while (this.nextCorner < corners.length) this.readCorner(this.nextCorner++);
        void this.reveal();
      }
      this.minimap.update(smp.s, null);
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
    this.telemetry.markCorner(i);
    this.minimap.markCorner(i, true);
    this.lineup.update(this.guesser.guesses(), this.guesser.seen);
    this.showEvidence(ev, true);
  }

  private showEvidence(ev: Evidence | null, flash = false) {
    const box = this.root.querySelector(".evidence") as HTMLElement | null;
    if (!box) return;
    box.innerHTML = ev
      ? `<span class="t">${ev.label}</span><span class="what">${capitalise(ev.sentence)}</span><span class="who caps">points to ${ev.movers.map((m) => `<b>${m}</b>`).join(" ")}</span>`
      : `<span class="t">${icons.flag}</span><span class="what">The models read every corner as the car leaves it.</span><span class="who"></span>`;
    if (flash) {
      box.classList.remove("flash");
      void box.offsetWidth;
      box.classList.add("flash");
    }
  }

  /** Jump to time t in the lap. Going forward, the frame loop reads the corners passed, as if the
   * car had driven them. Going back, corners after the new place are forgotten (the guess, the
   * marks on track and the ticks), so the model is never ahead of the car. */
  private seekTo(t: number) {
    if (this.phase !== "lap") return;
    this.t = Math.max(0, Math.min(t, this.player.duration - 0.05));
    const smp = this.player.at(this.t);
    const corners = this.session.corners;
    let n = 0;
    while (n < corners.length && smp.s > corners[n].hi) n++;
    if (n < this.nextCorner) {
      for (let i = n; i < this.nextCorner; i++) {
        this.world.unmarkEvidence(i, corners[i].lo, corners[i].hi);
        this.telemetry.unmarkCorner(i);
        this.minimap.markCorner(i, false);
      }
      this.guesser.rewind(n, this.lap);
      this.evidence = this.evidence.filter((e) => e.corner < n);
      this.nextCorner = n;
      this.lineup.update(this.guesser.guesses(), this.guesser.seen);
      this.showEvidence(this.evidence[this.evidence.length - 1] ?? null);
    }
    // While paused the loop does not move the car, so place it here.
    this.world.setCarS(smp.s);
    this.telemetry.update(smp.s, this.t, smp.speed, smp.gear, smp.throttle, smp.brake);
    this.minimap.update(smp.s, null);
  }

  private driverOf(code: string): DriverInfo {
    return Object.values(this.session.drivers).find((d) => d.code === code)!;
  }

  private async reveal() {
    this.phase = "reveal";
    // The chequered flag: a moment on the finished lap before the answer, not a jump cut.
    this.root.dataset.phase = "flag";
    const flag = document.createElement("div");
    flag.className = "flag-card";
    flag.innerHTML = `<p class="caps">Lap complete</p><b class="num">${formatLapTime(this.lap.lapTime)}</b><p class="caps">Who was it?</p>`;
    this.root.querySelector(".stage-frame")?.appendChild(flag);
    this.engine.setActive(false, 1.2);
    await new Promise((r) => setTimeout(r, 1500));
    if (this.disposed) return;
    flag.classList.add("out");
    setTimeout(() => flag.remove(), 500);
    this.root.dataset.phase = "reveal";
    this.engine.update(5000, 0, 0, 0);
    // Cut the engine quickly: the team radio is quiet and must not fight it.
    this.engine.setActive(false, 0.3);
    this.world.mode = "orbit";
    this.world.revealLine(true);
    const truth = this.lap.code;
    const driver = this.driverOf(truth);
    this.world.setCarColours(driver.colour);
    const [careers, results] = await Promise.all([loadCareers(), loadResults()]);
    if (this.disposed) return;
    const career = careerLine(careers.drivers[truth]);
    const context = this.sessionLine(results[String(this.session.key)]);
    const guesses = this.guesser.guesses();
    const modelPick = guesses[0].code;
    const rank = guesses.findIndex((g) => g.code === truth) + 1;
    const teamOf = (code: string) => this.driverOf(code)?.team;
    const outcome = (code: string | null) => (code === truth ? "right" : code && teamOf(code) === driver.team ? "teammate" : "wrong");
    const points = (o: string, hints: number) => (o === "right" ? Math.max(1, 3 - hints) : o === "teammate" ? 1 : 0);
    const youOutcome = outcome(this.lineup.pick);
    const modelOutcome = outcome(modelPick);
    const you = points(youOutcome, this.hints);
    const model = points(modelOutcome, 0);
    this.root.querySelector(".hints")?.classList.add("done");
    this.score = { you: this.score.you + you, model: this.score.model + model, rounds: this.score.rounds + 1 };
    writeScore(this.score, this.scoreKey);
    this.lineup.reveal(truth);
    const scoreEl = this.root.querySelector(".play-bar .score");
    if (scoreEl) scoreEl.innerHTML = `You <b>${this.score.you}</b> <span>·</span> Model <b>${this.score.model}</b>`;

    const verdict = (who: string, o: string, pts: number, code: string | null, hints = 0) =>
      `<span class="tag ${o === "right" ? "win" : o === "teammate" ? "half" : "miss"}">${who}: ${code ?? "no guess"} · ${o}${o === "right" && hints ? ` with ${hints} hint${hints > 1 ? "s" : ""}` : ""} · +${pts}</span>`;

    // The corners that pointed hardest at the real driver.
    const best = [...this.evidence].sort((a, b) => (b.deltas[truth] ?? 0) - (a.deltas[truth] ?? 0)).slice(0, 3);
    const cornerById = new Map(this.session.corners.map((c, i) => [i, c]));

    // The duel rival: whoever the model picked, or its runner-up when it was right.
    const rivalCode = modelPick !== truth ? modelPick : guesses[1]?.code;
    const rival = [...this.session.laps].filter((l) => l.code === rivalCode).sort((a, b) => a.lapTime - b.lapTime)[0];
    const [first, ...rest] = driver.name.split(" ");

    this.band.className = "band reveal";
    this.band.style.setProperty("--team", driver.colour);
    this.band.style.setProperty("--on-team", inkOn(driver.colour));
    this.band.innerHTML = `
      <div class="who-block">
        <div class="verdicts">${verdict("You", youOutcome, you, this.lineup.pick, this.hints)}${verdict(SHORT_MODEL[this.guesser.model] ?? "Model", modelOutcome, model, modelPick)}</div>
        <h2 class="display" style="--longest:${Math.max(...[first, ...rest].map((w) => w.length))}"><span>${first}</span> ${rest.join(" ")}</h2>
        <p class="caps team">${driver.team} · lap ${this.lap.lapNumber} · ${formatLapTime(this.lap.lapTime)}</p>
        <p class="context num">${context}</p>
        ${career ? `<p class="career num">${career}</p>` : ""}
      </div>
      <div class="facts">
        <p class="stat caps num">Ranked <b>P${rank}</b> of ${guesses.length} · confidence <b>${Math.round((guesses.find((g) => g.code === truth)?.p ?? 0) * 100)}%</b></p>
        ${this.modelTable(truth)}
      </div>
      <div class="why">
        <ol class="caption">${best
          .map((e) => `<li><b>${e.label}</b><span>${capitalise(e.sentence)}${cornerById.get(e.corner)?.braked === false ? " (no braking)" : ""}.</span></li>`)
          .join("")}</ol>
        ${
          this.lap.radio
            ? `<div class="radio"><button type="button" aria-label="Play team radio">${icons.play}</button><span class="wave">${"<i></i>".repeat(32)}</span><span class="label caps">Team radio, this session</span></div>`
            : `<div class="radio none"><span class="label caps">No team radio from ${truth} in this session</span></div>`
        }
      </div>
      <div class="actions">
        <button type="button" class="btn primary" data-next>Next lap ${icons.next}</button>
        ${rival ? `<button type="button" class="btn" data-duel>Race it against ${rival.code}</button>` : ""}
        <a class="btn" href="#/dna/${truth}">${truth}'s driver DNA</a>
        <button type="button" class="btn" data-challenge>Copy challenge link</button>
        <a class="btn ghost" href="#/">${icons.back} Menu</a>
        <p class="caps share-note" aria-live="polite"></p>
      </div>`;

    // Fetch the next random circuit while the player reads the reveal.
    const pool = this.index.sessions.filter((x) => !recent.includes(String(x.key)));
    const next = pool[Math.floor(Math.random() * pool.length)];
    if (next) {
      this.nextKey = next.key;
      void loadSession(next.key).catch(() => (this.nextKey = null));
      void prefetchSurroundings(next.key);
    }
    const card = this.band;
    card.querySelector("[data-next]")!.addEventListener("click", () => void this.newRound());
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
    if (this.lap.radio) void this.setupRadio(card.querySelector(".radio")!, this.lap.radio);
    (card.querySelector("[data-next]") as HTMLElement).focus({ preventScroll: true });
  }

  private startDuel(rival: LapData) {
    this.radio?.pause();
    this.duel = { lap: rival, player: new LapPlayer(rival), code: rival.code };
    this.player = new LapPlayer(this.lap);
    this.t = 0;
    this.phase = "duel";
    this.root.dataset.phase = "duel";
    this.setPaused(false);
    this.world.mode = "heli";
    this.world.setGhostLap(rival);
    this.world.setCarColours(this.driverOf(this.lap.code).colour, this.driverOf(rival.code).colour);
    this.world.snapCamera();
    this.engine.setActive(true);
    const a = this.driverOf(this.lap.code);
    const b = this.driverOf(rival.code);
    const bar = document.createElement("div");
    bar.className = "duel";
    bar.innerHTML = `
      <span class="car" style="background:${a.colour}"></span><b>${a.code}</b><span class="caps">vs</span><span class="car" style="background:${b.colour}"></span><b>${b.code}</b>
      <span class="gap num">+0.000 s</span>
      <span class="caps where">Same session</span>
      <button type="button" class="btn" data-back>${icons.back} Back to result</button>`;
    bar.querySelector("[data-back]")!.addEventListener("click", () => this.endDuel());
    this.band.appendChild(bar);
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
    this.minimap.update(a.s, b.s, this.driverOf(d.code).colour, this.driverOf(this.lap.code).colour);
    // Gap at the first car's position: how long ago the rival passed the same point.
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
    this.root.dataset.phase = "reveal";
    this.world.setGhostS(null);
    this.world.setGhostLap(null);
    this.world.setCarS(0);
    this.minimap.update(0, null);
    this.world.mode = "orbit";
    this.engine.setActive(false, 1.5);
    this.root.querySelector(".duel")?.remove();
  }

  private async setupRadio(box: HTMLElement, url: string) {
    const audio = new Audio(url);
    audio.volume = this.engine.volume;
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
