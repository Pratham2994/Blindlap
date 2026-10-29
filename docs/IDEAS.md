# Blind Lap: what next

Written on 2026-10-29 at the owner's request ("why did we pick this dataset, why only 2025, how do
we fix Driver DNA, give me lots of ideas"). Facts marked *checked* were measured that morning.

## Why this data

| Source | What it gives | Why |
|---|---|---|
| **OpenF1** | Car telemetry (~3.7 Hz: speed, throttle, brake, gear, RPM, DRS), position (~4 Hz), laps, team radio, results, weather, tyre stints | The only free source with telemetry and positions. No key. |
| MultiViewer | Corner numbers and positions per circuit | Same coordinate frame as OpenF1 positions. |
| F1DB | Career totals | Results only; used for the reveal and DNA cards. |
| FastF1 / F1 live-timing archive | Telemetry from 2018 | Returns HTTP 401 (*checked* again: still 401). Blocked. |
| Ergast / Jolpica / Kaggle "F1 1950-2024" | Results and lap times | No telemetry, so they cannot say how a corner was driven. |

**Why only 2025 and 2026.** The first build started with the latest full season (2025), because a
season takes about an hour to download (OpenF1 allows ~30 requests a minute), and 2026 was added
as it ran. It was not a limit of the data:

- **OpenF1 also has 2023 and 2024** (*checked*: 23 and 24 qualifying sessions, with car data and
  positions). Not downloaded yet.
- **Before 2023 there is nothing usable:** OpenF1 starts in 2023 (*checked*: 2022 returns "no
  results"), and the 2018-2022 archive is the blocked F1 live-timing source.

## The Driver DNA problem: it partly shows the car

*Checked:* for 12 of the 24 drivers, the closest DNA match is their own teammate (by chance it
would be about 1). Two drivers in one car brake, turn and accelerate alike because the car makes
them. The classifier has the same bias (it finds the team more easily than the driver), which is
why the teammate test exists.

The fix is to separate the two, and the data that makes it possible is **drivers who changed
teams**: Hamilton (Mercedes to Ferrari), Sainz (Ferrari to Williams), Hülkenberg (Haas to Sauber /
Audi), Ocon (Alpine to Haas), Bottas and Pérez (to Cadillac), Lawson and Tsunoda (between the two
Red Bull teams), and more once 2023-2024 are in. A driver who keeps their habits in a new car is
showing style; a car that makes every driver brake late is showing the car.

1. **Car + driver model.** For every corner feature, fit `value = car(team, season) + driver +
   noise` across all sessions (ridge regression, or a mixed model with the team-season as a random
   effect). Team switchers tie the two apart. DNA is then built from the driver term only.
2. **Two maps.** The DNA page gets a switch: "as driven" (today's map) and "car removed". The gap
   between them is itself a story: who drives *against* their car.
3. **Car fingerprints.** The car term is a feature too: which cars let drivers brake latest, carry
   the most apex speed, get on the power soonest. A small page or a panel on DNA.
4. **The models, car removed.** Train the classifier on car-removed features as a test. If teammate
   accuracy holds while team accuracy drops, the claim "it reads the driver, not the car" gets much
   stronger, and How it knows can say so with numbers.

A simpler first step, if the model is too much at once: subtract each team's session average from
its drivers' values. That removes the car but makes teammates mirror images of each other, so it
is only an interim view.

## Ideas, data first

1. **Add 2023 and 2024 qualifying** (the cheapest big win). +47 sessions, about double the laps,
   more drivers (Ricciardo, Sargeant, Magnussen, Zhou, de Vries...) and many more team switches for
   the DNA fix. The pipeline handles it as is: `BLINDLAP_YEAR=2023 fetch.py`, then `run_all.sh`.
   Costs about 2 hours of download and ~6 GB of local raw data; the `data-cache` branch grows a
   little (builds only).
2. **Sprint qualifying** (6 a year since 2023): same format, more laps per driver.
3. **Tyre compound and weather** (OpenF1 stints and weather) as conditions, so a soft-tyre lap and a
   wet lap are judged against like laps.
4. **Practice and race laps** for training only (as practice 3 is today), and later for new modes.
5. **Keep trying the 2018-2022 archive**: if F1's live-timing source opens again, five more seasons
   come in through the same pipeline.

## Big features, different from the blind lap

1. **Driver DNA over time.** With 2023-2026, each driver's style season by season: does Hamilton
   drive the Ferrari like the Mercedes? A timeline on the DNA page.
2. **Where the time goes.** In the Telemetry lab: the time gap between two laps along the whole
   lap, and for each corner the time won or lost and why (braking, apex speed, exit).
3. **Corner atlas.** For each circuit, which corners separate drivers most (from the models' own
   per-corner scores, already shipped): "where talent shows at Suzuka".
4. **Race mode.** Guess the driver from a race stint instead of a qualifying lap: tyre saving,
   lift and coast, defending. New data (race laps), new model.
5. **Track evolution.** How lap times fall from Q1 to Q3 in each session, and who improved most.
6. **This weekend.** The weekly update already brings the new qualifying in on Monday; a home card
   "Monza is in: guess the pole lap" makes the site worth coming back to.

## Smaller ideas that support Blind Lap

- **Difficulty:** a hard mode without the telemetry band and an easy mode with team colours.
- **Your record:** your accuracy against the models across rounds, by circuit and by driver.
- **Share card:** the reveal as an image (code, verdict, the three corners) to post.
- **Rival pick:** choose two drivers from different teams and guess which one it is.

## Done since (2026-10-29)

- 2023 and 2024 data; the car + driver DNA with two maps, seasons and car fingerprints; where the
  time goes in the lab.
- The model says how sure it is, with how often calls that sure were right; "More laps" (the read
  sharpening over a driver's other laps); **Which is which** (two cars, two names; 95% right).
- Team moves predicted before they happened, and any driver in any car, on the DNA page.
- How teammates drive differently, trait by trait and corner by corner, on Battles.

## Tested and dropped

- **A real racing line from the position data:** every car sits within about a metre of the same
  path, and one driver's laps differ as much as different drivers'. No signal; the line stays drawn.
- **Race laps for Driver DNA:** a different style (fuel, tyres, traffic). Mixed in, they made the DNA
  less steady and team moves harder to predict. A separate race-style DNA could still be built.
- **A pace model** (lap and sector times): not built. It would raise accuracy a lot but measure who
  is fast, not how they drive, and the "Result" hint already gives that away for points.
