# Blind Lap: handoff

For the next agent or developer. Read this first, then `README.md` (what it is, how to run) and
`docs/OVERVIEW.md` (file by file, and section 10: every piece of owner feedback and what changed).
State on 2026-10-28. Repository: `github.com/Pratham2994/Blindlap`, branch `master` (plus
`data-cache`, see 6.3). Every commit is authored by the owner, Pratham2994; keep it that way (2.1).

---

## 1. What Blind Lap is

A real F1 qualifying lap (2025 and 2026 seasons) is replayed in 3D with the driver's name hidden.
The engine sound is synthesised from the car's own speed, gear and throttle. As the car leaves each
corner, three models trained on other circuits read how that corner was driven and update their
guess. The player guesses too, with optional hints. The reveal names the driver, shows how each
model ranked them and why, the qualifying context (date, Q1/Q2/Q3, final position), and plays the
driver's real team radio with captions. Each circuit is set in its real surroundings, taken from
OpenStreetMap.

A portfolio piece: an ML pipeline (Python, offline) plus a static web app (TypeScript, Three.js,
Web Audio). No server: the site reads committed JSON.

---

## 2. The owner: how they work and what they expect

These are the most important things to get right. They come from many corrections.

### 2.1 Hard rules
- **Commits and pushes carry only the owner's name and email.** No `Co-Authored-By`, no
  "Generated with", no mention of Claude or AI anywhere in commits, pushes or the repo (the
  `.claude/` folder is git-ignored). This overrides any tool default that adds attribution.
- Never force-push, delete branches or rewrite pushed history.
- Never commit secrets. Diff before committing.
- Do not download or add third-party assets (models, audio, fonts) without asking first: name the
  file, source, licence and size. The car model was approved this way (CC BY 4.0, credited).
- Louder team radio was ruled out: it would mean rehosting copyrighted F1 clips. Leave it.
- Surroundings: "do whatever, it doesn't have to be 100% real, but every circuit should feel like
  itself". Real map data first; invented dressing (extra stands, boards) only on free ground, and
  never on or over the track.

### 2.2 How they communicate
- Messages are fast and full of typos; read for intent. They often send several new requests while
  you are working. Note each one, finish what is in hand, then do them all; do not drop any.
- They test in a real browser (Brave, dark theme often, a 1920 px monitor) and send screenshots and
  screen recordings of problems. Every report so far has been a real bug: reproduce it, find the
  cause, fix it everywhere it can happen, and say what the cause was.
- They want honest, plain answers. Say what is not done or not verified. Never claim smooth or fixed
  without having measured or looked.
- Reply in simple, short sentences (their global instruction: ASD-STE100 style). Code, docs and the
  app's own text are normal English.

### 2.3 What they care about (in order, from their feedback)
1. **It must never look broken.** No floating stands or buildings, nothing on the track, no road
   covered by ground, no car driving through kerbs, no black or empty boxes while loading, no lost
   3D view after navigation. These are the reports that annoyed them most.
2. **Speed and smoothness on any machine** ("should run on a potato"): no visible delay when
   loading, switching pages or themes.
3. **Feels real and alive:** sense of speed, crowds, lighting, surroundings specific to each track.
4. **Clear for a first-time visitor:** what the game is, how to guess, hints.
5. **Clean UI** with the poster look (they like the colours and both themes) and no clutter: they
   removed Daily five and duplicate links ("too many modes doing the same thing").
6. **Finish features before adding new ones.** They plan to add "tons of new F1 features with new
   datasets" next, but only once the current product is polished.

### 2.4 Working style that worked
- Plan briefly, then do; keep a visible task list.
- After any visual change: take screenshots (scripts in 7), look at them, and fix what you see
  before reporting.
- Write a check script for every class of bug they report, prove it catches the bug by switching
  the fix off once, and keep it in `web/scripts/` (see 7).
- Measure performance on the real GPU in the app's built-in browser (it has the owner's RTX 5070);
  headless Playwright uses a software renderer and is 50 to 100 times slower.

---

## 3. What exists now

- **Home:** "Who's driving?", a live 3D broadcast of a random daytime circuit (cuts between
  cameras), How to play in four steps, three ways to play (Quick lap, Teammates, Pick a circuit),
  the honest accuracy. Top bar: Home, Play, Driver DNA, Telemetry lab, How it knows, theme toggle.
- **First lap ever:** a rules card with a Start button; after that the lights start at once.
- **Play:** start lights, the lap in 3D; five cameras (Chase, Onboard, Side, TV, Above; C cycles;
  drag to look around; double-click resets); live track map (top right of the view); the models'
  grid with a three-model switch (Blend, Boosted trees, Logistic); a hint ladder from a small nudge
  to nearly the answer (qualifying result band, career length, driving style, team, car number;
  costs 1, 1, 1, 2, 3 off a right guess worth 5, never below 1; a teammate scores 2); a "What's
  real" button that says what is data and what is drawn; telemetry band with a seekable lap bar
  (drag, −5/+5 s, arrow keys); evidence line per corner; pause, 1x/2x/4x, sound and volume.
- **End of lap:** a chequered "Lap complete" card for 1.5 s, then the reveal panel arrives in steps.
- **Reveal:** team-colour field, verdicts with points, name, team, lap time, date, Q segment and
  final position, career totals, how each model ranked the driver, the three corners that gave them
  away, team radio with auto captions; duel replay against the model's pick; challenge link.
- **Teammates mode**, **Driver DNA** (style map), **Telemetry lab**, **How it knows**.
- Light and dark themes; laid out and checked for 11 screen sizes from 360 px phones to 27".

### 3.1 The 3D scene
- Track from the car's own position data; heights smoothed; bridges lifted where the track crosses
  itself (Suzuka); roads narrowed where two sections run side by side (Baku).
- Racing line: minimum-curvature line per circuit, reshaped per lap from that lap's real corners
  (`lineShape` in `world.ts`): later braking turns in later, the real apex moves the apex, earlier
  full throttle straightens the exit, more apex speed than the field swings a fuller arc. Only that
  fuller arc may run onto the inside kerb (never past its 1.6 m), and then the car rides up on it
  (lift, roll, ridges). Worked out once per lap at every track point and smoothed (`buildLapLine`).
  The duel rival drives its own lap's line.
- Car: "( FREE ) Formula One LP-830 SDC" (CC BY 4.0), repainted: plain while the driver is hidden,
  team colour after; neutral driver figure; contact shadow and a car-following shadow map.
- Surroundings from OpenStreetMap for all 26 circuits: buildings (real footprint, height, colour),
  grandstands as raked seating with crowds and roofs, water and sea, woods, trees, Ferris wheels,
  gravel traps, tarmac run-off, pit lane, grass. A grassy or paved verge carries the barriers.
  Trackside dressing where the map has little: extra stands, terraces, boards, marshal posts.
- Start/finish gantry with lights, chequered line, braking-zone rubber, low flat kerbs.
- Sky with clouds; night races (from the sun's real altitude at the session time) get a dark sky,
  floodlights and lit windows; camera grade; speed blur and lean into corners at speed.

### 3.2 Data and models
- 41 qualifying sessions (23 from 2025, 18 from 2026, up to Austin 2026-10-24), 26 circuits,
  24 drivers, 1,655 laps in the game, 3,759 laps scored. Practice 3 sessions train only.
- Leave-one-circuit-out results (each circuit's laps guessed by models that never saw it):

| Model | Top-1 | Top-3 | Team | Teammate | In game |
|---|---|---|---|---|---|
| Blend (trees + forest + logistic) | 46.6% | 74.1% | 60.8% | 74.9% | yes, default |
| Gradient-boosted trees | 43.7% | 73.2% | 59.2% | 74.0% | yes |
| Random forest | 42.2% | 70.7% | 58.4% | 71.7% | blend only |
| Logistic regression | 35.0% | 64.0% | 50.3% | 71.1% | yes |
| Cross-season (2025 → 2026) | 25.7% | 55.4% | 40.3% | | How page |
| Chance | 4.2% | 12.5% | ~9% | 50% | |

---

## 4. Architecture

```
pipeline/ (Python 3.12 venv, uv)            web/ (Vite, TypeScript strict, Three.js 0.170)
  fetch.py     OpenF1 + MultiViewer           main.ts         router, home, theme, render loop
  build.py     laps + corner features         lap.ts          smooth motion from the speed sensor
  model.py     3 models + blend, LOCO eval    model.ts        replays stored per-corner scores
  export.py    web JSON                       scene/world.ts  track, line, cameras, lights, scene
  results.py   Q1/Q2/Q3, positions            scene/environment.ts  terrain, buildings, stands, trees
  radio.py     speech start (ffmpeg)          scene/trackside.ts    clearance, occupancy, dressing
  captions.py  faster-whisper                 scene/car.ts    car, driver, contact shadow
  careers.py   F1DB totals                    ui/play.ts      the round: intro, hints, reveal, duel
  align.py     fit circuits to OSM            ui/minimap.ts   live track map
  environment.py  OSM surroundings + light    ui/stage.ts     one canvas docked per page
  check.py     data invariants                ui/telemetry.ts, lineup.ts, dna.ts, lab.ts, how.ts
  cache.py     pack/unpack the update cache
  run_all.sh   everything after fetch, in order
```

Mechanisms to know before changing anything:
- **One WebGL canvas** (`ui/stage.ts`) moves into each page's `.stage-slot`. A page not yet on
  screen only *requests* it; `flushStage()` moves it after the page is shown (`main.ts mount`).
  Getting this wrong loses the 3D view or leaves a black box (it happened three times).
- **No model runs in the browser:** every lap ships each model's held-out per-corner scores.
- **Distances are centreline metres;** only drawing the car, cameras and rubber line uses the
  racing line (`carPointAt`).
- **Surroundings build in steps across frames** (`applySurroundings`, async), so nothing freezes;
  each step stops if the circuit changed. They are prefetched with the lap.
- **Nothing may touch the track:** `TrackClearance` pulls every footprint back to 13 m from the
  centreline (fence at ~11 m); trees, seats and wheels likewise. The ground is capped below every
  road. `web/scripts/track-check.mjs` verifies all of it on all sessions.
- **Adaptive quality:** four levels (`QUALITY` in `world.ts`). It starts lower on small devices,
  integrated or phone graphics, and at the lowest on a software renderer (`startQuality`), then
  steps down by itself while frames stay over 33 ms. The lowest level draws straight to the screen
  (no effect passes), with no shadows and no spectators. `localStorage["blindlap.quality.v1"]`
  forces a level; the screenshot scripts set 0, since headless Chromium is a software renderer.
  Tests and the sweep run at the lowest level for the same reason.
- **Ground texture** is drawn once in light colours (2048 px) and tinted for dark/night, so theme
  switches cost nothing. Close-up detail (patches, grain, mowing stripes on grass verges) is made in
  the shader from the world position (`groundDetail`): no texture memory, no tiling.
- **Dark theme sky:** a daytime race in the dark theme is a deep blue evening (`EVENING`), not a
  black void; night races keep their night sky.
- **Car reflections:** the paint reflects a small sky-and-ground image made from the current palette
  (`refreshReflections`), rebuilt when the sky changes.

---

## 5. Decisions and reasons (do not undo without asking)

- OpenF1 data (free, no key). FastF1's source returns 401.
- Leave-one-circuit-out: the same circuit appears in two seasons; anything weaker leaks.
- The three models shown were the owner's choice after `compare_models.py` tested ten.
- OpenF1 positions are snapped to one line, so there is no real per-driver line; the racing line is
  computed and shifted by the lap's real apexes. Presentation, not data.
- Anonymity until the reveal: plain car, neutral helmet, no team colour.
- Poster design (owner picked "C, bold poster"): paper, ink, one red; `DESIGN.md` records it.
- Removed on request: Daily five, links that repeated the top bar, camera shake (looked glitchy),
  a browser page cross-fade (froze the old page while the new one built; see OVERVIEW).

---

## 6. Status of the infrastructure

### 6.1 Deploy: live
The site is live at **https://pratham2994.github.io/Blindlap/**. GitHub Pages is switched on
(source: GitHub Actions); `.github/workflows/pages.yml` builds and publishes on every push to
`master`, in about 1 to 2 minutes. Relative paths, so the sub-path works. Checked on 2026-10-29:
the home page broadcast, a full Austin 2026 lap with surroundings, map and hints, no errors; the
lap screen appeared 0.48 s after clicking. Note: the debug handles (`window.world`) exist only on
the development server, not on the live site.

### 6.2 Weekly data updates: built, not yet run on GitHub
`.github/workflows/data.yml` runs every Monday 06:00 UTC (and by hand from the Actions tab):
restore the cache, download new qualifying and practice 3 sessions for the current year, run
`run_all.sh` (build only new sessions, retrain, export, results, radio, captions, careers, align,
surroundings, checks), build the site, commit the data under the owner's name, push, and start the
Pages deploy. Weeks without new sessions do nothing. A new venue is located automatically
(`align.find_centre`, Nominatim + raceway search). First real run: the Monday after the next race.
Watch for: Actions runtime (the retrain takes ~20 to 40 min), OpenF1 rate limits, and faster-whisper
download size.

### 6.3 The `data-cache` branch
Holds what the weekly job needs without the 6.3 GB of telemetry: `build/*.pkl`, the small raw
files per session, `raw/osm/`, `raw/f1db/` (about 300 MB). Pack and unpack with
`pipeline/cache.py`. The job updates it after each run.

---

## 7. Checks (run before reporting anything as done)

From `web/` with the dev server running (`npm run dev`, port 5173):
- `npx tsc --noEmit` and `npm run build`.
- `npx playwright test`: 13 end-to-end tests (~6 min).
- `node scripts/sweep.mjs`: 44 steps through every flow; script errors, missing/blank 3D view,
  layout off screen, lap bar out of step.
- `node scripts/track-check.mjs`: every session; ground under the road, nothing within 12.5 m.
- `node scripts/responsive.mjs [dir]`: 11 screen sizes × 6 pages, with screenshots.
- `node scripts/capture.mjs [dark]`: screenshots of every page for review.
- `node scripts/shot-spot.mjs <session> <metres> <camera> <out.png>`: one spot on one circuit.

From `pipeline/`: `.venv/Scripts/python.exe check.py` (data invariants).

Status at handoff: all of the above pass on the final code (sweep 44/44, track check on all 41
sessions, 11 screen sizes, data checks, build).

---

## 8. Lessons learned (save the next person time)

- **Windows + Git Bash:** long heredocs with mixed quotes break the shell; write Python patch
  scripts to the scratchpad and run them. Open files with `encoding="utf-8"` (default is cp1252).
  `\d` in Python strings needs raw strings or `\\d`.
- **Edit by exact replacement with assertions** (`assert s.count(a) == 1`) so a stale anchor fails
  loudly instead of silently doing nothing.
- **The built-in browser pane may be hidden;** then `requestAnimationFrame` never fires. Code that
  waits for frames must have a timer fallback (`applySurroundings` does).
- **Headless timings mislead;** measure on the real GPU in the built-in browser.
- **When the owner reports one instance, search for the class:** one floating stand meant ground
  sampled at one point for every building; one Baku collision meant checking all 41 sessions.
- **Browser view transitions** freeze the old page while the next one works; do not use them here.

---

## 9. What is left

1. Check the live site on a phone and a weak laptop (6.1).
2. Confirm the final sweep passes, and watch the first weekly data run (6.2).
3. Demo media in the README (GIF, video, screenshots) is from an older look; re-record with
   `web/scripts/record-demo.mjs`.
4. The impeccable finish review has not been run on the latest design; `DESIGN.md` covers the
   poster world and the later additions (map, hints, trackside) in its component notes.
5. Ideas the owner raised for later: many new F1 features with new datasets (after polish).
6. Known limits: the racing line is computed, not measured; street circuits show only the stands
   OpenStreetMap or the dressing provides; captions are machine transcripts.
