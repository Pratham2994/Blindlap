"""Process each downloaded session into laps + per-corner features, saved to build/<sk>.pkl."""
import pickle
import sys
from pathlib import Path

import numpy as np

from features import corner_class, corner_features, corner_zones, normalise
from track import RAW, build_lap, driver_channels, driver_positions, load, push_laps, session_centreline

OUT = Path(__file__).parent / "build"


def process(sk: int):
    session = load(sk, "session")
    laps = load(sk, "laps")
    circuit = load(sk, "circuit")
    drivers = {d["driver_number"]: d for d in load(sk, "drivers")}
    if not laps or not circuit or not circuit.get("corners"):
        print(f"skip {sk}: missing laps or circuit")
        return
    cl, ref = session_centreline(sk, laps)
    if cl is None:
        print(f"skip {sk}: no clean reference lap")
        return

    corner_xy = np.array([[c["trackPosition"]["x"], c["trackPosition"]["y"]] for c in circuit["corners"]]) / 10
    corner_s = cl.project2d(corner_xy)
    zones = corner_zones([(c["number"], float(s), c["angle"]) for c, s in zip(circuit["corners"], corner_s)], cl.length)

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
