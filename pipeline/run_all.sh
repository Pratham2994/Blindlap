#!/usr/bin/env bash
# Everything after the download, in order: build new sessions, retrain, export, qualifying
# results, team radio and captions, careers, real surroundings, then the data checks.
# Used by hand and by the weekly update (.github/workflows/data.yml).
# To rebuild every session (after changing features.py or track.py): .venv/Scripts/python.exe build.py
set -e
cd "$(dirname "$0")"
PY=.venv/Scripts/python.exe
[ -x "$PY" ] || PY=.venv/bin/python
[ -x "$PY" ] || PY=python
$PY build.py --new 2>&1 | grep -v -e RuntimeWarning -e nanmedian
$PY model.py
$PY export.py
$PY results.py
# Team radio speech start (needs ffmpeg) and captions (needs faster-whisper); both keep what they
# already know and only process new clips.
if command -v ffmpeg >/dev/null; then
  $PY radio.py
  if $PY -c "import faster_whisper" 2>/dev/null; then $PY captions.py; fi
fi
[ -f raw/f1db/f1db-csv.zip ] && $PY careers.py
$PY align.py
$PY environment.py
$PY check.py
