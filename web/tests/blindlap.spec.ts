import { expect, test } from "@playwright/test";

// End-to-end: real data, real WebGL, real model in the page. Laps run at 4x to keep this short.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("blindlap.speed.v1", "4"));
});

test("home states the honest accuracy and links to play", async ({ page }) => {
  await page.goto("/#/");
  await expect(page.getByRole("heading", { name: /who's driving/i })).toBeVisible();
  await expect(page.locator(".home .facts")).toContainText(/\d+% first guess right/);
  await expect(page.getByRole("link", { name: /start a lap/i })).toHaveAttribute("href", "#/play");
});

test("a full round: model reads every corner, you guess, reveal, duel", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/#/play");

  const corners = await page.locator(".telemetry .tm-rule .tick").count();
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
  await expect(reveal).toContainText(/Ranked\s*P\d+ of \d+/i);
  await expect(page.locator(".lineup .row.truth")).toHaveCount(1);
  await expect(reveal.locator(".caption li")).toHaveCount(3);
  // When and where in qualifying: the date, the segment, and how the driver's session ended.
  await expect(reveal.locator(".context")).toHaveText(/\d{4} · Qualifying Q[123] · .*(qualified P\d+|took pole|DNF|DNS|DSQ)/);

  // Duel against the model's pick shows a live gap.
  await reveal.getByRole("button", { name: /race it against/i }).click();
  await expect(page.locator(".duel .gap")).toHaveText(/^[+-]\d+\.\d{3} s$/);
  await page.getByRole("button", { name: /back to result/i }).click();
  await expect(reveal).toBeVisible();

  expect(errors).toEqual([]);
});

test("dark mode switches the page and is remembered", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/#/");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: /switch to dark mode/i }).click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgb(18, 18, 18)");
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: /switch to light mode/i })).toHaveText("Light");
});

test("the lap bar seeks, the model forgets corners behind it, and volume is remembered", async ({ page }) => {
  await page.goto("/#/play/9908");
  const count = page.locator("[data-k=count]");
  const read = async () => Number((await count.textContent())!.split(" ")[0]);
  await expect.poll(read, { timeout: 40_000 }).toBeGreaterThanOrEqual(4);
  await page.keyboard.press("Space");
  const seek = page.locator(".tm-seek");

  // Back to the start: every corner is un-read, on the grid and on the lap bar.
  await seek.fill("0");
  await expect(count).toHaveText("0 corners read");
  await expect(page.locator(".tm-rule .tick.read")).toHaveCount(0);

  // Forward again: the corners passed are read once the lap runs.
  await seek.fill((Number(await seek.getAttribute("max")) * 0.6).toFixed(0));
  await page.keyboard.press("Space");
  await expect.poll(read).toBeGreaterThanOrEqual(5);
  const before = Number(await seek.inputValue());
  await page.getByRole("button", { name: "Back 5 seconds" }).click();
  expect(Number(await seek.inputValue())).toBeLessThan(before);

  const volume = page.getByRole("slider", { name: "Volume" });
  await volume.fill("30");
  expect(await page.evaluate(() => localStorage.getItem("blindlap.volume.v1"))).toBe("0.3");
  await page.reload();
  await expect(page.getByRole("slider", { name: "Volume" })).toHaveValue("30");
});

test("C cycles through the five cameras", async ({ page }) => {
  await page.goto("/#/play/9908");
  await expect(page.locator(".evidence .t")).toHaveText(/^T\d+/, { timeout: 30_000 });
  const pressed = page.locator(".seg.cams [aria-pressed=true]");
  const seen: string[] = [];
  for (let i = 0; i < 5; i++) {
    seen.push((await pressed.textContent())!);
    await page.keyboard.press("c");
  }
  expect(seen).toEqual(["Chase", "Onboard", "Side", "TV", "Above"]);
  await expect(pressed).toHaveText("Chase");
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
  const card = page.locator(".daily-card");
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
  await expect(page.locator(".play-bar .where h1")).toHaveText(/^Monza \d{4}$/);
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

test("the home circuit picker starts a lap at that circuit", async ({ page }) => {
  await page.goto("/#/");
  const select = page.locator(".home .pick select");
  const option = select.locator("option").nth(3);
  const value = await option.getAttribute("value");
  const label = (await option.textContent())!;
  await select.selectOption(value!);
  await expect(page).toHaveURL(new RegExp(`#/play/${value}$`));
  await expect(page.locator(".play-bar .where h1")).toHaveText(label);
});

test("teammates mode offers exactly the two drivers of one team", async ({ page }) => {
  await page.goto("/#/mates");
  await expect(page.locator(".play-bar .mates-q")).toContainText(/^Which .+ driver\?$/);
  await expect(page.locator(".lineup .row")).toHaveCount(2);
  await expect(page.locator(".reveal")).toBeVisible({ timeout: 90_000 });
  await expect(page.locator(".lineup .row.truth")).toHaveCount(1);
});

test("three models: switch mid-lap and compare them on the reveal", async ({ page }) => {
  await page.goto("/#/play/9908");
  const switcher = page.locator(".model-switch button");
  await expect(switcher).toHaveCount(3);
  await expect(page.locator(".evidence .t")).toHaveText(/^T\d+/, { timeout: 30_000 });
  const before = await page.locator(".lineup .row .pct").allTextContents();
  await switcher.filter({ hasText: "Logistic" }).click();
  await expect(switcher.filter({ hasText: "Logistic" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await page.locator(".lineup .row .pct").allTextContents()).join()).not.toBe(before.join());
  await expect(page.locator(".reveal")).toBeVisible({ timeout: 90_000 });
  await expect(page.locator(".model-table tbody tr")).toHaveCount(3);
  // Switching still works after the reveal, and the real driver stays marked.
  const atReveal = (await page.locator(".lineup .row .pct").allTextContents()).join();
  await switcher.filter({ hasText: "Boosted" }).click();
  await expect.poll(async () => (await page.locator(".lineup .row .pct").allTextContents()).join()).not.toBe(atReveal);
  await expect(page.locator(".lineup .row.truth")).toHaveCount(1);
});
