# Blind Lap

**Can a model tell who is driving an F1 car from the telemetry alone?**

Blind Lap replays a real 2025 qualifying lap with the driver's name removed. The lap runs on a 3D
circuit built from the car's recorded position, and you hear an engine synthesised live from its RPM,
gear and throttle. As the car leaves each corner, a model reads how that corner was driven and
updates its guess. You guess too. Then the reveal plays the driver's real team radio from that
session.

- **Play**: one anonymous lap, the model's live line-up, your pick, the reveal.
- **Daily five**: the same five laps for everyone each day, with a result grid you can share.
- **Duel**: after the reveal, race the lap against the driver the model picked, with a live gap.
- **Driver DNA**: every driver's corner style projected into 3D. Drivers who sit close drive alike.
- **How it knows**: the method and the evaluation, read from the same report the model produced.

## How it works

```
OpenF1 API ──► fetch.py ──► raw/<session>/*.json
MultiViewer ─┘                    │
                                  ▼
                track.py   one centreline per circuit; every sample projected to metres along it
                features.py  8 style features per corner, z-scored against the field
                build.py   build/<session>.pkl
                                  │
                                  ▼
                model.py   leave-one-session-out logistic regression (+ GBM baseline)
                export.py  web/public/data/*.json  (laps, track, fold weights, report, DNA)
                                  │
                                  ▼
web/  Vite + TypeScript + Three.js + Web Audio
      model.ts runs the same per-session model in the browser, corner by corner
```

1. **Data.** Car telemetry (~3.7 Hz), 3D position (~4 Hz) and team radio for all 24 qualifying
   sessions of 2025 come from [OpenF1](https://openf1.org). Corner positions come from
   MultiViewer's circuit maps. (FastF1's live-timing source now returns 401, so it is not used.)
2. **One line per circuit.** The fastest lap's position samples become a closed centripetal
   Catmull-Rom spline. Every position sample of every push lap is projected onto it with a KD-tree,
   so a distance means the same place on track for every driver. Laps that go backwards, lose data
   or disagree with the official lap time are dropped.
3. **Corner features.** The lap is cut into one zone per corner. In each zone: braking point,
   braking length, entry speed, apex speed, apex position, throttle pickup point, deepest lift and
   coasting distance. Each is turned into a robust z-score (median and MAD) against every push lap
   at that corner in that session, so the model learns "brakes 9 m later than the field", which
   survives a change of circuit.
4. **Model.** Features go into one block per corner type (slow, medium, fast). A multinomial
   logistic regression gives P(driver | corner). A lap's guess sums log-probabilities over its
   corners with a temperature fitted on held-out laps. Every number is evaluated leave-one-session-out:
   the model that guesses at Monza never saw Monza, and the browser uses exactly those fold models.
5. **Front end.** The track is a raised asphalt strip on a ground moulded like a tyre sidewall. The
   rubber line the car lays is coloured by the real inputs (blue under braking, white at full
   throttle) and fades behind the car except at corners where the model took evidence. The engine
   is four oscillators at the V6 firing frequency through a soft clipper, with a turbo whine, wind
   noise and exhaust crackle on lifts.

## Results

Read live from `pipeline/model_out/report.json` and shown on the How it knows page. With 23 of the
24 sessions, logistic regression names the right driver on roughly a third of laps and has them in
its top three on about two thirds (chance is about 5% and 14%). A gradient-boosted model is a few
points better; the linear model ships because it can explain each corner and runs in a few KB.

## Run it

```bash
# data + model (Python 3.12, uv)
cd pipeline
uv venv --python 3.12 .venv
uv pip install --python .venv/Scripts/python.exe -r requirements.txt
.venv/Scripts/python.exe fetch.py      # ~1 hour: OpenF1 allows 30 requests a minute
./run_all.sh                           # build, train, evaluate, export to web/public/data

# web
cd ../web
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in web/dist
```

The exported data is committed, so the web app runs without the pipeline.

## Credits

Telemetry, positions and team radio: OpenF1. Corner maps: MultiViewer. Blind Lap is a fan
project and is not associated with Formula 1, the FIA or any team.
