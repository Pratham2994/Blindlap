// Driver DNA: how each driver attacks corners, with the car taken out (pipeline/dna.py), projected
// to 3D. Close together = drive alike. A switch shows the style as driven, car included.
import * as THREE from "three";
import type { Careers, Dna, DnaCar, DnaDriver } from "../data";
import { careerLine } from "../data";
import type { World } from "../scene/world";
import { isDark, token } from "../theme";
import { dockStage } from "./stage";
import { traitLabel } from "./traits";

const SCALE = 60;

const discCache = new Map<string, THREE.CanvasTexture>();

function discTexture(code: string, colour: string, lit = false): THREE.CanvasTexture {
  const dark = isDark();
  const key = `${code}:${lit}:${token("--paper")}`;
  const hit = discCache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  // A printed roundel: paper disc, ink rim (heavier when selected), the code, a team-colour chip.
  g.fillStyle = dark ? token("--paper-2") : "#ffffff";
  g.beginPath();
  g.arc(128, 128, 118, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = lit ? 16 : 6;
  g.strokeStyle = lit ? token("--ink") : token("--paper-3");
  g.beginPath();
  g.arc(128, 128, 110, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = colour;
  g.fillRect(110, 176, 36, 8);
  g.font = `850 66px "Archivo Variable", sans-serif`;
  (g as CanvasRenderingContext2D & { fontStretch: string }).fontStretch = "expanded";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = token("--ink");
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
  private sprites: { sprite: THREE.Sprite; stalk: THREE.Line; d: DnaDriver; base: number; rank: number; target: THREE.Vector3 }[] = [];
  private links: THREE.LineSegments | null = null;
  // "own": the car taken out; "raw": as driven.
  private mode: "own" | "raw" = "own";
  private current = "";
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
    const tn = dna.teammateNearest;
    const shares = Object.values(dna.carShare);
    const lo = Math.round(Math.min(...shares) * 100);
    const hi = Math.round(Math.max(...shares) * 100);
    this.root.innerHTML = `
      <header class="page-head">
        <h1 class="display">Driver DNA</h1>
        <p>How every driver attacks a corner: where they brake, how much speed they carry, when they get back on the power, each against the whole field. Much of that is the car: ${lo} to ${hi}% of each habit, measured below. So the map takes the car out: what two teammates share is counted as the car, and drivers who changed teams show how much each car changes a driver. What is left is the driver's own style. Close together means they drive alike.</p>
      </header>
      <div class="dna-bar">
        <div class="seg" role="group" aria-label="Which style">
          <button type="button" data-mode="own" aria-pressed="true" title="Each driver with their car taken out">Own style</button>
          <button type="button" data-mode="raw" aria-pressed="false" title="Each driver's style as driven, car included">As driven</button>
        </div>
        <p class="dna-fact">Closest match is their own teammate: <b class="num">${tn.asDriven} of ${tn.drivers}</b> drivers as driven, <b class="num">${tn.ownStyle} of ${tn.drivers}</b> with the car taken out.</p>
      </div>
      <div class="dna-grid">
        <figure class="frame dna-stage">
          <div class="stage-slot"></div>
          <figcaption class="caps" data-k="caption"></figcaption>
        </figure>
        <aside class="dna-panel" aria-live="polite"></aside>
      </div>
      <section class="dna-share" aria-label="How much of each habit is the car">
        <h2 class="caps">How much is the car</h2>
        <p>The share of each habit that comes with the car (the team and season), against the share that stays with the driver wherever they drive.</p>
        ${Object.entries(dna.carShare)
          .map(
            ([k, v]) =>
              `<div class="share-row"><span>${k}</span><span class="share" role="img" aria-label="${Math.round(v * 100)}% car"><i style="width:${v * 100}%"></i></span><span class="num">${Math.round(v * 100)}% car · ${100 - Math.round(v * 100)}% driver</span></div>`,
          )
          .join("")}
      </section>
      ${movesSection(dna)}
      <section class="dna-what-if" aria-label="Any driver in any car">
        <h2 class="caps">Any driver, any car</h2>
        <p>The same sum for a move that never happened: the car's part plus the driver's own part. A guess from the model, not a measurement.</p>
        <div class="what-if-pick">
          <label class="caps">Driver <select data-k="wi-driver">${[...dna.drivers]
            .sort((a, b) => a.code.localeCompare(b.code))
            .map((d) => `<option value="${d.code}">${d.code} · ${d.name}</option>`)
            .join("")}</select></label>
          <label class="caps">Car <select data-k="wi-car">${carsByYear(dna)
            .map((c, i) => `<option value="${i}">${c.team} ${c.year}</option>`)
            .join("")}</select></label>
        </div>
        <div class="what-if-out" aria-live="polite"></div>
      </section>
      <section class="dna-cars" aria-label="Car fingerprints">
        <h2 class="caps">Car fingerprints</h2>
        <p>What each car makes its drivers do, whoever drives it: the car's part of every habit, scaled so the most extreme car reaches the edge.</p>
        <div class="car-grid">${carsByYear(dna)
          .map((c) => carCard(c))
          .join("")}</div>
      </section>`;
    this.panel = this.root.querySelector(".dna-panel")!;
    this.bindWhatIf(focus);
    this.root.querySelector(".dna-bar .seg")!.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-mode]");
      if (b) this.setMode(b.dataset.mode as "own" | "raw");
    });

    const ground = token("--paper");
    const faint = token("--paper-3");
    this.scene.background = new THREE.Color(ground);
    this.scene.fog = new THREE.Fog(ground, 180, 360);
    // Rings on the floor of the space, like range rings on a printed chart.
    for (let r = 20; r <= 100; r += 20) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(r - 0.15, r + 0.15, 160),
        new THREE.MeshBasicMaterial({ color: faint, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = -SCALE * 1.05;
      this.group.add(ring);
    }

    const byCode = new Map(dna.drivers.map((d) => [d.code, d]));
    for (const d of dna.drivers) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: discTexture(d.code, d.colour), transparent: true }));
      const target = new THREE.Vector3(...d.pos).multiplyScalar(SCALE);
      sprite.position.copy(target);
      sprite.scale.setScalar(10);
      this.group.add(sprite);
      // Stalk down to the floor so depth reads.
      const stalk = new THREE.Line(new THREE.BufferGeometry().setFromPoints([target, target.clone().setY(-SCALE * 1.05)]), new THREE.LineBasicMaterial({ color: faint }));
      this.group.add(stalk);
      this.sprites.push({ sprite, stalk, d, base: 1, rank: 0, target });
    }
    this.links = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: token("--ink"), transparent: true, opacity: 0.35 }));
    this.group.add(this.links);
    this.scene.add(this.group);

    this.bind();
    this.setMode("own");
    this.select(focus && byCode.has(focus) ? focus : dna.drivers[0].code);
    dockStage(this.root.querySelector(".stage-slot"));
  }

  /** "Any driver, any car": starts on the focused driver (or the first) in the newest car they did
   * not drive, so the first view is a real what-if. */
  private bindWhatIf(focus: string | null) {
    const dSel = this.root.querySelector<HTMLSelectElement>("[data-k=wi-driver]")!;
    const cSel = this.root.querySelector<HTMLSelectElement>("[data-k=wi-car]")!;
    const out = this.root.querySelector<HTMLElement>(".what-if-out")!;
    const cars = carsByYear(this.dna);
    const first = this.dna.drivers.find((d) => d.code === focus)?.code ?? "VER";
    dSel.value = this.dna.drivers.some((d) => d.code === first) ? first : this.dna.drivers[0].code;
    const other = cars.findIndex((c) => !c.drivers.includes(dSel.value) && c.year === cars[0].year && c.team === "Ferrari");
    cSel.value = String(other >= 0 ? other : cars.findIndex((c) => !c.drivers.includes(dSel.value)));
    const render = () => {
      const d = this.dna.drivers.find((x) => x.code === dSel.value)!;
      const car = cars[Number(cSel.value)];
      const rows = Object.keys(d.style)
        .map((k) => {
          const v = ((car.traitsZ[k] ?? 0) + (d.styleZ[k] ?? 0)) / (this.dna.rawScale[k] || 1);
          const x = Math.max(-1, Math.min(1, v));
          const own = Math.max(-1, Math.min(1, d.styleRaw[k] ?? 0));
          return `<div class="axis"><span>${traitLabel(k)}</span><span class="track"><i style="left:${x < 0 ? 50 + x * 50 : 50}%;width:${Math.max(Math.abs(x) * 50, 1)}%"></i><b class="tick" style="left:${50 + own * 50}%"></b></span></div>`;
        })
        .join("");
      const real = car.drivers.includes(d.code);
      out.innerHTML = `
        <p class="dna-key"><span><i class="bar"></i>${d.code} in the ${car.team} ${car.year}, as the model guesses</span><span><i class="mark"></i>${d.code} as really driven, all their cars</span></p>
        ${rows}
        <p class="near">${real ? `${d.code} really drove this car: the guess uses those laps too, so it is not a test. The team moves above are the honest test.` : `${d.code} never drove the ${car.team} ${car.year}${car.drivers.length ? ` (${car.drivers.join(", ")} did)` : ""}.`}</p>`;
    };
    dSel.addEventListener("change", render);
    cSel.addEventListener("change", render);
    render();
  }

  private neighbours(d: DnaDriver): string[] {
    return this.mode === "own" ? d.neighbours : d.neighboursRaw;
  }

  /** Own style or as driven: the discs glide to the other map, the links and panel follow. */
  private setMode(mode: "own" | "raw") {
    this.mode = mode;
    this.root.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String((b as HTMLElement).dataset.mode === mode)));
    const byCode = new Map(this.sprites.map((s) => [s.d.code, s]));
    for (const s of this.sprites) s.target.set(...(mode === "own" ? s.d.pos : s.d.posRaw)).multiplyScalar(SCALE);
    const pts: number[] = [];
    for (const s of this.sprites) {
      const n = byCode.get(this.neighbours(s.d)[0]);
      if (n) pts.push(...s.target.toArray(), ...n.target.toArray());
    }
    this.links!.geometry.dispose();
    this.links!.geometry = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const ex = mode === "own" ? this.dna.explained : this.dna.explainedRaw;
    const pct = Math.round(ex.reduce((a, v) => a + v, 0) * 100);
    this.root.querySelector("[data-k=caption]")!.textContent = `${mode === "own" ? "Own style, car taken out" : "As driven, car included"} · drag to turn · select a driver · lines join closest matches · the three directions hold ${pct}% of the differences`;
    if (this.current) this.select(this.current);
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
      if (!(e.target as HTMLElement).closest(".dna-stage")) return;
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
    this.current = code;
    const d = this.dna.drivers.find((x) => x.code === code)!;
    const near = this.neighbours(d);
    for (const s of this.sprites) {
      const on = s.d.code === code || near.includes(s.d.code);
      s.base = on ? 1 : 0.5;
      s.rank = s.d.code === code ? 2 : on ? 1 : 0;
      s.sprite.scale.setScalar(s.d.code === code ? 15 : 10);
      // The selected driver's rim lights in hard white; everyone else stays moulded grey.
      (s.sprite.material as THREE.SpriteMaterial).map = discTexture(s.d.code, s.d.colour, s.d.code === code);
    }
    // The bar is the style shown; the tick is the other one (as driven, or the car taken out).
    const shown = this.mode === "own" ? d.style : d.styleRaw;
    const other = this.mode === "own" ? d.styleRaw : d.style;
    const axes = Object.entries(shown)
      .map(([k, v]) => {
        const clamped = Math.max(-1, Math.min(1, v));
        const left = clamped < 0 ? 50 + clamped * 50 : 50;
        const width = Math.abs(clamped) * 50;
        const tick = 50 + Math.max(-1, Math.min(1, other[k] ?? 0)) * 50;
        return `<div class="axis"><span>${traitLabel(k)}</span><span class="track"><i style="left:${left}%;width:${Math.max(width, 1)}%"></i><b class="tick" style="left:${tick}%"></b></span></div>`;
      })
      .join("");
    // Season by season, the car taken out: the same seven traits as cells, ink to the right.
    const years = Object.keys(d.seasons).sort();
    const seasons = years.length
      ? `<p class="caps tells-h">Season by season, car taken out</p>
        <table class="dna-seasons"><thead><tr><th></th>${years.map((y) => `<th class="num" title="${d.seasons[y].team}">${y.slice(2)}</th>`).join("")}</tr></thead><tbody>${Object.keys(d.style)
          .map(
            (k) =>
              `<tr><th>${k}</th>${years
                .map((y) => {
                  const v = Math.max(-1, Math.min(1, d.seasons[y].traits[k] ?? 0));
                  return `<td title="${y}, ${d.seasons[y].team}: ${v > 0 ? "+" : ""}${v.toFixed(2)}"><i style="${v >= 0 ? "left:50%" : `left:${50 + v * 50}%`};width:${Math.abs(v) * 50}%"></i></td>`;
                })
                .join("")}</tr>`,
          )
          .join("")}</tbody></table>
        <p class="dna-teams">${years.map((y) => `<span><b class="num">${y}</b> ${d.seasons[y].team}</span>`).join("")}</p>`
      : "";
    const car = [...this.dna.cars].filter((c) => c.drivers.includes(code)).sort((a, b) => b.year - a.year)[0];
    const options = this.dna.drivers
      .map((x) => `<option value="${x.code}" ${x.code === code ? "selected" : ""}>${x.code} · ${x.name}</option>`)
      .join("");
    this.panel.innerHTML = `
      <h2 class="display">${d.code}</h2>
      <p class="caps team">${d.name} · ${d.team}</p>
      ${this.careers.drivers[code] ? `<p class="career num">${careerLine(this.careers.drivers[code])}</p>` : ""}
      <p class="dna-key"><span><i class="bar"></i>${this.mode === "own" ? "How they drive, with their car taken out" : "How they drive, car included"}</span><span><i class="mark"></i>${this.mode === "own" ? "The same, car included" : "The same, car taken out"}</span></p>
      ${axes}
      ${d.tells?.length ? `<p class="caps tells-h">What gives ${d.code} away, car taken out</p><ul class="tells">${d.tells.map((t) => `<li>${t.charAt(0).toUpperCase() + t.slice(1)}</li>`).join("")}</ul>` : ""}
      ${seasons}
      ${car ? `<p class="caps tells-h">Their car: ${car.team} ${car.year}</p>${carBars(car)}` : ""}
      <p class="near">Drives most like <b>${near.join("</b>, <b>")}</b>${this.mode === "own" ? ", car taken out" : ", car included"}. The centre line is the field average; bars are scaled so the most extreme driver on each trait reaches the edge.</p>
      <label class="caps jump">Jump to
        <select>${options}</select>
      </label>`;
    this.panel.querySelector("select")!.addEventListener("change", (e) => this.select((e.target as HTMLSelectElement).value));
  }

  frame(dt: number) {
    if (this.auto && !matchMedia("(prefers-reduced-motion: reduce)").matches) this.yaw += dt * 0.08;
    // Discs glide to the map that is shown.
    const k = Math.min(1, dt * 4);
    for (const s of this.sprites) {
      if (s.sprite.position.distanceToSquared(s.target) < 0.0001) continue;
      s.sprite.position.lerp(s.target, k);
      const a = s.stalk.geometry.getAttribute("position") as THREE.BufferAttribute;
      a.setXYZ(0, s.sprite.position.x, s.sprite.position.y, s.sprite.position.z);
      a.setXYZ(1, s.sprite.position.x, -SCALE * 1.05, s.sprite.position.z);
      a.needsUpdate = true;
    }
    const r = (this.world.renderer.domElement.clientWidth || innerWidth) <= 860 ? 280 : 210;
    this.camera.position.set(Math.sin(this.yaw) * Math.cos(this.pitch) * r, Math.sin(this.pitch) * r, Math.cos(this.yaw) * Math.cos(this.pitch) * r);
    this.camera.lookAt(0, -8, 0);
    const canvas = this.world.renderer.domElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    this.camera.aspect = w / h;
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

function carsByYear(dna: Dna): DnaCar[] {
  return [...dna.cars].sort((a, b) => b.year - a.year || a.team.localeCompare(b.team));
}

/** Team moves, each predicted before it happened and checked against what the driver did. */
function movesSection(dna: Dna): string {
  const ms = dna.moves ?? [];
  if (!ms.length) return "";
  const beatBefore = ms.filter((m) => m.error.model < m.error.before).length;
  const beatMate = ms.filter((m) => m.error.model < m.error.mate).length;
  const avg = (k: "model" | "before" | "mate") => (ms.reduce((a, m) => a + m.error[k], 0) / ms.length).toFixed(2);
  const colour = (team: string, year: number) => dna.cars.find((c) => c.team === team && c.year === year)?.colour ?? "#888888";
  const cards = ms
    .map((m) => {
      const worst = Math.max(m.error.model, m.error.before, m.error.mate);
      const err = (label: string, v: number, best: boolean) =>
        `<div class="err-row${best ? " best" : ""}"><span>${label}</span><span class="err"><i style="width:${(v / worst) * 100}%"></i></span><span class="num">${v.toFixed(2)}</span></div>`;
      const best = Math.min(m.error.model, m.error.before, m.error.mate);
      const rows = Object.keys(m.actual)
        .map((k) => {
          const x = Math.max(-1, Math.min(1, m.actual[k]));
          const p = Math.max(-1, Math.min(1, m.predicted[k]));
          return `<div class="axis"><span>${traitLabel(k)}</span><span class="track"><i style="left:${x < 0 ? 50 + x * 50 : 50}%;width:${Math.max(Math.abs(x) * 50, 1)}%"></i><b class="tick pred" style="left:${50 + p * 50}%"></b></span></div>`;
        })
        .join("");
      return `
        <article class="move-card" style="--team:${colour(m.team, m.year)}">
          <h3><b>${m.driver}</b> <span class="caps">${m.fromTeam} ${m.fromYear} → ${m.team} ${m.year}</span></h3>
          ${rows}
          <p class="caps err-h">Miss · shorter is better</p>
          ${err("The model", m.error.model, m.error.model === best)}
          ${err("Drives as before", m.error.before, m.error.before === best)}
          ${err(`Drives like ${m.mates.join(", ") || "the teammate"}`, m.error.mate, m.error.mate === best)}
        </article>`;
    })
    .join("");
  return `
    <section class="dna-moves" aria-label="Team moves, predicted before they happened">
      <h2 class="caps">Team moves, predicted before they happened</h2>
      <p>When a driver changes team, the model can guess how they will drive the new car before they drive it: the new car's part, learned from the teammate, plus the driver's own part, learned from their old cars. Here every move is guessed with none of the driver's laps from that season on, then checked against how they really drove. Two simple guesses for comparison: they drive as they did before, or the car decides and they drive like their new teammate.</p>
      <p class="moves-sum">The model was closer than "drives as before" in <b class="num">${beatBefore} of ${ms.length}</b> moves and closer than "drives like the new teammate" in <b class="num">${beatMate} of ${ms.length}</b>. Average miss: model <b class="num">${avg("model")}</b>, as before <b class="num">${avg("before")}</b>, like the teammate <b class="num">${avg("mate")}</b>.</p>
      <p class="dna-key"><span><i class="bar"></i>How they really drove the new car</span><span><i class="mark pred"></i>The model's guess, made before</span></p>
      <div class="move-grid">${cards}</div>
    </section>`;
}

/** A car's fingerprint: the seven traits as bars from the field's centre line. */
function carBars(c: DnaCar): string {
  return Object.entries(c.traits)
    .map(([k, v]) => {
      const x = Math.max(-1, Math.min(1, v));
      return `<div class="axis car"><span>${k}</span><span class="track"><i style="left:${x < 0 ? 50 + x * 50 : 50}%;width:${Math.max(Math.abs(x) * 50, 1)}%"></i></span></div>`;
    })
    .join("");
}

function carCard(c: DnaCar): string {
  return `<article class="car-card" style="--team:${c.colour}"><h3 class="caps">${c.team} <span class="num">${c.year}</span></h3><p class="drivers">${c.drivers.join(" · ")}</p>${carBars(c)}</article>`;
}
