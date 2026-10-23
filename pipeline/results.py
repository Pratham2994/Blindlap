"""Qualifying context for the reveal: which part of qualifying (Q1, Q2, Q3) each game lap was set
in, and where its driver finished.

OpenF1's session_result gives each driver's final position and best time in Q1, Q2 and Q3. Laps
carry no segment, so the segment boundaries are found from the laps themselves: every driver's best
Q1 lap must start before every best Q2 lap, and so on. Between the last best Q1 lap and the first
best Q2 lap, the boundary is the longest pause in lap starts (the break between segments).

Run after export.py: .venv/Scripts/python.exe results.py   (writes web/public/data/results.json)
"""
import json
from datetime import datetime
from pathlib import Path

from fetch import OPENF1, get_json, save

ROOT = Path(__file__).parent
RAW = ROOT / "raw"
WEB = ROOT.parent / "web" / "public" / "data"


def ts(s: str) -> float:
    return datetime.fromisoformat(s).timestamp()


def boundaries(laps, results):
    """Start times that split the session into Q1 | Q2 | Q3, or [] when they cannot be found."""
    timed = [l for l in laps if l.get("lap_duration") and l.get("date_start")]
    starts = sorted(ts(l["date_start"]) for l in timed)
    anchors = {0: [], 1: [], 2: []}
    for r in results:
        for q, best in enumerate(r.get("duration") or []):
            if not best:
                continue
            hit = [l for l in timed if l["driver_number"] == r["driver_number"] and abs(l["lap_duration"] - best) < 0.0015]
            if hit:
                anchors[q].append(ts(hit[0]["date_start"]))
    # Laps by drivers knocked out before segment q+1 must all start before the cut into it. This
    # keeps a red-flag pause inside Q1 (Suzuka 2025) from being taken for the break.
    # The last segment with a time is the one reached (a missing earlier time is a data gap).
    reached = {r["driver_number"]: max((i + 1 for i, d in enumerate(r.get("duration") or []) if d), default=0) for r in results}
    out_before = {q: [ts(l["date_start"]) for l in timed if reached.get(l["driver_number"], 3) <= q + 1] for q in (0, 1)}
    # Candidate cuts: the middle of every pause of more than a minute between lap starts. Each cut
    # is scored by how many laps it puts on the wrong side (a vote, so one odd match cannot break
    # it); ties go to the longest pause.
    pauses = [((a + b) / 2, b - a) for a, b in zip(starts, starts[1:]) if b - a > 60]
    out = []
    for q in (0, 1):
        if not anchors[q] or not anchors[q + 1]:
            return out
        after = out[-1] if out else -1
        options = [(sum(t >= c for t in anchors[q]) + sum(t < c for t in anchors[q + 1]) + sum(t >= c for t in out_before[q]),
                    -gap, c)
                   for c, gap in pauses if c > after]
        if not options:
            return out
        out.append(min(options)[2])
    return out


def main():
    index = json.loads((WEB / "index.json").read_text(encoding="utf-8"))
    out = {}
    for s in index["sessions"]:
        sk = s["key"]
        path = RAW / str(sk) / "session_result.json"
        if not path.exists():
            save(path, get_json(OPENF1 + "session_result", {"session_key": sk}))
        results = json.loads(path.read_text())
        laps = json.loads((RAW / str(sk) / "laps.json").read_text())
        cuts = boundaries(laps, results)
        start = {(l["driver_number"], l["lap_number"]): ts(l["date_start"]) for l in laps if l.get("date_start")}
        game = json.loads((WEB / "sessions" / f"{sk}.json").read_text(encoding="utf-8"))
        drivers = {}
        reached = {}
        for r in results:
            status = "dsq" if r.get("dsq") else "dns" if r.get("dns") else "dnf" if r.get("dnf") else None
            drivers[str(r["driver_number"])] = {"pos": r.get("position"), "best": r.get("duration"), "status": status}
            reached[r["driver_number"]] = max((i + 1 for i, d in enumerate(r.get("duration") or []) if d), default=3)
        segments = {}
        capped = 0
        for lap in game["laps"]:
            t = start.get((lap["driver"], lap["lapNumber"]))
            if t is None or len(cuts) != 2:
                continue
            q = 1 + sum(t >= c for c in cuts)
            # A lap cannot be in a segment its driver never reached. The cut lands on the wrong side
            # of a few laps, all faster than the driver's official best (deleted for track limits).
            if q > reached.get(lap["driver"], 3):
                q = reached[lap["driver"]]
                capped += 1
            segments[lap["id"]] = f"Q{q}"
        if capped:
            print(f"   {capped} laps moved back to the last segment their driver reached")
        out[str(sk)] = {"segments": segments, "drivers": drivers}
        print(f"{sk} {s['circuit']:>16} {s['date'][:4]}: {len(results)} results, "
              f"{'boundaries found' if len(cuts) == 2 else 'NO boundaries'}, {len(segments)}/{len(game['laps'])} laps labelled")
    (WEB / "results.json").write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print("wrote", WEB / "results.json")


if __name__ == "__main__":
    main()
