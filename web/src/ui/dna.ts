// Driver DNA: every driver's average corner style, projected to 3D. Close together = drive alike.
import * as THREE from "three";
import type { Careers, Dna, DnaDriver } from "../data";
import { careerLine } from "../data";
import type { World } from "../scene/world";

const SCALE = 60;

const discCache = new Map<string, THREE.CanvasTexture>();

function discTexture(code: string, colour: string, lit = false): THREE.CanvasTexture {
  const key = `${code}:${lit}`;
  const hit = discCache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  // A wheel nut seen face-on: rubber disc, moulded rim, raised code, team colour as a small chip.
  g.fillStyle = "#151515";
  g.beginPath();
  g.arc(128, 128, 118, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = lit ? "#f2f0ea" : "#3a3a3a";
  g.beginPath();
  g.arc(128, 128, 110, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = colour;
  g.fillRect(110, 176, 36, 8);
  g.font = `850 66px "Archivo Variable", sans-serif`;
  (g as CanvasRenderingContext2D & { fontStretch: string }).fontStretch = "expanded";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#000";
  g.fillText(code, 128, 132);
  g.fillStyle = "#f2f0ea";
  g.fillText(code, 128, 130);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  discCache.set(key, t);
  return t;
}

export class DnaView {
  readonly root: HTMLDivElement;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 1, 1, 2000);
  private group = new THREE.Group();
  private sprites: { sprite: THREE.Sprite; d: DnaDriver; base: number; rank: number }[] = [];
  private links: THREE.LineSegments | null = null;
  private yaw = 0.6;
  private pitch = 0.35;
  private dragging = false;
  private auto = true;
  private panel: HTMLElement;
  private ray = new THREE.Raycaster();
  private handlers: [EventTarget, string, EventListener][] = [];

  constructor(
    private world: World,
    private dna: Dna,
    focus: string | null,
    private careers: Careers = { source: "", drivers: {} },
  ) {
    this.root = document.createElement("div");
    this.root.className = "page dna";
    const pct = Math.round(dna.explained.reduce((a, v) => a + v, 0) * 100);
    this.root.innerHTML = `
      <div class="dna-head">
        <h1 class="display">Driver<br>DNA</h1>
        <p>Every driver's average corner, scored against the field: where they brake, how much speed they carry, when they get back on the power. Drivers who sit close together attack corners alike.</p>
      </div>
      <aside class="dna-panel" aria-live="polite"></aside>
      <p class="dna-legend">Drag to turn. Select a driver to read their style. The three directions shown hold ${pct}% of the differences between drivers; lines join each driver to their closest match. Built from qualifying push laps.</p>`;
    this.panel = this.root.querySelector(".dna-panel")!;

    this.scene.background = new THREE.Color("#0e0e0e");
    this.scene.fog = new THREE.Fog("#0e0e0e", 160, 320);
    // Concentric grooves as the floor of the space, the same sidewall the track sits on.
    for (let r = 20; r <= 100; r += 20) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(r - 0.15, r + 0.15, 160),
        new THREE.MeshBasicMaterial({ color: "#2b2b2b", side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = -SCALE * 1.05;
      this.group.add(ring);
    }

    const byCode = new Map(dna.drivers.map((d) => [d.code, d]));
    const linkPts: number[] = [];
    for (const d of dna.drivers) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: discTexture(d.code, d.colour), transparent: true }));
      sprite.position.set(d.pos[0] * SCALE, d.pos[1] * SCALE, d.pos[2] * SCALE);
      sprite.scale.setScalar(10);
      this.group.add(sprite);
      this.sprites.push({ sprite, d, base: 1, rank: 0 });
      // Stalk down to the floor so depth reads.
      const stalk = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([sprite.position.clone(), sprite.position.clone().setY(-SCALE * 1.05)]),
        new THREE.LineBasicMaterial({ color: "#2b2b2b" }),
      );
      this.group.add(stalk);
      const n = byCode.get(d.neighbours[0]);
      if (n) linkPts.push(...sprite.position.toArray(), n.pos[0] * SCALE, n.pos[1] * SCALE, n.pos[2] * SCALE);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.Float32BufferAttribute(linkPts, 3));
    this.links = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: "#f2f0ea", transparent: true, opacity: 0.28 }));
    this.group.add(this.links);
    this.scene.add(this.group);

    this.bind();
    this.select(focus && byCode.has(focus) ? focus : dna.drivers[0].code);
  }

  private on(target: EventTarget, type: string, fn: EventListener) {
    target.addEventListener(type, fn);
    this.handlers.push([target, type, fn]);
  }

  private bind() {
    const canvas = this.world.renderer.domElement;
    let lx = 0;
    let ly = 0;
    let moved = 0;
    this.on(this.root, "pointerdown", ((e: PointerEvent) => {
      if ((e.target as HTMLElement).closest(".dna-panel, .dna-head")) return;
      this.dragging = true;
      this.auto = false;
      lx = e.clientX;
      ly = e.clientY;
      moved = 0;
    }) as EventListener);
    this.on(window, "pointermove", ((e: PointerEvent) => {
      if (!this.dragging) return;
      this.yaw -= (e.clientX - lx) * 0.006;
      this.pitch = Math.min(1.2, Math.max(-0.4, this.pitch + (e.clientY - ly) * 0.004));
      moved += Math.abs(e.clientX - lx) + Math.abs(e.clientY - ly);
      lx = e.clientX;
      ly = e.clientY;
    }) as EventListener);
    this.on(window, "pointerup", ((e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      if (moved > 6) return;
      const rect = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      this.ray.setFromCamera(ndc, this.camera);
      const hit = this.ray.intersectObjects(this.sprites.map((s) => s.sprite))[0];
      if (hit) this.select(this.sprites.find((s) => s.sprite === hit.object)!.d.code);
    }) as EventListener);
  }

  private select(code: string) {
    const d = this.dna.drivers.find((x) => x.code === code)!;
    for (const s of this.sprites) {
      const on = s.d.code === code || d.neighbours.includes(s.d.code);
      s.base = on ? 1 : 0.5;
      s.rank = s.d.code === code ? 2 : on ? 1 : 0;
      s.sprite.scale.setScalar(s.d.code === code ? 15 : 10);
      // The selected driver's rim lights in hard white; everyone else stays moulded grey.
      (s.sprite.material as THREE.SpriteMaterial).map = discTexture(s.d.code, s.d.colour, s.d.code === code);
    }
    const axes = Object.entries(d.style)
      .map(([k, v]) => {
        const clamped = Math.max(-1, Math.min(1, v));
        const raw = d.styleRaw?.[k] ?? v;
        const left = clamped < 0 ? 50 + clamped * 50 : 50;
        const width = Math.abs(clamped) * 50;
        return `<div class="axis"><span>${k}</span><span class="track" title="${raw > 0 ? "+" : ""}${raw.toFixed(2)} standard deviations vs the field"><i style="left:${left}%;width:${Math.max(width, 1)}%"></i></span></div>`;
      })
      .join("");
    const options = this.dna.drivers
      .map((x) => `<option value="${x.code}" ${x.code === code ? "selected" : ""}>${x.code} · ${x.name}</option>`)
      .join("");
    this.panel.innerHTML = `
      <h2 class="display">${d.code}</h2>
      <p class="caps team">${d.name} · ${d.team}</p>
      ${this.careers.drivers[code] ? `<p class="career num">${careerLine(this.careers.drivers[code])}</p>` : ""}
      ${axes}
      ${d.tells?.length ? `<p class="caps tells-h">What gives ${d.code} away</p><ul class="tells">${d.tells.map((t) => `<li>${t.charAt(0).toUpperCase() + t.slice(1)}</li>`).join("")}</ul>` : ""}
      <p class="near">Drives most like <b>${d.neighbours.join("</b>, <b>")}</b>. The centre line is the field average; bars are scaled so the most extreme driver on each trait reaches the edge.</p>
      <label class="caps jump">Jump to
        <select style="margin-top:6px;width:100%;padding:10px;border-radius:12px;background:var(--rubber-3);color:var(--ink);border:0;font:inherit;text-transform:none;letter-spacing:0">${options}</select>
      </label>`;
    this.panel.querySelector("select")!.addEventListener("change", (e) => this.select((e.target as HTMLSelectElement).value));
  }

  frame(dt: number) {
    if (this.auto && !matchMedia("(prefers-reduced-motion: reduce)").matches) this.yaw += dt * 0.08;
    const r = (this.world.renderer.domElement.clientWidth || innerWidth) <= 860 ? 280 : 210;
    this.camera.position.set(Math.sin(this.yaw) * Math.cos(this.pitch) * r, Math.sin(this.pitch) * r, Math.cos(this.yaw) * Math.cos(this.pitch) * r);
    this.camera.lookAt(0, -8, 0);
    const canvas = this.world.renderer.domElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    this.camera.aspect = w / h;
    // On phones the heading and panel own the top and bottom; push the map into the band between.
    if (w <= 860) this.camera.setViewOffset(w, h, 0, -h * 0.06, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    this.declutter(w, h);
    this.world.renderer.render(this.scene, this.camera);
  }

  /** When two discs land on top of each other on screen, keep the one in front (or the one the
   * reader picked) and fade the other, so codes never overprint. */
  private declutter(w: number, h: number) {
    const focal = h / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    const pts = this.sprites.map((s) => {
      const p = s.sprite.position.clone().project(this.camera);
      const dist = s.sprite.position.distanceTo(this.camera.position);
      // On-screen diameter of the disc, from its world size and distance.
      const size = (s.sprite.scale.x * focal) / dist;
      return { s, x: (p.x + 1) * 0.5 * w, y: (1 - p.y) * 0.5 * h, z: p.z, size };
    });
    for (const a of pts) {
      let hidden = false;
      for (const b of pts) {
        if (a === b) continue;
        const close = Math.hypot(a.x - b.x, a.y - b.y) < (a.size + b.size) * 0.42;
        const loses = b.s.rank > a.s.rank || (b.s.rank === a.s.rank && b.z < a.z);
        if (close && loses) {
          hidden = true;
          break;
        }
      }
      (a.s.sprite.material as THREE.SpriteMaterial).opacity = hidden ? 0.08 : a.s.base;
    }
  }

  dispose() {
    for (const [t, type, fn] of this.handlers) t.removeEventListener(type, fn);
  }
}
