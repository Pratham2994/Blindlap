// Real surroundings for a circuit, from OpenStreetMap via pipeline/environment.py: buildings at
// their real footprint and height, grandstands, woods, single trees, Ferris wheels. Water, woods
// and parks are painted into the ground texture instead (see textures.ts), so they always lie
// on the terrain. Nothing here is invented: every object comes from a mapped feature.
import * as THREE from "three";

export interface EnvData {
  circuit: string;
  attribution: string;
  // height, min height, grandstand (1/0), footprint x0, y0, x1, y1..., wall colour, roof colour
  buildings: [number, number, number, number[], string, string][];
  water: number[][][]; // polygons: [outer ring, hole rings...], each ring x0, y0, x1, y1...
  wood: number[][][];
  grass: number[][][];
  gravel?: number[][][]; // gravel traps (older exports have none)
  tarmac?: number[][][]; // tarmac run-off, pit lane, car parks
  street?: boolean;
  trees: number[]; // x0, y0, x1, y1...
  wheels: [number, number, number][]; // x, y, height
}

/** Where a session sits on the map: world = M (track - offset) + t, in metres east/north. */
export interface EnvSession {
  env: string;
  M: number[][];
  t: number[];
  offset: number[];
  light: "day" | "dusk" | "night";
  sun: number;
}

/** Map metres (east, north) to the session's own track coordinates (the inverse of its fit). */
export function mapToTrack(s: EnvSession): (x: number, y: number) => [number, number] {
  const [[a, b], [c, d]] = s.M;
  const det = a * d - b * c;
  const [ia, ib, ic, id] = [d / det, -b / det, -c / det, a / det];
  return (x, y) => {
    const ux = x - s.t[0];
    const uy = y - s.t[1];
    return [ia * ux + ib * uy + s.offset[0], ic * ux + id * uy + s.offset[1]];
  };
}

/** A height field over the ground square, blended from the track's own height. */
export class Terrain {
  readonly heights: Float32Array;

  constructor(
    readonly size: number,
    readonly n: number,
    samples: { x: number; z: number; y: number }[],
    below: number,
  ) {
    this.heights = new Float32Array((n + 1) * (n + 1));
    const half = size / 2;
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const x = -half + (i / n) * size;
        const z = -half + (j / n) * size;
        // Inverse-distance weights that fall off fast, so the nearest track dominates and the
        // ground meets the road; far away the field settles to a blend of the whole circuit.
        let sw = 0;
        let sy = 0;
        for (const p of samples) {
          const dx = p.x - x;
          const dz = p.z - z;
          const w = 1 / (dx * dx + dz * dz + 100) ** 2;
          sw += w;
          sy += w * p.y;
        }
        this.heights[j * (n + 1) + i] = sy / sw - below;
      }
    }
    // The ground must never rise above a road. Where a high and a low part of the track pass
    // close together (Monaco's hairpin, the climb to Casino) the blend above pulled the ground up
    // over the low road and buried it. Near every road the ground stays below it and may only
    // rise away from it gently, like an embankment.
    const slope = 0.35;
    // No rise within one and a half grid cells of the road: between grid points the surface is
    // interpolated, so a point a cell away must not lift the ground over the road.
    const flat = 8 + 1.5 * (size / n);
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const x = -half + (i / n) * size;
        const z = -half + (j / n) * size;
        let cap = Infinity;
        for (const p of samples) {
          const d = Math.hypot(p.x - x, p.z - z);
          cap = Math.min(cap, p.y - below - 0.4 + slope * Math.max(0, d - flat));
        }
        const k = j * (n + 1) + i;
        if (this.heights[k] > cap) this.heights[k] = cap;
      }
    }
  }

  /** Height at scene (x, z), bilinear between grid points. */
  at(x: number, z: number): number {
    const n = this.n;
    const fx = THREE.MathUtils.clamp(((x + this.size / 2) / this.size) * n, 0, n - 1e-6);
    const fz = THREE.MathUtils.clamp(((z + this.size / 2) / this.size) * n, 0, n - 1e-6);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const h = this.heights;
    const r = n + 1;
    return (
      h[j * r + i] * (1 - u) * (1 - v) + h[j * r + i + 1] * u * (1 - v) + h[(j + 1) * r + i] * (1 - u) * v + h[(j + 1) * r + i + 1] * u * v
    );
  }

  /** The ground mesh, its vertices raised to the height field. */
  mesh(material: THREE.Material): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(this.size, this.size, this.n, this.n).rotateX(-Math.PI / 2);
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) pos.setY(k, this.at(pos.getX(k), pos.getZ(k)));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, material);
    m.receiveShadow = true;
    return m;
  }
}

const BAY_W = 3; // metres per window bay
const BAY_H = 3.2; // metres per floor
const BAYS = 8; // bays per texture side

/** Facade textures, 8 x 8 window bays: `wall` is white wall with glazing (multiplied by each
 * building's own colour), `lit` is the same windows, a random third of them glowing, for night. */
export function facadeTextures(): { wall: THREE.CanvasTexture; lit: THREE.CanvasTexture } {
  const px = 64;
  const n = px * BAYS;
  const make = (lit: boolean) => {
    const c = document.createElement("canvas");
    c.width = c.height = n;
    const g = c.getContext("2d")!;
    g.fillStyle = lit ? "#000000" : "#ffffff";
    g.fillRect(0, 0, n, n);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let j = 0; j < BAYS; j++)
      for (let i = 0; i < BAYS; i++) {
        const x = i * px;
        const y = j * px;
        const r = rnd();
        if (lit) {
          if (r < 0.34) {
            g.fillStyle = r < 0.1 ? "#ffd9a0" : r < 0.22 ? "#ffe9c2" : "#cfe3ff";
            g.fillRect(x + 16, y + 14, 32, 34);
          }
          continue;
        }
        // Lintel shadow, glass (a little different window to window), a sill.
        g.fillStyle = "#d9d6cf";
        g.fillRect(x + 13, y + 11, 38, 3);
        const shade = 60 + Math.floor(r * 45);
        g.fillStyle = `rgb(${shade - 8}, ${shade + 4}, ${shade + 22})`;
        g.fillRect(x + 16, y + 14, 32, 34);
        g.fillStyle = "rgba(255,255,255,0.18)";
        g.fillRect(x + 16, y + 14, 32, 8);
        g.fillStyle = "#c9c5bc";
        g.fillRect(x + 14, y + 48, 36, 3);
      }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  return { wall: make(false), lit: make(true) };
}

/** Buildings as one merged mesh per kind: walls and flat roofs, at the mapped heights, in their
 * mapped colours (or a typical colour for the type). `shade` darkens them for the dark theme. */
export function buildingsMesh(
  list: EnvData["buildings"],
  stands: boolean,
  toScene: (x: number, y: number) => THREE.Vector2,
  terrain: Terrain,
  material: THREE.Material,
  shade = 1,
): THREE.Mesh | null {
  const pos: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
  const c = new THREE.Color();
  const push = (hex: string, verts: number) => {
    c.set(hex).multiplyScalar(shade);
    for (let k = 0; k < verts; k++) col.push(c.r, c.g, c.b);
  };
  // Roofs and undersides sample a plain wall corner of the facade texture.
  const plain = (verts: number) => {
    for (let k = 0; k < verts; k++) uv.push(0.004, 0.004);
  };
  for (const [h, minh, stand, flat, wall, roof] of list) {
    if (Boolean(stand) !== stands) continue;
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i < flat.length; i += 2) pts.push(toScene(flat[i], flat[i + 1]));
    if (pts.length < 3) continue;
    if (THREE.ShapeUtils.isClockWise(pts)) pts.reverse();
    let cx = 0;
    let cz = 0;
    for (const p of pts) {
      cx += p.x;
      cz += p.y;
    }
    // The lowest ground under the footprint, a little below: no corner may float over a slope
    // (the ground is a 30 m grid; the middle alone left one side of a building in the air).
    const ground = Math.min(...pts.map((p) => terrain.at(p.x, p.y))) - 0.4;
    const y0 = ground + minh;
    const y1 = ground + h;
    // Walls: one quad per edge, outward facing, with window bays (u along the wall, v per floor)
    // and darker toward the ground, where streets and neighbours shade a real wall.
    let run = Math.abs(Math.sin(cx * 0.37 + cz * 0.11)) * BAYS; // each building starts at a different bay
    const v0 = minh / BAY_H / BAYS;
    const v1 = h / BAY_H / BAYS;
    const base = new THREE.Color(wall).multiplyScalar(shade * 0.62);
    const top = new THREE.Color(wall).multiplyScalar(shade);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const u0 = run / BAYS;
      run += Math.max(1, Math.round(a.distanceTo(b) / BAY_W));
      const u1 = run / BAYS;
      pos.push(a.x, y0, a.y, b.x, y0, b.y, b.x, y1, b.y, a.x, y0, a.y, b.x, y1, b.y, a.x, y1, a.y);
      uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
      const low = minh > 0 ? top : base;
      for (const q of [low, low, top, low, top, top]) col.push(q.r, q.g, q.b);
    }
    // Roof, and the underside for raised roofs (grandstand canopies, pit roofs).
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(pts, [])) {
      pos.push(pts[i].x, y1, pts[i].y, pts[k].x, y1, pts[k].y, pts[j].x, y1, pts[j].y);
      // Grandstand roofs are canopies over the seats; the seats show as a coloured roof from above.
      push(stand ? "#c23b30" : roof, 3);
      plain(3);
      if (minh > 0) {
        pos.push(pts[i].x, y0, pts[i].y, pts[j].x, y0, pts[j].y, pts[k].x, y0, pts[k].y);
        push(wall, 3);
        plain(3);
      }
    }
  }
  if (!pos.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Trees at mapped positions: a trunk and a crown, sized by a hash of the position so every
 * visit looks the same. */
export function treesGroup(
  flat: number[],
  toScene: (x: number, y: number) => THREE.Vector2,
  terrain: Terrain,
  crown: THREE.Material,
  trunk: THREE.Material,
  shade = 1,
): THREE.Group {
  const g = new THREE.Group();
  const green = new THREE.Color();
  const n = flat.length / 2;
  if (!n) return g;
  // Few sides each: there are thousands of trees. Open-ended so no hidden caps are drawn.
  // Two kinds, chosen per tree: round broadleaf crowns (most trees by a track) and conifers.
  const round = new THREE.IcosahedronGeometry(3.1, 1).translate(0, 6.2, 0);
  round.scale(1, 0.85, 1);
  const crowns = new THREE.InstancedMesh(new THREE.ConeGeometry(2.6, 7, 6, 1, true).translate(0, 6.5, 0), crown, n);
  const blobs = new THREE.InstancedMesh(round, crown, n);
  let nc = 0;
  let nb = 0;
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.35, 3.2, 4, 1, true).translate(0, 1.6, 0), trunk, n);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const p = toScene(flat[2 * i], flat[2 * i + 1]);
    const hash = Math.abs(Math.sin(flat[2 * i] * 12.9898 + flat[2 * i + 1] * 78.233) * 43758.5453) % 1;
    const k = 0.75 + hash * 0.6;
    s.set(k, k, k);
    m.compose(new THREE.Vector3(p.x, terrain.at(p.x, p.y), p.y), q, s);
    trunks.setMatrixAt(i, m);
    // Greens vary from tree to tree, as they do in a real wood.
    green.setHSL(0.25 + hash * 0.07, 0.32 + hash * 0.16, (0.3 + hash * 0.12) * shade);
    if ((hash * 7.13) % 1 < 0.62) {
      blobs.setMatrixAt(nb, m);
      blobs.setColorAt(nb++, green);
    } else {
      crowns.setMatrixAt(nc, m);
      crowns.setColorAt(nc++, green);
    }
  }
  crowns.count = nc;
  blobs.count = nb;
  g.add(blobs);
  // No shadows from trees: one instanced mesh is drawn whole into the shadow map, doubling its cost
  // for shadows that the close cameras barely show.
  g.add(crowns, trunks);
  return g;
}

/** A Ferris wheel at its mapped position and height, its face turned toward the circuit. */
export function wheelMesh(x: number, z: number, height: number, ground: number, material: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  // A wheel stands on legs: the rim reaches up to the mapped height, its hub a little above half.
  const r = height * 0.45;
  g.add(new THREE.Mesh(new THREE.TorusGeometry(r, 0.6, 6, 48), material));
  for (let k = 0; k < 16; k++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.25, r * 2, 0.25), material);
    spoke.rotation.z = (k / 16) * Math.PI;
    g.add(spoke);
  }
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.8, r + 2, 0.8), material);
    leg.position.set(side * r * 0.35, -(r + 2) / 2, 0);
    leg.rotation.z = side * 0.33;
    g.add(leg);
  }
  g.position.set(x, ground + height - r, z);
  g.rotation.y = Math.atan2(x, z);
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  return g;
}

/** One seated spectator: a block 0.42 m wide, 0.75 m tall, facing -z after placement turns it to
 * the track. Only the faces that can be seen are drawn: front, top and sides (8 triangles). */
function spectator(): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(0.42, 0.75, 0.38).translate(0, 0.38, 0);
  const index = geo.getIndex()!;
  // BoxGeometry faces in order: +x, -x, +y, -y, +z, -z (6 indices each). Keep +x, -x, +y, +z.
  const keep = [0, 1, 2, 4];
  const out: number[] = [];
  for (const f of keep) for (let k = 0; k < 6; k++) out.push(index.getX(f * 6 + k));
  geo.setIndex(out);
  return geo;
}

const SHIRTS = ["#c23b30", "#e8e4da", "#2f5aa8", "#f0c419", "#1d1d1d", "#e07a2e", "#3f8a4a", "#8e2c6c", "#7fb0d8", "#d9d0c0"];

/** Grandstands that sit on the ground become raked seating, rising away from the track, with a
 * crowd on it: the stands are mapped, and qualifying always has spectators. `nearest` gives the
 * closest track point to a scene position; `budget` caps how many spectators are drawn. */
export function standsGroup(
  list: EnvData["buildings"],
  toScene: (x: number, y: number) => THREE.Vector2,
  terrain: Terrain,
  nearest: (x: number, z: number) => THREE.Vector2,
  structure: THREE.Material,
  people: THREE.Material,
  budget = 22000,
  seatOk: (x: number, z: number) => boolean = () => true, // e.g. clear of the track
): THREE.Group {
  const g = new THREE.Group();
  const pos: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  type Seat = { x: number; y: number; z: number; d: number; face: number };
  const seats: Seat[] = [];
  for (const [h, minh, stand, flat, wall] of list) {
    if (!stand || minh > 0) continue;
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i < flat.length; i += 2) pts.push(toScene(flat[i], flat[i + 1]));
    if (pts.length < 3) continue;
    if (THREE.ShapeUtils.isClockWise(pts)) pts.reverse();
    const centre = pts.reduce((a, p) => a.add(p), new THREE.Vector2()).multiplyScalar(1 / pts.length);
    const track = nearest(centre.x, centre.y);
    const toTrack = track.clone().sub(centre).normalize(); // the front faces the track
    const across = new THREE.Vector2(-toTrack.y, toTrack.x);
    const depthOf = (p: THREE.Vector2) => -p.clone().sub(centre).dot(toTrack); // grows away from the track
    const ds = pts.map(depthOf);
    const d0 = Math.min(...ds);
    const depth = Math.max(...ds) - d0 || 1;
    const ground = Math.min(...pts.map((p) => terrain.at(p.x, p.y))) - 0.4; // never floating
    const front = 1.5;
    const top = Math.max(front + 2, h);
    const yAt = (p: THREE.Vector2) => ground + front + ((depthOf(p) - d0) / depth) * (top - front);
    // Side walls, ground to the rake.
    c.set(wall);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const ya = yAt(a);
      const yb = yAt(b);
      pos.push(a.x, ground, a.y, b.x, ground, b.y, b.x, yb, b.y, a.x, ground, a.y, b.x, yb, b.y, a.x, ya, a.y);
      for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b);
    }
    // The sloped seating deck.
    c.set("#8d9298");
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(pts, [])) {
      for (const p of [pts[i], pts[k], pts[j]]) {
        pos.push(p.x, yAt(p), p.y);
        col.push(c.r, c.g, c.b);
      }
    }
    // A roof over the back of bigger stands: the footprint cut to its rear 60% (by distance from
    // the track), floating 2.6 m above the top row, as a cantilevered canopy.
    if (depth > 7 && top > 5) {
      const cut = d0 + depth * 0.4;
      const back: THREE.Vector2[] = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const da = depthOf(a) - cut;
        const db = depthOf(b) - cut;
        if (da >= 0) back.push(a);
        if (da >= 0 !== db >= 0) back.push(a.clone().lerp(b, da / (da - db)));
      }
      if (back.length >= 3) {
        const roofY = ground + top + 2.6;
        c.set("#d9d6cf");
        for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(back, [])) {
          for (const p of [back[i], back[k], back[j]]) {
            pos.push(p.x, roofY, p.y);
            col.push(c.r, c.g, c.b);
          }
          for (const p of [back[i], back[j], back[k]]) {
            pos.push(p.x, roofY - 0.15, p.y);
            col.push(c.r * 0.82, c.g * 0.82, c.b * 0.82);
          }
        }
      }
    }
    // Seats in rows across the stand: 0.9 m between rows, 0.7 m between seats.
    const poly = pts.map((p) => [p.x, p.y]);
    const inside = (x: number, z: number) => {
      let hit = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, zi] = poly[i];
        const [xj, zj] = poly[j];
        if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
      }
      return hit;
    };
    const span = Math.max(...pts.map((p) => Math.abs(p.clone().sub(centre).dot(across)))) + 1;
    const dist = track.distanceTo(centre);
    // Only a stand with a corner close to the track needs each seat tested (the test is the slow
    // part); for the rest every seat is clear already.
    const checkSeats = pts.some((p) => !seatOk(p.x, p.y)) || !seatOk(centre.x, centre.y);
    for (let r = d0 + 0.8; r < d0 + depth - 0.4; r += 0.9) {
      for (let a = -span; a <= span; a += 0.7) {
        const p = centre.clone().addScaledVector(toTrack, -r).addScaledVector(across, a);
        if (!inside(p.x, p.y) || (checkSeats && !seatOk(p.x, p.y))) continue;
        seats.push({ x: p.x, y: yAt(p), z: p.y, d: dist + (r - d0), face: Math.atan2(toTrack.x, toTrack.y) });
      }
    }
  }
  if (pos.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, structure);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  }
  // A full house nearest the track, thinning out at the back; the closest seats win the budget.
  seats.sort((a, b) => a.d - b.d);
  const crowd: Seat[] = [];
  for (const s of seats) {
    const hash = Math.abs(Math.sin(s.x * 12.9898 + s.z * 78.233) * 43758.5453) % 1;
    if (hash < 0.82) crowd.push(s);
    if (crowd.length >= budget) break;
  }
  if (crowd.length) {
    const mesh = new THREE.InstancedMesh(spectator(), people, crowd.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    crowd.forEach((s, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.face);
      m.compose(new THREE.Vector3(s.x, s.y, s.z), q, one);
      mesh.setMatrixAt(i, m);
      const hash = Math.abs(Math.sin(s.x * 39.346 + s.z * 11.135) * 15731.743) % 1;
      mesh.setColorAt(i, c.set(SHIRTS[Math.floor(hash * SHIRTS.length)]));
    });
    g.add(mesh);
  }
  return g;
}
