// The live track map, as in the broadcast: the circuit from above in the same orientation as the
// 3D scene, a dot for the car (and the rival in a duel), the lap so far drawn in red, a mark at
// the start line and one per corner that turns red once the models have read it.
import type * as THREE from "three";

const NS = "http://www.w3.org/2000/svg";
const SIZE = 200; // viewBox units

export class Minimap {
  readonly root: HTMLElement;
  private dot: SVGCircleElement;
  private ghost: SVGCircleElement;
  private driven: SVGPathElement;
  private ticks: SVGCircleElement[] = [];
  private toMap: (x: number, z: number) => [number, number];

  /** outline: the centreline in scene coordinates (x, z), starting at the line. corners: the
   * distance of each corner along the lap; `pointAt` maps a distance to the scene. */
  constructor(
    outline: THREE.Vector3[],
    corners: number[],
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
    const pad = 12;
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
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${SIZE} ${height.toFixed(1)}`);
    const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>) => {
      const e = document.createElementNS(NS, tag);
      for (const [a, v] of Object.entries(attrs)) e.setAttribute(a, v);
      svg.appendChild(e);
      return e;
    };
    el("path", { d, class: "mm-track-under" });
    el("path", { d, class: "mm-track" });
    this.driven = el("path", { d, class: "mm-driven", pathLength: "1", "stroke-dasharray": "0 1" });
    for (const s of corners) {
      const [x, y] = this.toMap(pointAt(s).x, pointAt(s).z);
      this.ticks.push(el("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: "2.6", class: "mm-corner" }));
    }
    // The start line: a short bar across the track at s = 0.
    const a = this.toMap(pointAt(-6).x, pointAt(-6).z);
    const b = this.toMap(pointAt(6).x, pointAt(6).z);
    const nx = -(b[1] - a[1]);
    const ny = b[0] - a[0];
    const n = Math.hypot(nx, ny) || 1;
    const [sx, sy] = this.toMap(pointAt(0).x, pointAt(0).z);
    el("line", {
      x1: (sx + (nx / n) * 6).toFixed(1), y1: (sy + (ny / n) * 6).toFixed(1),
      x2: (sx - (nx / n) * 6).toFixed(1), y2: (sy - (ny / n) * 6).toFixed(1), class: "mm-start",
    });
    this.ghost = el("circle", { r: "5", class: "mm-ghost" });
    this.ghost.style.display = "none";
    this.dot = el("circle", { r: "5.5", class: "mm-car" });
    this.root.appendChild(svg);
    this.update(0, null);
  }

  /** The car at distance s along the lap; the rival at ghostS (null outside a duel). In a duel
   * both dots take their team colours; otherwise the car is red, since the driver is hidden. */
  update(s: number, ghostS: number | null, ghostColour?: string, carColour?: string) {
    this.dot.style.fill = carColour ?? "";
    const [x, y] = this.toMap(this.pointAt(s).x, this.pointAt(s).z);
    this.dot.setAttribute("cx", x.toFixed(1));
    this.dot.setAttribute("cy", y.toFixed(1));
    const frac = Math.max(0, Math.min(1, s / this.length));
    this.driven.setAttribute("stroke-dasharray", `${frac.toFixed(4)} 1`);
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

  markCorner(i: number, read: boolean) {
    this.ticks[i]?.classList.toggle("read", read);
  }
}
