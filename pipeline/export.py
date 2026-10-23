"""Write the static JSON the browser reads: one file per session, an index, the model report and the DNA map."""
import json
import pickle
from collections import defaultdict
from pathlib import Path

import numpy as np

from features import CORNER_CLASSES, FEATURES
from sklearn.linear_model import LogisticRegression

from model import acronym, corner_rows, load_sessions
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


MODELS = {"gbm": "Gradient-boosted trees", "forest": "Random forest", "logreg": "Logistic regression"}


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


TELL_TEXT = {
    "brake_point": ("brakes later", "brakes earlier"),
    "brake_length": ("brakes for longer", "brakes for less distance"),
    "entry_speed": ("arrives faster", "arrives slower"),
    "apex_speed": ("carries more apex speed", "carries less apex speed"),
    "apex_offset": ("takes a later apex", "takes an earlier apex"),
    "throttle_point": ("waits longer for full throttle", "gets to full throttle sooner"),
    "min_throttle": ("lifts less", "lifts more"),
    "coast": ("coasts more", "coasts less"),
    "throttle_ramp": ("squeezes the throttle on more gradually", "snaps the throttle open"),
    "partial_throttle": ("modulates the throttle more", "uses less part-throttle"),
}


def driver_tells(sessions, labels):
    """The three weights that most raise each driver's probability in a model trained on every lap,
    turned into phrases like "brakes later in slow corners"."""
    X, y = [], []
    for s in sessions:
        Xs, _, ys = corner_rows(s)
        m = np.isin(ys, sorted(labels))
        X.append(Xs[m]); y.append(ys[m])
    model = LogisticRegression(C=0.1, max_iter=3000, class_weight="balanced").fit(np.vstack(X), np.concatenate(y))
    W = model.coef_ - model.coef_.mean(axis=0)  # relative to the average driver
    tells = {}
    for k, code in enumerate(model.classes_):
        out = []
        for j in np.argsort(-np.abs(W[k])):
            f, cls = FEATURES[j % len(FEATURES)], CORNER_CLASSES[j // len(FEATURES)]
            phrase = TELL_TEXT[f][0 if W[k, j] > 0 else 1]
            text = f"{phrase} in {cls} corners"
            if text not in out:
                out.append(text)
            if len(out) == 3:
                break
        tells[code] = out
    return tells


def driver_dna(sessions, labels):
    """Average style vector per driver (24 dims: 8 features x 3 corner classes), PCA to 3D."""
    sums = defaultdict(lambda: np.zeros((3, len(FEATURES))))
    counts = defaultdict(lambda: np.zeros((3, 1)))
    teams = {}
    for s in sessions:
        for i, lap in enumerate(s["laps"]):
            code = acronym(s, lap.driver)
            if code not in labels:
                continue
            teams[code] = (s["drivers"][lap.driver]["team_name"], "#" + (s["drivers"][lap.driver].get("team_colour") or "888888"),
                           s["drivers"][lap.driver]["full_name"])
            for c, cls in enumerate(s["classes"]):
                sums[code][cls] += s["z"][i, c]
                counts[code][cls] += 1
    codes = sorted(sums)
    tells = driver_tells(sessions, labels)
    M = np.stack([(sums[c] / np.maximum(counts[c], 1)).ravel() for c in codes])
    Mc = M - M.mean(axis=0)
    _, S, Vt = np.linalg.svd(Mc, full_matrices=False)
    P = Mc @ Vt[:3].T
    P = P / np.abs(P).max(axis=0)
    explained = (S ** 2 / np.sum(S ** 2))[:3]
    norm = M / np.maximum(np.linalg.norm(M, axis=1, keepdims=True), 1e-9)
    sim = norm @ norm.T
    neighbours = {c: [codes[j] for j in np.argsort(-sim[i]) if j != i][:3] for i, c in enumerate(codes)}
    # Plain-language style axes, averaged over corner classes (z-scores vs the field).
    avg = M.reshape(len(codes), 3, len(FEATURES)).mean(axis=1)
    F = {f: k for k, f in enumerate(FEATURES)}
    axes = {
        "Late braking": avg[:, F["brake_point"]],
        "Short braking": -avg[:, F["brake_length"]],
        "Apex speed": avg[:, F["apex_speed"]],
        "Early throttle": -avg[:, F["throttle_point"]],
        "Low coasting": -avg[:, F["coast"]],
        "Commitment": avg[:, F["min_throttle"]],
        "Throttle snap": -avg[:, F["throttle_ramp"]],
    }
    # Scale each axis so the most extreme driver sits at +-1; the raw z-score stays in "raw".
    axes_scaled = {k: v / max(np.abs(v).max(), 1e-9) for k, v in axes.items()}
    loadings = [{"feature": f"{FEATURES[j % len(FEATURES)]}:{CORNER_CLASSES[j // len(FEATURES)]}", "pc": r(Vt[:3, j], 3)} for j in range(Vt.shape[1])]
    return {
        "explained": r(explained, 3),
        "loadings": loadings,
        "drivers": [
            {"code": c, "name": teams[c][2], "team": teams[c][0], "colour": teams[c][1], "pos": r(P[i], 3),
             "vector": r(M[i], 3), "neighbours": neighbours[c], "tells": tells.get(c, []),
             "style": {k: round(float(v[i]), 3) for k, v in axes_scaled.items()},
             "styleRaw": {k: round(float(v[i]), 3) for k, v in axes.items()}}
            for i, c in enumerate(codes)
        ],
    }


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
    (OUT / "dna.json").write_text(json.dumps(driver_dna(sessions, labels), separators=(",", ":")))
    print("index, report, dna written")


if __name__ == "__main__":
    main()
