"""Transcribe every team radio clip into timed captions with Whisper (faster-whisper, run locally).

Reads the clips radio.py cached in raw/radio/ and adds "lines": [{"t0", "t1", "text"}] to each
entry of web/public/data/radio.json. Radio audio is band-limited and noisy, so the transcript is a
best effort; the page labels it as automatic.
"""
import hashlib
import json
from pathlib import Path

from faster_whisper import WhisperModel

ROOT = Path(__file__).parent
CACHE = ROOT / "raw" / "radio"
RADIO = ROOT.parent / "web" / "public" / "data" / "radio.json"
# F1 words Whisper tends to mishear on radio, nudged with an initial prompt.
PROMPT = "Formula One team radio. Box box. Copy. Lap. Tyres. P1. Pole. Quali. Push. Delta. Mode. Battery."


def main():
    radio = json.loads(RADIO.read_text())
    model = WhisperModel("small.en", device="cpu", compute_type="int8")
    for k, (url, entry) in enumerate(radio.items()):
        if "lines" in entry:
            continue
        path = CACHE / (hashlib.sha1(url.encode()).hexdigest()[:16] + ".mp3")
        if not path.exists():
            continue
        segments, _ = model.transcribe(str(path), language="en", beam_size=1, vad_filter=True,
                                       initial_prompt=PROMPT, condition_on_previous_text=False)
        entry["lines"] = [
            {"t0": round(s.start, 2), "t1": round(s.end, 2), "text": s.text.strip()}
            for s in segments
            if s.text.strip() and s.no_speech_prob < 0.6
        ]
        if k % 25 == 0:
            print(f"{k}/{len(radio)}: {' / '.join(l['text'] for l in entry['lines'])[:90]}", flush=True)
            RADIO.write_text(json.dumps(radio, separators=(",", ":")))
    RADIO.write_text(json.dumps(radio, separators=(",", ":")))
    print(f"captions: {sum(1 for e in radio.values() if e.get('lines'))} of {len(radio)} clips have text")


if __name__ == "__main__":
    main()
