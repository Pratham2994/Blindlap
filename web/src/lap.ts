import type { LapData } from "./data";

export interface Sample {
  t: number;
  s: number;
  speed: number;
  throttle: number;
  brake: boolean;
  gear: number;
  rpm: number;
  drs: boolean;
}

/** Reads a lap's ~4 Hz telemetry at any time by interpolation (gear and brake are held, not blended). */
export class LapPlayer {
  private i = 0;
  readonly duration: number;

  constructor(readonly lap: LapData) {
    this.duration = lap.lapTime;
  }

  at(t: number): Sample {
    const { t: ts } = this.lap;
    // Telemetry is read forwards almost always; keep a cursor instead of binary search each frame.
    if (t < ts[this.i]) this.i = 0;
    while (this.i < ts.length - 2 && ts[this.i + 1] <= t) this.i++;
    const i = this.i;
    const span = ts[i + 1] - ts[i] || 1;
    const u = Math.min(Math.max((t - ts[i]) / span, 0), 1);
    const L = this.lap;
    const lerp = (a: number[]) => a[i] + (a[i + 1] - a[i]) * u;
    return {
      t,
      s: lerp(L.s),
      speed: lerp(L.v),
      throttle: lerp(L.thr),
      brake: (u < 0.5 ? L.brk[i] : L.brk[i + 1]) > 0,
      gear: u < 0.5 ? L.gear[i] : L.gear[i + 1],
      rpm: lerp(L.rpm),
      drs: (u < 0.5 ? L.drs[i] : L.drs[i + 1]) >= 10,
    };
  }
}

export function formatLapTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}
