// Telemetry lab: any session, any two drivers, their fastest laps overlaid corner by corner.
import type { Index, LapData, Session } from "../data";
import { loadSession } from "../data";
import { formatLapTime } from "../lap";

const NS = "http://www.w3.org/2000/svg";
const W = 1000;
const H = 300;
const PAD = { l: 44, r: 12, t: 16, b: 52 };

const PHRASE: Record<string, (a: string, b: string, d: number) => string | null> = {
  brake_point: (a, b, d) => (Math.abs(d) < 4 ? null : `${a} brakes ${Math.abs(d).toFixed(0)} m ${d > 0 ? "later" : "earlier"} than ${b}`),
  apex_speed: (a, _b, d) => (Math.abs(d) < 2 ? null : `${a} carries ${Math.abs(d).toFixed(0)} km/h ${d > 0 ? "more" : "less"} through the apex`),
  throttle_point: (a, _b, d) => (Math.abs(d) < 4 ? null : `${a} is back on full throttle ${Math.abs(d).toFixed(0)} m ${d > 0 ? "later" : "earlier"}`),
  coast: (a, b, d) => (Math.abs(d) < 4 ? null : `${a} coasts ${Math.abs(d).toFixed(0)} m ${d > 0 ? "more" : "less"} than ${b}`),
  entry_speed: (a, _b, d) => (Math.abs(d) < 3 ? null : `${a} arrives ${Math.abs(d).toFixed(0)} km/h ${d > 0 ? "faster" : "slower"}`),
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

  constructor(index: Index) {
    this.root = document.createElement("div");
    this.root.className = "page read lab";
    const options = [...index.sessions]
      .sort((x, y) => y.date.localeCompare(x.date))
      .map((s) => `<option value="${s.key}">${s.date.slice(0, 4)} · ${s.circuit}</option>`)
      .join("");
    this.root.innerHTML = `
      <article class="prose wide">
        <h1 class="display">Telemetry<br>lab</h1>
        <p>Put two drivers' fastest qualifying laps from the same session on top of each other. The trace is speed against distance; the blue marks under it are braking. Below, each corner says what the model would notice first.</p>
        <div class="lab-controls">
          <label class="caps">Session<select data-k="session">${options}</select></label>
          <label class="caps">Driver<select data-k="a"></select></label>
          <label class="caps">Against<select data-k="b"></select></label>
        </div>
        <figure class="lab-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Speed against distance for both drivers"></svg>
          <figcaption class="lab-legend"></figcaption></figure>
        <ol class="caption lab-corners"></ol>
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
    // Braking as wet-blue marks under the trace, one row per driver.
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
    this.root.querySelector(".lab-legend")!.innerHTML = `<span class="swatch a"></span><b>${A.code}</b> ${formatLapTime(A.lapTime)} <span class="swatch b"></span><b>${B.code}</b> ${formatLapTime(B.lapTime)} · ${A.code} ${gap >= 0 ? "faster" : "slower"} by ${Math.abs(gap).toFixed(3)} s`;

    // Per corner: the biggest difference between the two, in plain words.
    const feats = ["brake_point", "brake_length", "entry_speed", "apex_speed", "apex_offset", "throttle_point", "min_throttle", "coast"];
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
      return `<li><b>T${c.n}</b><span>${found ? found.text : "Same within the data's resolution"}.</span></li>`;
    });
    this.root.querySelector(".lab-corners")!.innerHTML = items.join("");
  }
}
