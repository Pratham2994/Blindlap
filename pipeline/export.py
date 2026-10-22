"""Write the static JSON the browser reads: one file per session, an index, the model report and the DNA map."""
import json
import pickle
from collections import defaultdict
from pathlib import Path

import numpy as np

from features import CORNER_CLASSES, FEATURES
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


def export_session(sess, fold, labels):
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
        "model": fold,
        "laps": laps,
    }
    (OUT / "sessions").mkdir(parents=True, exist_ok=True)
    (OUT / "sessions" / f"{sk}.json").write_text(json.dumps(out, separators=(",", ":"), allow_nan=False))
    return out


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
    }
    loadings = [{"feature": f"{FEATURES[j % 8]}:{CORNER_CLASSES[j // 8]}", "pc": r(Vt[:3, j], 3)} for j in range(Vt.shape[1])]
    return {
        "explained": r(explained, 3),
        "loadings": loadings,
        "drivers": [
            {"code": c, "name": teams[c][2], "team": teams[c][0], "colour": teams[c][1], "pos": r(P[i], 3),
             "vector": r(M[i], 3), "neighbours": neighbours[c],
             "style": {k: round(float(v[i]), 2) for k, v in axes.items()}}
            for i, c in enumerate(codes)
        ],
    }


def main():
    folds = pickle.loads((ROOT / "model_out" / "folds.pkl").read_bytes())
    report = json.loads((ROOT / "model_out" / "report.json").read_text())
    labels = set(folds["labels"])
    sessions = load_sessions()
    index = []
    for s in sessions:
        sk = str(s["session"]["session_key"])
        if sk not in folds["weights"]:
            continue
        out = export_session(s, folds["weights"][sk], labels)
        index.append({k: out[k] for k in ("key", "circuit", "country", "location", "date", "meeting", "length")}
                     | {"corners": len(out["corners"]), "laps": len(out["laps"])})
        print(f"exported {sk} {out['circuit']}: {len(out['laps'])} laps")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "index.json").write_text(json.dumps({
        "season": 2025, "session": "Qualifying", "tau": folds["tau"], "features": FEATURES,
        "cornerClasses": CORNER_CLASSES, "classes": folds["weights"][next(iter(folds["weights"]))]["classes"],
        "sessions": index,
    }, separators=(",", ":")))
    (OUT / "report.json").write_text(json.dumps(report, separators=(",", ":")))
    (OUT / "dna.json").write_text(json.dumps(driver_dna(sessions, labels), separators=(",", ":")))
    print("index, report, dna written")


if __name__ == "__main__":
    main()
