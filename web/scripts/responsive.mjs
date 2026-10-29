// Responsive audit: every page (home, lap, reveal, DNA, battles, How, lab) at common laptop, monitor, tablet and phone sizes. For each it
// checks horizontal scrolling, elements running off screen, text overflowing its box, controls
// overlapping, and (on play) that the 3D view keeps a usable size; and saves a screenshot.
// Usage: npm run dev (in another shell), then node scripts/responsive.mjs [out dir]
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const out = (process.argv[2] ?? new URL("../../.impeccable/review/responsive/", import.meta.url).pathname.replace(/^\/(\w:)/, "$1")).replace(/\/?$/, "/");
mkdirSync(out, { recursive: true });
const base = "http://localhost:5173/";
const SIZES = [
  ["13in", 1280, 800], ["13in-retina", 1440, 900], ["15in", 1536, 864], ["16in", 1728, 1117],
  ["24in", 1920, 1080], ["27in", 2560, 1440], ["tablet", 768, 1024], ["tablet-land", 1024, 768],
  ["phone", 390, 844], ["phone-small", 360, 800], ["phone-land", 844, 390],
];
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const problems = [];

async function audit(page, name, label) {
  const r = await page.evaluate(() => {
    const out = [];
    const W = innerWidth;
    if (document.documentElement.scrollWidth > W + 1) out.push(`page scrolls sideways (${document.documentElement.scrollWidth} > ${W})`);
    const visible = (el) => {
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden" || +s.opacity === 0) return false;
      const b = el.getBoundingClientRect();
      return b.width > 0 && b.height > 0;
    };
    // Controls and text that leave the screen on the right or left.
    for (const el of document.querySelectorAll("button, a, h1, h2, p, .seg, .chip, select, input")) {
      if (!visible(el) || el.closest(".stage-parking, .lab-chart, .confusion, .wrap, .lineup ol")) continue;
      const b = el.getBoundingClientRect();
      if (b.right > W + 1 || b.left < -1) out.push(`${el.tagName.toLowerCase()}.${[...el.classList].join(".")} "${(el.textContent || "").trim().slice(0, 24)}" off screen (${Math.round(b.left)}..${Math.round(b.right)})`);
    }
    // Text wider than its own box (clipped or spilling).
    for (const el of document.querySelectorAll("h1, h2, .btn, .seg button, .ctl, .tag, .caps")) {
      if (!visible(el) || el.closest(".stage-parking")) continue;
      if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflow !== "visible") out.push(`text clipped in ${el.tagName.toLowerCase()}.${[...el.classList].join(".")} "${(el.textContent || "").trim().slice(0, 24)}"`);
    }
    // Buttons in the play bar overlapping each other.
    const ctl = [...document.querySelectorAll(".play-bar button, .play-bar a, .play-bar label")].filter(visible).map((e) => [e, e.getBoundingClientRect()]);
    for (let i = 0; i < ctl.length; i++)
      for (let j = i + 1; j < ctl.length; j++) {
        const [, a] = ctl[i];
        const [, b] = ctl[j];
        const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ix > 3 && iy > 3 && !ctl[i][0].contains(ctl[j][0]) && !ctl[j][0].contains(ctl[i][0])) out.push(`play bar controls overlap: "${ctl[i][0].textContent.trim().slice(0, 12)}" and "${ctl[j][0].textContent.trim().slice(0, 12)}"`);
      }
    const stage = document.querySelector(".stage-frame");
    if (stage && visible(stage)) {
      const b = stage.getBoundingClientRect();
      if (b.height < Math.min(220, innerHeight * 0.3)) out.push(`3D view only ${Math.round(b.width)}x${Math.round(b.height)}`);
    }
    return out;
  });
  const uniq = [...new Set(r)].slice(0, 8);
  console.log(`${name.padEnd(12)} ${label.padEnd(7)} ${uniq.length ? uniq.join("; ") : "ok"}`);
  for (const p of uniq) problems.push(`${name} ${label}: ${p}`);
  await page.screenshot({ path: `${out}${name}-${label}.png` });
}

for (const [name, w, h] of SIZES) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.addInitScript(() => {
    localStorage.setItem("blindlap.speed.v1", "4");
    localStorage.setItem("blindlap.intro.v1", "1");
  });
  await page.goto(base + "#/");
  await page.waitForTimeout(1500);
  await audit(page, name, "home");
  await page.goto(base + "#/play/9908");
  await page.locator(".evidence .t").filter({ hasText: /^T\d+/ }).waitFor({ timeout: 60000 });
  await page.waitForTimeout(800);
  await audit(page, name, "lap");
  await page.locator(".band.reveal").waitFor({ timeout: 120000 });
  await page.waitForTimeout(1200);
  await audit(page, name, "reveal");
  for (const [route, label] of [["dna/VER", "dna"], ["battles", "battles"], ["how", "how"], ["lab", "lab"]]) {
    await page.goto(base + "#/" + route);
    await page.waitForTimeout(1500);
    await audit(page, name, label);
  }
  await page.close();
}
await browser.close();
console.log(problems.length ? `\n${problems.length} problems` : "\nno problems");
