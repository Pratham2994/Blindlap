// Checks that nothing covers the track, on every session:
// 1. the ground stays below the road everywhere (centre and both edges);
// 2. no building, grandstand, spectator, tree or Ferris wheel comes within 12.5 m of the
//    centreline (the fence is at about 11 m), unless it is well below the road.
// Trackside furniture (boards, marshal posts) stands at the fence by design and is skipped.
// Usage: npm run dev (in another shell), then node scripts/track-check.mjs
import { chromium } from "@playwright/test";

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
await page.goto("http://localhost:5173/#/how");
await page.waitForTimeout(1500);
const rows = await page.evaluate(async () => {
  const index = await (await fetch("/data/index.json")).json();
  const envIndex = await (await fetch("/data/env/index.json")).json();
  const w = window.world;
  const out = [];
  const LIMIT = 12.5;
  for (const s of index.sessions) {
    const session = await (await fetch(`/data/sessions/${s.key}.json`)).json();
    const es = envIndex[s.key];
    const env = await (await fetch(`/data/env/${es.env}.json`)).json();
    w.setSession(session);
    w.applySurroundings(env, es);
    // 1. Ground under the road.
    let buried = 0;
    for (let i = 0; i < w.frame.pos.length; i++) {
      const p = w.frame.pos[i];
      const sd = w.frame.side[i];
      for (const o of [-5.5, 0, 5.5]) if (w.terrain.at(p.x + sd.x * o, p.z + sd.z * o) - p.y > -0.05) buried++;
    }
    // 2. Surroundings clear of the road.
    let close = 0;
    let worst = Infinity;
    let what = "";
    const v = new THREE.Vector3();
    const m = new THREE.Matrix4();
    const test = (x, y, z, pad, kind) => {
      const { d, p } = w.clearance.near(x, z);
      if (!p || y < p.y - 3.5) return;
      if (d - pad < LIMIT) {
        close++;
        if (d - pad < worst) {
          worst = d - pad;
          what = kind;
        }
      }
    };
    w.envGroup.updateMatrixWorld(true);
    w.envGroup.traverse((o) => {
      for (let q = o; q; q = q.parent) if (q.userData?.furniture) return;
      if (!o.isMesh) return;
      const pos = o.geometry.getAttribute("position");
      if (o.isInstancedMesh) {
        o.geometry.computeBoundingSphere();
        const r = o.geometry.boundingSphere.radius;
        for (let i = 0; i < o.count; i++) {
          o.getMatrixAt(i, m);
          v.setFromMatrixPosition(m);
          test(v.x, v.y, v.z, Math.min(r, 3), o.geometry.type === "ConeGeometry" ? "tree" : "spectator");
        }
        return;
      }
      // Every vertex, and the middle of every triangle (big walls have few vertices).
      const idx = o.geometry.getIndex();
      const n = idx ? idx.count : pos.count;
      const at = (k) => (idx ? idx.getX(k) : k);
      for (let k = 0; k < pos.count; k++) {
        v.fromBufferAttribute(pos, k).applyMatrix4(o.matrixWorld);
        test(v.x, v.y, v.z, 0, "building or stand");
      }
      for (let k = 0; k + 2 < n; k += 3) {
        const a = new THREE.Vector3().fromBufferAttribute(pos, at(k));
        const b = new THREE.Vector3().fromBufferAttribute(pos, at(k + 1));
        const c = new THREE.Vector3().fromBufferAttribute(pos, at(k + 2));
        v.copy(a).add(b).add(c).multiplyScalar(1 / 3).applyMatrix4(o.matrixWorld);
        test(v.x, v.y, v.z, 0, "building or stand");
      }
    });
    const parts = [];
    if (buried) parts.push(`${buried} road points under the ground`);
    if (close) parts.push(`${close} points within ${LIMIT} m of the road (closest ${worst.toFixed(1)} m, ${what})`);
    out.push(`${s.circuit} ${s.year}: ${parts.length ? "FAIL " + parts.join("; ") : "ok"}`);
  }
  return out;
});
console.log(rows.join("\n"));
const failed = rows.filter((r) => r.includes("FAIL")).length;
console.log(failed ? `\n${failed} sessions with something on the track` : "\ntrack clear on every session");
await browser.close();
process.exit(failed ? 1 : 0);
