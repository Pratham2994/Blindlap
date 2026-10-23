// Screenshot one place on one circuit, for checking track geometry by eye.
// Usage: npm run dev (in another shell), then node scripts/shot-spot.mjs <session> <metres> <camera> <out.png> [drag px]
import { chromium } from "@playwright/test";

const [key, s, mode, out] = process.argv.slice(2);
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(`http://localhost:5173/#/play/${key}`);
await page.locator(".evidence .t").filter({ hasText: /^T\d+/ }).waitFor({ timeout: 40000 });
await page.keyboard.press("Space");
await page.evaluate(
  ([s, mode, nudge]) => {
    const w = window.world;
    const place = w.setCarS.bind(w);
    w.setCarS = () => {};
    w.mode = mode;
    place(Number(s));
    if (nudge) w.nudgeView(nudge, 60); // as if dragged this many pixels right and 60 down
  },
  [s, mode, Number(process.argv[6] ?? 0)],
);
await page.waitForTimeout(2500);
await page.locator(".stage-frame").screenshot({ path: out });
await browser.close();
