"""Teammate battles: every season's qualifying head-to-head inside each team.

Teammates share a car, so beating your teammate is the cleanest measure of a driver in qualifying.
For every qualifying session in the game and every pair of drivers in one team, the one who
qualified higher wins the round; the gap is the difference of their best laps in the furthest
segment both of them set a time in (Q3 if both reached it, else Q2, else Q1), so it compares like
with like. Drivers who swapped teams mid-season get one pairing per teammate.

Each pairing also gets how the two drive differently in the same car, from the corner features of
build/<session>.pkl: per trait, how far apart they are and in how many sessions the first had more
of it; and the clearest single corners, in metres and km/h.

Reads web/public/data/index.json, raw/<session>/drivers.json and raw/<session>/session_result.json
(run results.py first) and build/*.pkl. Writes web/public/data/battles.json.
"""
import json
from collections import defaultdict
from pathlib import Path
from statistics import median

import numpy as np

from dna import TRAITS
from features import FEATURES
from model import is_quali, load_sessions

ROOT = Path(__file__).parent
RAW = ROOT / "raw"
WEB = ROOT.parent / "web" / "public" / "data"
F = {f: k for k, f in enumerate(FEATURES)}
# Corner differences worth naming, in their own units: (feature, unit, text if the first has more,
# text if less). A single corner is named only when the gap is clear of the lap-to-lap scatter.
EXAMPLES = [
    ("brake_point", "m", "brakes {x} later", "brakes {x} earlier"),
    ("apex_speed", "km/h", "carries {x} more through the apex", "carries {x} less through the apex"),
    ("throttle_point", "m", "is back on full throttle {x} later", "is back on full throttle {x} sooner"),
    ("min_throttle", "%", "lifts {x} less", "lifts {x} more"),
]
NOISE = {"brake_point": 6.0, "apex_speed": 2.0, "throttle_point": 8.0, "min_throttle": 3.0}
MIN_T = 3.0


def style_by_session():
    """session key -> code -> (per-corner median raw features, per-corner median z, laps, zones, circuit)."""
    out = {}
    for s in load_sessions():
        if not is_quali(s):
            continue
        by = defaultdict(list)
        for i, lap in enumerate(s["laps"]):
            by[s["drivers"][lap.driver]["name_acronym"]].append(i)
        out[s["session"]["session_key"]] = {
            code: (s["raw"][idx], np.median(s["z"][idx], axis=0)) for code, idx in by.items()
        } | {"_zones": s["zones"], "_braked": s["braked"], "_circuit": s["session"]["circuit_short_name"]}
    return out


def pair_style(a, b, rounds, by_session):
    """How a and b differ in the same car, over the sessions both have laps in."""
    per_trait = defaultdict(list)
    examples = []
    for r in rounds:
        s = by_session.get(r["key"])
        if not s or a not in s or b not in s:
            continue
        (ra, za), (rb, zb) = s[a], s[b]
        for name, (f, sign) in TRAITS.items():
            per_trait[name].append(float(sign * np.mean(za[:, F[f]] - zb[:, F[f]])))
        if len(ra) < 2 or len(rb) < 2:
            continue
        for f, unit, more, less in EXAMPLES:
            k = F[f]
            for c, zone in enumerate(s["_zones"]):
                if f == "brake_point" and not s["_braked"][c]:
                    continue
                xa, xb = ra[:, c, k], rb[:, c, k]
                xa, xb = xa[~np.isnan(xa)], xb[~np.isnan(xb)]
                if len(xa) < 2 or len(xb) < 2:
                    continue
                if f == "min_throttle" and min(np.median(xa), np.median(xb)) > 97:
                    continue  # flat out for both: nothing to name
                d = float(np.median(xa) - np.median(xb))
                spread = max(np.sqrt(xa.var(ddof=1) / len(xa) + xb.var(ddof=1) / len(xb)), NOISE[f] / 2)
                if abs(d) / spread < MIN_T:
                    continue
                x = f"{abs(d):.0f} {unit}" if unit != "%" else f"{abs(d):.0f}%"
                examples.append({
                    "key": r["key"], "circuit": s["_circuit"], "corner": str(zone.number), "feature": f,
                    "text": (more if d > 0 else less).format(x=x), "laps": [len(xa), len(xb)],
                    "strength": round(abs(d) / spread, 1),
                })
    # The clearest corners, at most one per session and feature, two per circuit and two per feature.
    examples.sort(key=lambda e: -e["strength"])
    picked, seen, per_circuit, per_feature = [], set(), defaultdict(int), defaultdict(int)
    for e in examples:
        if (e["key"], e["feature"]) in seen or per_circuit[e["circuit"]] >= 2 or per_feature[e["feature"]] >= 2:
            continue
        seen.add((e["key"], e["feature"]))
        per_circuit[e["circuit"]] += 1
        per_feature[e["feature"]] += 1
        picked.append(e)
        if len(picked) == 6:
            break
    traits = {
        name: {"diff": round(float(np.mean(v)), 3), "more": int(sum(x > 0 for x in v)), "sessions": len(v)}
        for name, v in per_trait.items()
    }
    return {"traits": traits, "corners": picked, "clearCorners": len(examples)}


def position(r) -> int | None:
    """The final position, or None when there is none (a few results give it as text)."""
    p = r.get("position")
    if isinstance(p, int):
        return p
    return int(p) if isinstance(p, str) and p.isdigit() else None


def main():
    index = json.loads((WEB / "index.json").read_text(encoding="utf-8"))
    sessions = sorted(index["sessions"], key=lambda s: s["date"])
    # (year, team) -> {(a, b) sorted codes: [rounds]}
    pairs = defaultdict(lambda: defaultdict(list))
    teams = {}  # (year, team) -> colour of the latest session
    people = {}  # code -> full name
    for s in sessions:
        sk = s["key"]
        try:
            drivers = json.loads((RAW / str(sk) / "drivers.json").read_text(encoding="utf-8"))
            results = json.loads((RAW / str(sk) / "session_result.json").read_text(encoding="utf-8"))
        except FileNotFoundError:
            print(f"skip {sk}: no drivers or result")
            continue
        by_number = {r["driver_number"]: r for r in results}
        by_team = defaultdict(list)
        for d in drivers:
            if d["driver_number"] in by_number and d.get("team_name"):
                by_team[d["team_name"]].append(d)
                people[d["name_acronym"]] = d["full_name"].title()
        for team, members in by_team.items():
            teams[(s["year"], team)] = "#" + (members[0].get("team_colour") or "888888")
            members.sort(key=lambda d: d["name_acronym"])
            for i in range(len(members)):
                for j in range(i + 1, len(members)):
                    a, b = members[i], members[j]
                    ra, rb = by_number[a["driver_number"]], by_number[b["driver_number"]]
                    pa, pb = position(ra), position(rb)
                    if pa is None and pb is None:
                        continue
                    winner = a if pb is None or (pa is not None and pa < pb) else b
                    da, db = ra.get("duration") or [], rb.get("duration") or []
                    both = [q for q in range(min(len(da), len(db))) if da[q] and db[q]]
                    seg = both[-1] if both else None
                    pairs[(s["year"], team)][(a["name_acronym"], b["name_acronym"])].append({
                        "key": sk,
                        "circuit": s["circuit"],
                        "date": s["date"],
                        "pos": [pa, pb],
                        "seg": None if seg is None else f"Q{seg + 1}",
                        # Seconds, first driver minus second: negative means the first was faster.
                        "gap": None if seg is None else round(da[seg] - db[seg], 3),
                        "winner": winner["name_acronym"],
                    })

    out = {"seasons": {}}
    by_session = style_by_session()
    for (year, team), matchups in sorted(pairs.items()):
        entries = []
        for (a, b), rounds in matchups.items():
            gaps = [r["gap"] for r in rounds if r["gap"] is not None]
            entries.append({
                "drivers": [{"code": a, "name": people.get(a, a)}, {"code": b, "name": people.get(b, b)}],
                "score": [sum(r["winner"] == a for r in rounds), sum(r["winner"] == b for r in rounds)],
                "medianGap": round(median(gaps), 3) if gaps else None,
                "rounds": rounds,
                "style": pair_style(a, b, rounds, by_session),
            })
        # The pairing that raced together most often first (the team's main line-up).
        entries.sort(key=lambda e: -len(e["rounds"]))
        out["seasons"].setdefault(str(year), []).append({"team": team, "colour": teams[(year, team)], "pairs": entries})
    for year in out["seasons"]:
        out["seasons"][year].sort(key=lambda t: t["team"])
    # The largest gap of each trait over the pairings with a few sessions together (one-off pairings
    # are noisy), so the page can draw them on one scale.
    diffs = defaultdict(list)
    for ts in out["seasons"].values():
        for t in ts:
            for p in t["pairs"]:
                for name, v in p["style"]["traits"].items():
                    if v["sessions"] >= 5:
                        diffs[name].append(abs(v["diff"]))
    out["traitScale"] = {name: round(max(v), 3) for name, v in diffs.items()}
    (WEB / "battles.json").write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    n = sum(len(p["rounds"]) for ts in out["seasons"].values() for t in ts for p in t["pairs"])
    print(f"battles: {sum(len(v) for v in out['seasons'].values())} team seasons, {n} head-to-head rounds")


if __name__ == "__main__":
    main()
