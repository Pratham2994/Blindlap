"""The home page's broadcast files: each session with only its fastest lap and no model scores.

The home page shows one circuit and its fastest lap, so it should not wait for a whole session file
(every driver's laps and every model's corner scores: about 240 KB compressed). These are about
15 KB. The game itself still loads the full session.

Run after export.py: .venv/Scripts/python.exe home.py   (writes web/public/data/home/<key>.json)
"""
import json
from pathlib import Path

WEB = Path(__file__).parent.parent / "web" / "public" / "data"


def main():
    out = WEB / "home"
    out.mkdir(exist_ok=True)
    index = json.loads((WEB / "index.json").read_text(encoding="utf-8"))
    for s in index["sessions"]:
        session = json.loads((WEB / "sessions" / f"{s['key']}.json").read_text(encoding="utf-8"))
        fastest = min(session["laps"], key=lambda lap: lap["lapTime"])
        session["laps"] = [{k: v for k, v in fastest.items() if k not in ("steps", "radio")}]
        session["drivers"] = {}
        (out / f"{s['key']}.json").write_text(json.dumps(session, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    print(f"home: {len(index['sessions'])} broadcast files")


if __name__ == "__main__":
    main()
