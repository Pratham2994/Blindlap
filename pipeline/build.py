"""Process each downloaded session into laps + per-corner features, saved to build/<sk>.pkl."""
import pickle
import sys
from pathlib import Path

import numpy as np

from features import corner_class, corner_features, corner_zones, normalise
from track import RAW, build_lap, driver_channels, driver_positions, load, push_laps, session_centreline

OUT = Path(__file__).parent / "build"


def detect_corners(lap, min_drop=25.0, min_gap=160.0):
    """Corners as speed minima that follow a real slowdown, numbered in lap order. This finds every
    corner the driver brakes or lifts for; flat-out kinks are not corners for our features anyway."""
    s, v = lap.s, lap.speed
    found = []
    for i in range(1, len(v) - 1):
        if not (v[i] <= v[i - 1] and v[i] < v[i + 1]):
            continue
        before = v[max(0, i - 25):i]
        if before.size and before.max() - v[i] >= min_drop:
            if found and s[i] - found[-1][1] < min_gap:
                if v[i] < found[-1][2]:
                    found[-1] = (0, float(s[i]), float(v[i]))
                continue
            found.append((0, float(s[i]), float(v[i])))
    return [(k + 1, si, 0.0) for k, (_, si, _) in enumerate(found)]


def process(sk: int):
    session = load(sk, "session")
    laps = load(sk, "laps")
    circuit = load(sk, "circuit")
    drivers = {d["driver_number"]: d for d in load(sk, "drivers")}
    if not laps:
        print(f"skip {sk}: no lap timing")
        return
    if not isinstance(circuit, dict):
        circuit = {}
    cl, ref = session_centreline(sk, laps)
    if cl is None:
        print(f"skip {sk}: no clean reference lap")
        return

    built = []
    cache = {}
    for lap in push_laps(laps):
        n = lap["driver_number"]
        if n not in drivers:
            continue
        if n not in cache:
            cache[n] = (driver_channels(sk, n), driver_positions(sk, n))
        ch, pos = cache[n]
        if ch is None or pos is None:
            continue
        b = build_lap(cl, ch, pos, lap)
        if b is not None:
            built.append(b)
    if len(built) < 20:
        print(f"skip {sk}: only {len(built)} usable laps")
        return

    if circuit.get("corners"):
        corner_xy = np.array([[c["trackPosition"]["x"], c["trackPosition"]["y"]] for c in circuit["corners"]]) / 10
        corner_s = cl.project2d(corner_xy)
        # Keep the letter of split corners (1 and 1A at Hungaroring) so labels stay unique.
        marks = [(f'{c["number"]}{c.get("letter") or ""}', float(s), c["angle"]) for c, s in zip(circuit["corners"], corner_s)]
    else:
        # New circuits may not have a published corner map yet: find corners from the fastest lap.
        marks = detect_corners(min(built, key=lambda b: b.lap_time))
        circuit["cornersDetected"] = True
        print(f"  {sk}: no corner map, detected {len(marks)} corners from speed")
    zones = corner_zones(marks, cl.length)

    raw = np.stack([[corner_features(b, z) for z in zones] for b in built])  # laps x corners x F
    z, med, scale, braked = normalise(raw)
    classes = [corner_class(med[i, 3]) for i in range(len(zones))]

    data = dict(
        session=session, drivers=drivers, circuit=circuit, ref=ref,
        centreline=dict(length=cl.length, xyz=cl.xyz), zones=zones, classes=classes,
        laps=built, raw=raw, z=z, med=med, scale=scale, braked=braked,
    )
    OUT.mkdir(exist_ok=True)
    (OUT / f"{sk}.pkl").write_bytes(pickle.dumps(data))
    print(f"built {sk} {session['circuit_short_name']}: {len(built)} laps, {len(zones)} corners, "
          f"{len({b.driver for b in built})} drivers, length {cl.length:.0f} m", flush=True)


def main():
    keys = [int(a) for a in sys.argv[1:]] or sorted(int(p.name) for p in RAW.iterdir() if (p / "circuit.json").exists())
    for sk in keys:
        try:
            process(sk)
        except Exception as e:  # one bad session should not stop the season
            print(f"fail {sk}: {e!r}")


if __name__ == "__main__":
    main()
