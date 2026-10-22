"""Sanity checks on the exported web data. Run after export.py; exits non-zero on any failure.

These are the invariants the browser relies on: laps that move forward, corners in lap order, model
weights that match the feature layout, and no values a real car could not produce.
"""
import json
import math
import sys
from pathlib import Path

DATA = Path(__file__).parent.parent / "web" / "public" / "data"
problems: list[str] = []


def check(cond: bool, msg: str):
    if not cond:
        problems.append(msg)


def main():
    index = json.loads((DATA / "index.json").read_text())
    nf = len(index["features"])
    dims = nf * len(index["cornerClasses"])
    check(index["tau"] > 0, "temperature must be positive")
    laps_total = 0
    for summary in index["sessions"]:
        sk = summary["key"]
        s = json.loads((DATA / "sessions" / f"{sk}.json").read_text())
        name = f"{s['circuit']} {s['date'][:4]}"
        corners = [c["s"] for c in s["corners"]]
        check(corners == sorted(corners), f"{name}: corners not in lap order")
        check(len(s["corners"]) >= 5, f"{name}: only {len(s['corners'])} corners")
        W, b, classes = s["model"]["W"], s["model"]["b"], s["model"]["classes"]
        check(len(W) == len(b) == len(classes), f"{name}: weight rows do not match classes")
        check(all(len(row) == dims for row in W), f"{name}: weights are not {dims} wide")
        check(len(s["track"]["x"]) * s["track"]["step"] <= s["length"] + s["track"]["step"], f"{name}: track longer than lap")
        drivers = {d["code"] for d in s["drivers"].values()}
        for lap in s["laps"]:
            laps_total += 1
            tag = f"{name} {lap['code']} lap {lap['lapNumber']}"
            check(lap["code"] in drivers, f"{tag}: driver not in session")
            check(lap["code"] in classes, f"{tag}: driver unknown to the model")
            check(all(a <= b for a, b in zip(lap["t"], lap["t"][1:])), f"{tag}: time goes backwards")
            check(all(a <= b + 0.5 for a, b in zip(lap["s"], lap["s"][1:])), f"{tag}: distance goes backwards")
            check(abs(lap["t"][-1] - lap["lapTime"]) < 2, f"{tag}: samples end {lap['t'][-1]:.1f}s, lap is {lap['lapTime']:.1f}s")
            check(0 <= min(lap["v"]) and max(lap["v"]) < 380, f"{tag}: speed out of range")
            check(max(lap["rpm"]) < 15500, f"{tag}: rpm out of range")
            check(len(lap["z"]) == len(s["corners"]) and all(len(r) == nf for r in lap["z"]), f"{tag}: feature shape")
            check(all(math.isfinite(v) and abs(v) <= 4 for r in lap["z"] for v in r), f"{tag}: z-score not finite or unclipped")
    report = json.loads((DATA / "report.json").read_text())
    lr = report["logreg"]
    check(lr["top1"] > 2 * lr["chance"], "model is not clearly better than chance")
    check(sum(map(sum, lr["confusion"])) == lr["laps"], "confusion matrix does not add up to the laps scored")
    dna = json.loads((DATA / "dna.json").read_text())
    check(all(len(d["pos"]) == 3 for d in dna["drivers"]), "DNA positions must be 3D")

    print(f"checked {len(index['sessions'])} sessions, {laps_total} laps")
    if problems:
        print(f"{len(problems)} problems:")
        for p in problems[:40]:
            print("  -", p)
        sys.exit(1)
    print("all checks passed")


if __name__ == "__main__":
    main()
