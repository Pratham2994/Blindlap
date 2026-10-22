#!/usr/bin/env bash
# Rebuild every fully downloaded session, retrain, export. Safe to re-run while fetch.py is still going.
set -e
cd "$(dirname "$0")"
PY=.venv/Scripts/python.exe
[ -x "$PY" ] || PY=.venv/bin/python
KEYS=$(grep '^done' fetch.log | awk '{print $2}')
$PY build.py $KEYS 2>&1 | grep -v -e RuntimeWarning -e nanmedian
$PY model.py
$PY export.py
