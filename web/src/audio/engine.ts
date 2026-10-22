// A 1.6 L V6 turbo-hybrid, synthesised from telemetry. No recorded audio: the pitch is the firing
// frequency of a six-cylinder four-stroke (three combustion events per crank turn), the tone opens
// with the throttle, and lifts make the exhaust crackle.

const FIRINGS_PER_REV = 3;

function noiseBuffer(ctx: AudioContext, seconds = 2): AudioBuffer {
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function softClip(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return curve;
}

export class EngineSynth {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private oscs: OscillatorNode[] = [];
  private tone!: BiquadFilterNode;
  private engineGain!: GainNode;
  private whine!: OscillatorNode;
  private whineGain!: GainNode;
  private wind!: BiquadFilterNode;
  private windGain!: GainNode;
  private noise!: AudioBuffer;
  private lastThrottle = 0;
  private lastGear = 0;
  muted = false;

  /** Must be called from a user gesture. */
  start() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.noise = noiseBuffer(ctx);

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(comp).connect(ctx.destination);

    // Engine: crank order sub, firing fundamental, and an upper harmonic, through a soft clipper.
    const shaper = ctx.createWaveShaper();
    shaper.curve = softClip(2.4);
    shaper.oversample = "2x";
    this.tone = ctx.createBiquadFilter();
    this.tone.type = "lowpass";
    this.tone.Q.value = 2.2;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    const mix = ctx.createGain();
    mix.gain.value = 0.5;
    const voices: [OscillatorType, number, number][] = [
      ["sawtooth", 0.5, 0.55],
      ["sawtooth", 1, 0.6],
      ["square", 2, 0.12],
      ["triangle", 3, 0.08],
    ];
    for (const [type, mult, gain] of voices) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = 100 * mult;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(mix);
      o.start();
      (o as OscillatorNode & { mult: number }).mult = mult;
      this.oscs.push(o);
    }
    mix.connect(shaper).connect(this.tone).connect(this.engineGain).connect(this.master);

    // Turbo and MGU-H whine.
    this.whine = ctx.createOscillator();
    this.whine.type = "sine";
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    this.whine.connect(this.whineGain).connect(this.master);
    this.whine.start();

    // Wind and tyre roar.
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    n.loop = true;
    this.wind = ctx.createBiquadFilter();
    this.wind.type = "lowpass";
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    n.connect(this.wind).connect(this.windGain).connect(this.master);
    n.start();
  }

  setVolume(on: boolean, fade = 0.4) {
    this.muted = !on;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(on ? 0.55 : 0, t, fade / 3);
  }

  /** Update from one telemetry sample. rpm comes from gear and speed so shifts are instant. */
  update(rpm: number, throttle: number, speed: number, gear: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const f = Math.max((rpm / 60) * FIRINGS_PER_REV, 30);
    const thr = throttle / 100;
    for (const o of this.oscs) {
      o.frequency.setTargetAtTime(f * (o as OscillatorNode & { mult: number }).mult, t, 0.012);
    }
    this.tone.frequency.setTargetAtTime(500 + thr * 5200 + rpm * 0.08, t, 0.03);
    this.engineGain.gain.setTargetAtTime(0.16 + thr * 0.5, t, 0.04);
    this.whine.frequency.setTargetAtTime(1800 + rpm * 0.32, t, 0.05);
    this.whineGain.gain.setTargetAtTime(0.004 + thr * 0.012, t, 0.08);
    this.wind.frequency.setTargetAtTime(200 + speed * 6, t, 0.1);
    this.windGain.gain.setTargetAtTime(Math.pow(speed / 340, 2) * 0.32, t, 0.1);

    // Crackle when the driver lifts sharply; a short dip on every upshift.
    if (this.lastThrottle - throttle > 35 && speed > 120) this.crackle(5 + Math.floor(Math.random() * 5));
    if (gear > this.lastGear && this.lastGear > 0) {
      this.engineGain.gain.setValueAtTime(0.08, t);
      this.engineGain.gain.setTargetAtTime(0.16 + thr * 0.5, t + 0.03, 0.02);
    }
    if (gear < this.lastGear && gear > 0) this.crackle(2);
    this.lastThrottle = throttle;
    this.lastGear = gear;
  }

  private crackle(count: number) {
    const ctx = this.ctx!;
    let at = ctx.currentTime;
    for (let i = 0; i < count; i++) {
      at += 0.03 + Math.random() * 0.09;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 700 + Math.random() * 1600;
      bp.Q.value = 1.4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.35 + Math.random() * 0.4, at + 0.004);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.05);
      src.connect(bp).connect(g).connect(this.master);
      src.start(at, Math.random() * 1.5, 0.08);
    }
  }

  idle() {
    if (!this.ctx) return;
    this.update(4200, 0, 0, 0);
  }
}

/** rpm per (km/h) for each gear, learnt from the lap itself, so pitch follows gear changes exactly. */
export function gearRatios(v: number[], rpm: number[], gear: number[]): number[] {
  const ratios: number[][] = Array.from({ length: 9 }, () => []);
  for (let i = 0; i < v.length; i++) {
    if (v[i] > 40 && gear[i] >= 1 && gear[i] <= 8) ratios[gear[i]].push(rpm[i] / v[i]);
  }
  return ratios.map((r) => {
    if (!r.length) return 0;
    r.sort((a, b) => a - b);
    return r[Math.floor(r.length / 2)];
  });
}
