// What a broadcast shows around every circuit that the map does not: grandstands where the map
// has few (street circuits are mostly temporary stands), standing crowds behind the fences at the
// slow corners, advertising boards along the straights, and marshal posts. Each piece goes only
// where the ground is free: never on a mapped building or water, or across another part of the
// track (checked on an occupancy grid).
import * as THREE from "three";

/** 5 m cells over the ground square: 1 = taken (track corridor, building, water). */
export class Occupancy {
  readonly cell = 5;
  readonly n: number;
  readonly grid: Uint8Array;

  constructor(readonly size: number) {
    this.n = Math.ceil(size / this.cell);
    this.grid = new Uint8Array(this.n * this.n);
  }

  private index(x: number, z: number): number {
    const i = Math.floor((x + this.size / 2) / this.cell);
    const j = Math.floor((z + this.size / 2) / this.cell);
    return i < 0 || j < 0 || i >= this.n || j >= this.n ? -1 : j * this.n + i;
  }

  /** Mark a disc (the road and its barriers around a centreline point). */
  disc(x: number, z: number, r: number) {
    for (let dz = -r; dz <= r; dz += this.cell)
      for (let dx = -r; dx <= r; dx += this.cell) if (dx * dx + dz * dz <= r * r) this.set(x + dx, z + dz);
  }

  set(x: number, z: number) {
    const k = this.index(x, z);
    if (k >= 0) this.grid[k] = 1;
  }

  /** Mark a polygon (scene x, z points): every cell whose centre lies inside, plus its corners. */
  polygon(pts: THREE.Vector2[]) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      z0 = Math.min(z0, p.y);
      z1 = Math.max(z1, p.y);
    }
    for (const p of pts) this.set(p.x, p.y);
    for (let z = z0 + this.cell / 2; z < z1; z += this.cell)
      for (let x = x0 + this.cell / 2; x < x1; x += this.cell) if (inside(pts, x, z)) this.set(x, z);
  }

  free(x: number, z: number): boolean {
    const k = this.index(x, z);
    return k >= 0 && this.grid[k] === 0;
  }

  /** Is the whole rectangle (centre, along-direction, length, depth) free? Then mark it taken. */
  claim(c: THREE.Vector2, along: THREE.Vector2, length: number, depth: number): boolean {
    const across = new THREE.Vector2(-along.y, along.x);
    const pts: THREE.Vector2[] = [];
    for (let a = -length / 2; a <= length / 2; a += this.cell / 2)
      for (let d = -depth / 2; d <= depth / 2; d += this.cell / 2) pts.push(c.clone().addScaledVector(along, a).addScaledVector(across, d));
    if (!pts.every((p) => this.free(p.x, p.y))) return false;
    for (const p of pts) this.set(p.x, p.y);
    return true;
  }
}

export function inside(pts: THREE.Vector2[], x: number, z: number): boolean {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > z !== b.y > z && x < ((b.x - a.x) * (z - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/** A rectangle as a footprint: [x0, z0, x1, z1, ...] around a centre, in scene coordinates. */
export function rectangle(c: THREE.Vector2, along: THREE.Vector2, length: number, depth: number): number[] {
  const across = new THREE.Vector2(-along.y, along.x);
  const out: number[] = [];
  for (const [a, d] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const p = c.clone().addScaledVector(along, (a * length) / 2).addScaledVector(across, (d * depth) / 2);
    out.push(p.x, p.y);
  }
  return out;
}

const BOARD = ["#e10600", "#111111", "#f5c518", "#2f5aa8", "#11803d", "#f2f0ea", "#e07a2e"];

/** Advertising boards, one instanced mesh with a shared label texture tinted per board. */
export function boards(list: { p: THREE.Vector3; yaw: number }[]): THREE.Mesh | null {
  if (!list.length) return null;
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, 512, 64);
  g.fillStyle = "#d8d8d8";
  g.font = `900 44px "Archivo Variable", sans-serif`;
  (g as CanvasRenderingContext2D & { fontStretch: string }).fontStretch = "expanded";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("BLIND LAP", 256, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(10.5, 1.3).translate(0, 1.45, 0),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, side: THREE.DoubleSide }),
    list.length,
  );
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const col = new THREE.Color();
  list.forEach(({ p, yaw }, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    m.compose(p, q, new THREE.Vector3(1, 1, 1));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, col.set(BOARD[i % BOARD.length]));
  });
  return mesh;
}

/** Marshal posts: small orange cabins with a white roof. */
export function marshalPosts(list: { p: THREE.Vector3; yaw: number }[]): THREE.Group {
  const g = new THREE.Group();
  if (!list.length) return g;
  const cabin = new THREE.InstancedMesh(
    new THREE.BoxGeometry(2.2, 2.4, 2.2).translate(0, 1.2, 0),
    new THREE.MeshStandardMaterial({ color: "#e8742a", roughness: 0.7 }),
    list.length,
  );
  const roof = new THREE.InstancedMesh(
    new THREE.BoxGeometry(2.8, 0.25, 2.8).translate(0, 2.5, 0),
    new THREE.MeshStandardMaterial({ color: "#f2f0ea", roughness: 0.6 }),
    list.length,
  );
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  list.forEach(({ p, yaw }, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    m.compose(p, q, new THREE.Vector3(1, 1, 1));
    cabin.setMatrixAt(i, m);
    roof.setMatrixAt(i, m);
  });
  cabin.castShadow = true;
  g.add(cabin, roof);
  return g;
}
