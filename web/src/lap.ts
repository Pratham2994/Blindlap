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

// Half-width, in samples, of the window that smooths the position correction (~4 s at 3.7 Hz).
// Applied twice (a triangular filter), so the correction bends gently and never jerks the car.
const DRIFT_WINDOW = 14;

function smooth(a: ArrayLike<number>, w: number): Float64Array {
  const n = a.length;
  const out = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, k - w); j <= Math.min(n - 1, k + w); j++) {
      sum += a[j];
      count++;
    }
    out[k] = sum / count;
  }
  return out;
}

/**
 * Reads a lap's ~4 Hz telemetry at any time.
 *
 * Distance along the track does not come from the position samples directly: they are noisy
 * enough that speed worked out from them is off by about ±50 km/h, which made the car surge and
 * stall while the engine (driven by the real speed sensor) sounded smooth. Instead the car moves by
 * integrating the speed channel, and the position samples only correct slow drift. Between samples
 * speed changes linearly, so distance follows a smooth curve and acceleration looks real.
 */
export class LapPlayer {
  private i = 0;
  readonly duration: number;
  private dist: Float64Array; // smoothed distance at each sample time
  private integrated: Float64Array; // distance from the speed channel alone
  private correction: Float64Array; // smoothed drift correction from the position samples

  constructor(readonly lap: LapData) {
    this.duration = lap.lapTime;
    const { t, s, v } = lap;
    const n = t.length;
    const integrated = new Float64Array(n);
    integrated[0] = s[0];
    for (let k = 1; k < n; k++) integrated[k] = integrated[k - 1] + ((v[k - 1] + v[k]) / 2 / 3.6) * (t[k] - t[k - 1]);
    // Offset between where positions say the car is and where the speed says it is, smoothed.
    const offset = Array.from(integrated, (x, k) => s[k] - x);
    this.integrated = integrated;
    this.correction = smooth(smooth(offset, DRIFT_WINDOW), DRIFT_WINDOW);
    this.dist = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      this.dist[k] = integrated[k] + this.correction[k];
      if (k > 0 && this.dist[k] < this.dist[k - 1]) this.dist[k] = this.dist[k - 1];
    }
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

    // Distance under linearly changing speed is quadratic in time. The drift correction is blended
    // in linearly, so the car's speed on screen never jumps at a sample boundary.
    const v0 = L.v[i] / 3.6;
    const v1 = L.v[i + 1] / 3.6;
    const travelled = (v0 * u + 0.5 * (v1 - v0) * u * u) * span;
    const corr = this.correction[i] + (this.correction[i + 1] - this.correction[i]) * u;
    const s = this.integrated[i] + travelled + corr;

    return {
      t,
      s,
      speed: lerp(L.v),
      throttle: lerp(L.thr),
      brake: (u < 0.5 ? L.brk[i] : L.brk[i + 1]) > 0,
      gear: u < 0.5 ? L.gear[i] : L.gear[i + 1],
      rpm: lerp(L.rpm),
      drs: (u < 0.5 ? L.drs[i] : L.drs[i + 1]) >= 10,
    };
  }

  /** When the car reached distance d (for the duel's live gap), on the same smoothed track. */
  timeAt(d: number): number {
    const { t } = this.lap;
    const D = this.dist;
    let lo = 0;
    let hi = D.length - 1;
    if (d <= D[0]) return t[0];
    if (d >= D[hi]) return t[hi];
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (D[mid] <= d) lo = mid;
      else hi = mid;
    }
    const f = (d - D[lo]) / (D[hi] - D[lo] || 1);
    return t[lo] + (t[hi] - t[lo]) * f;
  }
}

export function formatLapTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}
