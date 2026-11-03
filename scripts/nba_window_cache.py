#!/usr/bin/env python3
"""Cache per-game NBA box scores for season-window ratings.

Downloads the sportsdataverse team box CSVs (ending years 2018-2027) and
writes a slim game list under .cache/nba-sim/window-games.json. The raw
CSVs stay in the cache. The site does not read this file.
"""

from __future__ import annotations

import csv
import json
import urllib.request
from pathlib import Path

from nba_factors import ESPN_TO_NBA, PHASE_BY_SEASON_TYPE, box_from_row

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".cache" / "nba-sim" / "boxes"
OUT = ROOT / ".cache" / "nba-sim" / "window-games.json"
URL = (
    "https://github.com/sportsdataverse/sportsdataverse-data/releases/download/"
    "espn_nba_team_boxscores/team_box_{season}.csv"
)
YEARS = range(2018, 2028)


def download(season: int) -> Path | None:
    dest = CACHE / f"team_box_{season}.csv"
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    print(f"download {season}")
    try:
        request = urllib.request.Request(URL.format(season=season), headers={"User-Agent": "investigacion-deportiva-historica"})
        with urllib.request.urlopen(request, timeout=120) as response:
            data = response.read()
    except Exception as error:  # noqa: BLE001
        print(f"  skip {season}: {error}")
        return None
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return dest


def main() -> None:
    paired: dict[str, dict] = {}
    for ending in YEARS:
        path = download(ending)
        if path is None:
            continue
        with path.open(newline="") as handle:
            for row in csv.DictReader(handle):
                phase = PHASE_BY_SEASON_TYPE.get(str(row.get("season_type")))
                if phase != "regular":
                    continue
                abbrev = (row.get("team_abbreviation") or "").strip()
                code = ESPN_TO_NBA.get(abbrev)
                if code is None:
                    continue
                box = box_from_row(row)
                if box is None:
                    continue
                try:
                    points = int(float(row.get("team_score") or ""))
                except ValueError:
                    continue
                game_id = str(row.get("game_id") or "").strip()
                if not game_id:
                    continue
                slot = paired.setdefault(
                    game_id,
                    {
                        "id": game_id,
                        "date": (row.get("game_date") or "")[:10],
                        "season": ending - 1,
                    },
                )
                side = (row.get("team_home_away") or "").strip().lower()
                if side not in {"home", "away"}:
                    continue
                slot[side] = code
                slot[f"{side}Score"] = points
                slot[f"{side}Box"] = box
    games = []
    for slot in paired.values():
        if not all(key in slot for key in ("home", "away", "homeBox", "awayBox", "homeScore", "awayScore", "date")):
            continue
        games.append(slot)
    games.sort(key=lambda game: (game["date"], game["id"]))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"games": games}))
    print(f"wrote {len(games)} games -> {OUT}")


if __name__ == "__main__":
    main()
