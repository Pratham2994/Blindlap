// The in-browser half of the model. pipeline/model.py trains one logistic regression per held-out
// session; this file runs it corner by corner and turns each step into a sentence a fan can read.
import type { Index, LapData, Session } from "./data";

export interface Guess {
  code: string;
  p: number;
}

export interface Evidence {
  corner: number; // index into session.corners
  label: string; // "T7"
  sentence: string; // "braked 11 m later than the field"
  movers: string[]; // drivers this corner pushed up the most
  deltas: Record<string, number>; // how much this corner moved each driver, vs the average driver
  feature: string;
  short: string; // three-word version for the 3D caption
}

const FEATURE_TEXT: Record<string, (d: number) => string | null> = {
  brake_point: (d) => (Math.abs(d) < 3 ? null : `braked ${Math.abs(d).toFixed(0)} m ${d > 0 ? "later" : "earlier"} than the field`),
  brake_length: (d) => (Math.abs(d) < 3 ? null : `stayed on the brake ${Math.abs(d).toFixed(0)} m ${d > 0 ? "longer" : "less"}`),
  entry_speed: (d) => (Math.abs(d) < 1 ? null : `arrived ${Math.abs(d).toFixed(0)} km/h ${d > 0 ? "faster" : "slower"}`),
  apex_speed: (d) => (Math.abs(d) < 1 ? null : `carried ${Math.abs(d).toFixed(0)} km/h ${d > 0 ? "more" : "less"} through the apex`),
  apex_offset: (d) => (Math.abs(d) < 3 ? null : `hit the slowest point ${Math.abs(d).toFixed(0)} m ${d > 0 ? "later" : "earlier"}`),
  throttle_point: (d) => (Math.abs(d) < 3 ? null : `went to full throttle ${Math.abs(d).toFixed(0)} m ${d > 0 ? "later" : "earlier"}`),
  min_throttle: (d) => (Math.abs(d) < 3 ? null : d > 0 ? `lifted ${Math.abs(d).toFixed(0)}% less` : `lifted ${Math.abs(d).toFixed(0)}% more`),
  coast: (d) => (Math.abs(d) < 3 ? null : `coasted ${Math.abs(d).toFixed(0)} m ${d > 0 ? "more" : "less"}`),
  throttle_ramp: (d) =>
    Math.abs(d) < 4 ? null : d > 0 ? `squeezed the throttle on over ${Math.abs(d).toFixed(0)} m more` : `opened the throttle ${Math.abs(d).toFixed(0)} m quicker`,
  partial_throttle: (d) => (Math.abs(d) < 4 ? null : `held part-throttle for ${Math.abs(d).toFixed(0)} m ${d > 0 ? "more" : "less"}`),
};

const FEATURE_SHORT: Record<string, (d: number) => string> = {
  brake_point: (d) => `brakes ${Math.abs(d).toFixed(0)} m ${d > 0 ? "later" : "earlier"}`,
  brake_length: (d) => `${Math.abs(d).toFixed(0)} m ${d > 0 ? "longer" : "shorter"} braking`,
  entry_speed: (d) => `${d > 0 ? "+" : "-"}${Math.abs(d).toFixed(0)} km/h entry`,
  apex_speed: (d) => `${d > 0 ? "+" : "-"}${Math.abs(d).toFixed(0)} km/h apex`,
  apex_offset: (d) => `apex ${Math.abs(d).toFixed(0)} m ${d > 0 ? "later" : "earlier"}`,
  throttle_point: (d) => `throttle ${Math.abs(d).toFixed(0)} m ${d > 0 ? "later" : "earlier"}`,
  min_throttle: (d) => `lifts ${Math.abs(d).toFixed(0)}% ${d > 0 ? "less" : "more"}`,
  coast: (d) => `coasts ${Math.abs(d).toFixed(0)} m ${d > 0 ? "more" : "less"}`,
  throttle_ramp: (d) => `throttle ${d > 0 ? "slower" : "quicker"} by ${Math.abs(d).toFixed(0)} m`,
  partial_throttle: (d) => `${Math.abs(d).toFixed(0)} m ${d > 0 ? "more" : "less"} part-throttle`,
};

export class Guesser {
  readonly codes: string[]; // candidates: drivers in this session the model knows
  private cls: number[]; // index of each candidate in the model's classes
  private logp: Float64Array;
  private read: number[] = []; // corners fed so far, so a model switch can replay them
  model: string;
  seen = 0;

  constructor(
    private session: Session,
    private index: Index,
    only?: string[], // restrict the candidates, e.g. to two teammates
    model?: string,
  ) {
    const inSession = new Set(Object.values(session.drivers).map((d) => d.code));
    this.codes = session.model.classes.filter((c) => inSession.has(c) && (!only || only.includes(c)));
    this.cls = this.codes.map((c) => session.model.classes.indexOf(c));
    this.logp = new Float64Array(this.codes.length);
    this.model = model ?? index.models[0].id;
  }

  reset() {
    this.logp.fill(0);
    this.read = [];
    this.seen = 0;
  }

  /** Switch model mid-lap: replay the corners already read with the other model's numbers. */
  useModel(model: string, lap: LapData) {
    const corners = this.read;
    this.model = model;
    this.reset();
    for (const c of corners) this.step(lap, c);
  }

  /** Add one corner's held-out log-probabilities; returns each candidate's change vs the average. */
  private step(lap: LapData, c: number): number[] {
    const row = lap.steps[this.model][c];
    const step = this.cls.map((k) => row[k] / 10); // stored in tenths
    const mean = step.reduce((a, v) => a + v, 0) / step.length;
    step.forEach((v, i) => (this.logp[i] += v));
    this.read.push(c);
    this.seen++;
    return step.map((v) => v - mean);
  }

  /** Feed one corner of the lap; returns what it said. */
  ingest(lap: LapData, c: number): Evidence {
    const corner = this.session.corners[c];
    const change = this.step(lap, c);
    const deltas: Record<string, number> = {};
    change.forEach((v, i) => (deltas[this.codes[i]] = v));
    const movers = Object.keys(deltas)
      .sort((a, b) => deltas[b] - deltas[a])
      .slice(0, 3);
    return { corner: c, label: `T${corner.n}`, movers, deltas, ...this.describe(lap, c) };
  }

  /** The single most unusual thing the driver did at this corner, in words. */
  describe(lap: LapData, c: number): { sentence: string; feature: string; short: string } {
    const feats = this.index.features;
    const corner = this.session.corners[c];
    const order = feats
      .map((f, k) => ({ f, k, z: Math.abs(lap.z[c][k]) }))
      .filter((o) => corner.braked || o.k > 2)
      .sort((a, b) => b.z - a.z);
    for (const o of order) {
      const raw = lap.raw[c][o.k];
      const med = this.session.field.med[c][o.k];
      if (raw == null || med == null) continue;
      const text = FEATURE_TEXT[o.f]?.(raw - med);
      if (text) return { sentence: text, feature: o.f, short: FEATURE_SHORT[o.f](raw - med) };
    }
    return { sentence: "took it exactly like the field", feature: "", short: "like the field" };
  }

  guesses(): Guess[] {
    const tau = this.index.models.find((m) => m.id === this.model)?.tau ?? 2;
    const a = Array.from(this.logp, (v) => v / tau);
    const m = Math.max(...a);
    const e = a.map((v) => Math.exp(v - m));
    const sum = e.reduce((acc, v) => acc + v, 0);
    return this.codes.map((code, i) => ({ code, p: e[i] / sum })).sort((x, y) => y.p - x.p);
  }
}
