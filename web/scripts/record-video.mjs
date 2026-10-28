// Record the README demo frame by frame, so it is smooth however slow the renderer is: the page
// runs on Playwright's fake clock, each step moves time on by exactly 1/30 s (animation frames,
// timers and performance.now together), and a screenshot is taken after every step. ffmpeg then
// joins the frames into docs/media/demo.mp4 and a smaller docs/media/demo.gif.
// Usage: npm run dev (in another shell), then node scripts/record-video.mjs   (a few minutes on a graphics card)
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const media = new URL("../../docs/media/", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
const frames = `${media}frames/`;
rmSync(frames, { recursive: true, force: true });
mkdirSync(frames, { recursive: true });
const FPS = 30;
// The real graphics card on Windows (headless Chrome can use it through ANGLE and Direct3D 11);
// the software renderer elsewhere. The tests keep the software renderer: it is the slow-machine check.
const GPU = process.platform === "win32" ? ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
const browser = await chromium.launch({ args: GPU });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript(() => {
  localStorage.setItem("blindlap.speed.v1", "4");
  localStorage.setItem("blindlap.intro.v1", "1");
  localStorage.setItem("blindlap.quality.v1", "0");
  localStorage.setItem("blindlap.theme.v1", "light");
});
// Paused: time moves only when film() moves it, never on its own while a screenshot is taken
// (a running fake clock made the lap play three times too fast).
await page.clock.install({ time: new Date("2026-10-29T12:00:00Z") });
await page.clock.pauseAt(new Date("2026-10-29T12:00:01Z"));
// Screenshots straight from the browser: Playwright's own screenshot waits for an animation frame,
// which the fake clock only gives when it is moved on.
const cdp = await page.context().newCDPSession(page);

let n = 0;
/** Move the page on by `seconds` of its own time, one frame at a time, filming each frame. */
async function film(seconds) {
  for (let k = 0; k < Math.round(seconds * FPS); k++) {
    await page.clock.runFor(1000 / FPS);
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(`${frames}${String(n++).padStart(5, "0")}.png`, Buffer.from(data, "base64"));
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
// A daytime circuit (the home link picks any, night races included).
await page.goto("http://localhost:5173/#/play/9935");
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
const gifSeconds = Math.min(n / FPS, 30); // the GIF: up to here, at most 30 s
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
ffmpeg(["-framerate", String(FPS), "-i", `${frames}%05d.png`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "27", "-preset", "slow", "-movflags", "+faststart", `${media}demo.mp4`]);
// The README's GIF: the first lap only (home, lights, the lap, the reveal), smaller and slower.
ffmpeg(["-framerate", String(FPS), "-t", String(gifSeconds), "-i", `${frames}%05d.png`, "-vf", "fps=8,scale=640:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=48:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle", `${media}demo.gif`]);
rmSync(frames, { recursive: true, force: true });
console.log("saved demo.mp4 and demo.gif in", media);
