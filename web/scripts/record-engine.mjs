// Record the synthesised engine for one lap segment to docs/media/engine.webm (dev server only).
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";

const out = new URL("../../docs/media/engine.webm", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript(() => localStorage.setItem("blindlap.speed.v1", "1"));
await page.goto("http://localhost:5173/#/");
await page.waitForTimeout(2500);
await page.getByRole("link", { name: /start a lap/i }).click();
await page.waitForTimeout(1500);
const b64 = await page.evaluate(async () => {
  const engine = window.engine;
  const ctx = engine.ctx;
  const dest = ctx.createMediaStreamDestination();
  engine.master.connect(dest);
  const rec = new MediaRecorder(dest.stream, { mimeType: "audio/webm" });
  const chunks = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  const done = new Promise((r) => (rec.onstop = r));
  rec.start();
  await new Promise((r) => setTimeout(r, 30000));
  rec.stop();
  await done;
  const buf = await new Blob(chunks).arrayBuffer();
  let s = "";
  new Uint8Array(buf).forEach((x) => (s += String.fromCharCode(x)));
  return btoa(s);
});
writeFileSync(out, Buffer.from(b64, "base64"));
console.log("saved", out, await page.locator(".hud-session .where").textContent());
await browser.close();
