// Driver DNA: every driver's average corner style, projected to 3D. Close together = drive alike.
import * as THREE from "three";
import type { Dna, DnaDriver } from "../data";
import type { World } from "../scene/world";

const SCALE = 60;

function discTexture(code: string, colour: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  // A wheel nut seen face-on: rubber disc, team-colour rim, raised code.
  g.fillStyle = "#151515";
  g.beginPath();
  g.arc(128, 128, 118, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 10;
  g.strokeStyle = colour;
  g.beginPath();
  g.arc(128, 128, 110, 0, Math.PI * 2);
  g.stroke();
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
  return t;
}

export class DnaView {
  readonly root: HTMLDivElement;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 1, 1, 2000);
  private group = new THREE.Group();
  private sprites: { sprite: THREE.Sprite; d: DnaDriver }[] = [];
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
      <p class="dna-legend">Drag to turn. Select a driver to read their style. The three directions shown hold ${pct}% of the differences between drivers; lines join each driver to their closest match. Built from 2025 qualifying, push laps only.</p>`;
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
      sprite.scale.setScalar(13);
      this.group.add(sprite);
      this.sprites.push({ sprite, d });
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
      (s.sprite.material as THREE.SpriteMaterial).opacity = on ? 1 : 0.35;
      s.sprite.scale.setScalar(s.d.code === code ? 18 : 13);
    }
    const axes = Object.entries(d.style)
      .map(([k, v]) => {
        const clamped = Math.max(-1.2, Math.min(1.2, v)) / 1.2;
        const left = clamped < 0 ? 50 + clamped * 50 : 50;
        const width = Math.abs(clamped) * 50;
        return `<div class="axis"><span>${k}</span><span class="track" title="${v > 0 ? "+" : ""}${v.toFixed(2)} vs the field"><i style="left:${left}%;width:${Math.max(width, 1)}%"></i></span></div>`;
      })
      .join("");
    const options = this.dna.drivers
      .map((x) => `<option value="${x.code}" ${x.code === code ? "selected" : ""}>${x.code} · ${x.name}</option>`)
      .join("");
    this.panel.innerHTML = `
      <h2 class="display">${d.code}</h2>
      <p class="caps team">${d.name} · ${d.team}</p>
      ${axes}
      <p class="near">Drives most like <b>${d.neighbours.join("</b>, <b>")}</b>. Centre line is the field average; right is more of the trait.</p>
      <label class="caps" style="display:block;margin-top:14px;color:var(--ink-3)">Jump to
        <select style="margin-top:6px;width:100%;padding:10px;border-radius:12px;background:var(--rubber-3);color:var(--ink);border:0;font:inherit;text-transform:none;letter-spacing:0">${options}</select>
      </label>`;
    this.panel.querySelector("select")!.addEventListener("change", (e) => this.select((e.target as HTMLSelectElement).value));
  }

  frame(dt: number) {
    if (this.auto) this.yaw += dt * 0.08;
    const r = 210;
    this.camera.position.set(Math.sin(this.yaw) * Math.cos(this.pitch) * r, Math.sin(this.pitch) * r, Math.cos(this.yaw) * Math.cos(this.pitch) * r);
    this.camera.lookAt(0, -8, 0);
    const canvas = this.world.renderer.domElement;
    this.camera.aspect = canvas.clientWidth / canvas.clientHeight;
    this.camera.updateProjectionMatrix();
    this.world.renderer.render(this.scene, this.camera);
  }

  dispose() {
    for (const [t, type, fn] of this.handlers) t.removeEventListener(type, fn);
  }
}
