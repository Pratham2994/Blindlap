"""Carry what the pipeline needs between weekly updates, without the 6 GB of telemetry.

Past sessions only need their build (build/<sk>.pkl) and their small raw files; the car telemetry
is read once, when a session is built. The weekly update (.github/workflows/data.yml) keeps these
on the data-cache branch of this repository:

    build/*.pkl            processed sessions (training reads all of them)
    build/*.skip           sessions that cannot be built, so they are not retried every week
    raw/<sk>/*.json        the small per-session files, no car_data_* or location_*
    raw/osm/, raw/f1db/    map downloads and the career database

  python cache.py unpack <dir>   copy a cache checkout into the pipeline folders
  python cache.py pack <dir>     copy the pipeline folders into a cache checkout
"""
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).parent
SMALL = ("session.json", "drivers.json", "laps.json", "team_radio.json", "weather.json", "circuit.json", "session_result.json")


def pairs(cache: Path):
    """(path in the pipeline, path in the cache) for every carried file."""
    for p in sorted((ROOT / "build").glob("*.pkl")) + sorted((ROOT / "build").glob("*.skip")):
        yield p, cache / "build" / p.name
    for d in sorted((ROOT / "raw").iterdir()):
        if d.is_dir() and d.name.isdigit():
            for name in SMALL:
                if (d / name).exists():
                    yield d / name, cache / "raw" / d.name / name
    for sub in ("osm", "f1db"):
        for p in sorted((ROOT / "raw" / sub).glob("*")) if (ROOT / "raw" / sub).exists() else []:
            yield p, cache / "raw" / sub / p.name


def copy(src: Path, dst: Path) -> bool:
    if dst.exists() and dst.stat().st_size == src.stat().st_size and dst.read_bytes() == src.read_bytes():
        return False
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dst)
    return True


def main():
    if len(sys.argv) != 3 or sys.argv[1] not in ("pack", "unpack"):
        sys.exit(__doc__)
    cache = Path(sys.argv[2]).resolve()
    changed = 0
    if sys.argv[1] == "pack":
        for src, dst in pairs(cache):
            changed += copy(src, dst)
    else:
        for dst in sorted(cache.rglob("*")):
            if dst.is_file() and ".git" not in dst.parts:
                changed += copy(dst, ROOT / dst.relative_to(cache))
    print(f"{sys.argv[1]}: {changed} files copied")


if __name__ == "__main__":
    main()
