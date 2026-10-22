# Blind Lap: full overview

This document explains what was built overnight on 2026-10-23, how each part works, and why it was
built that way. It is written for the owner, for a reviewer reading the repository, and for anyone
who wants to extend it.

## 1. The idea in one paragraph

Every F1 driver attacks a corner a little differently: one brakes later, one carries more speed to
the apex, one gets back on the throttle earlier. Blind Lap asks whether that "handwriting" is strong
enough to identify a driver from telemetry alone. It replays a real 2025 qualifying lap with the
name removed, on a 3D circuit built from the car's own position data, with an engine sound
synthesised from the car's own RPM and throttle. As the car leaves each corner, a model trained on
other circuits reads that corner and updates its guess. The player guesses too. The reveal plays
the driver's real team radio.

## 2. What exists now

| Surface | What it does |
|---|---|
| Title | A random circuit orbits behind the title, with the session's fastest lap drawn as a rubber line on a ground moulded like a tyre sidewall. States the model's real held-out accuracy next to chance. |
| Play | Start lights, then an anonymous lap in a chase camera (or overhead). Tyre-shaped gauge (lap progress, corner notches, speed, gear, throttle, brake). The model's grid of drivers re-sorts after every corner. An evidence line says what the corner showed ("braked 11 m later than the field") and which drivers it pointed to. 3D captions appear beside the corners the model read. Click a driver to guess. 1x, 2x, 4x playback. Space pauses, C switches camera. |
| Reveal | Verdicts for you and the model (right, teammate, wrong), driver, team, lap time, the rank the model gave the real driver, the three corners that pointed hardest at them, career totals from F1DB, and the real team radio clip from that session. |
| Duel | Replays the lap against the fastest lap of the driver the model picked (or its runner-up when it was right), as a red ghost car, with a live time gap at the white car's position. |
| Daily five | The same five laps for every visitor on a given date (seeded), saved per day, with a result grid and a copy-to-clipboard share text. |
| Challenge link | "Copy challenge link" on the reveal gives a URL (`#/play/<session>.<lap index>`) that opens that exact lap for a friend. The link uses the lap's position in the session file, so it does not reveal the driver. |
| Driver DNA | Every driver's average corner style as a 3D point (PCA of 24 style dimensions). Drag to turn, click or pick a driver to see six plain-language style traits, closest matches and career totals. |
| How it knows | The method and the honest numbers: top-1, top-3 and team accuracy as bars against chance, the cross-season result, accuracy per session, the easiest and hardest drivers to spot, a confusion matrix, what the data cannot see, and the GBM comparison. All read from the evaluation report. |

## 3. Architecture

```
                     ┌──────────────────────────── pipeline/ (Python) ───────────────────────────┐
OpenF1 REST ────────►│ fetch.py      raw JSON per session: drivers, laps, car_data, location,      │
MultiViewer API ────►│               team_radio, weather, circuit corners                          │
F1DB release zip ───►│ careers.py    career totals per driver                                      │
                     │ track.py      centreline per circuit, lap alignment to metres               │
                     │ features.py   8 corner features, z-scored against the field                │
                     │ build.py      build/<session>.pkl                                           │
                     │ model.py      leave-one-circuit-out evaluation + per-session fold weights   │
                     │ export.py     web/public/data/{index,report,dna}.json, sessions/<key>.json   │
                     └───────────────────────────────────────┬─────────────────────────────────────┘
                                                             │ static JSON (committed)
                     ┌───────────────────────────── web/ (TypeScript) ─────────────────────────────┐
                     │ data.ts   types + cached loaders       model.ts  in-browser inference         │
                     │ lap.ts    telemetry interpolation      audio/engine.ts  Web Audio V6 synth    │
                     │ scene/world.ts  Three.js track, car, ghost, rubber-line shader, cameras       │
                     │ scene/textures.ts  asphalt grain, sidewall relief, corner caption sprites     │
                     │ ui/play.ts  round state machine   ui/lineup.ts  ui/tyre.ts  ui/daily.ts       │
                     │ ui/dna.ts   ui/how.ts   main.ts  hash router + render loop                    │
                     └──────────────────────────────────────────────────────────────────────────────┘
```

The split is deliberate. All heavy work (download, alignment, training, evaluation) happens once,
offline, in Python. The browser gets small static JSON and does only what must be live: rendering,
audio and running a linear model over a handful of numbers per corner. The site therefore hosts on
any static host with no server.

## 4. The data pipeline in depth

### 4.1 Sources and why

- **OpenF1** (`api.openf1.org/v1`): free, no key, JSON. Gives `car_data` (speed, throttle, brake,
  gear, RPM, DRS at about 3.7 Hz), `location` (x, y, z at about 4 Hz), `laps` (start time and
  duration of every lap), `drivers` and `team_radio` (MP3 URLs). Rate limit is about 30 requests a
  minute, so `fetch.py` paces itself and backs off on 429 and 5xx. A full season of qualifying
  (24 sessions × ~45 requests) takes about an hour.
- **FastF1** was the first plan. Its live-timing source (`livetiming.formula1.com/static`) returned
  HTTP 401 for session data during this build, so it was dropped. Team radio MP3s on the same host
  still return 200, so the game can play them.
- **MultiViewer** (`api.multiviewer.app/api/v1/circuits/<key>/<year>`): corner numbers and their
  positions in the same coordinate frame as OpenF1's location data, plus the broadcast map rotation.
- **Kaggle's "F1 World Championship 1950–2024"** is the most popular F1 dataset, but it is an
  Ergast dump with results and lap times only. It has no telemetry, so it cannot power this.
- **F1DB** (GitHub release `v2026.17.0`, checksum verified): career totals (starts, wins, poles,
  podiums, titles). Used for the reveal card and the DNA panel.

### 4.2 Turning samples into comparable laps (`track.py`)

OpenF1 gives no lap distance, and telemetry and position arrive on different clocks. Comparing
"where did they brake" needs every sample placed on the same measuring tape.

1. **Push laps**: timed laps that are not out-laps, within 2.5% of the driver's own best lap and
   inside the 107% rule. A first version used "within 3.5% of the session's best", which silently
   dropped every lap of the slowest team (Cadillac in 2026); judging each driver against their own
   best keeps the whole grid.
2. **Centreline**: the fastest lap with clean position data is turned into a closed loop.
   Near-duplicate points are dropped, a centripetal Catmull-Rom spline is run through the rest
   (centripetal parametrisation avoids loops and overshoot at tight corners), the curve is resampled
   every metre and lightly smoothed with a circular moving average. The start is rotated so s = 0
   sits at the timing line.
3. **Projection**: a KD-tree over the 1 m centreline points (3D, so Suzuka's crossover does not
   confuse the two levels) maps every position sample to a distance s. Distances are unwrapped
   across the line, anchored so the sample nearest the official lap start is near 0, and made
   monotonic.
4. **Validation**: the lap's start and end are recomputed as the times s crosses 0 and the lap
   length. A lap is dropped when that disagrees with the official start by more than 3 s, with the
   official duration by more than 3 s, or when s goes backwards by more than 60 m (spin or bad data).
5. **Telemetry onto distance**: each telemetry timestamp gets its s by interpolating the position
   track in time.

Result on Melbourne: 90 of 90 push laps aligned; centreline 5,243 m against an official 5,278 m (the
spline cuts the inside of corners slightly, which does not matter because every lap uses the same
tape).

### 4.3 Corner features (`features.py`)

Each corner gets a zone from halfway after the previous corner to halfway before the next (at most
450 m before and 300 m after the apex marker). Inside the zone:

| Feature | How it is measured |
|---|---|
| brake_point | first off-to-on brake transition before the apex, midpoint between samples, relative to the marker |
| brake_length | metres from brake on to the last braking sample before the apex |
| entry_speed | speed when braking starts (or peak speed before the apex if there is no braking) |
| apex_speed | minimum of speed interpolated on a 2 m grid within ±120 m of the marker |
| apex_offset | where that minimum happens relative to the marker |
| throttle_point | metres after the apex until throttle first reaches 95% |
| min_throttle | deepest throttle in the zone (lift depth on corners taken without braking) |
| coast | metres with throttle under 5% and no brake before the apex |

Then every value becomes a **robust z-score** against every push lap at that corner in that session:
(value − median) / max(1.4826 × MAD, noise floor). The floors (6 m for distances, 2 km/h for speeds,
3% for throttle) stop a corner where everybody does the same thing from turning noise into huge
scores. Brake features are switched off at corners where most of the field does not brake. Missing
values become 0, which means "like the field". Scores are clipped to ±4.

Why z-scores: "brakes at 112 m" means nothing at another circuit; "brakes 0.8 standard deviations
later than the field" carries over. It also removes most of the session-wide effects (track
evolution, wind) that hit everyone.

Each corner is also classed slow (field apex speed under 140 km/h), medium (under 220) or fast. The
8 features are placed into one of three blocks of a 24-dimensional vector, so the model can learn
that a driver brakes late for hairpins but lifts early in sweepers.

### 4.4 The model (`model.py`)

- **Samples**: one row per (lap, corner). Label: the driver's three-letter code. Drivers with fewer
  than 4 sessions are left out of the label set.
- **Classifier**: multinomial logistic regression, `C = 0.1`, balanced class weights (Q3 drivers
  have more laps than Q1 drivers). C was chosen by a sweep (0.01 to 1.0); 0.1 to 1.0 were within
  half a point of each other.
- **Lap guess**: the sum over corners of log P(driver | corner), divided by a temperature. Summing is
  naive Bayes over corners. Corners of one lap are not independent witnesses, so the raw sum is
  overconfident; the temperature that minimises held-out log loss is fitted from the evaluation.
- **Evaluation**: leave-one-circuit-out. For each circuit, a model is trained on every session at
  every other circuit (both seasons) and scores that circuit's laps in every year. This is the only
  honest test for this question: the same circuit in training, even from the other season, would let
  the model memorise "who was fast at Monza", not driving style. With one season this is the same as
  leave-one-session-out; with two it is stricter.
- **Cross-season test**: a model trained only on 2025 guesses every 2026 lap of drivers who raced
  both years. 2026 brought new cars and new rules, so this asks whether style survives a new car.
- **Baselines tried**: a histogram gradient-boosted tree model scored a few points higher top-1; a
  small MLP (32 or 64 hidden units) scored lower. Logistic regression ships because each corner's
  push toward a driver is a readable sum of weight × feature, and the weights are a few KB.
- **Outputs**: `model_out/report.json` (top-1, top-3, team accuracy, per-circuit accuracy, confusion
  matrix, temperature) and one set of fold weights per session.

### 4.5 Export (`export.py`) and careers (`careers.py`)

Per session: the centreline every 4 m, corners with zones and classes, the field's medians and
scales, driver names and team colours, the fold weights for that session (trained without it), and
the two fastest laps per driver with time, distance, speed, throttle, brake, gear, RPM, DRS, the
corner z-scores and the raw corner values (for sentences like "11 m later"), plus the team radio
clip nearest after the lap. The DNA file averages each driver's 24-dimensional vector over every lap
of the season, runs PCA to 3D, finds each driver's three closest matches by cosine similarity, and
computes six plain-language traits scaled so the most extreme driver reaches ±1.

### 4.6 Final numbers (full season)

Leave-one-session-out on 23 sessions, 2,012 laps, 21 drivers:

| Model | Top-1 driver | Top-3 driver | Right team | Log loss |
|---|---|---|---|---|
| Chance | 4.8% | 14.3% | 10% | 3.04 |
| Logistic regression (ships) | **37.3%** | **65.7%** | **49.3%** | 1.98 |
| Gradient-boosted trees | 44.6% | 75.3% | 60.8% | 1.66 |

The game's model is right about 7.8 times as often as picking at random, on circuits it never saw.

**Data gaps.** OpenF1 has no lap timing for Baku 2025 qualifying, so Baku is not in the game (23 of 24
sessions). Las Vegas 2025 qualifying was wet, so only 34 laps from 10 drivers fall within 3.5% of the
best lap.

## 5. The web app in depth

### 5.1 Stack

Vite 6, TypeScript 5.8 (strict, no unused locals), Three.js 0.170, Web Audio, no UI framework. One
self-hosted variable font, Archivo, with a width axis: expanded black for moulded lettering,
condensed for labels. Playwright for end-to-end tests.

### 5.2 Rendering (`scene/world.ts`, `scene/textures.ts`)

- **Track**: a ribbon 13 m wide following the real x, y, z (elevation exaggerated 3× so hills read),
  rotated to the broadcast map orientation. Side walls drop to the ground, so the circuit reads as a
  solid strip. Asphalt is a generated grain texture tiled every 14 m. Painted edge lines. Striped
  kerbs on the inside of every corner (inside found from the sign of the tangent's turn).
- **Ground**: a disc textured as a tyre sidewall: bands of concentric moulding grooves, two raised
  rims and the session's details moulded in a ring ("BLIND LAP", circuit, length, corners). The same
  canvas is the bump map, and one low warm directional light rakes across it so the relief shows.
- **Rubber line**: a narrow strip on the racing line with per-vertex colour from the real inputs:
  wet blue under braking, hard white at full throttle, grey otherwise. A custom shader hides what the
  car has not reached, fades what is behind it like a wake, and keeps corners at full strength once
  the model has read them (a per-vertex `aKeep` attribute). At the reveal the whole line lights.
- **Cameras**: chase (behind and above, distance and height grow with speed, looking 45 m ahead),
  overhead, and an orbit for title and reveal. On-board cameras smooth their offset from the car
  rather than their absolute position, so they never fall behind at 4× playback.
- **Post**: ACES tone mapping, a restrained bloom pass for the car and the line, 4096 shadow map.
- **Corner labels**: sprites with corner numbers; on board only the next few corners show. Once
  read, a label turns soft red and gains a caption of what the model saw ("BRAKES 11 M LATER").

### 5.3 Engine sound (`audio/engine.ts`)

A 1.6 L V6 four-stroke fires three times per crank revolution, so the fundamental is RPM / 60 × 3
(about 600 Hz at 12,000 RPM). Four oscillators (crank order sub, fundamental, square and triangle
harmonics) are mixed, soft-clipped by a tanh wave shaper, and sent through a resonant low-pass whose
cutoff opens with throttle and RPM. On top: a sine for the turbo and MGU-H whine, filtered noise for
wind and tyre roar that grows with the square of speed, a short gain dip on upshifts and bursts of
band-passed noise for exhaust crackle when the driver lifts sharply or downshifts.

Pitch comes from speed × a per-gear ratio learnt from the lap itself (median RPM/speed in each
gear), not from the 3.7 Hz RPM channel directly. Interpolating RPM would smear every gear change
over a quarter of a second; computing it from the held gear makes each shift instant.

### 5.4 The model in the browser (`model.ts`)

For each corner: build the 24-dimensional vector from the lap's stored z-scores, compute logits with
the session's fold weights, log-softmax over every class the model knows, keep the drivers in this
session, add to a running log-probability per driver. The display divides by the temperature and
normalises. Each step also yields: the drivers this corner pushed up most (relative to the average
driver), and a sentence from the corner's most unusual feature using the raw value minus the field
median ("went to full throttle 14 m earlier"). The reveal's caption lists the three corners that
pointed hardest at the real driver.

### 5.5 Game flow (`ui/play.ts`)

A small state machine: loading → lights (five lights, 0.7 s apart, then a random 0.4–1.3 s hold,
like a real start) → lap → reveal ↔ duel. Laps are sampled with a cursor-based interpolator
(`lap.ts`). Corners are read when the car passes the end of their zone. Scoring: 3 for the right
driver, 1 for their teammate, 0 otherwise, for both you and the model; kept in localStorage. Speed
preference is kept too. Storage is always wrapped in try/catch so a private window still plays.

### 5.6 Design

The visual direction was set with the impeccable design skill and recorded in
`.impeccable/surfaces/web-index-html.md`. The world is a tyre: matte rubber ground, moulded
lettering lit by one raking light, and the five Pirelli compound colours as the only hues, each with
one job: soft red is the model's pick, medium yellow is your pick, hard white is data, inter green
is correct, wet blue is braking. Team colour only appears as a thin chip beside a driver code. This
deliberately avoids the usual F1 broadcast look (team-colour glass panels and chyrons on
blue-black). The lap clock is a tyre: the lap is the band round the rim, corners are notches, and
speed and gear sit on the wheel.

### 5.7 Design review

The finished build went through the impeccable finish reviewer, a fresh subagent that judges the
screenshots and code against the written direction contract. Round one returned "fix" with eight
groups of material problems. All of them were real, among them: rows overprinting while the grid
re-sorted; yellow (your pick) used for a model verdict; team colour used as a big stripe; corner
sprites printing over the title copy; the phone duel bar running off screen; a "hero metric" scoreboard.
Round two scored two groups resolved and six partial, and found three regressions from round one (a
warm haze outside the palette, the ground lost in the overhead view, amber percentages). A final batch
addressed those, verified with fresh captures rather than a third review round. The open items are
listed in section 8. DESIGN.md records the shipped system.

## 6. File by file

| File | Purpose |
|---|---|
| `pipeline/fetch.py` | Paced, resumable downloader for OpenF1 and MultiViewer. Skips files already on disk. |
| `pipeline/track.py` | Loading raw JSON, centreline building (Catmull-Rom), KD-tree projection, lap alignment and validation. |
| `pipeline/features.py` | Corner zones, the 8 corner features, robust field z-scores, corner classes, block expansion. |
| `pipeline/build.py` | Runs track + features for each session, writes `build/<key>.pkl`. One bad session never stops the rest. |
| `pipeline/model.py` | Leave-one-circuit-out training and evaluation for logistic regression and GBM, the 2025 to 2026 cross-season test, temperature fitting, report and fold weights. |
| `pipeline/export.py` | Writes the web data: sessions, index, report, DNA (PCA, neighbours, traits). |
| `pipeline/careers.py` | Matches game drivers to F1DB by name and writes career totals. |
| `pipeline/run_all.sh` | Build, train, export and careers for every fully downloaded session. |
| `web/src/main.ts` | Hash router (title, play, daily, DNA, how) and the single render loop. |
| `web/src/data.ts` | Types for every JSON file, cached loaders, career line formatting. |
| `web/src/lap.ts` | Telemetry interpolation at any time; lap time formatting. |
| `web/src/model.ts` | In-browser inference, evidence sentences and captions. |
| `web/src/audio/engine.ts` | The engine synthesiser and per-gear ratio estimation. |
| `web/src/scene/world.ts` | Three.js scene: track, ground, kerbs, rubber-line shader, car, ghost car, labels, cameras, post-processing. |
| `web/src/scene/textures.ts` | Generated textures: asphalt, sidewall relief and lettering, corner labels with captions. |
| `web/src/ui/play.ts` | Round state machine, HUD, reveal, team radio, duel, daily integration. |
| `web/src/ui/lineup.ts` | The model's grid: rows that re-sort with transforms, your pick, the truth. |
| `web/src/ui/tyre.ts` | The SVG tyre gauge. |
| `web/src/ui/daily.ts` | Seeded daily plan, per-day storage, summary table and share text. |
| `web/src/ui/dna.ts` | The DNA 3D view and trait panel. |
| `web/src/ui/how.ts` | The method page and confusion matrix canvas. |
| `web/src/ui/icons.ts` | A small authored SVG icon set. |
| `web/src/styles.css` | Tokens (rubber, ink, compounds), lettering, HUD, reveal, pages, responsive rules. |
| `web/tests/blindlap.spec.ts` | End-to-end tests: title, a full round with guess, reveal and duel, DNA, How, daily share. |
| `PRODUCT.md`, `.impeccable/` | Product context and the design direction contract. |

## 7. How it was built (workflow)

1. Explored data sources (Kaggle, Ergast/Jolpica, F1DB, FastF1, OpenF1) and tested access from
   this machine. FastF1's source was locked (401); OpenF1 worked without a key.
2. Started the hour-long download in the background, and built the pipeline against the first
   sessions as they landed: alignment, features, model, export. The first end-to-end run on 4
   sessions already showed 30% top-1 against 5.6% chance, which confirmed the idea.
3. Chose the visual direction with the impeccable process (product context, a seeded direction roll
   and a written direction contract), then built the 3D scene, HUD, audio and game loop.
4. Tested in a real browser at each step, then moved testing to headless Playwright when the app's
   own browser pane was hidden (a hidden pane pauses animation). Fixed what the screenshots showed:
   an over-bright car light, oversized labels, an overflowing driver list, a camera that lagged at
   4×, the mobile layout.
5. Added depth: the duel replay, Daily five, 3D evidence captions, F1DB careers, end-to-end tests.
6. Retrained on the full season, re-exported, ran the tests, and wrote this document.

## 8. Honest limits

- Telemetry at about 3.7 Hz means about 22 m between samples at 300 km/h. A single braking point
  is known to about ±11 m. The model works because errors average out over many corners and laps.
- The model cannot fully separate driver from car. Team accuracy is higher than driver accuracy,
  and teammates are the hard case. The confusion matrix on the How page shows where it fails.
- Brake is on/off in this data; brake pressure and steering are not available.
- Corner positions come from MultiViewer and are projected onto our centreline; on a few circuits
  that puts a corner a few metres off. This is the same for every driver, so it does not bias the
  comparison.
- Daily five plans depend on the exported data; re-exporting changes which laps a date gets.

## 9. Ideas for next

- Add 2026 qualifying (OpenF1 already has it) and a season switch.
- Per-driver model cards: which corners and features identify each driver.
- A practice mode that shows the model's per-corner push as bars for every driver.
- Deploy to the portfolio domain (the site is static: `npm run build` and upload `web/dist`).
