import { expect, test } from "@playwright/test";

// End-to-end: real data, real WebGL, real model in the page. Laps run at 4x to keep this short.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("blindlap.speed.v1", "4"));
});

test("title states the honest accuracy and links to play", async ({ page }) => {
  await page.goto("/#/");
  await expect(page.getByRole("heading", { name: /blind lap/i })).toBeVisible();
  await expect(page.locator(".honest")).toContainText(/names the driver \d+%/);
  await expect(page.getByRole("link", { name: /start a lap/i })).toHaveAttribute("href", "#/play");
});

test("a full round: model reads every corner, you guess, reveal, duel", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/#/play");

  const corners = await page.locator(".tyre .tick-label").count();
  expect(corners).toBeGreaterThan(5);

  // Lights out, then the model starts reading corners.
  await expect(page.locator(".evidence .t")).toHaveText(/^T\d+/, { timeout: 30_000 });
  await page.locator(".lineup .row").nth(3).click();
  await expect(page.locator(".lineup .row.pick")).toHaveCount(1);

  // Reveal.
  const reveal = page.locator(".reveal");
  await expect(reveal).toBeVisible({ timeout: 90_000 });
  await expect(page.locator("[data-k=count]")).toHaveText(`${corners} corners read`);
  await expect(reveal.locator(".verdicts .tag")).toHaveCount(2);
  await expect(reveal).toContainText(/Model ranked them\s*P\d+ of \d+/i);
  await expect(page.locator(".lineup .row.truth")).toHaveCount(1);
  await expect(reveal.locator(".caption li")).toHaveCount(3);

  // Duel against the model's pick shows a live gap.
  await reveal.getByRole("button", { name: /race it against/i }).click();
  await expect(page.locator(".duel .gap")).toHaveText(/^[+-]\d+\.\d{3} s$/);
  await page.getByRole("button", { name: /back to result/i }).click();
  await expect(reveal).toBeVisible();

  expect(errors).toEqual([]);
});

test("driver DNA lets you switch drivers", async ({ page }) => {
  await page.goto("/#/dna/VER");
  const panel = page.locator(".dna-panel");
  await expect(panel.locator("h2")).toHaveText("VER");
  await expect(panel.locator(".axis")).toHaveCount(7);
  await panel.locator("select").selectOption("LEC");
  await expect(panel.locator("h2")).toHaveText("LEC");
});

test("how it works shows metrics against chance and draws the confusion matrix", async ({ page }) => {
  await page.goto("/#/how");
  await expect(page.locator(".chart-row.big > span:last-child").first()).toHaveText(/\d+%/);
  await expect(page.locator(".chart-row").first()).toBeVisible();
  const painted = await page.locator(".confusion canvas").evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 60) lit++;
    return lit;
  });
  expect(painted).toBeGreaterThan(500);
});

test("daily five summary and share text", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() => {
    const d = new Date();
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const r = (you: number, model: number, truth: string) => ({ you, model, truth, circuit: "Monza" });
    localStorage.setItem(`blindlap.daily.${key}`, JSON.stringify([r(3, 0, "VER"), r(1, 3, "NOR"), r(0, 1, "HAM"), r(3, 3, "LEC"), r(0, 0, "ALB")]));
  });
  await page.goto("/#/daily");
  const card = page.locator(".reveal.daily");
  await expect(card).toContainText("Daily");
  await expect(card.locator("tbody tr")).toHaveCount(5);
  await expect(card.locator("tfoot")).toContainText("7");
  await card.getByRole("button", { name: /copy result/i }).click();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toMatch(/BLIND LAP · daily five/);
  expect(text.split(/\r?\n/)[1].trimEnd()).toMatch(/^You {3}🟩🟨⬛🟩⬛ 7$/u);
});

test("a challenge link opens that exact lap without naming the driver", async ({ page }) => {
  const index = await (await page.request.get("/data/index.json")).json();
  const monza = index.sessions.find((s: { circuit: string }) => s.circuit === "Monza");
  await page.goto(`/#/play/${monza.key}.0`);
  await expect(page.locator(".hud-session .where")).toHaveText("Monza");
  expect(page.url()).not.toMatch(/[A-Z]{3}/);
});

test("telemetry lab overlays two drivers and explains each corner", async ({ page }) => {
  await page.goto("/#/lab");
  await expect(page.locator(".lab-chart .trace")).toHaveCount(2);
  const corners = page.locator(".lab-corners li");
  await expect(corners.first()).toContainText(/^T\d+/);
  const a = page.locator("[data-k=a]");
  const before = await page.locator(".lab-legend").innerText();
  await a.selectOption({ index: 3 });
  await expect(page.locator(".lab-legend")).not.toHaveText(before);
});
