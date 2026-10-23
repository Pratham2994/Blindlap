"""Find where speech starts in every team radio clip the game uses.

F1 radio clips often open with seconds of digital silence (one Monza clip starts with 2.8 s of
nothing), so playing them from 0 sounds like the clip is broken. This downloads each clip once
(cached in raw/radio/), asks ffmpeg where the first silence ends, and writes
web/public/data/radio.json: {url: {"start": seconds, "duration": seconds}}. Requires ffmpeg.
"""
import glob
import hashlib
import json
import re
import subprocess
import time
from pathlib import Path

import requests

ROOT = Path(__file__).parent
CACHE = ROOT / "raw" / "radio"
DATA = ROOT.parent / "web" / "public" / "data"


def speech_window(path: Path) -> tuple[float, float]:
    out = subprocess.run(
        ["ffmpeg", "-hide_banner", "-i", str(path), "-af", "silencedetect=noise=-50dB:d=0.25", "-f", "null", "-"],
        capture_output=True, text=True,
    ).stderr
    dur = re.search(r"Duration: (\d+):(\d+):([\d.]+)", out)
    duration = int(dur.group(1)) * 3600 + int(dur.group(2)) * 60 + float(dur.group(3)) if dur else 0.0
    start = 0.0
    first = re.search(r"silence_start: ([\d.]+)", out)
    if first and float(first.group(1)) < 0.05:
        end = re.search(r"silence_end: ([\d.]+)", out)
        if end:
            start = float(end.group(1))
    # Leave a breath before the first word.
    return max(0.0, start - 0.15), duration


def main():
    urls = sorted({
        lap["radio"]
        for f in glob.glob(str(DATA / "sessions" / "*.json"))
        for lap in json.loads(Path(f).read_text())["laps"]
        if lap["radio"]
    })
    CACHE.mkdir(parents=True, exist_ok=True)
    out = {}
    for k, url in enumerate(urls):
        path = CACHE / (hashlib.sha1(url.encode()).hexdigest()[:16] + ".mp3")
        if not path.exists():
            r = requests.get(url, timeout=60)
            if r.status_code != 200:
                print(f"skip {url}: {r.status_code}")
                continue
            path.write_bytes(r.content)
            time.sleep(0.2)
        start, duration = speech_window(path)
        out[url] = {"start": round(start, 2), "duration": round(duration, 2)}
        if k % 50 == 0:
            print(f"{k}/{len(urls)}", flush=True)
    (DATA / "radio.json").write_text(json.dumps(out, separators=(",", ":")))
    late = sum(1 for v in out.values() if v["start"] > 1)
    print(f"radio: {len(out)} clips, {late} start with more than 1 s of silence")


if __name__ == "__main__":
    main()
