import { chromium } from "@playwright/test";
const out = process.argv[2];
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
for (const [w, h, name] of [[1440, 900, "home-desk"], [390, 844, "home-phone"]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto("http://localhost:5173/#/");
  await page.waitForTimeout(9000);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  await page.goto("http://localhost:5173/#/play/9943");
  await page.locator(".intro").waitFor({ timeout: 120000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/${name}-intro.png` });
  await page.getByRole("button", { name: /start the lap/i }).click();
  await page.locator(".evidence .t").filter({ hasText: /^T[3-9]/ }).waitFor({ timeout: 120000 });
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: "Driving style" }).click();
  await page.getByRole("button", { name: "Car number" }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/${name}-hints.png` });
  await page.close();
}
await browser.close();
