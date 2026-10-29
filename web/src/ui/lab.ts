// Telemetry lab: any session, any two drivers, their fastest laps overlaid corner by corner.
import type { Index, LapData, Session } from "../data";
import { loadSession } from "../data";
import { formatLapTime, LapPlayer } from "../lap";

const NS = "http://www.w3.org/2000/svg";
const W = 1000;
const H = 300;
const PAD = { l: 44, r: 12, t: 16, b: 52 };
// The gap chart under the speed trace.
const DH = 170;
const DPAD = { l: 44, r: 12, t: 14, b: 24 };
// Below this a corner's time difference is within what the position data can resolve.
const NOISE = 0.02;

const PHRASE: Record<string, (a: string, b: string, d: number) => string | null> = {
  brake_point: (a, b, d) => (Math.abs(d) < 4 ? null : `${a} brakes ${Math.abs(d).toFixed(0)} m ${d > 0 ? "later" : "earlier"} than ${b}`),
  apex_speed: (a, _b, d) => (Math.abs(d) < 2 ? null : `${a} carries ${Math.abs(d).toFixed(0)} km/h ${d > 0 ? "more" : "less"} through the apex`),
  throttle_point: (a, _b, d) => (Math.abs(d) < 4 ? null : `${a} is back on full throttle ${Math.abs(d).toFixed(0)} m ${d > 0 ? "later" : "earlier"}`),
  coast: (a, b, d) => (Math.abs(d) < 4 ? null : `${a} coasts ${Math.abs(d).toFixed(0)} m ${d > 0 ? "more" : "less"} than ${b}`),
  entry_speed: (a, _b, d) => (Math.abs(d) < 3 ? null : `${a} arrives ${Math.abs(d).toFixed(0)} km/h ${d > 0 ? "faster" : "slower"}`),
  throttle_ramp: (a, _b, d) => (Math.abs(d) < 5 ? null : `${a} ${d > 0 ? "squeezes the throttle on more gently" : "opens the throttle more sharply"} (${Math.abs(d).toFixed(0)} m)`),
  partial_throttle: (a, _b, d) => (Math.abs(d) < 5 ? null : `${a} spends ${Math.abs(d).toFixed(0)} m ${d > 0 ? "more" : "less"} on part-throttle`),
  min_throttle: (a, b, d) => (Math.abs(d) < 5 ? null : `${a} lifts ${Math.abs(d).toFixed(0)}% ${d > 0 ? "less" : "more"} than ${b}`),
};

function fastest(session: Session, code: string): LapData | undefined {
  return session.laps.filter((l) => l.code === code).sort((a, b) => a.lapTime - b.lapTime)[0];
}

export class LabView {
  readonly root: HTMLElement;
  private session: Session | null = null;
  private a = "";
  private b = "";
  private features: string[];

  constructor(index: Index) {
    this.features = index.features;
    this.root = document.createElement("div");
    this.root.className = "page read lab";
    const options = [...index.sessions]
      .sort((x, y) => y.date.localeCompare(x.date))
      .map((s) => `<option value="${s.key}">${s.date.slice(0, 4)} · ${s.circuit}</option>`)
      .join("");
    this.root.innerHTML = `
      <article class="prose wide">
        <h1 class="display">Telemetry<br>lab</h1>
        <p>Put two drivers' fastest qualifying laps from the same session on top of each other. The trace is speed against distance; the marks under it are braking, one row per driver. The second chart is the gap between them along the lap, and below it is where the time goes: what each corner won or lost, and why.</p>
        <div class="lab-controls">
          <label class="caps">Session<select data-k="session">${options}</select></label>
          <label class="caps">Driver<select data-k="a"></select></label>
          <label class="caps">Against<select data-k="b"></select></label>
        </div>
        <figure class="lab-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Speed against distance for both drivers"></svg>
          <figcaption class="lab-legend"></figcaption></figure>
        <figure class="lab-chart lab-delta"><svg viewBox="0 0 ${W} ${DH}" role="img" aria-label="The gap between the two drivers along the lap"></svg>
          <figcaption class="lab-delta-note"></figcaption></figure>
        <h2 class="lab-h">Where the time goes</h2>
        <ol class="caption lab-corners"></ol>
        <p class="lab-noise">Times come from the cars' position data, about four samples a second, so a gap under ${NOISE.toFixed(2)} s at one corner is within the noise. Straights are everything between the corner zones.</p>
      </article>`;
    this.root.querySelector<HTMLSelectElement>("[data-k=session]")!.addEventListener("change", (e) => void this.load(Number((e.target as HTMLSelectElement).value)));
    this.root.querySelector<HTMLSelectElement>("[data-k=a]")!.addEventListener("change", (e) => {
      this.a = (e.target as HTMLSelectElement).value;
      this.draw();
    });
    this.root.querySelector<HTMLSelectElement>("[data-k=b]")!.addEventListener("change", (e) => {
      this.b = (e.target as HTMLSelectElement).value;
      this.draw();
    });
    const latest = [...index.sessions].sort((x, y) => y.date.localeCompare(x.date))[0];
    void this.load(latest.key);
  }

  private async load(key: number) {
    const session = await loadSession(key);
    this.session = session;
    // Default pair: the two fastest drivers of the session.
    const best = new Map<string, number>();
    for (const l of session.laps) best.set(l.code, Math.min(best.get(l.code) ?? 1e9, l.lapTime));
    const codes = [...best.keys()].sort((x, y) => best.get(x)! - best.get(y)!);
    this.a = codes[0];
    this.b = codes[1] ?? codes[0];
    const opts = (sel: string) => codes.map((c) => `<option value="${c}" ${c === sel ? "selected" : ""}>${c} · ${formatLapTime(best.get(c)!)}</option>`).join("");
    this.root.querySelector<HTMLSelectElement>("[data-k=session]")!.value = String(key);
    this.root.querySelector<HTMLSelectElement>("[data-k=a]")!.innerHTML = opts(this.a);
    this.root.querySelector<HTMLSelectElement>("[data-k=b]")!.innerHTML = opts(this.b);
    this.draw();
  }

  private draw() {
    const s = this.session;
    if (!s) return;
    const A = fastest(s, this.a);
    const B = fastest(s, this.b);
    if (!A || !B) return;
    const svg = this.root.querySelector("svg")!;
    svg.replaceChildren();
    const L = s.length;
    const vmax = Math.max(...A.v, ...B.v, 300);
    const x = (d: number) => PAD.l + (Math.min(Math.max(d, 0), L) / L) * (W - PAD.l - PAD.r);
    const y = (v: number) => PAD.t + (1 - v / vmax) * (H - PAD.t - PAD.b);
    const el = (tag: string, attrs: Record<string, string | number>) => {
      const e = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
      svg.appendChild(e);
      return e;
    };

    for (const v of [100, 200, 300]) {
      el("line", { x1: PAD.l, x2: W - PAD.r, y1: y(v), y2: y(v), class: "grid" });
      el("text", { x: PAD.l - 8, y: y(v) + 4, class: "tick", "text-anchor": "end" }).textContent = String(v);
    }
    let lastLabel = -1e9;
    for (const c of s.corners) {
      el("line", { x1: x(c.s), x2: x(c.s), y1: PAD.t, y2: H - PAD.b, class: "corner" });
      // Corners closer than a label's width share the first one's label.
      if (x(c.s) - lastLabel < 30) continue;
      lastLabel = x(c.s);
      el("text", { x: x(c.s), y: H - 8, class: "tick", "text-anchor": "middle" }).textContent = `T${c.n}`;
    }
    // Braking as marks under the trace, one row per driver.
    const brakeRow = (lap: LapData, row: number) => {
      for (let i = 0; i < lap.s.length - 1; i++) {
        if (lap.brk[i] > 0) el("rect", { x: x(lap.s[i]), y: H - PAD.b + 8 + row * 9, width: Math.max(x(lap.s[i + 1]) - x(lap.s[i]), 1), height: 6, class: `brake ${row ? "b" : "a"}` });
      }
    };
    brakeRow(A, 0);
    brakeRow(B, 1);
    const path = (lap: LapData) => lap.s.map((d, i) => `${i ? "L" : "M"}${x(d).toFixed(1)},${y(lap.v[i]).toFixed(1)}`).join("");
    el("path", { d: path(B), class: "trace b" });
    el("path", { d: path(A), class: "trace a" });

    const gap = B.lapTime - A.lapTime;
    this.root.querySelector(".lab-legend")!.innerHTML = `<span class="swatch a"></span><b>${A.code}</b> ${formatLapTime(A.lapTime)} <span class="swatch b"></span><b>${B.code}</b> ${formatLapTime(B.lapTime)} <span class="delta">${A.code} ${gap >= 0 ? "faster" : "slower"} by ${Math.abs(gap).toFixed(3)} s</span>`;

    // The gap along the lap: how much later B reached each point than A (positive: A ahead).
    const pa = new LapPlayer(A, L);
    const pb = new LapPlayer(B, L);
    const step = 10;
    const n = Math.ceil(L / step);
    // Timing from positions drifts a little over a lap, so the gap at the line is pinned to the
    // official lap times and the difference spread evenly along the lap.
    const raw = (d: number) => pb.timeAt(d) - pb.timeAt(0) - (pa.timeAt(d) - pa.timeAt(0));
    const drift = B.lapTime - A.lapTime - raw(L);
    const gapAt = (d: number) => raw(d) + drift * (Math.min(Math.max(d, 0), L) / L);
    const gaps = Array.from({ length: n + 1 }, (_, k) => gapAt(Math.min(k * step, L)));
    this.drawGap(gaps, step, A.code, B.code, drift);

    // Time won in each corner zone (positive: A gained), and on the straights between them.
    const won = s.corners.map((c) => gapAt(Math.min(c.hi, L)) - gapAt(Math.max(c.lo, 0)));
    const total = gaps[n];
    const straights = total - won.reduce((a, v) => a + v, 0);
    const biggest = Math.max(...won.map(Math.abs), Math.abs(straights), 0.001);
    const bar = (v: number) => {
      const who = v >= 0 ? A.code : B.code;
      const small = Math.abs(v) < NOISE;
      return `<span class="gain ${v >= 0 ? "a" : "b"}${small ? " small" : ""}"><i style="width:${(Math.abs(v) / biggest) * 100}%"></i><em class="num">${small ? "level" : `${who} +${Math.abs(v).toFixed(3)} s`}</em></span>`;
    };
    // Per corner: the biggest difference between the two, in plain words.
    const feats = this.features;
    const items = s.corners.map((c, k) => {
      let best: { text: string; size: number } | null = null;
      feats.forEach((f, j) => {
        const phrase = PHRASE[f];
        const ra = A.raw[k][j];
        const rb = B.raw[k][j];
        if (!phrase || ra == null || rb == null || (j < 3 && !c.braked)) return;
        const text = phrase(A.code, B.code, ra - rb);
        const size = Math.abs((ra - rb) / (s.field.scale[k][j] || 1));
        if (text && (!best || size > best.size)) best = { text, size };
      });
      const found = best as { text: string; size: number } | null;
      return `<li><b>T${c.n}</b>${bar(won[k])}<span>${found ? found.text : "Same within the data's resolution"}.</span></li>`;
    });
    items.push(`<li class="straights"><b>Straights</b>${bar(straights)}<span>Speed down the straights and out of the corners onto them.</span></li>`);
    this.root.querySelector(".lab-corners")!.innerHTML = items.join("");
  }

  /** The gap chart: zero in the middle, above it A is ahead, below it B. */
  private drawGap(gaps: number[], step: number, a: string, b: string, drift: number) {
    const s = this.session!;
    const svg = this.root.querySelector(".lab-delta svg")!;
    svg.replaceChildren();
    const L = s.length;
    const span = Math.max(0.1, ...gaps.map(Math.abs)) * 1.15;
    const x = (d: number) => DPAD.l + (Math.min(Math.max(d, 0), L) / L) * (W - DPAD.l - DPAD.r);
    const y = (g: number) => DPAD.t + (1 - (g + span) / (2 * span)) * (DH - DPAD.t - DPAD.b);
    const el = (tag: string, attrs: Record<string, string | number>) => {
      const e = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
      svg.appendChild(e);
      return e;
    };
    for (const c of s.corners) el("line", { x1: x(c.s), x2: x(c.s), y1: DPAD.t, y2: DH - DPAD.b, class: "corner" });
    el("line", { x1: DPAD.l, x2: W - DPAD.r, y1: y(0), y2: y(0), class: "zero" });
    const t = (g: number) => (Math.abs(g) < 0.0005 ? "0" : `${g > 0 ? "+" : "−"}${Math.abs(g).toFixed(2)} s`);
    for (const g of [span / 1.15, -span / 1.15]) el("text", { x: DPAD.l - 8, y: y(g) + 4, class: "tick", "text-anchor": "end" }).textContent = t(g);
    el("text", { x: DPAD.l + 6, y: DPAD.t + 10, class: "tick" }).textContent = `${a} ahead`;
    el("text", { x: DPAD.l + 6, y: DH - DPAD.b - 4, class: "tick" }).textContent = `${b} ahead`;
    const pts = gaps.map((g, k) => `${x(k * step).toFixed(1)},${y(g).toFixed(1)}`);
    el("path", { d: `M${x(0)},${y(0)}L${pts.join("L")}L${x(L)},${y(0)}Z`, class: "gap-area" });
    el("path", { d: `M${pts.join("L")}`, class: "gap-line" });
    const end = gaps[gaps.length - 1];
    this.root.querySelector(".lab-delta-note")!.textContent = `${Math.abs(end).toFixed(3)} s to ${end >= 0 ? a : b} at the line, as the official lap times say. Timing from the cars' positions drifted ${Math.abs(drift).toFixed(3)} s over this lap; that is spread evenly along it.`;
  }
}
