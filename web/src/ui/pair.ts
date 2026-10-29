// Which is which: two real laps from one qualifying session on the track together, two names, and
// one question: which car is which? The model reads both laps corner by corner. With two laps to
// compare it is right far more often than when it picks one driver from the whole field.
//
// The two cars share one line, the plain car on the left and the red car on the right, and each
// lays its own rubber (red where it braked) and shows a brake light. By default the red car's lap
// is nudged on the straights so both cars reach every braking zone together ("Level"): who brakes
// first, who carries more speed and who is back on the power first then shows in the picture.
// Through the corners both laps run in real time.
import { gearRatios, EngineSynth, VOLUME_KEY } from "../audio/engine";
import type { CornerZone, DriverInfo, Index, LapData, Session } from "../data";
import { loadSession, prefetchSurroundings } from "../data";
import { formatLapTime, LapPlayer } from "../lap";
import type { Sample } from "../lap";
import { FEATURE_SHORT, Guesser } from "../model";
import type { CameraMode, World } from "../scene/world";
import { icons } from "./icons";
import { Minimap } from "./minimap";
import { inkOn } from "./play";
import { dockStage, stageDocked } from "./stage";

type Phase = "loading" | "lights" | "lap" | "reveal";
type Car = "A" | "B";
type Clock = "level" | "real";

const SCORE_KEY = "blindlap.score.v2.pair";
const SPEED_KEY = "blindlap.speed.v1";
const CLOCK_KEY = "blindlap.pair.clock.v1";
const RED = "#e10600";
// The cameras of a normal lap, in the order C cycles through them. The close ones follow the car
// picked under "Camera on".
const CAMERAS: [CameraMode, string, string][] = [
  ["chase", "Chase", "Behind the car the camera is on"],
  ["onboard", "Onboard", "From that car's cockpit"],
  ["side", "Side", "Alongside that car, the other one beyond it"],
  ["tv", "TV", "A broadcast camera, high and zoomed in"],
  ["heli", "Above", "From above: both cars in view"],
];
const CAR_NAME: Record<Car, string> = { A: "Plain car", B: "Red car" };
// Never "100% sure": the model is wrong now and then even when it is very sure.
const shown = (p: number) => Math.min(99, Math.round(p * 100));

// Level: each corner's real-time stretch starts LEAD m before the first of the two braking points
// and ends EXIT m after the later of the two returns to full throttle. Between stretches the red
// car's clock runs at most MAX_RATE faster or slower; stretches closer than MIN_GAP m run as one.
const LEAD = 90;
const EXIT = 30;
const MIN_GAP = 60;
const MAX_RATE = 0.1;

/** The difference between the two laps at a corner, red against plain, in the direction that reads
 * as "more": "brakes 9 m later", never "brakes 9 m earlier" for the other car. */
const PAIR_TEXT: Record<string, { min: number; text: (v: string) => string }> = {
  brake_point: { min: 3, text: (v) => `brakes ${v} m later` },
  brake_length: { min: 3, text: (v) => `stays on the brake ${v} m longer` },
  entry_speed: { min: 2, text: (v) => `arrives ${v} km/h faster` },
  apex_speed: { min: 2, text: (v) => `carries ${v} km/h more through the apex` },
  apex_offset: { min: 4, text: (v) => `reaches its slowest point ${v} m later` },
  throttle_point: { min: 4, text: (v) => `is back on full throttle ${v} m later` },
  min_throttle: { min: 4, text: (v) => `lifts ${v}% less` },
  coast: { min: 4, text: (v) => `coasts ${v} m more` },
  throttle_ramp: { min: 5, text: (v) => `squeezes the throttle on over ${v} m more` },
  partial_throttle: { min: 5, text: (v) => `holds part-throttle ${v} m more` },
};

const REAL_NOTE =
  "<b>Real, from the cars:</b> each car's speed, gear, throttle, brake and timing, about four times a second. The rear light and the red rubber show the real brake channel. " +
  "<b>Drawn:</b> where across the road each car is. The position data puts every car on the same line, so both share one: the plain car on the left, the red car on the right. " +
  "<b>Level into corners:</b> the red car's lap runs up to 10% faster or slower on the straights, so both cars reach every braking zone together. Through each corner both run in real time. " +
  "<b>Real gap</b> plays both laps exactly as driven. " +
  "<b>The guess:</b> the model reads every corner of both laps. It never saw this circuit.";

interface Score {
  you: number;
  model: number;
  rounds: number;
}

function readScore(): Score {
  try {
    const s = JSON.parse(localStorage.getItem(SCORE_KEY) ?? "");
    if (typeof s?.you === "number") return s;
  } catch {
    /* first visit or storage blocked */
  }
  return { you: 0, model: 0, rounds: 0 };
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

function readClock(): Clock {
  try {
    return localStorage.getItem(CLOCK_KEY) === "real" ? "real" : "level";
  } catch {
    return "level";
  }
}

function capitalise(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Each corner's real-time stretch, and the red car's clock against the plain car's: in Level the
 * red car's lap time is t + offset(t), where offset changes only between stretches, smoothly. */
class LevelClock {
  private segs: { t0: number; t1: number; o0: number; o1: number }[] = [];
  /** Per corner: where its stretch starts and ends (metres). Corners run together share one. */
  readonly spots: { p: number; e: number }[] = [];

  constructor(a: LapPlayer, b: LapPlayer, corners: CornerZone[]) {
    const dA = a.lap.t.map((t) => a.at(t).s);
    const dB = b.lap.t.map((t) => b.at(t).s);
    let prevE = -Infinity;
    let prevApex = -Infinity;
    let tEnd = 0;
    let o = 0;
    for (const c of corners) {
      const from = Math.max(c.s - 450, prevApex + 10);
      const brake = (lap: LapData, d: number[]) => {
        for (let k = 0; k < d.length && d[k] <= c.s; k++) if (d[k] >= from && lap.brk[k] > 0) return d[k];
        return c.s;
      };
      const power = (lap: LapData, d: number[]) => {
        for (let k = 0; k < d.length; k++) if (d[k] >= c.s && lap.thr[k] >= 95) return Math.min(d[k], c.s + 300);
        return c.hi;
      };
      const p = Math.min(brake(a.lap, dA), brake(b.lap, dB)) - LEAD;
      const e = Math.max(power(a.lap, dA), power(b.lap, dB), c.s) + EXIT;
      prevApex = c.s;
      if (p - prevE < MIN_GAP) {
        // Too close to the last stretch: run on through it in real time.
        const last = this.spots[this.spots.length - 1];
        prevE = Math.max(prevE, e);
        if (last) last.e = prevE;
        this.spots.push(last ?? { p, e });
        tEnd = a.timeAt(prevE);
        continue;
      }
      const tp = a.timeAt(p);
      const span = Math.max(0, tp - tEnd);
      const target = b.timeAt(p) - tp;
      const next = o + Math.max(-MAX_RATE * span, Math.min(MAX_RATE * span, target - o));
      this.segs.push({ t0: tEnd, t1: tp, o0: o, o1: next });
      o = next;
      prevE = e;
      tEnd = a.timeAt(e);
      this.spots.push({ p, e });
    }
  }

  offset(t: number): number {
    let o = 0;
    for (const g of this.segs) {
      if (t < g.t0) return o;
      if (t <= g.t1) {
        const u = (t - g.t0) / (g.t1 - g.t0 || 1);
        return g.o0 + (g.o1 - g.o0) * u * u * (3 - 2 * u);
      }
      o = g.o1;
    }
    return o;
  }
}

interface Side {
  lap: LapData;
  player: LapPlayer;
  guesser: Guesser;
  ratios: number[];
  next: number; // next corner to read
  t: number;
  smp: Sample;
}

const recent: number[] = [];

export class PairView {
  readonly root: HTMLDivElement;
  private phase: Phase = "loading";
  private session!: Session;
  private cars!: Record<Car, Side>;
  private clock!: LevelClock;
  private clockMode = readClock();
  private mix = 1; // how far the red car's clock is levelled: eases between 0 (real) and 1 (level)
  private follow: Car = "A";
  private target = ""; // the driver the question names
  private other = "";
  private pick: Car | null = null;
  private t = 0; // the plain car's lap time
  private marked = 0; // corners both cars have passed
  private speed = readSpeed();
  private paused = false;
  private lightsAt = 0;
  private goAt = 0;
  private replay: { to: number } | null = null;
  private minimap!: Minimap;
  private band!: HTMLElement;
  private side!: HTMLElement;
  private score = readScore();
  private disposed = false;
  private starting = false;
  private keyHandler = (e: KeyboardEvent) => this.onKey(e);
  private visibilityHandler = () => {
    if (document.hidden) {
      if (this.phase === "lap") this.setPaused(true);
      this.engine.suspend();
    } else {
      this.engine.resume();
    }
  };

  constructor(
    private world: World,
    private engine: EngineSynth,
    private index: Index,
  ) {
    this.root = document.createElement("div");
    this.root.className = "play pair";
    window.addEventListener("keydown", this.keyHandler);
    document.addEventListener("visibilitychange", this.visibilityHandler);
    void this.newRound();
  }

  dispose() {
    this.disposed = true;
    window.removeEventListener("keydown", this.keyHandler);
    document.removeEventListener("visibilitychange", this.visibilityHandler);
    this.engine.setActive(false);
    this.world.follow = "car";
    this.world.setGhostS(null);
    document.body.classList.remove("playing");
  }

  private async newRound() {
    if (this.starting) return;
    this.starting = true;
    try {
      await this.loadRound();
    } finally {
      this.starting = false;
    }
  }

  private driverOf(code: string): DriverInfo {
    return Object.values(this.session.drivers).find((d) => d.code === code)!;
  }

  private async loadRound() {
    this.phase = "loading";
    this.paused = false;
    this.pick = null;
    this.replay = null;
    this.t = 0;
    this.marked = 0;
    if (!this.root.querySelector(".stage-frame")) {
      this.root.dataset.phase = "loading";
      dockStage(null);
      this.root.innerHTML = `<p class="loading caps">Loading two laps…</p>`;
    } else {
      this.root.classList.add("next-loading");
    }
    const pool = this.index.sessions.filter((s) => !recent.includes(s.key));
    const summary = (pool.length ? pool : this.index.sessions)[Math.floor(Math.random() * (pool.length || this.index.sessions.length))];
    recent.push(summary.key);
    if (recent.length > Math.min(6, this.index.sessions.length - 1)) recent.shift();
    try {
      [this.session] = await Promise.all([loadSession(summary.key), prefetchSurroundings(summary.key)]);
    } catch (e) {
      dockStage(null);
      this.root.classList.remove("next-loading");
      this.root.innerHTML = `<div class="error"><p>Couldn't load ${summary.circuit}: ${(e as Error).message}.</p><a class="btn" href="#/">Back to menu</a></div>`;
      return;
    }
    if (this.disposed) return;

    // Two drivers the model knows, with laps close in time so the cars run together.
    const known = new Set(this.session.model.classes);
    const laps = this.session.laps.filter((l) => known.has(l.code));
    const a = laps[Math.floor(Math.random() * laps.length)];
    const near = laps
      .filter((l) => l.code !== a.code)
      .sort((x, y) => Math.abs(x.lapTime - a.lapTime) - Math.abs(y.lapTime - a.lapTime))
      .slice(0, 4);
    const b = near[Math.floor(Math.random() * near.length)];
    const [plain, red] = Math.random() < 0.5 ? [a, b] : [b, a];
    const codes = [plain.code, red.code];
    const model = this.index.models[0].id;
    const side = (lap: LapData): Side => {
      const player = new LapPlayer(lap);
      return { lap, player, guesser: new Guesser(this.session, this.index, codes, model), ratios: gearRatios(lap.v, lap.rpm, lap.gear), next: 0, t: 0, smp: player.at(0) };
    };
    this.cars = { A: side(plain), B: side(red) };
    this.clock = new LevelClock(this.cars.A.player, this.cars.B.player, this.session.corners);
    this.mix = this.clockMode === "level" ? 1 : 0;
    [this.target, this.other] = Math.random() < 0.5 ? codes : [codes[1], codes[0]];

    this.world.setSession(this.session);
    this.world.setPair(plain, red);
    this.world.hideLivery();
    this.world.showCar(true);
    this.world.follow = this.follow === "A" ? "car" : "ghost";
    this.world.mode = "chase";
    document.body.classList.add("playing");
    dockStage(null);
    this.root.classList.remove("next-loading");
    this.build();
    this.place();
    this.world.snapCamera();
    this.phase = "lights";
    this.root.dataset.phase = "lights";
    this.lightsAt = performance.now();
    this.goAt = this.lightsAt + 5 * 700 + 400 + Math.random() * 900;
    this.engine.start();
    this.engine.setActive(true);
  }

  private build() {
    const s = this.session;
    const t = this.driverOf(this.target);
    const o = this.driverOf(this.other);
    this.root.innerHTML = "";
    const bar = document.createElement("header");
    bar.className = "play-bar";
    bar.innerHTML = `
      <a class="back" href="#/" aria-label="Back to the menu" title="Back to the menu (Esc)">${icons.back}<span>Menu</span></a>
      <div class="where">
        <h1 class="display">${s.circuit} <span class="year">${s.date.slice(0, 4)}</span></h1>
        <p class="caps">Which is which · round ${this.score.rounds + 1} · ${(s.length / 1000).toFixed(3)} km</p>
      </div>
      <p class="score caps num">You <b>${this.score.you}</b> <span>·</span> Model <b>${this.score.model}</b></p>
      <div class="controls">
        <button type="button" class="ctl" data-pause aria-pressed="false" title="Pause (Space)">${icons.pause}<span>Pause</span></button>
        <div class="seg" role="group" aria-label="Playback speed">
          ${[1, 2, 4].map((v) => `<button type="button" data-speed="${v}" aria-pressed="${v === this.speed}" title="Play the laps at ${v === 1 ? "real speed" : `${v} times real speed`}">${v}×</button>`).join("")}
        </div>
        <div class="seg cams" role="group" aria-label="Camera">
          ${CAMERAS.map(([id, label, title]) => `<button type="button" data-cam="${id}" aria-pressed="${id === this.world.mode}" title="${title} (C to cycle, drag the view to look around)"><span>${label}</span></button>`).join("")}
        </div>
        <button type="button" class="ctl" data-real aria-expanded="false" title="What is real data and what is drawn">${icons.info}<span>What's real</span></button>
        <button type="button" class="ctl" data-sound aria-pressed="${!this.engine.muted}" aria-label="Engine sound" title="Engine sound on or off (the car the camera is on, made live from its speed, gear and throttle)">${this.engine.muted ? icons.soundOff : icons.soundOn}<span>Sound</span></button>
        <label class="volume" title="Volume of the engine"><span class="caps">Vol</span><input type="range" min="0" max="100" step="1" value="${Math.round(this.engine.volume * 100)}" aria-label="Volume"></label>
      </div>`;
    bar.querySelector<HTMLInputElement>(".volume input")!.addEventListener("input", (e) => {
      const v = Number((e.target as HTMLInputElement).value) / 100;
      this.engine.setVolume(v);
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
        if (this.phase === "lap") this.setPaused(!this.paused);
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
      } else if (b.hasAttribute("data-real")) {
        const open = !this.root.classList.contains("show-real");
        this.root.classList.toggle("show-real", open);
        b.setAttribute("aria-expanded", String(open));
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
        <p class="caps reminder">Plain car on the left, red car on the right. Which one is ${t.code}? Watch where each one brakes.</p></div>
      <p class="paused-note caps" aria-live="polite">Paused · Space to resume</p>
      <aside class="real-note" aria-label="What is real"><p>${REAL_NOTE}</p><p class="keys caps">Keys · Space pause · C camera · F other car · L level or real · ← → 5 seconds · 1 2 your pick · Esc menu · drag the view to look around</p><button type="button" class="btn" data-real-close>Got it</button></aside>`;
    stage.querySelector("[data-real-close]")!.addEventListener("click", () => {
      this.root.classList.remove("show-real");
      this.root.querySelector("[data-real]")?.setAttribute("aria-expanded", "false");
    });
    const w = this.world;
    this.minimap = new Minimap(s.circuit, w.outline(), s.corners.map((c) => ({ s: c.s, n: c.n })), s.length, (d) => w.pointAt(d));
    stage.appendChild(this.minimap.root);

    // Hold the left button (or a finger) and drag to look around; double-click to reset.
    let drag: { x: number; y: number; id: number } | null = null;
    stage.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || this.phase === "loading" || this.phase === "lights") return;
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

    this.side = document.createElement("aside");
    this.side.className = "side pair-side";
    this.side.innerHTML = `
      <section class="pair-q">
        <p class="caps">Which car is</p>
        <h2 class="display">${t.name}?</h2>
        <p class="pair-names">One car is <b>${t.name}</b> (${t.team}), the other <b>${o.name}</b> (${o.team}). Both laps are from this session.</p>
        <div class="pair-pick" role="group" aria-label="Your guess">
          ${(["A", "B"] as Car[]).map((c) => `<button type="button" data-car="${c}" aria-pressed="false" title="${CAR_NAME[c]} is ${t.code} (key ${c === "A" ? 1 : 2})"><i class="sw ${c === "A" ? "plain" : "red"}"></i><span>${CAR_NAME[c]}</span></button>`).join("")}
        </div>
        <p class="pair-hint">Pick any time before both cars finish; you can change your mind. Right: 1 point.</p>
      </section>
      <section class="pair-view">
        <p class="caps">The two laps</p>
        <div class="seg" role="group" aria-label="How the two laps run">
          <button type="button" data-clock="level" aria-pressed="${this.clockMode === "level"}" title="Both cars reach every braking zone together (L)">Level into corners</button>
          <button type="button" data-clock="real" aria-pressed="${this.clockMode === "real"}" title="Both laps exactly as driven (L)">Real gap</button>
        </div>
        <p class="pair-view-note" data-k="clock-note"></p>
        <p class="caps">Camera on</p>
        <div class="seg" role="group" aria-label="Which car the camera follows">
          ${(["A", "B"] as Car[]).map((c) => `<button type="button" data-follow="${c}" aria-pressed="${this.follow === c}" title="The close cameras follow the ${CAR_NAME[c].toLowerCase()} (F)"><i class="sw ${c === "A" ? "plain" : "red"}"></i>${c === "A" ? "Plain" : "Red"}</button>`).join("")}
        </div>
      </section>
      <section class="pair-model" aria-live="polite">
        <header class="caps"><span>The model's read</span><span class="num" data-k="read">0 corners</span></header>
        <div class="pair-split" role="img" aria-label="How sure the model is"><i class="a" style="width:50%"></i><i class="b" style="width:50%"></i></div>
        <p class="pair-split-key num"><span>Plain is ${t.code}</span><span>Red is ${t.code}</span></p>
        <p class="call" data-level="none">The model reads every corner as each car leaves it.</p>
      </section>`;
    this.side.querySelector(".pair-pick")!.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-car]");
      if (b) this.choose(b.dataset.car as Car);
    });
    this.side.querySelector(".pair-view")!.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
      if (!b) return;
      if (b.dataset.clock) this.setClock(b.dataset.clock as Clock);
      else if (b.dataset.follow) this.setFollow(b.dataset.follow as Car);
      b.blur();
    });
    this.clockNote();

    this.band = document.createElement("section");
    this.band.className = "band pair-band";
    const cars = (["A", "B"] as Car[])
      .map(
        (c) => `
        <div class="pair-tm" data-car="${c}">
          <p class="caps"><i class="sw ${c === "A" ? "plain" : "red"}"></i>${CAR_NAME[c]} · ${c === "A" ? "left" : "right"}</p>
          <b class="num" data-k="speed">0</b><span class="caps unit">km/h</span>
          <span class="caps">Gear <b class="num" data-k="gear">N</b></span>
          <span class="meters caps"><span>Thr</span><i class="meter thr"><em data-k="thr"></em></i><span>Brk</span><i class="meter brk"><em data-k="brk"></em></i></span>
          <span class="num clock" data-k="clock">0:00.000</span>
        </div>`,
      )
      .join("");
    this.band.innerHTML = `${cars}
      <div class="tm-lap pair-lap">
        <div class="tm-lap-head caps">
          <span>Lap</span>
          <span class="tm-jump">
            <button type="button" data-jump="-5" aria-label="Back 5 seconds" title="Back 5 seconds (left arrow)">−5 s</button>
            <button type="button" data-jump="5" aria-label="Forward 5 seconds" title="Forward 5 seconds (right arrow)">+5 s</button>
          </span>
          <span class="pair-gap"><span data-k="where">Side by side</span> <b class="num" data-k="gap">0.000 s</b></span>
        </div>
        <div class="tm-rule"><em data-k="progress"></em><i class="pair-rival" data-k="rival"></i>${s.corners
          .map((c) => `<span class="tick" style="left:${(c.s / s.length) * 100}%" title="Turn ${c.n}"></span>`)
          .join("")}<input class="tm-seek" type="range" min="0" max="${Math.round(s.length)}" step="1" value="0" aria-label="Position in the lap" title="Drag to move through the laps. Going back, the model forgets the corners after that point." disabled></div>
      </div>
      <div class="evidence" aria-live="polite"></div>`;
    const seek = this.band.querySelector<HTMLInputElement>(".tm-seek")!;
    seek.addEventListener("input", () => this.seekTo(this.cars.A.player.timeAt(Number(seek.value))));
    this.band.querySelectorAll<HTMLButtonElement>("[data-jump]").forEach((b) => {
      b.disabled = true;
      b.addEventListener("click", () => this.seekTo(this.t + Number(b.dataset.jump)));
    });
    this.showEvidence(null);

    this.root.append(bar, stage, this.side, this.band);
    dockStage(stage.querySelector(".stage-slot"));
  }

  private choose(car: Car) {
    if (this.phase === "reveal" || this.phase === "loading") return;
    this.pick = car;
    this.side.querySelectorAll<HTMLButtonElement>("[data-car]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.car === car)));
  }

  private setCamera(mode: CameraMode) {
    if (this.phase === "reveal" && !this.replay) return;
    this.world.mode = mode;
    this.root.querySelectorAll("[data-cam]").forEach((x) => x.setAttribute("aria-pressed", String((x as HTMLElement).dataset.cam === mode)));
  }

  /** Level or real: the red car eases to its new place over about a second, never jumps. */
  private setClock(mode: Clock) {
    this.clockMode = mode;
    try {
      localStorage.setItem(CLOCK_KEY, mode);
    } catch {
      /* ignore */
    }
    this.side.querySelectorAll("[data-clock]").forEach((x) => x.setAttribute("aria-pressed", String((x as HTMLElement).dataset.clock === mode)));
    this.clockNote();
  }

  private clockNote() {
    const note = this.side.querySelector("[data-k=clock-note]");
    if (note)
      note.textContent =
        this.clockMode === "level"
          ? "Both cars reach every braking zone together; each corner then runs in real time. Watch who brakes first and who is back on the power first."
          : "Both laps exactly as driven: the gap on track is the real one.";
  }

  /** Which car the close cameras follow (and the engine sound comes from). */
  private setFollow(car: Car) {
    this.follow = car;
    this.world.follow = car === "A" ? "car" : "ghost";
    // From where the camera is now, glide to the other car.
    this.world.snapCamera();
    this.side.querySelectorAll("[data-follow]").forEach((x) => x.setAttribute("aria-pressed", String((x as HTMLElement).dataset.follow === car)));
  }

  private setPaused(on: boolean) {
    this.paused = on;
    this.engine.setActive(!on, 0.15);
    this.root.classList.toggle("paused", on);
    const btn = this.root.querySelector<HTMLButtonElement>("[data-pause]");
    if (btn) {
      btn.innerHTML = on ? `${icons.play}<span>Resume</span>` : `${icons.pause}<span>Pause</span>`;
      btn.setAttribute("aria-pressed", String(on));
    }
  }

  private onKey(e: KeyboardEvent) {
    const t = e.target;
    if (t instanceof HTMLSelectElement || (t instanceof HTMLInputElement && t.type !== "range")) return;
    if (e.key === " ") {
      e.preventDefault();
      if (!e.repeat && this.phase === "lap") this.setPaused(!this.paused);
    } else if (e.key === "c" || e.key === "C") {
      const i = CAMERAS.findIndex(([id]) => id === this.world.mode);
      this.setCamera(CAMERAS[(i + 1) % CAMERAS.length][0]);
    } else if (e.key === "f" || e.key === "F") {
      if (this.phase !== "loading") this.setFollow(this.follow === "A" ? "B" : "A");
    } else if (e.key === "l" || e.key === "L") {
      if (this.phase !== "loading") this.setClock(this.clockMode === "level" ? "real" : "level");
    } else if (e.key === "1" || e.key === "2") {
      this.choose(e.key === "1" ? "A" : "B");
    } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && this.phase === "lap") {
      e.preventDefault();
      this.seekTo(this.t + (e.key === "ArrowLeft" ? -5 : 5));
    } else if (e.key === "Escape") {
      location.hash = "#/";
    } else if (e.key === "Enter" && this.phase === "reveal") {
      void this.newRound();
    }
  }

  /** P(plain car is the named driver): the two ways to hand out the names, each scored by both laps. */
  private plainIsTarget(): number {
    const a = this.cars.A.guesser.scores();
    const b = this.cars.B.guesser.scores();
    // The temperature fitted for this question on held-out laps, so the percentage stays honest.
    const tau = this.index.models[0].confidence?.pair.tau ?? this.index.models[0].tau;
    const odds = (a[this.target] + b[this.other] - (a[this.other] + b[this.target])) / tau;
    return 1 / (1 + Math.exp(-odds));
  }

  /** The red car's lap time while the plain car's is t. A corner replay is always level. */
  private timeB(t: number): number {
    const mix = this.replay ? 1 : this.mix;
    return Math.max(0, Math.min(t + mix * this.clock.offset(t), this.cars.B.player.duration));
  }

  /** The real gap where the plain car is at distance d: how long before it the red car got there
   * (positive: the red car is ahead). */
  private gapAt(d: number): number {
    return this.cars.A.player.timeAt(d) - this.cars.B.player.timeAt(d);
  }

  /** Put both cars where their laps are at the plain car's time this.t, and update the readouts. */
  private place() {
    const { A, B } = this.cars;
    A.t = Math.min(this.t, A.player.duration);
    B.t = this.timeB(this.t);
    const a = (A.smp = A.player.at(A.t));
    const b = (B.smp = B.player.at(B.t));
    this.world.setCarS(a.s);
    this.world.setGhostS(b.s, b.brake);
    this.minimap.update(a.s, b.s, RED, "var(--ink)");
    this.readout("A", a, A.t);
    this.readout("B", b, B.t);
    const L = this.session.length;
    const q = (k: string) => this.band.querySelector<HTMLElement>(`[data-k=${k}]`);
    const progress = q("progress");
    if (progress) progress.style.width = `${Math.max(0, Math.min(1, a.s / L)) * 100}%`;
    const rival = q("rival");
    if (rival) rival.style.left = `${Math.max(0, Math.min(1, b.s / L)) * 100}%`;
    const seek = this.band.querySelector<HTMLInputElement>(".tm-seek");
    if (seek && !seek.matches(":active")) seek.value = String(Math.round(a.s));
    const gap = this.gapAt(Math.max(0, a.s));
    const g = q("gap");
    if (g) g.textContent = `${Math.abs(gap).toFixed(3)} s`;
    const where = q("where");
    if (where) where.textContent = Math.abs(gap) < 0.005 ? "Real gap · level" : `Real gap · ${gap > 0 ? "red" : "plain"} ahead by`;
  }

  /** Read the corners each car has passed; once both have, mark the corner and say how they differed. */
  private readCorners() {
    const corners = this.session.corners;
    for (const car of ["A", "B"] as Car[]) {
      const side = this.cars[car];
      const done = side.t >= side.player.duration;
      while (side.next < corners.length && (done || side.smp.s > corners[side.next].hi)) {
        side.guesser.ingest(side.lap, side.next++);
        this.refreshRead();
      }
    }
    while (this.marked < Math.min(this.cars.A.next, this.cars.B.next)) this.markCorner(this.marked++);
  }

  private markCorner(c: number) {
    const corner = this.session.corners[c];
    const cmp = this.compare(c, { A: "the plain car", B: "the red car" }, { A: "Plain", B: "Red" });
    this.world.markEvidence(c, corner.lo, corner.hi, cmp.short);
    this.minimap.markCorner(c, true);
    this.band.querySelectorAll(".tm-rule .tick")[c]?.classList.add("read");
    this.showEvidence(c, true);
  }

  private refreshRead() {
    const p = this.plainIsTarget();
    const seen = this.cars.A.guesser.seen + this.cars.B.guesser.seen;
    this.side.querySelector("[data-k=read]")!.textContent = `${seen} corners`;
    const split = this.side.querySelectorAll<HTMLElement>(".pair-split i");
    split[0].style.width = `${p * 100}%`;
    split[1].style.width = `${(1 - p) * 100}%`;
    const sure = Math.max(p, 1 - p);
    const lead = p >= 0.5 ? "plain" : "red";
    const call = this.side.querySelector<HTMLElement>(".call")!;
    if (seen < 4) {
      call.textContent = seen ? "Still reading the first corners…" : "The model reads every corner as each car leaves it.";
      call.dataset.level = "none";
    } else {
      const word = sure >= 0.95 ? "Very sure" : sure >= 0.8 ? "Fairly sure" : sure >= 0.6 ? "Leaning" : "Not sure yet";
      call.innerHTML = `<b>${word}</b> · the ${lead} car is ${this.target} · ${shown(sure)}%`;
      call.dataset.level = sure >= 0.8 ? "high" : sure >= 0.6 ? "mid" : "low";
    }
  }

  /** How the two laps differed at corner c, from the real telemetry: the one or two biggest
   * differences for that corner (measured against how much drivers usually differ there), and the
   * time one car took out of the other through it. */
  private compare(c: number, long: Record<Car, string>, short: Record<Car, string>): { sentence: string; short: string } {
    const { A, B } = this.cars;
    const corner = this.session.corners[c];
    const scale = this.session.field.scale[c];
    const found = this.index.features
      .map((f, k) => {
        const ra = A.lap.raw[c]?.[k];
        const rb = B.lap.raw[c]?.[k];
        const spec = PAIR_TEXT[f];
        if (ra == null || rb == null || !spec || (!corner.braked && k <= 2)) return null;
        const d = rb - ra;
        if (Math.abs(d) < spec.min) return null;
        return { f, d, score: Math.abs(d) / Math.max(scale?.[k] ?? 1, 0.5) };
      })
      .filter((x): x is { f: string; d: number; score: number } => x !== null)
      .sort((x, y) => y.score - x.score)
      .slice(0, 2);
    const spot = this.clock.spots[c];
    const gain = spot ? this.gapAt(spot.e) - this.gapAt(spot.p) : 0; // positive: the red car gained
    const gainText = Math.abs(gain) >= 0.01 ? `; ${long[gain > 0 ? "B" : "A"]} gains ${Math.abs(gain).toFixed(2)} s through it` : "";
    if (!found.length) return { sentence: `Both take it alike${gainText}`, short: "alike" };
    const who = (d: number): Car => (d > 0 ? "B" : "A");
    const part = (x: { f: string; d: number }) => PAIR_TEXT[x.f].text(Math.abs(x.d).toFixed(0));
    const [first, second] = found;
    let sentence = `${capitalise(long[who(first.d)])} ${part(first)}`;
    if (second) sentence += who(second.d) === who(first.d) ? ` and ${part(second)}` : `; ${long[who(second.d)]} ${part(second)}`;
    return { sentence: sentence + gainText, short: `${short[who(first.d)]} ${FEATURE_SHORT[first.f](Math.abs(first.d))}` };
  }

  /** The line under the cars: the last corner both have passed, how they differed there, and which
   * way it pushed the model. */
  private showEvidence(c: number | null, flash = false) {
    const box = this.band.querySelector<HTMLElement>(".evidence");
    if (!box) return;
    if (c === null) {
      box.innerHTML = `<span class="t">${icons.flag}</span><span class="what">Once both cars leave a corner, this line says how they took it differently.</span><span class="who"></span>`;
      return;
    }
    const corner = this.session.corners[c];
    const cmp = this.compare(c, { A: "the plain car", B: "the red car" }, { A: "Plain", B: "Red" });
    const push = this.push(c);
    const says = Math.abs(push) < 0.05 ? "says little" : `points to <b>${push > 0 ? "plain" : "red"} = ${this.target}</b>`;
    box.innerHTML = `<span class="t">T${corner.n}</span><span class="what">${cmp.sentence}.</span><span class="who caps">${says}</span>`;
    if (flash) {
      box.classList.remove("flash");
      void box.offsetWidth;
      box.classList.add("flash");
    }
  }

  /** How far corner c pushed the model toward "the plain car is the named driver" (log-odds). */
  private push(c: number): number {
    const m = this.index.models[0].id;
    const cls = (code: string) => this.session.model.classes.indexOf(code);
    const ra = this.cars.A.lap.steps[m][c];
    const rb = this.cars.B.lap.steps[m][c];
    return (ra[cls(this.target)] - ra[cls(this.other)] + rb[cls(this.other)] - rb[cls(this.target)]) / 10;
  }

  /** Jump the laps to the plain car's time t. Going back, the model forgets the corners after the new
   * place (for each car) and their marks, so it is never ahead of the cars. */
  private seekTo(t: number) {
    if (this.phase !== "lap") return;
    this.t = Math.max(0, Math.min(t, this.cars.A.player.duration - 0.05));
    this.place();
    const corners = this.session.corners;
    for (const car of ["A", "B"] as Car[]) {
      const side = this.cars[car];
      let n = 0;
      while (n < corners.length && side.smp.s > corners[n].hi) n++;
      if (n < side.next) {
        side.guesser.rewind(n, side.lap);
        side.next = n;
      }
    }
    const keep = Math.min(this.cars.A.next, this.cars.B.next);
    for (let i = keep; i < this.marked; i++) {
      this.world.unmarkEvidence(i, corners[i].lo, corners[i].hi);
      this.minimap.markCorner(i, false);
      this.band.querySelectorAll(".tm-rule .tick")[i]?.classList.remove("read");
    }
    if (keep < this.marked) {
      this.marked = keep;
      this.showEvidence(keep ? keep - 1 : null);
    }
    this.refreshRead();
  }

  /** The followed car's engine. */
  private sound() {
    const side = this.cars[this.follow];
    const smp = side.smp;
    const ratio = side.ratios[smp.gear];
    this.engine.update(ratio > 0 && smp.speed > 40 ? smp.speed * ratio : smp.rpm, smp.throttle, smp.speed, smp.gear);
  }

  frame(dt: number) {
    if (this.phase === "loading") {
      if (stageDocked()) this.world.update(dt, 0);
      return;
    }
    // Level and real blend into each other over about a second of real time.
    const want = this.clockMode === "level" ? 1 : 0;
    const blending = this.mix !== want;
    if (blending) this.mix = want > this.mix ? Math.min(want, this.mix + dt / 1.2) : Math.max(want, this.mix - dt / 1.2);
    const followed = () => this.cars[this.follow].smp;
    if (this.phase === "lights") {
      const now = performance.now();
      const lit = Math.min(5, Math.floor((now - this.lightsAt) / 700));
      this.root.querySelectorAll(".lights i").forEach((l, i) => l.classList.toggle("on", i < lit && now < this.goAt));
      this.engine.update(lit >= 5 ? 9000 + Math.random() * 1500 : 4200 + lit * 300, lit >= 5 ? 40 : 4, 0, 1);
      if (now >= this.goAt) {
        this.root.querySelector(".countdown")?.remove();
        this.band.querySelectorAll<HTMLButtonElement | HTMLInputElement>("[data-jump], .tm-seek").forEach((x) => (x.disabled = false));
        this.phase = "lap";
        this.root.dataset.phase = "lap";
      }
      this.world.update(dt, 0);
      return;
    }
    if (this.phase === "lap") {
      if (!this.paused) {
        this.t += dt * this.speed;
        this.place();
        this.sound();
        this.readCorners();
        const { A, B } = this.cars;
        if (A.t >= A.player.duration && B.t >= B.player.duration) void this.reveal();
      } else if (blending) this.place();
      const smp = followed();
      this.world.update(dt, this.paused ? 0 : smp.speed, smp.brake);
      return;
    }
    if (this.phase === "reveal" && this.replay) {
      this.t += dt * 0.5;
      this.place();
      this.sound();
      const smp = followed();
      this.world.update(dt, smp.speed, smp.brake);
      if (this.t >= this.replay.to) this.endReplay();
      return;
    }
    if (blending && this.phase === "reveal") this.place();
    this.world.update(dt, 0);
  }

  private readout(car: Car, smp: Sample, t: number) {
    const box = this.band.querySelector<HTMLElement>(`.pair-tm[data-car="${car}"]`);
    if (!box) return;
    const q = (k: string) => box.querySelector<HTMLElement>(`[data-k=${k}]`)!;
    q("speed").textContent = String(Math.round(smp.speed));
    q("gear").textContent = smp.gear > 0 ? String(smp.gear) : "N";
    q("thr").style.width = `${Math.max(0, Math.min(100, smp.throttle))}%`;
    q("brk").style.width = smp.brake ? "100%" : "0%";
    box.classList.toggle("braking", smp.brake);
    q("clock").textContent = formatLapTime(Math.max(0, t));
  }

  /** Drive one corner again for both cars, from before its stretch to after it, at half speed. */
  private replayCorner(c: number) {
    if (this.phase !== "reveal") return;
    const spot = this.clock.spots[c];
    const A = this.cars.A.player;
    this.t = A.timeAt(Math.max(0, spot.p - 60));
    this.replay = { to: A.timeAt(Math.min(this.session.length - 1, spot.e + 40)) };
    this.place();
    this.world.mode = "chase";
    this.world.snapCamera();
    this.engine.setActive(true);
    this.root.classList.add("replaying");
  }

  private endReplay() {
    this.replay = null;
    this.world.mode = "orbit";
    this.engine.setActive(false, 0.8);
    this.root.classList.remove("replaying");
  }

  private async reveal() {
    this.phase = "reveal";
    // The chequered flag first: a moment on the finished laps before the answer.
    this.root.dataset.phase = "flag";
    const flag = document.createElement("div");
    flag.className = "flag-card";
    flag.innerHTML = `<p class="caps">Both laps complete</p><b class="num">${this.target}?</b><p class="caps">Which car was it?</p>`;
    this.root.querySelector(".stage-frame")?.appendChild(flag);
    this.engine.setActive(false, 1.2);
    this.band.querySelectorAll<HTMLButtonElement | HTMLInputElement>("[data-jump], .tm-seek").forEach((x) => (x.disabled = true));
    await new Promise((r) => setTimeout(r, 1500));
    if (this.disposed) return;
    flag.classList.add("out");
    setTimeout(() => flag.remove(), 500);
    this.root.dataset.phase = "reveal";
    this.world.mode = "orbit";
    // Both laps' rubber, whole: the two braking zones of every corner side by side.
    this.world.revealLine(true);
    const { A, B } = this.cars;
    const truthCar: Car = A.lap.code === this.target ? "A" : "B";
    const p = this.plainIsTarget();
    const modelCar: Car = p >= 0.5 ? "A" : "B";
    const sure = Math.max(p, 1 - p);
    const you = this.pick === truthCar ? 1 : 0;
    const model = modelCar === truthCar ? 1 : 0;
    this.score = { you: this.score.you + you, model: this.score.model + model, rounds: this.score.rounds + 1 };
    try {
      localStorage.setItem(SCORE_KEY, JSON.stringify(this.score));
    } catch {
      /* storage blocked: score lives for this tab only */
    }
    const scoreEl = this.root.querySelector(".play-bar .score");
    if (scoreEl) scoreEl.innerHTML = `You <b>${this.score.you}</b> <span>·</span> Model <b>${this.score.model}</b>`;
    const da = this.driverOf(A.lap.code);
    const db = this.driverOf(B.lap.code);
    this.world.setCarColours(da.colour, db.colour);
    this.side.querySelectorAll<HTMLButtonElement>("[data-car]").forEach((b) => {
      b.disabled = true;
      b.classList.toggle("truth", b.dataset.car === truthCar);
    });

    // The corners that told them apart: each corner's push toward the right answer, both laps.
    const right = truthCar === "A" ? 1 : -1;
    const top = this.session.corners
      .map((_, c) => ({ c, v: this.push(c) * right }))
      .sort((x, y) => y.v - x.v)
      .slice(0, 3);
    const pairRight = this.index.models[0].confidence?.pair.right ?? null;
    const tag = (who: string, ok: boolean, what: string) => `<span class="tag ${ok ? "win" : "miss"}">${who}: ${what} · ${ok ? "right · +1" : "wrong · +0"}</span>`;
    const block = (car: Car, d: DriverInfo, lap: LapData) => `
      <div class="who-block pair-who" style="--team:${d.colour};--on-team:${inkOn(d.colour)};--longest:${Math.max(...d.name.split(" ").map((w) => w.length))}">
        <p class="caps"><i class="sw ${car === "A" ? "plain" : "red"}"></i>${CAR_NAME[car]}</p>
        <h2 class="display">${d.name}</h2>
        <p class="caps team">${d.team} · lap ${lap.lapNumber} · ${formatLapTime(lap.lapTime)}</p>
      </div>`;
    const codes = { A: A.lap.code, B: B.lap.code };
    this.band.className = "band reveal pair-reveal";
    this.band.innerHTML = `
      <div class="verdicts">${tag("You", you === 1, this.pick ? `${CAR_NAME[this.pick].toLowerCase()} is ${this.target}` : "no guess")}${tag("Model", model === 1, `${CAR_NAME[modelCar].toLowerCase()} is ${this.target} · ${shown(sure)}% sure`)}</div>
      ${block("A", da, A.lap)}${block("B", db, B.lap)}
      <div class="why">
        <p class="caps">The corners that told them apart</p>
        <ol class="caption replays">${top
          .map(({ c }) => {
            const corner = this.session.corners[c];
            return `<li><b>T${corner.n}</b><span>${this.compare(c, codes, codes).sentence}.</span><button type="button" class="replay-btn" data-corner="${c}" title="Watch both cars through T${corner.n} again, at half speed">${icons.play}<span>Replay</span></button></li>`;
          })
          .join("")}</ol>
        <p class="pair-note">Two laps to compare make this far easier for the model than naming one driver from the whole field${pairRight != null ? `: on circuits it never saw, it gets the pair the right way round <b>${Math.round(pairRight * 100)}%</b> of the time, against ${Math.round(this.index.models[0].top1 * 100)}% for one driver from the field` : ""}.</p>
      </div>
      <div class="actions">
        <button type="button" class="btn primary" data-next>Next pair ${icons.next}</button>
        <a class="btn" href="#/dna/${this.target}">${this.target}'s driver DNA</a>
        <a class="btn" href="#/">Menu</a>
      </div>`;
    this.band.querySelector("[data-next]")!.addEventListener("click", () => void this.newRound());
    this.band.querySelectorAll<HTMLButtonElement>("[data-corner]").forEach((b) =>
      b.addEventListener("click", () => {
        this.replayCorner(Number(b.dataset.corner));
        b.blur();
      }),
    );
    (this.band.querySelector("[data-next]") as HTMLElement).focus({ preventScroll: true });
  }
}
