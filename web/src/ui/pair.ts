// Which is which: two real laps from one qualifying session on the track together, two names, and
// one question: which car is which? The model reads both laps corner by corner. With two laps to
// compare it is right far more often than when it picks one driver from the whole field.
import { gearRatios, EngineSynth } from "../audio/engine";
import type { DriverInfo, Index, LapData, Session } from "../data";
import { loadSession, prefetchSurroundings } from "../data";
import { formatLapTime, LapPlayer } from "../lap";
import { Guesser } from "../model";
import type { CameraMode, World } from "../scene/world";
import { icons } from "./icons";
import { Minimap } from "./minimap";
import { inkOn } from "./play";
import { dockStage, stageDocked } from "./stage";

type Phase = "loading" | "lights" | "lap" | "reveal";
type Car = "A" | "B";

const SCORE_KEY = "blindlap.score.v2.pair";
const SPEED_KEY = "blindlap.speed.v1";
const RED = "#e10600";
// Above first: both cars stay in view. Chase follows the plain car.
const CAMERAS: [CameraMode, string, string][] = [
  ["heli", "Above", "From above: both cars in view"],
  ["tv", "TV", "A broadcast camera, high and zoomed in"],
  ["chase", "Chase", "Behind the plain car"],
];
const CAR_NAME: Record<Car, string> = { A: "Plain car", B: "Red car" };
// Never "100% sure": the model is wrong now and then even when it is very sure.
const shown = (p: number) => Math.min(99, Math.round(p * 100));

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

interface Side {
  lap: LapData;
  player: LapPlayer;
  guesser: Guesser;
  next: number; // next corner to read
  t: number;
}

const recent: number[] = [];

export class PairView {
  readonly root: HTMLDivElement;
  private phase: Phase = "loading";
  private session!: Session;
  private cars!: Record<Car, Side>;
  private target = ""; // the driver the question names
  private other = "";
  private pick: Car | null = null;
  private t = 0;
  private speed = readSpeed();
  private paused = false;
  private lightsAt = 0;
  private goAt = 0;
  private ratios: number[] = [];
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
    this.world.setGhostS(null);
    this.world.setGhostLap(null);
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
    this.t = 0;
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
    const side = (lap: LapData): Side => ({ lap, player: new LapPlayer(lap), guesser: new Guesser(this.session, this.index, codes, model), next: 0, t: 0 });
    this.cars = { A: side(plain), B: side(red) };
    [this.target, this.other] = Math.random() < 0.5 ? codes : [codes[1], codes[0]];
    this.ratios = gearRatios(plain.v, plain.rpm, plain.gear);

    this.world.setSession(this.session);
    this.world.setLap(plain);
    this.world.setGhostLap(red);
    this.world.setCarS(0);
    this.world.setGhostS(0);
    this.world.hideLivery();
    this.world.showCar(true);
    this.world.mode = "heli";
    this.world.snapCamera();
    document.body.classList.add("playing");
    dockStage(null);
    this.root.classList.remove("next-loading");
    this.build();
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
          ${CAMERAS.map(([id, label, title]) => `<button type="button" data-cam="${id}" aria-pressed="${id === "heli"}" title="${title} (C to cycle)"><span>${label}</span></button>`).join("")}
        </div>
      </div>`;
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
      }
      b.blur();
    });

    const stage = document.createElement("div");
    stage.className = "stage-frame";
    stage.innerHTML = `<div class="stage-slot"></div>
      <div class="countdown"><div class="lights" role="img" aria-label="Start lights">${"<i></i>".repeat(5)}</div>
        <p class="caps reminder">Two real laps from this session, one car each. Which one is ${t.code}?</p></div>
      <p class="paused-note caps" aria-live="polite">Paused · Space to resume</p>`;
    const w = this.world;
    this.minimap = new Minimap(s.circuit, w.outline(), s.corners.map((c) => ({ s: c.s, n: c.n })), s.length, (d) => w.pointAt(d));
    stage.appendChild(this.minimap.root);

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
      <section class="pair-model" aria-live="polite">
        <header class="caps"><span>The model's read</span><span class="num" data-k="read">0 corners</span></header>
        <div class="pair-split" role="img" aria-label="How sure the model is"><i class="a" style="width:50%"></i><i class="b" style="width:50%"></i></div>
        <p class="pair-split-key num"><span>Plain is ${t.code}</span><span>Red is ${t.code}</span></p>
        <p class="call" data-level="none">The model reads every corner as each car leaves it.</p>
      </section>
      <section class="pair-ev" aria-live="polite"><p class="caps">Last corner read</p><p data-k="ev">Waiting for the first corner.</p></section>`;
    this.side.querySelector(".pair-pick")!.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-car]");
      if (b) this.choose(b.dataset.car as Car);
    });

    this.band = document.createElement("section");
    this.band.className = "band pair-band";
    this.band.innerHTML = (["A", "B"] as Car[])
      .map(
        (c) => `
        <div class="pair-tm" data-car="${c}">
          <p class="caps"><i class="sw ${c === "A" ? "plain" : "red"}"></i>${CAR_NAME[c]}</p>
          <b class="num" data-k="speed">0</b><span class="caps unit">km/h</span>
          <span class="caps">Gear <b class="num" data-k="gear">N</b></span>
          <span class="meters caps"><span>Thr</span><i class="meter thr"><em data-k="thr"></em></i><span>Brk</span><i class="meter brk"><em data-k="brk"></em></i></span>
          <span class="num clock" data-k="clock">0:00.000</span>
        </div>`,
      )
      .join("") + `<div class="pair-gap"><span class="caps">Gap</span><b class="num" data-k="gap">0.000 s</b><span class="caps" data-k="where">Side by side</span></div>`;

    this.root.append(bar, stage, this.side, this.band);
    dockStage(stage.querySelector(".stage-slot"));
  }

  private choose(car: Car) {
    if (this.phase === "reveal" || this.phase === "loading") return;
    this.pick = car;
    this.side.querySelectorAll<HTMLButtonElement>("[data-car]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.car === car)));
  }

  private setCamera(mode: CameraMode) {
    if (this.phase === "reveal") return;
    this.world.mode = mode;
    this.root.querySelectorAll("[data-cam]").forEach((x) => x.setAttribute("aria-pressed", String((x as HTMLElement).dataset.cam === mode)));
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
    if (t instanceof HTMLSelectElement || t instanceof HTMLInputElement) return;
    if (e.key === " ") {
      e.preventDefault();
      if (!e.repeat && this.phase === "lap") this.setPaused(!this.paused);
    } else if (e.key === "c" || e.key === "C") {
      const i = CAMERAS.findIndex(([id]) => id === this.world.mode);
      this.setCamera(CAMERAS[(i + 1) % CAMERAS.length][0]);
    } else if (e.key === "1" || e.key === "2") {
      this.choose(e.key === "1" ? "A" : "B");
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

  private read(car: Car, c: number) {
    const side = this.cars[car];
    side.guesser.ingest(side.lap, c);
    const p = this.plainIsTarget();
    const seen = this.cars.A.guesser.seen + this.cars.B.guesser.seen;
    const q = (k: string) => this.side.querySelector<HTMLElement>(`[data-k=${k}]`)!;
    q("read").textContent = `${seen} corners`;
    const split = this.side.querySelectorAll<HTMLElement>(".pair-split i");
    split[0].style.width = `${p * 100}%`;
    split[1].style.width = `${(1 - p) * 100}%`;
    const sure = Math.max(p, 1 - p);
    const lead = p >= 0.5 ? "plain" : "red";
    const call = this.side.querySelector<HTMLElement>(".call")!;
    if (seen < 4) {
      call.textContent = "Still reading the first corners…";
      call.dataset.level = "none";
    } else {
      const word = sure >= 0.95 ? "Very sure" : sure >= 0.8 ? "Fairly sure" : sure >= 0.6 ? "Leaning" : "Not sure yet";
      call.innerHTML = `<b>${word}</b> · the ${lead} car is ${this.target} · ${shown(sure)}%`;
      call.dataset.level = sure >= 0.8 ? "high" : sure >= 0.6 ? "mid" : "low";
    }
    const corner = this.session.corners[c];
    q("ev").innerHTML = `<b>T${corner.n}</b> · the ${car === "A" ? "plain" : "red"} car ${side.guesser.describe(side.lap, c).sentence}.`;
  }

  frame(dt: number) {
    if (this.phase === "loading") {
      if (stageDocked()) this.world.update(dt, 0);
      return;
    }
    if (this.phase === "lights") {
      const now = performance.now();
      const lit = Math.min(5, Math.floor((now - this.lightsAt) / 700));
      this.root.querySelectorAll(".lights i").forEach((l, i) => l.classList.toggle("on", i < lit && now < this.goAt));
      this.engine.update(lit >= 5 ? 9000 + Math.random() * 1500 : 4200 + lit * 300, lit >= 5 ? 40 : 4, 0, 1);
      if (now >= this.goAt) {
        this.root.querySelector(".countdown")?.remove();
        this.phase = "lap";
        this.root.dataset.phase = "lap";
      }
      this.world.update(dt, 0);
      return;
    }
    if (this.phase === "lap" && !this.paused) {
      const { A, B } = this.cars;
      const end = Math.max(A.player.duration, B.player.duration);
      this.t = Math.min(this.t + dt * this.speed, end);
      A.t = Math.min(this.t, A.player.duration);
      B.t = Math.min(this.t, B.player.duration);
      const a = A.player.at(A.t);
      const b = B.player.at(B.t);
      const ratio = this.ratios[a.gear];
      this.engine.update(ratio > 0 && a.speed > 40 ? a.speed * ratio : a.rpm, a.throttle, a.speed, a.gear);
      this.world.setCarS(a.s);
      this.world.setGhostS(b.s);
      const corners = this.session.corners;
      for (const car of ["A", "B"] as Car[]) {
        const side = this.cars[car];
        const s = car === "A" ? a.s : b.s;
        const done = side.t >= side.player.duration;
        while (side.next < corners.length && (done || s > corners[side.next].hi)) this.read(car, side.next++);
      }
      this.minimap.update(a.s, b.s, RED);
      this.readout("A", a, A.t);
      this.readout("B", b, B.t);
      // Gap at the plain car's place: how long ago the red car passed it.
      const gap = A.t - B.player.timeAt(a.s);
      const q = (k: string) => this.band.querySelector<HTMLElement>(`[data-k=${k}]`);
      const g = q("gap");
      if (g) g.textContent = `${Math.abs(gap).toFixed(3)} s`;
      const where = q("where");
      if (where) where.textContent = Math.abs(gap) < 0.05 ? "Side by side" : gap > 0 ? "Red car ahead" : "Plain car ahead";
      this.world.update(dt, a.speed, a.brake);
      if (this.t >= end) void this.reveal();
      return;
    }
    this.world.update(dt, 0);
  }

  private readout(car: Car, smp: { speed: number; gear: number; throttle: number; brake: boolean }, t: number) {
    const box = this.band.querySelector<HTMLElement>(`.pair-tm[data-car="${car}"]`);
    if (!box) return;
    const q = (k: string) => box.querySelector<HTMLElement>(`[data-k=${k}]`)!;
    q("speed").textContent = String(Math.round(smp.speed));
    q("gear").textContent = smp.gear > 0 ? String(smp.gear) : "N";
    q("thr").style.width = `${Math.max(0, Math.min(100, smp.throttle))}%`;
    q("brk").style.width = smp.brake ? "100%" : "0%";
    q("clock").textContent = formatLapTime(t);
  }

  private async reveal() {
    this.phase = "reveal";
    this.root.dataset.phase = "reveal";
    this.engine.setActive(false, 0.8);
    this.world.mode = "orbit";
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
    const n = this.session.corners.length;
    const truthA = truthCar === "A" ? this.target : this.other;
    const truthB = truthCar === "A" ? this.other : this.target;
    const model0 = this.index.models[0].id;
    const cls = (code: string) => this.session.model.classes.indexOf(code);
    const push = Array.from({ length: n }, (_, c) => {
      const ra = A.lap.steps[model0][c];
      const rb = B.lap.steps[model0][c];
      return { c, v: (ra[cls(truthA)] - ra[cls(truthB)] + rb[cls(truthB)] - rb[cls(truthA)]) / 10 };
    })
      .sort((x, y) => y.v - x.v)
      .slice(0, 3);
    const pairRight = this.index.models[0].confidence?.pair.right ?? null;
    const tag = (who: string, right: boolean, what: string) => `<span class="tag ${right ? "win" : "miss"}">${who}: ${what} · ${right ? "right · +1" : "wrong · +0"}</span>`;
    const block = (car: Car, d: DriverInfo, lap: LapData) => `
      <div class="who-block pair-who" style="--team:${d.colour};--on-team:${inkOn(d.colour)};--longest:${Math.max(...d.name.split(" ").map((w) => w.length))}">
        <p class="caps"><i class="sw ${car === "A" ? "plain" : "red"}"></i>${CAR_NAME[car]}</p>
        <h2 class="display">${d.name}</h2>
        <p class="caps team">${d.team} · lap ${lap.lapNumber} · ${formatLapTime(lap.lapTime)}</p>
      </div>`;
    this.band.className = "band reveal pair-reveal";
    this.band.innerHTML = `
      <div class="verdicts">${tag("You", you === 1, this.pick ? `${CAR_NAME[this.pick].toLowerCase()} is ${this.target}` : "no guess")}${tag("Model", model === 1, `${CAR_NAME[modelCar].toLowerCase()} is ${this.target} · ${shown(sure)}% sure`)}</div>
      ${block("A", da, A.lap)}${block("B", db, B.lap)}
      <div class="why">
        <p class="caps">The corners that told them apart</p>
        <ol class="caption">${push
          .map(({ c }) => {
            const corner = this.session.corners[c];
            return `<li><b>T${corner.n}</b><span>${A.lap.code} ${A.guesser.describe(A.lap, c).sentence}; ${B.lap.code} ${B.guesser.describe(B.lap, c).sentence}.</span></li>`;
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
    (this.band.querySelector("[data-next]") as HTMLElement).focus({ preventScroll: true });
  }
}
