import { expect, test } from "@playwright/test";

// End-to-end: real data, real WebGL, real model in the page. Laps run at 4x to keep this short.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("blindlap.speed.v1", "4");
    localStorage.setItem("blindlap.intro.v1", "1");
  });
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

  // The lap screen appears once the circuit and its surroundings have loaded.
  await page.locator(".telemetry .tm-rule .tick").first().waitFor({ timeout: 30_000 });
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
  // The model says how sure it was, and how often a call that sure was right.
  await expect(reveal.locator(".verdicts .tag").nth(1)).toContainText(/\d+% sure/);
  await expect(reveal.locator(".call-line")).toHaveText(/picked [A-Z]{3}, .* at \d+%\. Picks that sure were right \d+% /);
  await expect(page.locator(".lineup .call")).not.toBeEmpty();
  // More laps of the same driver, read one by one, when the driver set more than one.
  const more = reveal.locator("[data-laps]");
  if (await more.count()) {
    await more.click();
    await expect(reveal.locator("[data-k=laps-line]")).toContainText(/laps?: [A-Z]{3} P\d+ · \d+%/, { timeout: 15_000 });
    await expect(more).toHaveText("Watch again", { timeout: 15_000 });
  }
  await expect(page.locator(".lineup .row.truth")).toHaveCount(1);
  await expect(reveal.locator(".caption li")).toHaveCount(3);
  // The team line is plain text: no other page's card styles leak onto it.
  expect(await reveal.locator(".team").evaluate((e) => getComputedStyle(e).borderTopWidth)).toBe("0px");
  // When and where in qualifying: the date, the segment, and how the driver's session ended.
  await expect(reveal.locator(".context")).toHaveText(/\d{4} · Qualifying Q[123] · .*(qualified P\d+|took pole|DNF|DNS|DSQ)/);

  // Duel against the model's pick shows a live gap.
  await reveal.getByRole("button", { name: /race it against/i }).click();
  await expect(page.locator(".duel .gap")).toHaveText(/^[+-]\d+\.\d{3} s$/);
  await page.getByRole("button", { name: /back to result/i }).click();
  await expect(reveal).toBeVisible();

  // Each corner that gave the driver away can be driven again; the view then returns to the result.
  await expect(reveal.locator(".replay-btn")).toHaveCount(3);
  await reveal.locator(".replay-btn").first().click();
  await expect(page.locator(".play.replaying")).toHaveCount(1);
  await expect(page.locator(".play.replaying")).toHaveCount(0, { timeout: 90_000 });
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

test("a first visit explains the game, then hints cost points", async ({ page }) => {
  // A visitor who has never played: clear the flag once (not again on the reload below).
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("fresh")) {
      localStorage.removeItem("blindlap.intro.v1");
      sessionStorage.setItem("fresh", "1");
    }
  });
  await page.goto("/#/play/9908");
  const intro = page.locator(".intro");
  await expect(intro).toBeVisible({ timeout: 30_000 });
  await expect(intro).toContainText("Tap your driver");
  await expect(intro).toContainText("Real, from the car");
  await page.getByRole("button", { name: /start the lap/i }).click();
  await expect(intro).toBeHidden();
  await expect(page.locator(".evidence .t")).toHaveText(/^T\d+/, { timeout: 30_000 });
  await page.keyboard.press("Space"); // pause, so the flag does not close the hints
  // Hints go from small to big: style costs 1 and the team 2, so a right guess drops from 5 to 2.
  await expect(page.locator("[data-k=worth]")).toHaveText("right = 5 pts");
  await page.getByRole("button", { name: /^Style/ }).click();
  await expect(page.locator(".hint-list li")).toHaveCount(1);
  await page.getByRole("button", { name: /^Team/ }).click();
  await expect(page.locator(".hint-list li").nth(1)).toHaveText(/Drives for /);
  await expect(page.locator("[data-k=worth]")).toHaveText("right = 2 pts");
  // The number gives nearly everything away: a right guess is still worth 1, never less.
  await page.getByRole("button", { name: /^Number/ }).click();
  await expect(page.locator("[data-k=worth]")).toHaveText("right = 1 pt");
  // More laps: the model's top three from all the driver's laps here (or a note, at no cost).
  await page.getByRole("button", { name: /^More laps/ }).click();
  await expect(page.locator(".hint-list li").nth(3)).toHaveText(/read \d+ laps by this driver.*top three: [A-Z]{3} \d+%|no other push lap/);
  // The grid says how sure the model is once it has read a few corners.
  await expect(page.locator(".lineup .call")).toHaveText(/^(Still reading|Not sure|Leaning|Fairly sure|Very sure)/);
  // The next visit goes straight to the lights.
  await page.reload();
  await expect(page.locator(".evidence .t")).toHaveText(/^T\d+/, { timeout: 30_000 });
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

test("driver DNA takes the car out, shows seasons and cars, and switches drivers", async ({ page }) => {
  await page.goto("/#/dna/VER");
  const panel = page.locator(".dna-panel");
  await expect(panel.locator("h2")).toHaveText("VER");
  // Seven traits for the driver, seven for their car.
  await expect(panel.locator(".axis:not(.car)")).toHaveCount(7);
  await expect(panel.locator(".axis.car")).toHaveCount(7);
  await expect(panel.locator(".dna-seasons tbody tr")).toHaveCount(7);
  await expect(page.locator(".dna-fact")).toContainText(/\d+ of \d+ drivers as driven, \d+ of \d+ with the car taken out/);
  await expect(page.locator(".share-row")).toHaveCount(7);
  expect(await page.locator(".car-card").count()).toBeGreaterThan(10);
  // As driven, then back; the panel says which it shows.
  await page.getByRole("button", { name: "As driven" }).click();
  await expect(panel.locator(".dna-key")).toContainText("How they drive, car included");
  await page.getByRole("button", { name: "Own style" }).click();
  await expect(panel.locator(".dna-key")).toContainText("How they drive, with their car taken out");
  await panel.locator("select").selectOption("LEC");
  await expect(panel.locator("h2")).toHaveText("LEC");
  // Team moves, each predicted before it happened, against two simple guesses.
  expect(await page.locator(".move-card").count()).toBeGreaterThan(4);
  await expect(page.locator(".moves-sum")).toHaveText(/closer than "drives as before" in \d+ of \d+ moves and closer than "drives like the new teammate" in \d+ of \d+/);
  await expect(page.locator(".move-card").first().locator(".err-row")).toHaveCount(3);
  // Any driver in any car: seven guessed traits, and whether it really happened.
  const whatIf = page.locator(".dna-what-if");
  await whatIf.locator("[data-k=wi-driver]").selectOption("NOR");
  await expect(whatIf.locator(".axis")).toHaveCount(7);
  await expect(whatIf.locator(".near")).toHaveText(/^NOR (never drove|really drove)/);
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
  // Where the time goes: a time per corner and the straights, and the gap ends at the official one.
  await expect(corners.last()).toContainText(/^Straights/);
  await expect(corners.first().locator(".gain em")).toHaveText(/^(level|[A-Z]{3} \+\d\.\d{3} s)$/);
  await expect(page.locator(".lab-delta .gap-line")).toHaveCount(1);
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

test("teammate battles show each team's qualifying head-to-head and switch season", async ({ page }) => {
  await page.goto("/#/battles");
  const teams = page.locator(".team");
  await expect(teams.first()).toBeVisible({ timeout: 30_000 });
  expect(await teams.count()).toBeGreaterThan(8);
  await expect(teams.first().locator(".tally")).toHaveText(/^\d+–\d+$/);
  // Every session square links to a blind lap at that circuit.
  await expect(teams.first().locator(".cell").first()).toHaveAttribute("href", /^#\/play\/\d+$/);
  await page.getByRole("button", { name: "2025" }).click();
  await expect(page).toHaveURL(/#\/battles\/2025$/);
  await expect(page.getByRole("button", { name: "2025" })).toHaveAttribute("aria-pressed", "true");
  // How two teammates drive differently: seven traits, and single corners linked to their session.
  const style = teams.first().locator(".pair-style").first();
  await style.locator("summary").click();
  await expect(style.locator(".diff-row")).toHaveCount(7);
  await expect(style.locator(".diff-row .held").first()).toHaveText(/^[A-Z]{3} \d+\/\d+$/);
  await expect(style.locator(".diff-corners a").first()).toHaveAttribute("href", /^#\/play\/\d+$/);
});

test("which is which: two cars, two names, the model says which is which", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/#/pair");
  await expect(page.locator(".pair-q h2")).toHaveText(/\?$/, { timeout: 30_000 });
  await expect(page.locator(".pair-pick button")).toHaveCount(2);
  // Once the cars are moving the model reads corners from both laps.
  await expect(page.locator(".pair-model [data-k=read]")).not.toHaveText("0 corners", { timeout: 30_000 });
  await page.keyboard.press("2");
  await expect(page.locator(".pair-pick [aria-pressed=true]")).toHaveText("Red car");
  // The cameras of a normal lap, the two ways to run the laps, and either car to follow.
  await expect(page.locator("[data-cam]")).toHaveCount(5);
  await expect(page.locator("[data-clock=level]")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("l");
  await expect(page.locator("[data-clock=real]")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("f");
  await expect(page.locator("[data-follow=B]")).toHaveAttribute("aria-pressed", "true");
  // Once both cars leave a corner, the line under them says how they took it differently.
  await expect(page.locator(".pair-band .evidence .t")).toHaveText(/^T\d/, { timeout: 30_000 });
  await expect(page.locator(".pair-band .evidence .what")).toContainText(/(plain|red) car|alike/);
  await page.locator("[data-speed='4']").click();
  const reveal = page.locator(".pair-reveal");
  await expect(reveal).toBeVisible({ timeout: 90_000 });
  await expect(reveal.locator(".verdicts .tag")).toHaveCount(2);
  await expect(reveal.locator(".pair-who h2")).toHaveCount(2);
  await expect(reveal.locator(".caption li")).toHaveCount(3);
  await expect(reveal.locator(".pair-note")).toContainText(/right way round \d+%/);
  await expect(page.locator(".pair-pick button.truth")).toHaveCount(1);
  // Each of those corners can be driven again by both cars.
  await reveal.locator(".replay-btn").first().click();
  await expect(page.locator(".pair.replaying")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("a phone gets a notice instead of the app, and loads none of its data", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const data: string[] = [];
  page.on("request", (r) => r.url().includes("/data/") && data.push(r.url()));
  await page.goto("/#/play");
  await expect(page.getByRole("heading", { name: /made for a bigger screen/i })).toBeVisible();
  await expect(page.locator("#view")).toBeHidden();
  await page.waitForTimeout(1500);
  expect(data).toEqual([]);
  await context.close();
});

test("a narrow window on a computer still gets the game", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 800 });
  await page.goto("/#/");
  await expect(page.getByRole("heading", { name: /who's driving/i })).toBeVisible();
  await expect(page.locator(".phone-gate")).toBeHidden();
});
