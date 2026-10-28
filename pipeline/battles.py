"""Teammate battles: every season's qualifying head-to-head inside each team.

Teammates share a car, so beating your teammate is the cleanest measure of a driver in qualifying.
For every qualifying session in the game and every pair of drivers in one team, the one who
qualified higher wins the round; the gap is the difference of their best laps in the furthest
segment both of them set a time in (Q3 if both reached it, else Q2, else Q1), so it compares like
with like. Drivers who swapped teams mid-season get one pairing per teammate.

Reads web/public/data/index.json, raw/<session>/drivers.json and raw/<session>/session_result.json
(run results.py first). Writes web/public/data/battles.json.
"""
import json
from collections import defaultdict
from pathlib import Path
from statistics import median

ROOT = Path(__file__).parent
RAW = ROOT / "raw"
WEB = ROOT.parent / "web" / "public" / "data"


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
    for (year, team), matchups in sorted(pairs.items()):
        entries = []
        for (a, b), rounds in matchups.items():
            gaps = [r["gap"] for r in rounds if r["gap"] is not None]
            entries.append({
                "drivers": [{"code": a, "name": people.get(a, a)}, {"code": b, "name": people.get(b, b)}],
                "score": [sum(r["winner"] == a for r in rounds), sum(r["winner"] == b for r in rounds)],
                "medianGap": round(median(gaps), 3) if gaps else None,
                "rounds": rounds,
            })
        # The pairing that raced together most often first (the team's main line-up).
        entries.sort(key=lambda e: -len(e["rounds"]))
        out["seasons"].setdefault(str(year), []).append({"team": team, "colour": teams[(year, team)], "pairs": entries})
    for year in out["seasons"]:
        out["seasons"][year].sort(key=lambda t: t["team"])
    (WEB / "battles.json").write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    n = sum(len(p["rounds"]) for ts in out["seasons"].values() for t in ts for p in t["pairs"])
    print(f"battles: {sum(len(v) for v in out['seasons'].values())} team seasons, {n} head-to-head rounds")


if __name__ == "__main__":
    main()
