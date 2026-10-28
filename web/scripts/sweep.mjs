// Bug sweep: drive every flow of the app in headless Chromium and, at each step, check for script
// errors, a stage that is missing or blank, and layout running off the screen.
// Usage: npm run dev (in another shell), then node scripts/sweep.mjs
import { chromium } from "@playwright/test";

const base = "http://localhost:5173/";
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => {
    localStorage.setItem("blindlap.speed.v1", "4");
    localStorage.setItem("blindlap.intro.v1", "1");
  });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const problems = [];
let step = 0;

/** Check the page now. needs3d: the page should show the 3D stage. */
async function check(label, needs3d = true) {
  step++;
  await page.waitForTimeout(700);
  const r = await page.evaluate((needs3d) => {
    const out = [];
    const canvas = document.getElementById("stage");
    if (!canvas) out.push("canvas missing from the page");
    else if (needs3d) {
      if (!canvas.parentElement?.classList.contains("stage-slot")) out.push(`canvas not in a frame (parent: ${canvas.parentElement?.className})`);
      if (canvas.clientWidth < 50 || canvas.clientHeight < 50) out.push(`canvas tiny ${canvas.clientWidth}x${canvas.clientHeight}`);
      // Render one frame and read it back: a blank or black stage has almost no variation.
      try {
        window.world.composer.render();
        const c = document.createElement("canvas");
        c.width = 64;
        c.height = 40;
        const g = c.getContext("2d");
        g.drawImage(canvas, 0, 0, 64, 40);
        const d = g.getImageData(0, 0, 64, 40).data;
        let sum = 0, sq = 0;
        const n = d.length / 4;
        for (let i = 0; i < d.length; i += 4) {
          const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
          sum += l;
          sq += l * l;
        }
        const sd = Math.sqrt(sq / n - (sum / n) ** 2);
        if (sd < 4) out.push(`stage looks blank (luminance spread ${sd.toFixed(1)}, mean ${(sum / n).toFixed(0)})`);
      } catch (e) {
        out.push("readback failed: " + e.message);
      }
    }
    // The lap bar's handle and its fill must show the same place in the lap.
    const seek = document.querySelector(".tm-seek");
    const fill = document.querySelector("[data-k=progress]");
    if (seek && fill && !seek.disabled) {
      const a = Number(seek.value) / Number(seek.max);
      const b = fill.getBoundingClientRect().width / fill.parentElement.getBoundingClientRect().width;
      if (Math.abs(a - b) > 0.01) out.push(`lap bar handle at ${(a * 100).toFixed(1)}% but fill at ${(b * 100).toFixed(1)}%`);
    }
    if (document.documentElement.scrollWidth > innerWidth + 1) out.push(`page wider than the screen (${document.documentElement.scrollWidth} > ${innerWidth})`);
    for (const sel of [".play-bar", ".side", ".band", ".stage-frame"]) {
      const el = document.querySelector(sel);
      if (el && getComputedStyle(el).display !== "none") {
        const b = el.getBoundingClientRect();
        if (b.right > innerWidth + 1) out.push(`${sel} runs off the right edge (${Math.round(b.right)} > ${innerWidth})`);
      }
    }
    return out;
  }, needs3d);
  const line = `${String(step).padStart(2)} ${label}: ${r.length ? r.join("; ") : "ok"}`;
  console.log(line);
  if (r.length) problems.push(line);
  if (errors.length) {
    problems.push(`   script errors: ${errors.join(" | ")}`);
    console.log(`   script errors: ${errors.join(" | ")}`);
    errors.length = 0;
  }
  // UNTIL=n stops after step n, for a quick run.
  if (process.env.UNTIL && step >= Number(process.env.UNTIL)) {
    console.log(problems.length ? `${problems.length} problems` : "no problems");
    await browser.close();
    process.exit(0);
  }
}

const waitLap = () => page.locator(".evidence .t").filter({ hasText: /^T\d+/ }).waitFor({ timeout: 60000 });
const waitReveal = () => page.locator(".band.reveal").waitFor({ timeout: 120000 });
const click = (name) => page.getByRole("button", { name }).first().click();

await page.goto(base + "#/");
await check("home");
await page.getByRole("link", { name: /start a lap/i }).click();
await page.waitForTimeout(1200);
await check("lights");
await waitLap();
await check("lap 1");
await page.locator(".lineup .row").nth(1).click();
await page.locator(".model-switch button").nth(2).click();
await check("model switched mid-lap");
await page.locator(".tm-seek").fill("100");
await check("seek back");
await page.keyboard.press("ArrowRight");
await check("arrow forward");
for (const cam of ["Onboard", "Side", "TV", "Above", "Chase"]) {
  await page.locator(".seg.cams button", { hasText: cam }).click();
  await check(`camera ${cam}`);
}
const box = await page.locator(".stage-frame").boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 + 250, box.y + box.height / 2 + 60, { steps: 8 });
await page.mouse.up();
await check("dragged view");
await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
await check("view reset by double-click");
await waitReveal();
await check("reveal 1");
await page.locator(".model-switch button").nth(1).click();
await check("model switched on reveal");
await page.getByRole("link", { name: /driver dna/i }).click();
await check("dna from the reveal");
await page.goBack();
await page.waitForTimeout(1500);
await check("browser back from dna into play");
await page.keyboard.press("Escape");
await check("escape during lights");
await page.goto(base + "#/play");
await waitReveal();
await click(/race it against/i);
await page.waitForTimeout(2500);
await check("duel");
await page.keyboard.press("Space");
await check("duel paused");
await page.keyboard.press("Space");
await click(/back to result/i);
await check("back from duel");
for (const round of [2, 3]) {
  await click(/next lap/i);
  await page.waitForTimeout(1200);
  await check(`round ${round} lights`);
  await waitLap();
  await check(`round ${round} lap`);
  await waitReveal();
  await check(`round ${round} reveal`);
}
await click(/next lap/i);
await waitLap();
await page.keyboard.press("Space");
await page.locator(".play-bar .back").click();
await check("menu from a paused lap");
await page.goto(base + "#/play");
await waitLap();
await page.keyboard.press("Escape");
await check("escape to home");

await page.locator(".theme-toggle").click();
await check("home dark");
await page.goto(base + "#/play/9908.0");
await waitLap();
await check("challenge link, dark");
await page.setViewportSize({ width: 390, height: 844 });
await check("phone size mid-lap");
await page.setViewportSize({ width: 1440, height: 900 });
await check("back to desktop size");
await page.goto(base + "#/dna/VER");
await check("dna dark");
await page.locator(".theme-toggle").click();
await check("dna switched to light");
await page.goto(base + "#/how");
await check("how", false);
await page.goto(base + "#/lab");
await check("lab", false);
await page.goto(base + "#/shootout/9943");
await page.locator(".tower-row").first().waitFor({ timeout: 60000 });
await page.waitForTimeout(1500);
await check("shootout");
await page.locator(".tower-row").nth(4).click();
await check("shootout, following another driver");
await page.goto(base + "#/play/9943");
await waitLap();
await check("blind lap after the shootout (field gone, one car)");
await page.goto(base + "#/mates");
await waitLap();
await check("teammates lap");
await waitReveal();
await check("teammates reveal");
await click(/next lap/i);
await waitLap();
await check("teammates round 2");
await page.goto(base + "#/");
await check("home with three modes");
await page.locator(".mode.quick").click();
await waitLap();
await check("quick lap from the home tile");
await page.goto(base + "#/");
await check("home again");
await page.goBack();
await page.waitForTimeout(1500);
await check("browser back into the lap");

console.log(problems.length ? `\n${problems.length} problems` : "\nno problems");
await browser.close();
