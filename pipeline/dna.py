"""Driver DNA: how each driver attacks corners, with the car taken out.

Every corner of every lap gives ten style measurements, each a z-score against the whole field at
that corner in that session (features.py). Part of a z-score is the car (a car that brakes late
makes both its drivers brake late) and part is the driver. This file splits them:

    z[lap, corner, feature] = car[team, season] + driver + noise      (per corner class and feature)

fitted over every lap of every session by alternating shrunken means. Teammates share the car term,
so their difference is the driver's own; drivers who change teams (Hamilton, Sainz, Hülkenberg,
Ocon, Lawson...) tie the cars of different teams together, which is what separates a car's habits
from its drivers'. With no switch, a team's common style stays with the car.

Outputs, all in dna.json:
- each driver's own style (the driver term), with the car removed, and the style as driven;
- a 3D map of each (PCA), closest matches, plain-language traits and the habits that give the
  driver away, all from the own style;
- each driver's own style season by season;
- each car's fingerprint (the car term) per team and season;
- how much of each trait is the car and how much the driver (shares of variance).
"""
from collections import defaultdict

import numpy as np

from features import CORNER_CLASSES, FEATURES

F = {f: k for k, f in enumerate(FEATURES)}
# Plain-language traits: a feature and its sign (positive = more of the trait).
TRAITS = {
    "Late braking": ("brake_point", 1),
    "Short braking": ("brake_length", -1),
    "Apex speed": ("apex_speed", 1),
    "Early throttle": ("throttle_point", -1),
    "Low coasting": ("coast", -1),
    "Commitment": ("min_throttle", 1),
    "Throttle snap": ("throttle_ramp", -1),
}
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
# Rows of prior weight pulling each term toward zero. The car's pull is weak and the driver's strong,
# so what two teammates share goes to their car, and a driver term keeps only what the data really
# ties to the driver: the difference to the teammate, and what stays when they change teams.
# (With equal pulls each driver kept a third of what they share with the teammate: the teammate was
# the closest match for 7 of 29 drivers. These settings: 1 of 29, with the car 69-90% of each habit.)
SHRINK_CAR = 20
SHRINK_DRIVER = 600
ITERATIONS = 40


# Team names that are one team under a new name: a driver who stays is not changing team.
LINEAGE = {"AlphaTauri": "Racing Bulls", "RB": "Racing Bulls", "Alfa Romeo": "Audi", "Kick Sauber": "Audi"}
# A move is tested only when the driver did enough sessions in the new car to know how they drove it.
MIN_MOVE_SESSIONS = 10


def _rows(sessions, labels):
    """Every (lap, corner) as (driver, car, season, corner class, 10 z-scores, session)."""
    out = []
    names = {}
    for s in sessions:
        year = int(s["session"]["date_start"][:4])
        for i, lap in enumerate(s["laps"]):
            d = s["drivers"][lap.driver]
            code = d["name_acronym"]
            if code not in labels:
                continue
            car = f"{d['team_name']}|{year}"
            names[code] = (d["full_name"].title(), d["team_name"], "#" + (d.get("team_colour") or "888888"), year)
            for c, cls in enumerate(s["classes"]):
                out.append((code, car, year, cls, s["z"][i, c], s["session"]["session_key"]))
    return out, names


def _fit(rows):
    """Alternating shrunken means of z = car + driver, per corner class (30 dims in all)."""
    drivers = sorted({r[0] for r in rows})
    cars = sorted({r[1] for r in rows})
    di = {d: k for k, d in enumerate(drivers)}
    ci = {c: k for k, c in enumerate(cars)}
    D = np.array([di[r[0]] for r in rows])
    C = np.array([ci[r[1]] for r in rows])
    K = np.array([r[3] for r in rows])
    Z = np.stack([r[4] for r in rows])  # rows x 10
    nf = Z.shape[1]
    drv = np.zeros((len(drivers), 3, nf))
    car = np.zeros((len(cars), 3, nf))
    for cls in range(3):
        m = K == cls
        d, c, z = D[m], C[m], Z[m]
        nd = np.bincount(d, minlength=len(drivers))[:, None] + SHRINK_DRIVER
        nc = np.bincount(c, minlength=len(cars))[:, None] + SHRINK_CAR
        for _ in range(ITERATIONS):
            res = z - car[c, cls]
            drv[:, cls] = np.stack([np.bincount(d, res[:, f], len(drivers)) for f in range(nf)], 1) / nd
            res = z - drv[d, cls]
            car[:, cls] = np.stack([np.bincount(c, res[:, f], len(cars)) for f in range(nf)], 1) / nc
    # Driver terms on average zero: what all drivers share belongs to the cars.
    shift = drv.mean(axis=0)
    drv -= shift
    car += shift
    return drivers, cars, drv, car, D, C, K, Z


def _pca3(M):
    Mc = M - M.mean(axis=0)
    _, S, Vt = np.linalg.svd(Mc, full_matrices=False)
    P = Mc @ Vt[:3].T
    P = P / np.maximum(np.abs(P).max(axis=0), 1e-9)
    return P, (S**2 / np.sum(S**2))[:3]


def _traits(v):
    """The seven traits of a 3 x 10 style (averaged over corner classes)."""
    avg = v.mean(axis=0)
    return {name: float(sign * avg[F[f]]) for name, (f, sign) in TRAITS.items()}


def _tells(v, n=3):
    """The strongest own habits, as phrases ("brakes later in slow corners")."""
    flat = [(abs(v[cls, k]), cls, k) for cls in range(3) for k in range(len(FEATURES))]
    out = []
    for _, cls, k in sorted(flat, reverse=True):
        text = f"{TELL_TEXT[FEATURES[k]][0 if v[cls, k] > 0 else 1]} in {CORNER_CLASSES[cls]} corners"
        if text not in out:
            out.append(text)
        if len(out) == n:
            break
    return out


def _neighbours(M, codes):
    norm = M / np.maximum(np.linalg.norm(M, axis=1, keepdims=True), 1e-9)
    sim = norm @ norm.T
    return {c: [codes[j] for j in np.argsort(-sim[i]) if j != i][:3] for i, c in enumerate(codes)}


def _line(car):
    team = car.split("|")[0]
    return LINEAGE.get(team, team)


def _moves(sessions_in):
    """Every time a driver joined a team they had not driven for before, after at least a season
    elsewhere, and drove for it at least MIN_MOVE_SESSIONS sessions: (driver, first new car,
    previous car). A rename is not a move; neither is a one-off stand-in."""
    by_driver = defaultdict(dict)
    for (code, car), n in sessions_in.items():
        by_driver[code][car] = n
    out = []
    for code, cars in by_driver.items():
        lines = defaultdict(list)
        for car in cars:
            lines[_line(car)].append(car)
        for line, in_line in lines.items():
            y = min(int(c.split("|")[1]) for c in in_line)
            earlier = [c for c in cars if int(c.split("|")[1]) < y]
            if not earlier or sum(cars[c] for c in in_line) < MIN_MOVE_SESSIONS:
                continue
            new = max((c for c in in_line if int(c.split("|")[1]) == y), key=lambda c: cars[c])
            last = max(int(c.split("|")[1]) for c in earlier)
            prev = max((c for c in earlier if int(c.split("|")[1]) == last), key=lambda c: cars[c])
            if cars[new] >= MIN_MOVE_SESSIONS:
                out.append((code, new, prev))
    return sorted(out, key=lambda m: (m[1].split("|")[1], m[0]))


def _predict_moves(rows, moves):
    """Each move predicted from the data before it: the model is refitted without any of the
    driver's laps in the new team, then style in the new car = new car's term (from the teammate)
    + the driver's own term (from the old cars). Two simple guesses for comparison: the driver
    drives as they did in the old car, or the new car decides and they drive like the teammate."""
    out = []
    for code, new, prev in moves:
        y_new = int(new.split("|")[1])
        later = [r[0] == code and r[2] >= y_new for r in rows]
        held = [r for r, x in zip(rows, later) if x]
        keep = [r for r, x in zip(rows, later) if not x]
        drivers, cars, drv, car, *_ = _fit(keep)
        if code not in drivers or new not in cars:
            continue
        pred = car[cars.index(new)] + drv[drivers.index(code)]

        def mean_style(sel):
            v = np.zeros((3, len(FEATURES)))
            for cls in range(3):
                z = [r[4] for r in sel if r[3] == cls]
                if z:
                    v[cls] = np.mean(z, axis=0)
            return v

        actual = mean_style([r for r in held if r[1] == new])
        before = mean_style([r for r in rows if r[0] == code and r[1] == prev])
        mates = sorted({r[0] for r in rows if r[1] == new and r[0] != code})
        mate = mean_style([r for r in rows if r[1] == new and r[0] != code])
        err = lambda v: float(np.sqrt(np.mean((v - actual) ** 2)))  # noqa: E731
        out.append({
            "driver": code, "car": new, "from": prev, "mates": mates,
            "pred": pred, "actual": actual, "before": before, "mate": mate,
            "error": {"model": err(pred), "before": err(before), "mate": err(mate)},
        })
        print(f"dna move {code} {prev} -> {new}: error model {err(pred):.3f}, as before {err(before):.3f}, like the teammate {err(mate):.3f}")
    return out


def build_dna(sessions, labels):
    rows, names = _rows(sessions, labels)
    drivers, cars, drv, car, D, C, K, Z = _fit(rows)
    # As driven: each driver's plain average (the old DNA), for the comparison.
    raw = np.zeros_like(drv)
    for cls in range(3):
        m = K == cls
        for k in range(len(drivers)):
            mk = m & (D == k)
            if mk.any():
                raw[k, cls] = Z[mk].mean(axis=0)
    own_flat = drv.reshape(len(drivers), -1)
    raw_flat = raw.reshape(len(drivers), -1)
    P_own, ex_own = _pca3(own_flat)
    P_raw, ex_raw = _pca3(raw_flat)
    near_own = _neighbours(own_flat, drivers)
    near_raw = _neighbours(raw_flat, drivers)

    # Each trait scaled so the most extreme driver sits at +-1 (own style); cars on their own scale.
    own_traits = {c: _traits(drv[k]) for k, c in enumerate(drivers)}
    raw_traits = {c: _traits(raw[k]) for k, c in enumerate(drivers)}
    scale = {t: max(abs(v[t]) for v in own_traits.values()) or 1 for t in TRAITS}
    raw_scale = {t: max(abs(v[t]) for v in raw_traits.values()) or 1 for t in TRAITS}
    car_traits = {c: _traits(car[k]) for k, c in enumerate(cars)}
    car_scale = {t: max(abs(v[t]) for v in car_traits.values()) or 1 for t in TRAITS}

    # How much of each trait is the car: the spread of the car terms against the spread of the
    # driver terms, over every row (so each counts as often as it is driven).
    share = {}
    for name, (f, sign) in TRAITS.items():
        k = F[f]
        cv = np.var(car[C, K, k])
        dv = np.var(drv[D, K, k])
        share[name] = round(float(cv / (cv + dv)) if cv + dv > 0 else 0.5, 3)

    # Own style season by season: the driver's laps that season, car term removed.
    seasons = defaultdict(dict)
    years = np.array([r[2] for r in rows])
    for k, code in enumerate(drivers):
        for y in sorted(set(years[D == k])):
            m = (D == k) & (years == y)
            v = np.zeros((3, len(FEATURES)))
            for cls in range(3):
                mc = m & (K == cls)
                if mc.sum() >= 30:
                    v[cls] = (Z[mc] - car[C[mc], cls]).mean(axis=0)
            team = next(r[1].split("|")[0] for r, keep in zip(rows, m) if keep)
            seasons[code][str(int(y))] = {"team": team, "corners": int(m.sum()), "traits": {t: round(x / scale[t], 3) for t, x in _traits(v).items()}}

    # Moves: each team change predicted from the data before it (see _predict_moves).
    sessions_in = defaultdict(set)
    for r in rows:
        sessions_in[(r[0], r[1])].add(r[5])
    moves = _predict_moves(rows, _moves({k: len(v) for k, v in sessions_in.items()}))
    as_driven = lambda v: {t: round(x / raw_scale[t], 3) for t, x in _traits(v).items()}  # noqa: E731
    move_out = [{
        "driver": m["driver"], "team": m["car"].split("|")[0], "year": int(m["car"].split("|")[1]),
        "fromTeam": m["from"].split("|")[0], "fromYear": int(m["from"].split("|")[1]), "mates": m["mates"],
        "predicted": as_driven(m["pred"]), "actual": as_driven(m["actual"]),
        "before": as_driven(m["before"]), "mate": as_driven(m["mate"]),
        "error": {k: round(v, 3) for k, v in m["error"].items()},
    } for m in moves]

    teammate_raw = sum(1 for c in drivers if near_raw[c] and names[near_raw[c][0]][1] == names[c][1])
    teammate_own = sum(1 for c in drivers if near_own[c] and names[near_own[c][0]][1] == names[c][1])
    team_of = {c: names[c][1] for c in drivers}
    car_colour = {}
    for code, (_, team, col, year) in names.items():
        car_colour[f"{team}|{year}"] = col
    print(f"dna: closest match is the teammate for {teammate_raw} of {len(drivers)} as driven, {teammate_own} with the car removed")
    return {
        "explained": [round(float(x), 3) for x in ex_own],
        "explainedRaw": [round(float(x), 3) for x in ex_raw],
        "teammateNearest": {"asDriven": teammate_raw, "ownStyle": teammate_own, "drivers": len(drivers)},
        "carShare": share,
        "loadings": [],
        "moves": move_out,
        # For "any driver in any car": as driven = car term + driver term, both in z (not scaled),
        # shown on the as-driven scale.
        "rawScale": {t: round(float(raw_scale[t]), 4) for t in TRAITS},
        "drivers": [
            {
                "code": c,
                "name": names[c][0],
                "team": team_of[c],
                "colour": names[c][2],
                "pos": [round(float(x), 3) for x in P_own[k]],
                "posRaw": [round(float(x), 3) for x in P_raw[k]],
                "vector": [round(float(x), 3) for x in own_flat[k]],
                "neighbours": near_own[c],
                "neighboursRaw": near_raw[c],
                "tells": _tells(drv[k]),
                "style": {t: round(own_traits[c][t] / scale[t], 3) for t in TRAITS},
                "styleRaw": {t: round(raw_traits[c][t] / raw_scale[t], 3) for t in TRAITS},
                "styleZ": {t: round(own_traits[c][t], 4) for t in TRAITS},
                "corners": int((D == k).sum()),
                "seasons": seasons[c],
            }
            for k, c in enumerate(drivers)
        ],
        "cars": [
            {
                "team": car_key.split("|")[0],
                "year": int(car_key.split("|")[1]),
                "colour": car_colour.get(car_key, "#888888"),
                "traits": {t: round(car_traits[car_key][t] / car_scale[t], 3) for t in TRAITS},
                "traitsZ": {t: round(car_traits[car_key][t], 4) for t in TRAITS},
                "drivers": sorted({r[0] for r in rows if r[1] == car_key}),
            }
            for car_key in cars
        ],
    }
