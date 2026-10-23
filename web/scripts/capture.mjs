// Capture every surface at desktop and phone size into .impeccable/review/ for design review.
// Usage: npm run dev (in another shell), then node scripts/capture.mjs [light|dark]
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const out = new URL("../../.impeccable/review/", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
mkdirSync(out, { recursive: true });
const base = "http://localhost:5173/";
const theme = process.argv[2] === "dark" ? "dark" : "light";
const tag = theme === "dark" ? "-dark" : "";
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });

async function shoot(width, height, prefix) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.addInitScript((t) => {
    localStorage.setItem("blindlap.speed.v1", "4");
    localStorage.setItem("blindlap.theme.v1", t);
  }, theme);
  const wait = (ms) => page.waitForTimeout(ms);

  await page.goto(base + "#/");
  await wait(3500);
  await page.screenshot({ path: `${out}${prefix}.png` });

  await page.goto(base + "#/play");
  await page.locator(".evidence .t").filter({ hasText: /^T\d+/ }).waitFor({ timeout: 40000 });
  await wait(2500);
  await page.locator(".lineup .row").nth(2).click();
  await page.screenshot({ path: `${out}${prefix}-play.png` });
  await page.locator(".reveal").waitFor({ timeout: 90000 });
  await wait(1500);
  await page.screenshot({ path: `${out}${prefix}-reveal.png` });
  const duel = page.getByRole("button", { name: /race it against/i });
  if (await duel.count()) {
    await duel.click();
    await wait(6000);
    await page.screenshot({ path: `${out}${prefix}-duel.png` });
  }

  await page.goto(base + "#/dna/VER");
  await wait(2500);
  await page.screenshot({ path: `${out}${prefix}-dna.png` });

  await page.goto(base + "#/how");
  await wait(800);
  await page.screenshot({ path: `${out}${prefix}-how.png` });

  await page.goto(base + "#/lab");
  await wait(1800);
  await page.screenshot({ path: `${out}${prefix}-lab.png` });

  await page.goto(base + "#/mates");
  await page.locator(".evidence .t").filter({ hasText: /^T\d+/ }).waitFor({ timeout: 40000 });
  await wait(2500);
  await page.screenshot({ path: `${out}${prefix}-mates.png` });
  await page.close();
}

await shoot(1440, 900, `desktop${tag}`);
await shoot(390, 844, `mobile${tag}`);
await browser.close();
console.log("captured into", out);
