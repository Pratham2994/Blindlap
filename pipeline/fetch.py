"""Download raw 2025 qualifying data from OpenF1 and corner maps from MultiViewer.

Everything lands in raw/<session_key>/ as plain JSON so later steps never touch the network.
Re-running skips files that already exist.
"""
import json
import sys
import time
from pathlib import Path

import requests

OPENF1 = "https://api.openf1.org/v1/"
MULTIVIEWER = "https://api.multiviewer.app/api/v1/circuits/{key}/{year}"
RAW = Path(__file__).parent / "raw"
YEAR = 2025

session = requests.Session()
session.headers["User-Agent"] = "blindlap-pipeline/0.1"
_last_call = 0.0


def get_json(url, params=None, tries=6):
    """GET with a gentle rate limit and backoff on 429/5xx."""
    global _last_call
    for attempt in range(tries):
        wait = 0.4 - (time.time() - _last_call)
        if wait > 0:
            time.sleep(wait)
        _last_call = time.time()
        try:
            r = session.get(url, params=params, timeout=90)
        except requests.RequestException as e:
            print(f"  network error {e!r}, retry {attempt}")
            time.sleep(2 + attempt * 3)
            continue
        if r.status_code == 200:
            return r.json()
        if r.status_code in (429, 500, 502, 503, 504):
            time.sleep(2 + attempt * 4)
            continue
        if r.status_code == 404:
            return []
        r.raise_for_status()
    raise RuntimeError(f"gave up on {url} {params}")


def save(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, separators=(",", ":")))


def fetch_session(s):
    sk = s["session_key"]
    out = RAW / str(sk)
    save(out / "session.json", s)

    drivers_path = out / "drivers.json"
    if not drivers_path.exists():
        save(drivers_path, get_json(OPENF1 + "drivers", {"session_key": sk}))
    drivers = json.loads(drivers_path.read_text())

    for name in ("laps", "team_radio", "weather"):
        p = out / f"{name}.json"
        if not p.exists():
            save(p, get_json(OPENF1 + name, {"session_key": sk}))

    circuit = out / "circuit.json"
    if not circuit.exists():
        save(circuit, get_json(MULTIVIEWER.format(key=s["circuit_key"], year=YEAR)))

    for d in drivers:
        n = d["driver_number"]
        for name in ("car_data", "location"):
            p = out / f"{name}_{n}.json"
            if not p.exists():
                save(p, get_json(OPENF1 + name, {"session_key": sk, "driver_number": n}))
    print(f"done {sk} {s['circuit_short_name']} ({len(drivers)} drivers)", flush=True)


def main():
    sessions = get_json(OPENF1 + "sessions", {"year": YEAR, "session_name": "Qualifying"})
    only = set(sys.argv[1:])
    for s in sessions:
        if only and s["circuit_short_name"] not in only:
            continue
        fetch_session(s)


if __name__ == "__main__":
    main()
