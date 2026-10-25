// Checks that the ground never covers the track: on every session, the terrain height at every
// point of the centreline must stay below the road. Usage: npm run dev, then node scripts/ground-check.mjs
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
  for (const s of index.sessions) {
    const session = await (await fetch(`/data/sessions/${s.key}.json`)).json();
    const es = envIndex[s.key];
    const env = await (await fetch(`/data/env/${es.env}.json`)).json();
    w.setSession(session);
    w.applySurroundings(env, es);
    let worst = -Infinity;
    let bad = 0;
    // Both edges of the road and the centre, at every frame point.
    for (let i = 0; i < w.frame.pos.length; i++) {
      const p = w.frame.pos[i];
      const sd = w.frame.side[i];
      for (const o of [-5.5, 0, 5.5]) {
        const over = w.terrain.at(p.x + sd.x * o, p.z + sd.z * o) - p.y;
        worst = Math.max(worst, over);
        if (over > -0.05) bad++;
      }
    }
    out.push(`${s.circuit} ${s.year}: ${bad ? `${bad} road points covered, worst ${worst.toFixed(1)} m above` : `ok (ground at least ${(-worst).toFixed(1)} m below)`}`);
  }
  return out;
});
console.log(rows.join("\n"));
const failed = rows.filter((r) => r.includes("covered")).length;
console.log(failed ? `\n${failed} sessions with the road covered` : "\nground below the road everywhere");
await browser.close();
process.exit(failed ? 1 : 0);
