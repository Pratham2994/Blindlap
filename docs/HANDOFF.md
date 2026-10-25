# Blind Lap: handoff

State on 2026-10-23, 18:00, at commit `6f9037f` (46 commits, all authored by Pratham2994 and pushed
to `github.com/Pratham2994/Blindlap`, branch `master`). This document is the starting point for
the next session, human or agent: what exists, why it is that way, what was discussed and decided,
what is still open, and the plan for the next feature. Deeper references:

- `README.md`: what it is, results, how to run.
- `docs/OVERVIEW.md`: file by file, how each part works, and section 10, every piece of owner
  feedback and what changed.
- `DESIGN.md` and `.impeccable/design.json`: the shipped design system (poster world, dark theme).
- `PRODUCT.md`, `.impeccable/surfaces/web-index-html.md`: product context and the design contract.

---

## 1. What Blind Lap is

A real 2025 or 2026 F1 qualifying lap is replayed in 3D with the driver's name removed, with an
engine synthesised from the car's own speed, gear and throttle. As the car leaves each corner, a
model trained on other circuits reads that corner and updates its guess of who is driving. The
player guesses too. The reveal names the driver, shows how each model ranked them and why, and
plays the driver's real team radio with captions.

It is a portfolio project: an ML pipeline (Python, offline) plus a static web app (TypeScript,
Three.js, Web Audio), with no server.

---

## 2. How it was built: timeline

### Night (02:00 to 06:15): the first complete build

The owner set the brief: one impressive, resume-worthy project, AI/ML or backend, not frontend
only, using F1 data, novel, visually striking, built overnight with the impeccable design process.
Built in that time:

- **Data pipeline** (`pipeline/`): OpenF1 telemetry, positions and team radio; MultiViewer corner
  maps; F1DB career totals. FastF1 was ruled out (its live-timing source returns 401).
- **Track alignment**: one centripetal Catmull-Rom centreline per circuit, every position sample
  projected onto it with a KD-tree, strict lap validation.
- **Corner features**: 10 style features per corner (braking point and length, entry and apex
  speed, apex position, throttle pickup, how sharply and smoothly the throttle opens, deepest lift,
  coasting), as robust z-scores against the field, in slow / medium / fast blocks.
- **Honest evaluation**: leave-one-circuit-out across both seasons; a teammate test (same car,
  which of the two drivers); a cross-season test (train on 2025, test on 2026).
- **Web app**: game loop, 3D scene, engine synth, driver DNA (PCA of driving style), telemetry
  lab, How it knows page, Daily five (since removed), Teammates mode, challenge links, duel replay.
- Three rounds of impeccable finish review, E2E tests, demo media, and `docs/OVERVIEW.md`.

### Morning and day (10:40 to 18:00): owner feedback, in order

| Owner feedback | Outcome |
|---|---|
| Car moves stop-start, sound not in sync | Car distance now integrates the speed sensor, drift corrected from positions: motion error ±53 km/h → ±1.5 km/h. |
| Is the car on the right part of the track? | OpenF1 positions are snapped to one line: the data has no per-driver racing line. Explained; later solved with a computed line (below). |
| Team radio: only the second half audible | Clips start with silence; playback starts where speech starts (ffmpeg silencedetect), engine cuts out first. |
| Questions on the model | Answered: data, features and why, one model per held-out circuit, what the cross-season test proves. |
| Test the best models, keep logistic regression | Boosted trees, random forest, logistic regression computed offline and switchable in the game. |
| Louder radio, subtle captions | Captions with faster-whisper (334 of 348 clips). Louder is **open**, see section 6. |
| Space to pause breaks things; sound stuck after pause or with the tab hidden | One pause state; mute and "lap running" separated; a hidden tab pauses and suspends audio. |
| UI bland and all black, confusing navigation | Owner chose direction C, "bold poster", from three mockups. Full redesign: home hub, top bar on every page, Menu exit in every lap. |
| No sense of speed; car shakes on straights | Barriers, brake boards, camera dynamics; heading smoothing (on-screen jitter under half a pixel). |
| Better car model | Owner downloaded "( FREE ) Formula One LP-830 SDC" (CC BY 4.0). Geometry only: its textures carried Blender, Sketchfab, sponsor and Pirelli logos. Repainted in the game; credited. |
| Dark mode | Top-bar toggle, remembered, follows the system by default; 3D scene, DNA and charts follow. |
| Suzuka: tracks touch at the crossover | Crossings detected; the upper road is lifted into a bridge with 13 m clearance. |
| Interlagos: car looks airborne downhill; car bobs as if the road were bumpy | Car pitches with the slope; heights smoothed over ~85 m, exaggeration 2× → 1.25×. |
| 300 km/h does not feel fast; braking feels stop-start | Measured: the camera moved up to 11 m against the car on braking (74 km/h relative). Camera distance now depends on speed only; low and close; catch-fence posts. Relative movement now ≤ 6 km/h. |
| Show date, Q1/Q2/Q3 and final position on the reveal | `pipeline/results.py`: OpenF1 session results, segment boundaries found by a vote (robust to red flags), all 40 sessions labelled. |
| Think about the best three models | `compare_models.py` tested ten models and blends. Owner chose: Blend, Boosted trees, Logistic. |
| Volume slider; back and forward | Volume (engine and radio, remembered); lap bar is a seek slider with −5 s / +5 s and arrow keys; seeking back un-reads corners so the model is never ahead of the car. |
| Next lap blacks out; lap bar line ahead of the car; black screens elsewhere | Shared canvas lost when the view cleared itself (fixed); fog washout when the camera flew out (fixed); lap bar handle measured time, fill measured distance (fixed). Bug sweep script added. |
| Drag the camera; more angles | Chase, Onboard, Side, TV, Above; drag to look around; double-click resets; onboard glides in. |
| Car looks like it floats; add a driver | Shadow box follows the car (sharp shadow), contact shadow; driver with helmet, visor, stripe, arms, gloves on the wheel. |
| Racing line in the middle of the road | Minimum-curvature racing line per circuit (first version minimised length and hugged the inside; fixed). |
| Baku: two tracks collide | Audit of all 40 sessions: only Baku (two stretches 9 m apart). Roads narrow and share one wall where sections run side by side. |

---

## 3. Current state

### Product

- **Home**: Start a lap, three ways to play (Quick lap, Teammates, Pick a circuit) and the honest
  accuracy. Driver DNA, Telemetry lab and How it knows are in the top bar only.
- **Play**: anonymous lap with start lights; five cameras and drag; model grid with a three-model
  switch; telemetry band (speed, gear, pedals, seekable lap bar); evidence line per corner; pause,
  1×/2×/4×, sound and volume.
- **Reveal**: team-colour field, verdicts, driver, team, lap time, date, qualifying segment and
  final position, career totals, the rank each model gave, the three corners that gave the driver
  away, team radio with captions; duel replay against the model's pick; challenge link.
- **Driver DNA**, **Telemetry lab**, **How it knows**, **Teammates**.
- Light and dark themes; phone layout.

### Data

- 40 qualifying sessions (23 from 2025, 17 from 2026), 3,669 push laps scored, 24 drivers.
- 18 practice 3 sessions used as extra training data only (58 sessions in training).
- The game ships 1,611 laps (best laps per driver per session) on 26 circuits, 34 MB of static JSON.

### Models (leave-one-circuit-out, 3,669 laps)

| Model | Top-1 | Top-3 | Right team | Right teammate | In the game |
|---|---|---|---|---|---|
| Blend (trees + forest + logistic) | **44.4%** | **74.1%** | **59.8%** | 74.2% | yes, default |
| Gradient-boosted trees | 42.9% | 72.6% | 58.7% | 73.5% | yes |
| Random forest | 40.3% | 68.6% | 56.4% | 69.6% | only inside the blend |
| Logistic regression | 34.7% | 64.2% | 49.1% | 71.4% | yes |
| Cross-season (logistic, 2025 → 2026) | 25.4% | 55.6% | 40.3% | | How page |
| Chance | 4.2% | 12.6% | ~9% | 50% | |

Tuned trees, a neural net and lap-level models were tested the same way and did no better
(`pipeline/model_out/compare.json`; analysis in OVERVIEW section 10).

### Verification

- `npx playwright test`: 12 E2E tests, all passing (about 2 minutes).
- `node scripts/sweep.mjs`: 44-step bug sweep over every flow (script errors, missing or blank
  stage, layout off screen, lap bar out of step). Passing. It was checked to catch the black-stage
  bug when that fix is removed.
- `pipeline/check.py`: data invariants. Passing.
- `npm run build`: passing.

---

## 4. Architecture in brief

```
pipeline/ (Python 3.12, offline)
  fetch.py      OpenF1 + MultiViewer downloads (paced, resumable)
  track.py      centreline, projection, lap validation, push-lap filter
  features.py   10 corner features, field z-scores, corner classes
  build.py      per-session build
  model.py      LOCO evaluation of logreg / forest / gbm, the blend, cross-season test
  export.py     web JSON: sessions (laps, per-corner model scores), index, report, DNA
  results.py    qualifying segments and final positions per lap
  radio.py, captions.py, careers.py, check.py, compare_models.py, run_all.sh
web/ (Vite, TypeScript strict, Three.js 0.170, Web Audio)
  main.ts       hash router, home hub, theme toggle, render loop
  lap.ts        LapPlayer: smooth motion from the speed sensor
  model.ts      replays the models' stored per-corner scores; evidence sentences
  scene/world.ts  track, racing line, edges, barriers, cameras, fog, shadows
  scene/car.ts    car model, driver, contact shadow
  ui/play.ts    the round state machine and every play-screen control
  ui/stage.ts   one WebGL canvas docked into each page's frame
```

Mechanisms worth knowing before changing anything:

- **One canvas.** `ui/stage.ts` holds the canvas directly and moves it into each page's
  `.stage-slot`; a page must park it (`dockStage(null)`) before clearing its own HTML.
- **No model runs in the browser.** Each model's held-out log-probability for every corner of
  every lap is computed offline and shipped in tenths (`lap.steps[model]`); the game replays sums.
- **Distances stay on the centreline.** Telemetry, corners and seeking use centreline metres; only
  the drawn car, cameras and rubber line use the racing line (`carPointAt`).
- **Track geometry per circuit** (`setSession`): smoothing, height smoothing, bridge lift at
  crossings, `trackEdges` (roads that run alongside), `racingLine`. About 0.2 s on Spa.
- **Fog** follows the camera's real distance; a new circuit snaps the camera into place.

---

## 5. Decisions and the reasons for them

- **Data source**: OpenF1 (free, no key, telemetry + positions + radio). Rate limit about 30
  requests a minute, so a season takes about an hour. Exported data is committed.
- **Leave-one-circuit-out**: the same circuit appears in two seasons; leaving out only a session
  would leak the circuit. Every number, and every guess in the game, is made blind to the circuit.
- **Three models shown**: the blend is most accurate; boosted trees are the best single model;
  logistic regression is readable and matches the evidence sentences. Random forest overlaps the
  trees, so it only feeds the blend (owner's choice).
- **No real racing line in the data**: positions are snapped to one line. The racing line is
  therefore computed (minimum curvature), the same for every driver. It is presentation, not data.
- **Anonymity**: the car is ink (paper in dark mode) until the reveal; the driver figure and helmet
  are neutral; team colour appears only once the driver is named.
- **Design**: owner-pinned direction C, "bold poster": paper, heavy ink type, one F1-red block,
  team colours as flat fields, the 3D view as a framed picture.
- **Car asset**: CC BY 4.0; credited in the README and on the How page; logo textures removed by
  `web/scripts/prep-car.mjs`; the raw download folder is git-ignored.
- **Git**: commits and pushes carry only the owner's name; no AI attribution anywhere.

---

## 6. Open items and known limits

- **Louder team radio (owner decision pending)**: the F1 audio host sends no CORS headers, so the
  page cannot boost it through Web Audio; it plays at the browser's maximum. Louder would mean
  rehosting copyrighted clips in a public repository. Not done.
- **Circuit load time** grew by about 0.2 s (racing line and edges). Could move to the pipeline
  and ship precomputed, or optimise the loops.
- **Racing line** is geometric and the same for every driver and lap; real lines vary with car,
  speed and driver.
- **Driver figure** is simple geometry: good at game distances, plain in extreme close-ups.
- **Grid rows** in flight during the 4× re-sort can overlap for a frame.
- **One E2E run** failed once while the machine was busy (a timeout); it passed on every rerun.
- **Demo media** (README GIF, video, screenshots) predates the cameras, driver and racing line.
- **Design review**: the impeccable finish reviewer has not been rerun since the poster redesign;
  later changes were checked with screenshots.
- **Engine sound**: tuned from a recording and spectrogram, not yet by ear at length.
- **Touch**: drag-to-look is sideways only on phones, so the page can still scroll.

---

## 7. Next feature: track-specific surroundings from real references

Owner direction: each circuit must look like itself, built from **real references**. Nothing is
placed where it does not exist: no generic stadiums, no random buildings.

### 7.1 Source of truth: OpenStreetMap

For each circuit, query OpenStreetMap (Overpass API) within about 1 km of the track for:

| Feature | OSM tags (typical) | Rendered as |
|---|---|---|
| The track itself | `highway=raceway`; for street circuits, the named public roads | alignment only (7.2) |
| Pit lane and pit building | `highway=raceway` + `service=pit_lane` or names; `building` at the pit straight | pit lane strip, pit building |
| Grandstands | `building=grandstand`, `leisure=stadium`, `building=stadium` | tiered stands at their real footprint |
| Buildings | `building=*` with `height` or `building:levels` | extruded footprints at real height |
| Water | `natural=water`, `natural=coastline`, `waterway`, `leisure=marina`, `harbour=*` | flat water |
| Woodland and trees | `landuse=forest`, `natural=wood`, `natural=tree_row`, `natural=tree` | instanced trees inside the real areas |
| Grass, parks | `landuse=grass`, `leisure=park` | ground colour |
| Landmarks | named features, e.g. `attraction=big_wheel` (Suzuka), hotels and towers by name | simple hand-made meshes, placed only at their OSM position |

### 7.2 Alignment: the hard part

Our track coordinates are circuit-local (OpenF1 / MultiViewer `x`, `y`): **no latitude or
longitude** (confirmed in `raw/<session>/circuit.json`). So each circuit is aligned by its shape:

1. Project the OSM track polyline to metres (local equirectangular projection).
2. Resample it and our centreline by arc length.
3. Search the start offset and direction, then fit a similarity transform (rotation, scale,
   translation) by Procrustes, refined with ICP.
4. Accept only if the remaining error is small (target: RMS under 10 m); report it per circuit and
   save an overlay image (OSM track over our centreline) for review.
5. Transform every feature into track coordinates with the same transform.

Risks: OSM may hold several layouts (pick the loop that matches); street circuits (Monaco, Baku,
Singapore, Las Vegas, Miami, Jeddah, Melbourne, Madring) are mapped as ordinary roads, not
raceways, so the matching roads must be stitched first.

### 7.3 Temporary structures

Grandstands at street circuits are temporary and usually missing from OSM. For those, use the
**official circuit maps** published for each event (grandstand names and positions), entered by
hand into a small per-circuit file, marked as hand-placed with the source noted. Nothing is
invented: if a reference does not show it, it is not built.

### 7.4 Pipeline and data

- New `pipeline/environment.py`: fetch (cached in `raw/osm/`), align, simplify (Douglas-Peucker),
  clip, export `web/public/data/env/<circuitKey>.json` in track coordinates; alignment report.
- `check.py`: every env file loads, alignment error under the limit, nothing overlaps the track.

### 7.5 Rendering, in the poster style

- Extruded footprints in paper and ink tones; grandstands tiered, seats in a single accent; water
  flat; trees instanced; landmarks as simple shapes.
- **Night races** derived, not listed: the session's local start time (`date_start` +
  `gmt_offset`) and the sun's position decide night (Singapore, Las Vegas, Jeddah, Lusail,
  Sakhir) or dusk (Yas Marina): dark sky, lit track, floodlights, independent of the UI theme.
- Performance budget: instancing and merged geometry; keep 60 fps on a laptop.

### 7.6 Order of work and checks

1. Alignment for all 26 circuits, with the report and overlay images. Stop if any fails.
2. Export and render buildings, grandstands, water and trees on three circuits (one permanent,
   one street, one parkland: e.g. Silverstone, Monaco, Spa); compare screenshots with satellite
   views.
3. Roll out to all circuits; hand-placed temporary grandstands for street circuits.
4. Landmarks where OSM confirms them.
5. Night races.
6. Sweep, E2E tests, performance check, docs.

### 7.7 Licence

OpenStreetMap data is under the ODbL. Credit "© OpenStreetMap contributors" in the README and on
the How page. The exported environment files are a derived database and must stay under the ODbL
(add a licence note in `web/public/data/env/`).

---

## 8. Other backlog

- Owner decision on louder radio (section 6).
- Refresh demo media after the surroundings land.
- Rerun the impeccable finish review on the current build and update `DESIGN.md`.
- Precompute the racing line and edges in the pipeline to cut load time.
- Optional: per-driver racing-line variation from braking points (stays presentation, not data).

---

## 9. How to run and check

```bash
# web (from web/)
npm install
npm run dev                  # http://localhost:5173
npx tsc --noEmit             # typecheck
npx playwright test          # 12 E2E tests
node scripts/sweep.mjs       # bug sweep over every flow (dev server running)
node scripts/capture.mjs     # screenshots of every page, desktop and phone (add "dark" for the dark theme)
node scripts/shot-spot.mjs <session> <metres> <camera> <out.png> [drag px]   # one spot on one circuit
npm run build                # static site in web/dist

# pipeline (from pipeline/, Python 3.12 venv)
./run_all.sh                 # build, train, export, results, careers, check
.venv/Scripts/python.exe compare_models.py   # the model comparison (about 30 minutes)
```
