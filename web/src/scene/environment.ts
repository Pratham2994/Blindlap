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
  const c = new THREE.Color();
  const push = (hex: string, verts: number) => {
    c.set(hex).multiplyScalar(shade);
    for (let k = 0; k < verts; k++) col.push(c.r, c.g, c.b);
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
    const ground = terrain.at(cx / pts.length, cz / pts.length);
    const y0 = ground + minh;
    const y1 = ground + h;
    // Walls: one quad per edge, outward facing.
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      pos.push(a.x, y0, a.y, b.x, y0, b.y, b.x, y1, b.y, a.x, y0, a.y, b.x, y1, b.y, a.x, y1, a.y);
      push(wall, 6);
    }
    // Roof, and the underside for raised roofs (grandstand canopies, pit roofs).
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(pts, [])) {
      pos.push(pts[i].x, y1, pts[i].y, pts[k].x, y1, pts[k].y, pts[j].x, y1, pts[j].y);
      // Grandstand roofs are canopies over the seats; the seats show as a coloured roof from above.
      push(stand ? "#c23b30" : roof, 3);
      if (minh > 0) {
        pos.push(pts[i].x, y0, pts[i].y, pts[j].x, y0, pts[j].y, pts[k].x, y0, pts[k].y);
        push(wall, 3);
      }
    }
  }
  if (!pos.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
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
  const crowns = new THREE.InstancedMesh(new THREE.ConeGeometry(2.6, 7, 7).translate(0, 6.5, 0), crown, n);
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.35, 3.2, 5).translate(0, 1.6, 0), trunk, n);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const p = toScene(flat[2 * i], flat[2 * i + 1]);
    const hash = Math.abs(Math.sin(flat[2 * i] * 12.9898 + flat[2 * i + 1] * 78.233) * 43758.5453) % 1;
    const k = 0.75 + hash * 0.6;
    s.set(k, k, k);
    m.compose(new THREE.Vector3(p.x, terrain.at(p.x, p.y), p.y), q, s);
    crowns.setMatrixAt(i, m);
    trunks.setMatrixAt(i, m);
    // Greens vary from tree to tree, as they do in a real wood.
    green.setHSL(0.25 + hash * 0.07, 0.32 + hash * 0.16, (0.3 + hash * 0.12) * shade);
    crowns.setColorAt(i, green);
  }
  crowns.castShadow = true;
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
