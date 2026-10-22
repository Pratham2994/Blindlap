// The lap clock is a tyre: moulded lettering on the sidewall, the lap as a band round the rim,
// one notch per corner, speed and gear on the wheel.
import type { Session } from "../data";

const NS = "http://www.w3.org/2000/svg";
const C = 220;
const BAND = 158;

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
}

function polar(r: number, frac: number): [number, number] {
  const a = frac * Math.PI * 2 - Math.PI / 2;
  return [C + Math.cos(a) * r, C + Math.sin(a) * r];
}

function arcPath(r: number, from: number, to: number): string {
  const span = Math.min(Math.max(to - from, 0), 0.9999);
  const [x0, y0] = polar(r, from);
  const [x1, y1] = polar(r, from + span);
  return `M ${x0} ${y0} A ${r} ${r} 0 ${span > 0.5 ? 1 : 0} 1 ${x1} ${y1}`;
}

export class TyreGauge {
  readonly root: HTMLDivElement;
  private progress: SVGPathElement;
  private speed: SVGTextElement;
  private gear: SVGTextElement;
  private thr: SVGPathElement;
  private brk: SVGPathElement;
  private ticks: { line: SVGLineElement; label: SVGTextElement; notch: SVGPathElement }[] = [];

  constructor(private session: Session) {
    this.root = document.createElement("div");
    this.root.className = "tyre";
    this.root.setAttribute("aria-hidden", "true");
    const svg = el("svg", { viewBox: "0 0 440 440" });
    this.root.appendChild(svg);

    const defs = el("defs", {}, svg);
    const grad = el("radialGradient", { id: "rubberShade", cx: "38%", cy: "30%", r: "75%" }, defs);
    el("stop", { offset: "0%", "stop-color": "#1d1d1d" }, grad);
    el("stop", { offset: "100%", "stop-color": "#0a0a0a" }, grad);

    // Tyre body and moulding grooves.
    el("circle", { cx: C, cy: C, r: 218, fill: "url(#rubberShade)" }, svg);
    for (let r = 200; r <= 214; r += 3.5) {
      el("circle", { cx: C, cy: C, r, fill: "none", stroke: "#202020", "stroke-width": 1 }, svg);
    }
    el("circle", { cx: C, cy: C, r: 176, fill: "none", stroke: "#262626", "stroke-width": 1.5 }, svg);

    // Sidewall lettering.
    el("path", { id: "ringPath", d: `M ${C} ${C - 188} a 188 188 0 1 1 -0.01 0`, fill: "none" }, defs);
    const text = el("text", { class: "ring-text" }, svg);
    const tp = el("textPath", { href: "#ringPath", startOffset: "0" }, text);
    const km = (session.length / 1000).toFixed(3);
    tp.textContent = `BLIND LAP · ${session.circuit.toUpperCase()} · 2025 QUALIFYING · ${km} KM · ${session.corners.length} CORNERS · WHO IS DRIVING ·`;

    // The lap band.
    el("circle", { cx: C, cy: C, r: BAND, fill: "none", stroke: "#070707", "stroke-width": 13 }, svg);
    el("circle", { cx: C, cy: C, r: BAND - 6, fill: "none", stroke: "#2a2a2a", "stroke-width": 0.8 }, svg);
    this.progress = el("path", { d: "", fill: "none", stroke: "#f2f0ea", "stroke-width": 9, "stroke-linecap": "round" }, svg);

    // Corner notches. Numbers that would collide with the previous one are left off.
    let lastLabelled = -1;
    for (const c of session.corners) {
      const f = c.s / session.length;
      const [x0, y0] = polar(BAND - 10, f);
      const [x1, y1] = polar(BAND + 10, f);
      const line = el("line", { x1: x0, y1: y0, x2: x1, y2: y1, stroke: "#4a4a4a", "stroke-width": 2 }, svg);
      const [lx, ly] = polar(BAND - 24, f);
      const label = el("text", { x: lx, y: ly, class: "tick-label", "text-anchor": "middle", "dominant-baseline": "middle" }, svg);
      label.textContent = String(c.n);
      if (lastLabelled >= 0 && f - lastLabelled < 0.028) label.setAttribute("opacity", "0");
      else lastLabelled = f;
      const [nx, ny] = polar(BAND + 13, f);
      const ang = f * 360;
      const notch = el("path", {
        d: "M -5 -4 L 5 -4 L 0 4 Z",
        transform: `translate(${nx} ${ny}) rotate(${ang})`,
        fill: "#e8312a",
        opacity: 0,
      }, svg);
      this.ticks.push({ line, label, notch });
    }

    // Wheel.
    el("circle", { cx: C, cy: C, r: 118, fill: "#0b0b0b", stroke: "#1f1f1f", "stroke-width": 2 }, svg);
    el("path", { d: arcPath(104, 0.62, 0.88), fill: "none", stroke: "#1c1c1c", "stroke-width": 6, "stroke-linecap": "round" }, svg);
    el("path", { d: arcPath(104, 0.12, 0.38), fill: "none", stroke: "#1c1c1c", "stroke-width": 6, "stroke-linecap": "round" }, svg);
    this.thr = el("path", { d: "", fill: "none", stroke: "#f2f0ea", "stroke-width": 6, "stroke-linecap": "round" }, svg);
    this.brk = el("path", { d: "", fill: "none", stroke: "#2f7fe0", "stroke-width": 6, "stroke-linecap": "round" }, svg);

    this.speed = el("text", { x: C, y: C + 12, class: "speed num", "text-anchor": "middle" }, svg);
    this.speed.textContent = "0";
    const unit = el("text", { x: C, y: C + 34, class: "unit", "text-anchor": "middle" }, svg);
    unit.textContent = "KM/H";
    this.gear = el("text", { x: C, y: C - 52, class: "gear", "text-anchor": "middle" }, svg);
    this.gear.textContent = "N";
    const gl = el("text", { x: C, y: C - 82, class: "glabel", "text-anchor": "middle" }, svg);
    gl.textContent = "GEAR";
    const tl = el("text", { x: C - 80, y: C + 78, class: "glabel", "text-anchor": "middle" }, svg);
    tl.textContent = "THR";
    const bl = el("text", { x: C + 80, y: C + 78, class: "glabel", "text-anchor": "middle" }, svg);
    bl.textContent = "BRK";
  }

  update(s: number, speed: number, gear: number, throttle: number, brake: boolean) {
    const f = Math.min(Math.max(s / this.session.length, 0), 1);
    this.progress.setAttribute("d", f > 0.002 ? arcPath(BAND, 0, f) : "");
    this.speed.textContent = String(Math.round(speed));
    this.gear.textContent = gear > 0 ? String(gear) : "N";
    // Throttle fills the left arc upward, brake the right arc.
    this.thr.setAttribute("d", throttle > 2 ? arcPath(104, 0.88 - 0.26 * (throttle / 100), 0.88) : "");
    this.brk.setAttribute("d", brake ? arcPath(104, 0.12, 0.38) : "");
  }

  markCorner(i: number) {
    const t = this.ticks[i];
    if (!t) return;
    t.line.setAttribute("stroke", "#e8312a");
    t.label.classList.add("taken");
    t.notch.setAttribute("opacity", "1");
  }
}
