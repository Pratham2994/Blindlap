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
// The brake channel drops to off for one to three samples in the middle of a braking about once
// every two laps; on screen the brake light blinked and the red rubber had a grey gap. Gaps shorter
// than this (seconds) between two "on" samples are shown as braking.
const BRAKE_GAP = 0.6;
// The timing says a lap starts on the line at t = 0 and ends on it at its lap time, but the position
// data puts the car up to about 15 m before or after the line at those moments, so two laps started
// together were drawn up to 20 m apart. The difference is eased out over the first and last
// LINE_EASE seconds (at most about 2.5 m/s against the real speed); a difference over LINE_MAX m is
// a broken lap and left alone.
const LINE_EASE = 6;
const LINE_MAX = 40;

/** The brake channel as shown: on (1) or off (0), with short drop-outs inside a braking filled. */
export function heldBrake(lap: { t: number[]; brk: number[] }): Uint8Array {
  const { t, brk } = lap;
  const out = Uint8Array.from(brk, (b) => (b > 0 ? 1 : 0));
  for (let k = 0; k < out.length - 1; k++) {
    if (!out[k] || out[k + 1]) continue;
    let j = k + 1;
    while (j < out.length && !out[j]) j++;
    if (j < out.length && t[j] - t[k] <= BRAKE_GAP) out.fill(1, k + 1, j);
    k = j - 1;
  }
  return out;
}

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
  readonly dist: Float64Array; // smoothed distance at each sample time: where the car is drawn
  readonly brake: Uint8Array; // heldBrake
  /** How far off the line the position data had the car at the start or the end (m). Over LINE_MAX
   * the data has a gap there (16 laps of 3,379) and the lap is left out of the random picks. */
  readonly offLine: number;
  private integrated: Float64Array; // distance from the speed channel alone
  private correction: Float64Array; // smoothed drift correction from the position samples

  /** length: the circuit's length, so the lap also ends on the line (without it only the start is
   * put on the line). */
  constructor(
    readonly lap: LapData,
    length?: number,
  ) {
    this.duration = lap.lapTime;
    this.brake = heldBrake(lap);
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
    this.fillDist();
    // On the line at 0:00.000, and again at the lap time.
    const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
    const d0 = -this.at(0).s;
    const d1 = length ? length - this.at(this.duration).s : 0;
    this.i = 0;
    this.offLine = Math.max(Math.abs(d0), Math.abs(d1));
    const fix0 = Math.abs(d0) <= LINE_MAX ? d0 : 0;
    const fix1 = Math.abs(d1) <= LINE_MAX ? d1 : 0;
    if (fix0 || fix1) {
      for (let k = 0; k < n; k++) {
        const tk = t[k];
        this.correction[k] += fix0 * (1 - ease(tk / LINE_EASE)) + fix1 * ease((tk - (this.duration - LINE_EASE)) / LINE_EASE);
      }
      this.fillDist();
    }
  }

  private fillDist() {
    for (let k = 0; k < this.dist.length; k++) {
      this.dist[k] = this.integrated[k] + this.correction[k];
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
    let s = this.integrated[i] + travelled + corr;
    // Before the first sample or after the last (a lap's data can start up to a second after the
    // line), carry on at the speed there instead of standing still.
    const n = ts.length;
    if (t < ts[0]) s -= (L.v[0] / 3.6) * (ts[0] - t);
    else if (t > ts[n - 1]) s += (L.v[n - 1] / 3.6) * (t - ts[n - 1]);

    return {
      t,
      s,
      speed: lerp(L.v),
      throttle: lerp(L.thr),
      brake: (u < 0.5 ? this.brake[i] : this.brake[i + 1]) > 0,
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
    // Past either end, at the speed there (as at()).
    if (d <= D[0]) return t[0] - (D[0] - d) / Math.max(this.lap.v[0] / 3.6, 1);
    if (d >= D[hi]) return t[hi] + (d - D[hi]) / Math.max(this.lap.v[hi] / 3.6, 1);
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (D[mid] <= d) lo = mid;
      else hi = mid;
    }
    const f = (d - D[lo]) / (D[hi] - D[lo] || 1);
    return t[lo] + (t[hi] - t[lo]) * f;
  }
}

/** A lap whose data reaches the line at both ends, so it plays cleanly from the start to the flag. */
export function playable(lap: LapData, length: number): boolean {
  return new LapPlayer(lap, length).offLine <= LINE_MAX;
}

export function formatLapTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}
