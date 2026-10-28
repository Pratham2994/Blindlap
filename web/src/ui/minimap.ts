// The live track map, as on the broadcast: a dark card with the circuit from above in the same
// orientation as the 3D scene, the lap so far in red, a pulsing dot for the car (and the rival in
// a duel), a chequered start line, a mark per corner that turns red once the models have read it,
// and the next corner in the header.
import type * as THREE from "three";

const NS = "http://www.w3.org/2000/svg";
const SIZE = 200; // viewBox units

export interface MapCorner {
  s: number;
  n: number | string;
}

export class Minimap {
  readonly root: HTMLElement;
  private dot: SVGGElement;
  private ghost: SVGCircleElement;
  private driven: SVGPathElement;
  private next: HTMLElement;
  private ticks: SVGCircleElement[] = [];
  private fieldDots: SVGCircleElement[] = [];
  private toMap: (x: number, z: number) => [number, number];

  /** outline: the centreline in scene coordinates (x, z), starting at the line. `pointAt` maps a
   * distance along the lap to the scene. */
  constructor(
    name: string,
    outline: THREE.Vector3[],
    private corners: MapCorner[],
    private length: number,
    private pointAt: (s: number) => THREE.Vector3,
  ) {
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const p of outline) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      z0 = Math.min(z0, p.z);
      z1 = Math.max(z1, p.z);
    }
    // The card takes the circuit's own shape: full width, as tall as the track needs (between
    // half and 1.3 times the width), so a long circuit like Monza does not float in empty space.
    const pad = 14;
    const height = Math.min(1.3, Math.max(0.5, (z1 - z0) / (x1 - x0))) * SIZE;
    const k = Math.min((SIZE - 2 * pad) / (x1 - x0), (height - 2 * pad) / (z1 - z0));
    const ox = pad + (SIZE - 2 * pad - (x1 - x0) * k) / 2;
    const oz = pad + (height - 2 * pad - (z1 - z0) * k) / 2;
    // Seen from above: scene x to the right, scene z down the screen (the chase camera's map).
    this.toMap = (x, z) => [ox + (x - x0) * k, oz + (z - z0) * k];
    const d = outline.map((p, i) => `${i ? "L" : "M"}${this.toMap(p.x, p.z).map((v) => v.toFixed(1)).join(" ")}`).join("") + "Z";

    this.root = document.createElement("figure");
    this.root.className = "minimap";
    this.root.setAttribute("aria-hidden", "true");
    const head = document.createElement("figcaption");
    head.className = "mm-head";
    head.innerHTML = `<span>${name}</span><span class="mm-next" data-k="next"></span>`;
    this.next = head.querySelector("[data-k=next]")!;
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${SIZE} ${height.toFixed(1)}`);
    const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>, parent: Element = svg) => {
      const e = document.createElementNS(NS, tag);
      for (const [a, v] of Object.entries(attrs)) e.setAttribute(a, v);
      parent.appendChild(e);
      return e;
    };
    el("path", { d, class: "mm-casing" });
    el("path", { d, class: "mm-track" });
    this.driven = el("path", { d, class: "mm-driven", pathLength: "1", "stroke-dasharray": "0 1" });
    for (const c of corners) {
      const [x, y] = this.toMap(pointAt(c.s).x, pointAt(c.s).z);
      this.ticks.push(el("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: "2.2", class: "mm-corner" }));
    }
    // The start line: a short chequered bar across the track at s = 0.
    const a = this.toMap(pointAt(-6).x, pointAt(-6).z);
    const b = this.toMap(pointAt(6).x, pointAt(6).z);
    const nx = -(b[1] - a[1]);
    const ny = b[0] - a[0];
    const n = Math.hypot(nx, ny) || 1;
    const [sx, sy] = this.toMap(pointAt(0).x, pointAt(0).z);
    const line = { x1: (sx + (nx / n) * 7).toFixed(1), y1: (sy + (ny / n) * 7).toFixed(1), x2: (sx - (nx / n) * 7).toFixed(1), y2: (sy - (ny / n) * 7).toFixed(1) };
    el("line", { ...line, class: "mm-start" });
    el("line", { ...line, class: "mm-start-check" });
    this.ghost = el("circle", { r: "5", class: "mm-ghost" });
    this.ghost.style.display = "none";
    this.dot = el("g", { class: "mm-car" });
    el("circle", { r: "6", class: "mm-pulse" }, this.dot);
    el("circle", { r: "5.5", class: "mm-dot" }, this.dot);
    this.root.append(head, svg);
    this.update(0, null);
  }

  /** The car at distance s along the lap; the rival at ghostS (null outside a duel). In a duel
   * both dots take their team colours; otherwise the car is red, since the driver is hidden. */
  update(s: number, ghostS: number | null, ghostColour?: string, carColour?: string) {
    const [x, y] = this.toMap(this.pointAt(s).x, this.pointAt(s).z);
    this.dot.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
    (this.dot.lastChild as SVGCircleElement).style.fill = carColour ?? "";
    const frac = Math.max(0, Math.min(1, s / this.length));
    this.driven.setAttribute("stroke-dasharray", `${frac.toFixed(4)} 1`);
    const next = this.corners.find((c) => c.s > s);
    this.next.textContent = next ? `Next T${next.n}` : "To the line";
    if (ghostS === null) {
      this.ghost.style.display = "none";
      return;
    }
    const [gx, gy] = this.toMap(this.pointAt(ghostS).x, this.pointAt(ghostS).z);
    this.ghost.style.display = "";
    this.ghost.setAttribute("cx", gx.toFixed(1));
    this.ghost.setAttribute("cy", gy.toFixed(1));
    if (ghostColour) this.ghost.style.fill = ghostColour;
  }

  /** The shootout: a dot in team colour for every other car (on: false hides one). */
  field(points: { s: number; colour: string; on: boolean }[]) {
    const svg = this.root.querySelector("svg")!;
    while (this.fieldDots.length < points.length) {
      const c = document.createElementNS(NS, "circle");
      c.setAttribute("r", "3.6");
      c.setAttribute("class", "mm-field");
      svg.insertBefore(c, this.dot);
      this.fieldDots.push(c);
    }
    points.forEach((p, i) => {
      const c = this.fieldDots[i];
      c.style.display = p.on ? "" : "none";
      if (!p.on) return;
      const at = this.pointAt(p.s);
      const [x, y] = this.toMap(at.x, at.z);
      c.setAttribute("cx", x.toFixed(1));
      c.setAttribute("cy", y.toFixed(1));
      c.style.fill = p.colour;
    });
  }

  markCorner(i: number, read: boolean) {
    this.ticks[i]?.classList.toggle("read", read);
  }
}
