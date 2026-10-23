// The telemetry band under the stage: speed set like a poster headline, gear, pedals, and the lap
// as a progress rule with a tick per corner (filled once the model has read it).
import type { Session } from "../data";
import { formatLapTime } from "../lap";

export class Telemetry {
  readonly root: HTMLElement;
  private speed: HTMLElement;
  private gear: HTMLElement;
  private thr: HTMLElement;
  private brk: HTMLElement;
  private progress: HTMLElement;
  private clock: HTMLElement;
  private ticks: HTMLElement[] = [];
  private seek: HTMLInputElement;

  /** The lap bar measures distance, like its fill and its corner ticks, so the handle sits where
   * the car is. (Measured in time it ran up to 10% behind the fill: cars spend longer in slow
   * corners.) onSeek(s) gets a distance in metres; onJump(seconds) the 5 s buttons. */
  constructor(
    private session: Session,
    onSeek: (s: number) => void,
    onJump: (seconds: number) => void,
  ) {
    this.root = document.createElement("div");
    this.root.className = "telemetry";
    this.root.innerHTML = `
      <div class="tm-speed"><b class="num" data-k="speed">0</b><span class="caps">km/h</span></div>
      <div class="tm-gear"><span class="caps">Gear</span><b class="num" data-k="gear">N</b></div>
      <div class="tm-pedals">
        <span class="caps">Throttle</span><i class="meter thr"><em data-k="thr"></em></i>
        <span class="caps">Brake</span><i class="meter brk"><em data-k="brk"></em></i>
      </div>
      <div class="tm-lap">
        <div class="tm-lap-head caps">
          <span>Lap</span>
          <span class="tm-jump">
            <button type="button" data-jump="-5" aria-label="Back 5 seconds">−5 s</button>
            <button type="button" data-jump="5" aria-label="Forward 5 seconds">+5 s</button>
          </span>
          <span class="num" data-k="clock">0:00.000</span>
        </div>
        <div class="tm-rule"><em data-k="progress"></em>${session.corners
          .map((c) => `<span class="tick" style="left:${(c.s / session.length) * 100}%" title="Turn ${c.n}"></span>`)
          .join("")}<input class="tm-seek" type="range" min="0" max="${Math.round(session.length)}" step="1" value="0" aria-label="Position in the lap"></div>
      </div>`;
    const q = (k: string) => this.root.querySelector<HTMLElement>(`[data-k=${k}]`)!;
    this.speed = q("speed");
    this.gear = q("gear");
    this.thr = q("thr");
    this.brk = q("brk");
    this.progress = q("progress");
    this.clock = q("clock");
    this.ticks = [...this.root.querySelectorAll<HTMLElement>(".tick")];
    this.seek = this.root.querySelector<HTMLInputElement>(".tm-seek")!;
    this.seek.addEventListener("input", () => onSeek(Number(this.seek.value)));
    this.root.querySelectorAll<HTMLButtonElement>("[data-jump]").forEach((b) =>
      b.addEventListener("click", () => onJump(Number(b.dataset.jump))),
    );
  }

  /** The bar is a slider only during the lap; after the flag it is a plain record of it. */
  setSeekable(on: boolean) {
    this.seek.disabled = !on;
    this.root.querySelectorAll<HTMLButtonElement>("[data-jump]").forEach((b) => (b.disabled = !on));
  }

  update(s: number, t: number, speed: number, gear: number, throttle: number, brake: boolean) {
    this.speed.textContent = String(Math.round(speed));
    this.gear.textContent = gear > 0 ? String(gear) : "N";
    this.thr.style.width = `${Math.max(0, Math.min(100, throttle))}%`;
    this.brk.style.width = brake ? "100%" : "0%";
    this.progress.style.width = `${Math.max(0, Math.min(1, s / this.session.length)) * 100}%`;
    this.clock.textContent = formatLapTime(Math.max(0, t));
    // Follow the lap, except while the visitor is holding the slider.
    if (!this.seek.matches(":active")) this.seek.value = String(Math.round(s));
  }

  markCorner(i: number) {
    this.ticks[i]?.classList.add("read");
  }

  unmarkCorner(i: number) {
    this.ticks[i]?.classList.remove("read");
  }
}
