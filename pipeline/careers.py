"""Career totals from F1DB for every driver in the game, matched by name (driver codes are reused
across eras, e.g. VER is both Verstappen and Vergne). Writes web/public/data/careers.json."""
import csv
import io
import json
import unicodedata
import zipfile
from pathlib import Path

ROOT = Path(__file__).parent
F1DB = ROOT / "raw" / "f1db" / "f1db-csv.zip"
OUT = ROOT.parent / "web" / "public" / "data" / "careers.json"
RELEASE = "v2026.17.0"


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return "".join(ch for ch in s.lower() if ch.isalpha())


def main():
    z = zipfile.ZipFile(F1DB)
    rows = list(csv.DictReader(io.TextIOWrapper(z.open("f1db-drivers.csv"), encoding="utf-8")))
    countries = {r["id"]: r["name"] for r in csv.DictReader(io.TextIOWrapper(z.open("f1db-countries.csv"), encoding="utf-8"))}
    by_name = {(norm(r["firstName"]), norm(r["lastName"])): r for r in rows}

    # Every driver code that appears in the exported game data.
    index = json.loads((OUT.parent / "index.json").read_text())
    people = {}
    for s in index["sessions"]:
        sess = json.loads((ROOT / "raw" / str(s["key"]) / "drivers.json").read_text())
        for d in sess:
            people[d["name_acronym"]] = (d["first_name"], d["last_name"])

    out = {}
    for code, (first, last) in sorted(people.items()):
        r = by_name.get((norm(first), norm(last)))
        if r is None:  # fall back to surname plus code, e.g. different first-name spellings
            r = next((x for x in rows if norm(x["lastName"]).startswith(norm(last)) and x["abbreviation"] == code), None)
        if r is None:
            print(f"no F1DB match for {code} {first} {last}")
            continue
        out[code] = {
            "id": r["id"],
            "born": r["dateOfBirth"],
            "nationality": countries.get(r["nationalityCountryId"], r["nationalityCountryId"]),
            "starts": int(r["totalRaceStarts"] or 0),
            "wins": int(r["totalRaceWins"] or 0),
            "podiums": int(r["totalPodiums"] or 0),
            "poles": int(r["totalPolePositions"] or 0),
            "titles": int(r["totalChampionshipWins"] or 0),
        }
    OUT.write_text(json.dumps({"source": f"F1DB {RELEASE}", "drivers": out}, separators=(",", ":")))
    print(f"careers: {len(out)} drivers matched")


if __name__ == "__main__":
    main()
