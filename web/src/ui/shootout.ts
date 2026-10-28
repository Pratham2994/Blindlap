// Shootout: every driver's best lap of one session, run at once on the same track. A live timing
// tower orders them by how far round they are and shows each one's gap to pole at that point; the
// camera and the engine follow whichever driver you pick.
import { gearRatios, EngineSynth } from "../audio/engine";
import type { DriverInfo, Index, LapData, Session } from "../data";
import { loadSession, prefetchSurroundings } from "../data";
import { formatLapTime, LapPlayer } from "../lap";
import type { CameraMode, World } from "../scene/world";
import { icons } from "./icons";
import { Minimap } from "./minimap";
import { dockStage } from "./stage";
import { Telemetry } from "./telemetry";

const CAMERAS: [CameraMode, string][] = [
  ["chase", "Chase"],
  ["onboard", "Onboard"],
  ["tv", "TV"],
  ["heli", "Above"],
];

interface Runner {
  lap: LapData;
  player: LapPlayer;
  driver: DriverInfo;
  s: number;
  done: boolean;
}

export class ShootoutView {
  readonly root: HTMLDivElement;
  private session!: Session;
  private runners: Runner[] = [];
  private pole!: Runner;
  private follow = 0; // index into runners
  private t = 0;
  private end = 0;
  private speed = 1;
  private paused = false;
  private finished = false;
  private ratios: number[] = [];
  private tower!: HTMLOListElement;
  private telemetry!: Telemetry;
  private minimap!: Minimap;
  private status!: HTMLElement;
  private sinceTower = 1;
  private disposed = false;
  private keyHandler = (e: KeyboardEvent) => this.onKey(e);

  constructor(
    private world: World,
    private engine: EngineSynth,
    private index: Index,
    key: number | null,
  ) {
    this.root = document.createElement("div");
    this.root.className = "play shootout";
    this.root.dataset.phase = "loading";
    this.root.innerHTML = `<p class="loading caps">Loading the session…</p>`;
    window.addEventListener("keydown", this.keyHandler);
    const known = index.sessions.find((s) => s.key === key);
    const pick = known ?? index.sessions[Math.floor(Math.random() * index.sessions.length)];
    void this.load(pick.key);
  }

  dispose() {
    this.disposed = true;
    window.removeEventListener("keydown", this.keyHandler);
    this.world.setField(null);
    this.world.showCar(true);
    this.engine.setActive(false);
    document.body.classList.remove("playing");
  }

  private async load(key: number) {
    const [session] = await Promise.all([loadSession(key), prefetchSurroundings(key)]);
    if (this.disposed) return;
    this.session = session;
    // Each driver's fastest lap in the session, fastest first.
    const best = new Map<string, LapData>();
    for (const lap of session.laps) {
      const b = best.get(lap.code);
      if (!b || lap.lapTime < b.lapTime) best.set(lap.code, lap);
    }
    const driverOf = (code: string) => Object.values(session.drivers).find((d) => d.code === code)!;
    this.runners = [...best.values()]
      .sort((a, b) => a.lapTime - b.lapTime)
      .map((lap) => ({ lap, player: new LapPlayer(lap), driver: driverOf(lap.code), s: 0, done: false }));
    this.pole = this.runners[0];
    this.end = Math.max(...this.runners.map((r) => r.player.duration));
    this.t = 0;
    this.finished = false;
    this.follow = 0;

    dockStage(null);
    this.world.setSession(session);
    this.world.labelsOn = true;
    this.world.mode = "tv";
    this.build();
    this.setFollow(0);
    this.world.snapCamera();
    document.body.classList.add("playing");
    this.engine.start();
    this.engine.setActive(true);
    this.root.dataset.phase = "lap";
  }

  private build() {
    const s = this.session;
    this.root.innerHTML = "";
    const bar = document.createElement("header");
    bar.className = "play-bar";
    const options = [...this.index.sessions]
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((x) => `<option value="${x.key}"${x.key === s.key ? " selected" : ""}>${x.date.slice(0, 4)} · ${x.circuit}</option>`)
      .join("");
    bar.innerHTML = `
      <a class="back" href="#/" title="Back to the menu (Esc)">${icons.back}<span>Menu</span></a>
      <div class="where">
        <h1 class="display">${s.circuit} <span class="year">${s.date.slice(0, 4)}</span></h1>
        <p class="caps">Shootout · every driver's best lap at once · ${(s.length / 1000).toFixed(3)} km</p>
      </div>
      <label class="shootout-pick caps" title="Watch another qualifying session">Session<select aria-label="Session">${options}</select></label>
      <div class="controls">
        <button type="button" class="ctl" data-pause aria-pressed="false" title="Pause (Space)">${icons.pause}<span>Pause</span></button>
        <div class="seg" role="group" aria-label="Playback speed">
          ${[1, 2, 4].map((v) => `<button type="button" data-speed="${v}" aria-pressed="${v === this.speed}" title="Play at ${v === 1 ? "real speed" : `${v} times real speed`}">${v}×</button>`).join("")}
        </div>
        <div class="seg cams" role="group" aria-label="Camera">
          ${CAMERAS.map(([id, label]) => `<button type="button" data-cam="${id}" aria-pressed="${id === "tv"}" title="Camera: ${label} (C to cycle)"><span>${label}</span></button>`).join("")}
        </div>
        <button type="button" class="ctl" data-sound aria-pressed="${!this.engine.muted}" aria-label="Engine sound" title="The followed car's engine, on or off">${this.engine.muted ? icons.soundOff : icons.soundOn}<span>Sound</span></button>
      </div>`;
    bar.querySelector("select")!.addEventListener("change", (e) => {
      location.hash = `#/shootout/${(e.target as HTMLSelectElement).value}`;
    });
    bar.querySelector(".controls")!.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("button");
      if (!b) return;
      if (b.hasAttribute("data-pause")) this.setPaused(!this.paused);
      else if (b.dataset.speed) {
        this.speed = Number(b.dataset.speed);
        bar.querySelectorAll("[data-speed]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      } else if (b.dataset.cam) this.setCamera(b.dataset.cam as CameraMode);
      else if (b.hasAttribute("data-sound")) {
        const on = this.engine.muted;
        this.engine.setMuted(!on);
        b.setAttribute("aria-pressed", String(on));
        b.innerHTML = `${on ? icons.soundOn : icons.soundOff}<span>Sound</span>`;
      }
      b.blur();
    });

    const stage = document.createElement("div");
    stage.className = "stage-frame";
    stage.innerHTML = `<div class="stage-slot"></div><p class="paused-note caps" aria-live="polite">Paused · Space to resume</p>`;
    const w = this.world;
    this.minimap = new Minimap(s.circuit, w.outline(), s.corners.map((c) => ({ s: c.s, n: c.n })), s.length, (d) => w.pointAt(d));
    stage.appendChild(this.minimap.root);
    let drag: { x: number; y: number; id: number } | null = null;
    stage.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest("button, a, input, select")) return;
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
    side.innerHTML = `
      <section class="tower" aria-label="Live order. Pick a driver to follow.">
        <header><span class="caps">Live order</span><span class="caps">Gap to pole here</span></header>
        <ol></ol>
        <p class="hint">Every driver's fastest lap of the session, all started together. Pick a driver to follow them.</p>
      </section>`;
    this.tower = side.querySelector("ol")!;
    this.buildTower();
    this.tower.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-i]");
      if (b) {
        this.setFollow(Number(b.dataset.i));
        b.blur();
      }
    });

    const band = document.createElement("section");
    band.className = "band";
    this.telemetry = new Telemetry(
      s,
      (metres) => this.seekTo(this.runners[this.follow].player.timeAt(metres)),
      (seconds) => this.seekTo(this.t + seconds),
    );
    this.status = document.createElement("div");
    this.status.className = "evidence";
    this.status.setAttribute("aria-live", "polite");
    this.telemetry.setSeekable(true);
    band.append(this.telemetry.root, this.status);

    this.root.append(bar, stage, side, band);
    dockStage(stage.querySelector(".stage-slot"));
    this.world.setField(this.runners.map((r) => ({ lap: r.lap, colour: r.driver.colour })));
    this.renderTower();
  }

  private setCamera(mode: CameraMode) {
    this.world.mode = mode;
    this.root.querySelectorAll("[data-cam]").forEach((x) => x.setAttribute("aria-pressed", String((x as HTMLElement).dataset.cam === mode)));
  }

  /** Follow one driver: the camera, the engine, the telemetry and the modelled car are theirs. */
  private setFollow(i: number) {
    this.follow = i;
    const r = this.runners[i];
    this.world.setLap(r.lap);
    this.world.revealLine(false);
    this.world.setCarColours(r.driver.colour);
    this.world.setFieldHidden(i);
    this.ratios = gearRatios(r.lap.v, r.lap.rpm, r.lap.gear);
    this.place();
    this.renderTower();
  }

  private setPaused(on: boolean) {
    this.paused = on;
    this.engine.setActive(!on && !this.finished, 0.15);
    this.root.classList.toggle("paused", on);
    const btn = this.root.querySelector<HTMLButtonElement>("[data-pause]");
    if (btn) {
      btn.innerHTML = on ? `${icons.play}<span>Resume</span>` : `${icons.pause}<span>Pause</span>`;
      btn.setAttribute("aria-pressed", String(on));
    }
  }

  private seekTo(t: number) {
    this.t = Math.max(0, Math.min(t, this.end));
    if (this.finished && this.t < this.end) {
      this.finished = false;
      this.root.querySelector(".shootout-result")?.remove();
      this.engine.setActive(!this.paused);
    }
    this.place();
    this.renderTower();
  }

  private onKey(e: KeyboardEvent) {
    const t = e.target;
    if (t instanceof HTMLSelectElement || (t instanceof HTMLInputElement && t.type !== "range")) return;
    if (e.key === " ") {
      e.preventDefault();
      if (!e.repeat) this.setPaused(!this.paused);
    } else if (e.key === "c" || e.key === "C") {
      const i = CAMERAS.findIndex(([id]) => id === this.world.mode);
      this.setCamera(CAMERAS[(i + 1) % CAMERAS.length][0]);
    } else if (e.key === "Escape") {
      location.hash = "#/";
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      this.seekTo(this.t + (e.key === "ArrowLeft" ? -5 : 5));
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      // Follow the car ahead or behind in the live order.
      e.preventDefault();
      const order = this.order();
      const k = order.indexOf(this.follow) + (e.key === "ArrowUp" ? -1 : 1);
      if (order[k] !== undefined) this.setFollow(order[k]);
    }
  }

  /** Put every car where its lap is at the shared time t. A car that has crossed the line rolls on
   * at its finishing speed, as it would on track, instead of stopping dead on the line. */
  private place() {
    const L = this.session.length;
    for (const r of this.runners) {
      r.done = this.t >= r.player.duration;
      r.s = r.done ? L + (this.t - r.player.duration) * (r.lap.v[r.lap.v.length - 1] / 3.6) : r.player.at(this.t).s;
    }
    const f = this.runners[this.follow];
    const smp = f.player.at(Math.min(this.t, f.player.duration));
    this.world.setCarS(f.done ? f.s : smp.s);
    this.world.setFieldS(this.runners.map((r) => r.s));
    this.telemetry.update(Math.min(smp.s, L), Math.min(this.t, f.player.duration), smp.speed, smp.gear, smp.throttle, smp.brake);
    this.minimap.update(Math.min(f.s, L), null, undefined, f.driver.colour); // the map's lap ends at the line
    this.minimap.field(this.runners.map((r, i) => ({ s: r.s % L, colour: r.driver.colour, on: i !== this.follow })));
    return smp;
  }

  /** Runners in race order now: finished first (by lap time), then by distance covered. */
  private order(): number[] {
    return this.runners
      .map((r, i) => ({ r, i }))
      .sort((a, b) => (a.r.done && b.r.done ? a.r.lap.lapTime - b.r.lap.lapTime : b.r.s - a.r.s))
      .map((x) => x.i);
  }

  /** The gap to the pole lap at the same point: how much later this car got there. */
  private gap(r: Runner): number {
    if (r.done) return r.lap.lapTime - this.pole.lap.lapTime;
    return this.t - this.pole.player.timeAt(r.s);
  }

  /** One row per runner, made once; renderTower only changes their text and order, so a click is
   * never lost to a row being rebuilt under the pointer. */
  private buildTower() {
    this.tower.innerHTML = this.runners
      .map(
        (r, i) => `<li><button type="button" class="tower-row" data-i="${i}" aria-label="Follow ${r.driver.name}">
          <span class="pos num"></span><span class="chip" style="background:${r.driver.colour}"></span><span class="code">${r.lap.code}</span><span class="gap num"></span></button></li>`,
      )
      .join("");
  }

  private renderTower() {
    if (!this.tower) return;
    const items = [...this.tower.children] as HTMLLIElement[];
    this.order().forEach((i, pos) => {
      const r = this.runners[i];
      const li = items[i];
      if (!li) return;
      li.style.order = String(pos);
      const g = this.gap(r);
      const b = li.firstElementChild as HTMLButtonElement;
      b.classList.toggle("pick", i === this.follow);
      b.classList.toggle("done", r.done);
      b.setAttribute("aria-pressed", String(i === this.follow));
      b.querySelector(".pos")!.textContent = String(pos + 1);
      b.querySelector(".gap")!.textContent =
        r === this.pole ? (r.done ? formatLapTime(r.lap.lapTime) : "Pole lap") : `${g >= 0 ? "+" : "−"}${Math.abs(g).toFixed(3)}`;
    });
    const f = this.runners[this.follow];
    const pos = this.order().indexOf(this.follow) + 1;
    const g = this.gap(f);
    this.status.innerHTML = `<span class="t">P${pos}</span><span class="what">Following <b>${f.driver.name}</b>, ${f.driver.team}. ${
      f.done ? `Lap ${formatLapTime(f.lap.lapTime)}${f === this.pole ? ", the fastest of the session" : `, ${g.toFixed(3)} s off pole`}.` : f === this.pole ? "This is the pole lap." : `${Math.abs(g).toFixed(3)} s ${g >= 0 ? "behind" : "ahead of"} the pole lap at this point.`
    }</span><span class="who caps">↑ ↓ follow the car ahead or behind</span>`;
  }

  /** The finish: the order these laps make, and where to go next. */
  private showResult() {
    if (this.root.querySelector(".shootout-result")) return;
    const card = document.createElement("div");
    card.className = "shootout-result";
    const top = this.order().slice(0, 3).map((i) => this.runners[i]);
    card.innerHTML = `
      <p class="caps">Chequered flag</p>
      <ol>${top.map((r, k) => `<li><span class="num">P${k + 1}</span><span class="chip" style="background:${r.driver.colour}"></span><b>${r.driver.name}</b><span class="num">${k ? `+${(r.lap.lapTime - this.pole.lap.lapTime).toFixed(3)}` : formatLapTime(r.lap.lapTime)}</span></li>`).join("")}</ol>
      <div class="actions">
        <a class="btn primary" href="#/play/${this.session.key}">Guess a blind lap here ${icons.next}</a>
        <button type="button" class="btn" data-again>Watch again</button>
      </div>`;
    card.querySelector("[data-again]")!.addEventListener("click", () => this.seekTo(0));
    this.root.querySelector(".stage-frame")?.appendChild(card);
  }

  frame(dt: number) {
    if (!this.runners.length || !this.telemetry) return;
    if (!this.paused && !this.finished) {
      this.t = Math.min(this.t + dt * this.speed, this.end);
      if (this.t >= this.end) {
        this.finished = true;
        this.engine.setActive(false, 1.2);
        this.showResult();
      }
    }
    const smp = this.place();
    const f = this.runners[this.follow];
    if (!this.paused && !this.finished && this.t < f.player.duration) {
      const ratio = this.ratios[smp.gear];
      this.engine.update(ratio > 0 && smp.speed > 40 ? smp.speed * ratio : smp.rpm, smp.throttle, smp.speed, smp.gear);
    }
    this.sinceTower += dt;
    if (this.sinceTower > 0.2) {
      this.sinceTower = 0;
      this.renderTower();
    }
    this.world.update(dt, this.t < f.player.duration ? smp.speed : 0, smp.brake);
  }
}
