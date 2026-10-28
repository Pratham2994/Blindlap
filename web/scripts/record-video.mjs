// Record the README demo frame by frame, so it is smooth however slow the renderer is: the page
// runs on Playwright's fake clock, each step moves time on by exactly 1/30 s (animation frames,
// timers and performance.now together), and a screenshot is taken after every step. ffmpeg then
// joins the frames into docs/media/demo.mp4 and a smaller docs/media/demo.gif.
// Usage: npm run dev (in another shell), then node scripts/record-video.mjs   (about 20 minutes)
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";

const media = new URL("../../docs/media/", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
const frames = `${media}frames/`;
rmSync(frames, { recursive: true, force: true });
mkdirSync(frames, { recursive: true });
const FPS = 30;
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript(() => {
  localStorage.setItem("blindlap.speed.v1", "2");
  localStorage.setItem("blindlap.intro.v1", "1");
  localStorage.setItem("blindlap.quality.v1", "0");
  localStorage.setItem("blindlap.theme.v1", "light");
});
await page.clock.install();

let n = 0;
/** Move the page on by `seconds` of its own time, one frame at a time, filming each frame. */
async function film(seconds) {
  for (let k = 0; k < Math.round(seconds * FPS); k++) {
    await page.clock.runFor(1000 / FPS);
    await page.screenshot({ path: `${frames}${String(n++).padStart(5, "0")}.png` });
  }
}
/** Film until the condition holds (checked every frame), at most `limit` seconds. */
async function filmUntil(selector, limit = 120) {
  for (let k = 0; k < limit * FPS; k++) {
    if (await page.locator(selector).count()) return;
    await film(1 / FPS);
  }
  throw new Error(`never saw ${selector}`);
}

await page.goto("http://localhost:5173/#/");
await page.waitForTimeout(1500); // the data loads in real time
await film(4);
await page.getByRole("link", { name: /start a lap/i }).click();
await filmUntil(".play[data-phase=lights]", 30);
await filmUntil(".evidence .t >> text=/^T\\d+/", 60);
await film(5);
await page.locator(".lineup .row").nth(1).click();
await film(3);
await page.getByRole("button", { name: /^above/i }).click();
await film(5);
await page.getByRole("button", { name: /^chase/i }).click();
await filmUntil(".band.reveal", 150);
await film(4);
const replay = page.locator(".replay-btn").first();
if (await replay.count()) {
  await replay.click();
  await film(6);
}
await page.goto("http://localhost:5173/#/shootout/9943");
await page.waitForTimeout(2500);
await film(7);
await browser.close();

console.log(`${n} frames; joining`);
const ffmpeg = (args) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: "inherit" });
ffmpeg(["-framerate", String(FPS), "-i", `${frames}%05d.png`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "24", "-movflags", "+faststart", `${media}demo.mp4`]);
ffmpeg(["-framerate", String(FPS), "-i", `${frames}%05d.png`, "-vf", "fps=12,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4", `${media}demo.gif`]);
rmSync(frames, { recursive: true, force: true });
console.log("saved demo.mp4 and demo.gif in", media);
