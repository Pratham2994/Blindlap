// Record a demo of one round (title, lap at 2x, reveal, duel) to docs/media/demo.webm, and save
// still screenshots for the README. Usage: npm run dev (in another shell), then node scripts/record-demo.mjs
import { chromium } from "@playwright/test";
import { mkdirSync, renameSync, readdirSync, rmSync } from "node:fs";

const root = new URL("../../docs/media/", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
const tmp = `${root}tmp/`;
mkdirSync(tmp, { recursive: true });
const size = { width: 1280, height: 720 };
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const context = await browser.newContext({ viewport: size, recordVideo: { dir: tmp, size } });
await context.addInitScript(() => {
    localStorage.setItem("blindlap.speed.v1", "2");
    localStorage.setItem("blindlap.intro.v1", "1"); localStorage.setItem("blindlap.quality.v1", "0");
  });
const page = await context.newPage();
const wait = (ms) => page.waitForTimeout(ms);

await page.goto("http://localhost:5173/#/");
await wait(4000);
await page.screenshot({ path: `${root}title.png` });
await page.getByRole("link", { name: /start a lap/i }).click();
await page.locator(".evidence .t").filter({ hasText: /^T\d+/ }).waitFor({ timeout: 40000 });
await wait(6000);
await page.locator(".lineup .row").nth(1).click();
await wait(3000);
await page.screenshot({ path: `${root}lap.png` });
await page.getByRole("button", { name: /above/i }).click();
await wait(6000);
await page.screenshot({ path: `${root}above.png` });
await page.getByRole("button", { name: /chase/i }).click();
await page.locator(".reveal").waitFor({ timeout: 120000 });
await wait(2500);
await page.screenshot({ path: `${root}reveal.png` });
const duel = page.getByRole("button", { name: /race it against/i });
if (await duel.count()) {
  await duel.click();
  await wait(9000);
  await page.screenshot({ path: `${root}duel.png` });
}
await page.goto("http://localhost:5173/#/dna/VER");
await wait(5000);
await page.screenshot({ path: `${root}dna.png` });

await context.close();
await browser.close();
const video = readdirSync(tmp).find((f) => f.endsWith(".webm"));
renameSync(`${tmp}${video}`, `${root}demo.webm`);
rmSync(tmp, { recursive: true });
console.log("saved", `${root}demo.webm`);
