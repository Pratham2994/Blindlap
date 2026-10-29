"""Write the static JSON the browser reads: one file per session, an index, the model report and the DNA map."""
import json
import pickle
from collections import defaultdict
from pathlib import Path

import numpy as np

from features import CORNER_CLASSES, FEATURES

from dna import build_dna
from model import acronym, load_sessions
from track import ts

ROOT = Path(__file__).parent
OUT = ROOT.parent / "web" / "public" / "data"
LAPS_PER_DRIVER = 2


def r(a, nd=1):
    return np.round(np.asarray(a, dtype=float), nd).tolist()


def pick_radio(radios, lap_end):
    """The clip nearest after the lap ends, else the nearest one in the session."""
    if not radios:
        return None
    after = [x for x in radios if 0 <= x[0] - lap_end <= 300]
    pool = after or radios
    return min(pool, key=lambda x: abs(x[0] - lap_end))[1]


# The models the game offers. Random forest is trained too, but only feeds the blend.
MODELS = {"blend": "Blend of three", "gbm": "Gradient-boosted trees", "logreg": "Logistic regression"}


def export_session(sess, classes, held, labels):
    sk = sess["session"]["session_key"]
    raw_radio = json.loads((ROOT / "raw" / str(sk) / "team_radio.json").read_text())
    radio = defaultdict(list)
    for x in raw_radio:
        radio[x["driver_number"]].append((ts(x["date"]), x["recording_url"]))

    # Best laps per driver, only drivers the model knows.
    by_driver = defaultdict(list)
    for i, lap in enumerate(sess["laps"]):
        if acronym(sess, lap.driver) in labels:
            by_driver[lap.driver].append(i)
    chosen = []
    for idx in by_driver.values():
        chosen += sorted(idx, key=lambda i: sess["laps"][i].lap_time)[:LAPS_PER_DRIVER]

    laps = []
    for i in chosen:
        lap = sess["laps"][i]
        laps.append({
            "id": f"{sk}-{lap.driver}-{lap.lap_number}",
            "driver": lap.driver,
            "code": acronym(sess, lap.driver),
            "lapNumber": lap.lap_number,
            "lapTime": round(lap.lap_time, 3),
            "t": r(lap.t, 3), "s": r(lap.s, 1), "v": r(lap.speed, 0), "thr": r(lap.throttle, 0),
            "brk": r(lap.brake > 0, 0), "gear": r(lap.gear, 0), "rpm": r(lap.rpm, 0), "drs": r(lap.drs, 0),
            "z": r(sess["z"][i], 2),
            "raw": [[None if np.isnan(v) else round(float(v), 1) for v in row] for row in sess["raw"][i]],
            # Each model's held-out log P(driver | corner) in tenths (-32 means -3.2), corner by corner,
            # in the order of model.classes. The game replays these instead of running the models.
            "steps": {m: np.round(np.log(np.clip(held[m][i], 1e-4, 1)) * 10).astype(int).tolist() for m in held},
            "radio": pick_radio(radio.get(lap.driver, []), lap.t0 + lap.lap_time),
        })

    cl = sess["centreline"]
    step = 4
    xyz = cl["xyz"][::step]
    drivers = {
        str(n): {"code": d["name_acronym"], "name": d["full_name"], "team": d["team_name"],
                 "colour": "#" + (d.get("team_colour") or "888888")}
        for n, d in sess["drivers"].items()
    }
    out = {
        "key": sk,
        "circuit": sess["session"]["circuit_short_name"],
        "country": sess["session"]["country_name"],
        "location": sess["session"]["location"],
        "date": sess["session"]["date_start"][:10],
        "meeting": sess["circuit"].get("meetingName"),
        "rotation": sess["circuit"].get("rotation", 0),
        "length": round(cl["length"], 1),
        "track": {"step": step, "x": r(xyz[:, 0]), "y": r(xyz[:, 1]), "z": r(xyz[:, 2])},
        "corners": [
            {"n": z.number, "s": round(z.s, 1), "lo": round(z.lo, 1), "hi": round(z.hi, 1),
             "cls": int(c), "braked": bool(b)}
            for z, c, b in zip(sess["zones"], sess["classes"], sess["braked"])
        ],
        "field": {"med": [[None if np.isnan(v) else round(float(v), 1) for v in row] for row in sess["med"]],
                  "scale": r(sess["scale"], 2)},
        "drivers": drivers,
        "model": {"classes": classes},
        "laps": laps,
    }
    (OUT / "sessions").mkdir(parents=True, exist_ok=True)
    (OUT / "sessions" / f"{sk}.json").write_text(json.dumps(out, separators=(",", ":"), allow_nan=False))
    return out


def main():
    folds = pickle.loads((ROOT / "model_out" / "folds.pkl").read_bytes())
    held = pickle.loads((ROOT / "model_out" / "probs.pkl").read_bytes())
    report = json.loads((ROOT / "model_out" / "report.json").read_text())
    labels = set(folds["labels"])
    sessions = load_sessions()
    index = []
    for s in sessions:
        sk = str(s["session"]["session_key"])
        if s["session"]["session_name"] != "Qualifying" or int(sk) not in held["probs"]["logreg"]:
            continue
        out = export_session(s, held["classes"], {m: held["probs"][m][int(sk)] for m in MODELS}, labels)
        index.append({k: out[k] for k in ("key", "circuit", "country", "location", "date", "meeting", "length")}
                     | {"corners": len(out["corners"]), "laps": len(out["laps"]), "year": int(out["date"][:4])})
        print(f"exported {sk} {out['circuit']}: {len(out['laps'])} laps")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "index.json").write_text(json.dumps({
        "seasons": sorted({e["year"] for e in index}), "session": "Qualifying", "features": FEATURES,
        "cornerClasses": CORNER_CLASSES, "classes": held["classes"],
        # Best first: the game guesses with the first model and offers the others for comparison.
        "models": [{"id": m, "name": n, "tau": held["tau"][m], "top1": report[m]["top1"]} for m, n in
                   sorted(MODELS.items(), key=lambda kv: -report[kv[0]]["top1"])],
        "sessions": index,
    }, separators=(",", ":")))
    (OUT / "report.json").write_text(json.dumps(report, separators=(",", ":")))
    (OUT / "dna.json").write_text(json.dumps(build_dna(sessions, labels), separators=(",", ":")))
    print("index, report, dna written")


if __name__ == "__main__":
    main()
