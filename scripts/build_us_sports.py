#!/usr/bin/env python3
"""Build NBA, NFL, and MLB summaries.

NFL is re-downloaded from nflverse. NBA is re-downloaded from the two public
Kaggle files (no login; KAGGLE_USERNAME and KAGGLE_KEY are an optional
fallback). MLB is read from the frozen file data/mlb/games.json. Pass
--rebuild-mlb to download the static archives once and rewrite that file.
This script does not scrape pages and does not run the MLB odds scraper.

Soccer outputs are not touched. summary.json schemaVersion 1 stays as it is.
"""

from __future__ import annotations

import base64
import csv
import io
import json
import os
import statistics
import sys
import urllib.error
import urllib.request
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

from us_markets import (
    JUICE_110,
    MLB_NAMES,
    NBA_NAMES,
    NFL_NAMES,
    AtsSplit,
    MoneylineSplit,
    add_two_way_market,
    american_to_decimal,
    canonical_mlb,
    canonical_nba,
    canonical_nba_mgm,
    canonical_nfl,
    empty_prob_buckets,
    favorite_side,
    finalize_prob_buckets,
    grade_ats,
    grade_moneyline,
    merge_ats,
    merge_moneyline,
    slugify,
)

ROOT = Path(__file__).resolve().parents[1]
CACHE = Path(os.environ.get("US_CACHE", ROOT / ".cache" / "us-sports"))
PUBLIC = ROOT / "web" / "public" / "data"
MLB_GAMES = ROOT / "data" / "mlb" / "games.json"

NFL_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"
NBA_PAGE = "cviaxmiwnptr/nba-betting-data-october-2007-to-june-2024"
MGM_PAGE = "caseydurfee/mgm-grand-nba-betting-data"
MLB_RELEASE = "https://github.com/ArnavSaraogi/mlb-odds-scraper/releases/download/dataset/mlb_odds_dataset.json"
SBR_TEMPLATE = (
    "https://www.sportsbookreviewsonline.com/wp-content/uploads/"
    "sportsbookreviewsonline_com_737/mlb-odds-{year}.xlsx"
)
MLB_RELEASE_START = "2021-04-01"
MLB_GAP_AFTER = "2025-08-16"
NBA_ML_GAP_FROM = "2026-02-13"

USER_AGENT = "investigacion-deportiva-historica"


def fetch(url: str, dest: Path, kaggle: bool = False) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0:
        return
    print(f"download {url}")
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            dest.write_bytes(response.read())
        return
    except urllib.error.HTTPError:
        if not kaggle:
            raise
    user = os.environ.get("KAGGLE_USERNAME", "")
    key = os.environ.get("KAGGLE_KEY", "")
    if not user or not key:
        raise SystemExit(
            f"Download failed for {url}. Set KAGGLE_USERNAME and KAGGLE_KEY to use the API fallback."
        )
    token = base64.b64encode(f"{user}:{key}".encode()).decode()
    request = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Authorization": f"Basic {token}"},
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        dest.write_bytes(response.read())


def kaggle_csv(slug: str, member: str) -> Path:
    dest_zip = CACHE / f"{slug.split('/')[-1]}.zip"
    dest_csv = CACHE / member
    if not dest_csv.exists():
        fetch(
            f"https://www.kaggle.com/api/v1/datasets/download/{slug}",
            dest_zip,
            kaggle=True,
        )
        with zipfile.ZipFile(dest_zip) as archive:
            dest_csv.write_bytes(archive.read(member))
    return dest_csv


def blank(value) -> bool:
    return value is None or str(value).strip() == ""


def as_int(value):
    if blank(value):
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def as_float(value):
    if blank(value):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number:
        return None
    return number


def median_decimal(values: list[float]) -> float | None:
    if not values:
        return None
    return round(float(statistics.median(values)), 3)


def new_game(**kwargs) -> dict:
    return kwargs


def load_nfl() -> tuple[list[dict], dict]:
    path = CACHE / "games.csv"
    fetch(NFL_URL, path)
    games = []
    scheduled = Counter()
    with path.open(newline="") as handle:
        for row in csv.DictReader(handle):
            season = int(row["season"])
            phase = "regular" if row["game_type"] == "REG" else "playoff"
            scheduled[(season, phase)] += 1
            home_score = as_int(row["home_score"])
            away_score = as_int(row["away_score"])
            if home_score is None or away_score is None:
                continue
            home_ml = american_to_decimal(row["home_moneyline"])
            away_ml = american_to_decimal(row["away_moneyline"])
            if home_ml is None or away_ml is None:
                home_ml = away_ml = None
                source = None
            else:
                source = "nflverse"
            spread = as_float(row["spread_line"])
            if spread is None:
                home_spread = away_price = home_price = None
            else:
                home_spread = spread
                home_price = american_to_decimal(row["home_spread_odds"]) or JUICE_110
                away_price = american_to_decimal(row["away_spread_odds"]) or JUICE_110
            games.append(
                new_game(
                    date=row["gameday"],
                    season=season,
                    phase=phase,
                    away=canonical_nfl(row["away_team"]),
                    home=canonical_nfl(row["home_team"]),
                    away_score=away_score,
                    home_score=home_score,
                    away_ml=away_ml,
                    home_ml=home_ml,
                    ml_source=source,
                    home_spread=home_spread,
                    away_spread_odds=away_price,
                    home_spread_odds=home_price,
                )
            )
    return games, {"scheduled": scheduled}


def load_mgm() -> dict[tuple[str, str, str], dict]:
    path = kaggle_csv(MGM_PAGE, "all_odds.csv")
    index: dict[tuple[str, str, str], dict] = {}
    with path.open(newline="") as handle:
        for row in csv.DictReader(handle):
            away = canonical_nba_mgm(row["away_team"])
            home = canonical_nba_mgm(row["home_team"])
            date = row["game_date"][:10]
            home_ml = as_float(row["money_home_decimal_odds"]) or american_to_decimal(row["money_home_odds"])
            away_ml = as_float(row["money_away_decimal_odds"]) or american_to_decimal(row["money_away_odds"])
            if home_ml is None or away_ml is None or home_ml <= 1 or away_ml <= 1:
                continue
            index[(date, away, home)] = {"away_ml": round(away_ml, 3), "home_ml": round(home_ml, 3)}
    return index


def load_nba(mgm: dict) -> list[dict]:
    path = kaggle_csv(NBA_PAGE, "nba_2008-2026.csv")
    games = []
    with path.open(newline="") as handle:
        for row in csv.DictReader(handle):
            home_score = as_int(row["score_home"])
            away_score = as_int(row["score_away"])
            if home_score is None or away_score is None:
                continue
            if row["playoffs"] == "True":
                phase = "playoff"
            elif row["regular"] == "True":
                phase = "regular"
            else:
                phase = "other"
            away = canonical_nba(row["away"])
            home = canonical_nba(row["home"])
            home_ml = american_to_decimal(row["moneyline_home"])
            away_ml = american_to_decimal(row["moneyline_away"])
            source = None
            if home_ml is not None and away_ml is not None:
                source = "kaggle-cc0"
            else:
                fill = mgm.get((row["date"], away, home))
                if fill:
                    home_ml = fill["home_ml"]
                    away_ml = fill["away_ml"]
                    source = "betmgm"
                else:
                    home_ml = away_ml = None
            spread = as_float(row["spread"])
            favored = (row.get("whos_favored") or "").strip().lower()
            if spread is None or favored not in {"home", "away"}:
                home_spread = None
                home_price = away_price = None
            else:
                home_spread = 0.0 if spread == 0 else (spread if favored == "home" else -spread)
                home_price = away_price = JUICE_110
            # The file's season is the ending year (2008 = 2007-08).
            games.append(
                new_game(
                    date=row["date"],
                    season=int(row["season"]) - 1,
                    phase=phase,
                    away=away,
                    home=home,
                    away_score=away_score,
                    home_score=home_score,
                    away_ml=away_ml,
                    home_ml=home_ml,
                    ml_source=source,
                    home_spread=home_spread,
                    away_spread_odds=away_price,
                    home_spread_odds=home_price,
                )
            )
    return games


def sbr_date(value, year: int) -> str:
    number = int(value)
    month, day = divmod(number, 100)
    return f"{year:04d}-{month:02d}-{day:02d}"


def parse_sbr_year(path: Path, year: int) -> list[dict]:
    import openpyxl

    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    sheet = workbook.active
    rows = list(sheet.iter_rows(values_only=True))
    workbook.close()
    body = [row for row in rows[1:] if row and row[0] is not None and row[3] is not None]
    if len(body) % 2 != 0:
        raise SystemExit(f"{path.name} has an odd number of team rows ({len(body)})")
    games = []
    for index in range(0, len(body), 2):
        first, second = body[index], body[index + 1]
        marks = (first[2], second[2])
        if marks == ("V", "H"):
            visitor, home = first, second
        elif marks == ("H", "V"):
            visitor, home = second, first
        elif marks == ("N", "N"):
            # 2020 bubble listed both clubs as neutral. The first row is the visitor.
            visitor, home = first, second
        else:
            raise SystemExit(f"{path.name} pair {index} has roles {marks}")
        away_score = as_int(visitor[14])
        home_score = as_int(home[14])
        if away_score is None or home_score is None:
            continue
        away_ml = american_to_decimal(visitor[16])
        home_ml = american_to_decimal(home[16])
        if away_ml is None or home_ml is None:
            away_ml = home_ml = None
            source = None
        else:
            source = "sbr-close"
        away_line = as_float(visitor[17])
        home_line = as_float(home[17])
        if home_line is None:
            home_spread = None
            away_price = home_price = None
        else:
            # The sheet stores the side's own number. -1.5 means that side lays 1.5.
            home_spread = -home_line
            home_price = american_to_decimal(home[18]) or JUICE_110
            away_price = american_to_decimal(visitor[18]) or JUICE_110
            if away_line is None:
                away_price = JUICE_110
        games.append(
            new_game(
                date=sbr_date(visitor[0], year),
                season=year,
                phase="regular",
                away=canonical_mlb(str(visitor[3])),
                home=canonical_mlb(str(home[3])),
                away_score=away_score,
                home_score=home_score,
                away_ml=away_ml,
                home_ml=home_ml,
                ml_source=source,
                home_spread=home_spread,
                away_spread_odds=away_price,
                home_spread_odds=home_price,
            )
        )
    return games


def _side_decimals(books: list, odds_key: str) -> list[float]:
    values = []
    for book in books:
        current = book.get("currentLine") or {}
        decimal = american_to_decimal(current.get(odds_key))
        if decimal is not None:
            values.append(decimal)
    return values


def release_local_date(start: str, fallback: str) -> str:
    """US game date. West-coast night games are after midnight UTC."""
    if "T" not in (start or ""):
        return (start or fallback)[:10]
    moment = datetime.fromisoformat(start.replace("Z", "+00:00"))
    if moment.hour < 12:
        moment -= timedelta(days=1)
    return moment.date().isoformat()


def parse_release(path: Path) -> list[dict]:
    payload = json.loads(path.read_text())
    games = []
    for day in sorted(payload):
        for item in payload[day]:
            view = item.get("gameView") or {}
            game_type = view.get("gameType")
            if game_type not in {"R", "F", "D", "L", "W", "Unknown"}:
                continue
            status = view.get("gameStatusText") or ""
            if not status.startswith("Final"):
                continue
            away_raw = (view.get("awayTeam") or {}).get("shortName") or ""
            home_raw = (view.get("homeTeam") or {}).get("shortName") or ""
            if away_raw in {"AL", "NL"} or home_raw in {"AL", "NL"}:
                continue
            if game_type == "Unknown" and away_raw in {"AL", "NL"}:
                continue
            away_score = as_int(view.get("awayTeamScore"))
            home_score = as_int(view.get("homeTeamScore"))
            if away_score is None or home_score is None:
                continue
            odds = item.get("odds") or {}
            moneylines = odds.get("moneyline") or []
            home_ml = median_decimal(_side_decimals(moneylines, "homeOdds"))
            away_ml = median_decimal(_side_decimals(moneylines, "awayOdds"))
            if home_ml is None or away_ml is None:
                home_ml = away_ml = None
                source = None
            else:
                source = "release-current-median"
            spreads = odds.get("pointspread") or []
            home_lines = []
            home_prices = []
            away_prices = []
            for book in spreads:
                current = book.get("currentLine") or {}
                line = as_float(current.get("homeSpread"))
                if line is not None:
                    home_lines.append(line)
                home_price = american_to_decimal(current.get("homeOdds"))
                away_price = american_to_decimal(current.get("awayOdds"))
                if home_price is not None:
                    home_prices.append(home_price)
                if away_price is not None:
                    away_prices.append(away_price)
            if home_lines:
                # Release homeSpread is negative when home lays runs.
                home_spread = -float(statistics.median(home_lines))
                home_odds = median_decimal(home_prices) or JUICE_110
                away_odds = median_decimal(away_prices) or JUICE_110
            else:
                home_spread = None
                home_odds = away_odds = None
            phase = "playoff" if game_type in {"F", "D", "L", "W"} else "regular"
            date = release_local_date(view.get("startDate") or "", day)
            games.append(
                new_game(
                    date=date,
                    season=int(date[:4]),
                    phase=phase,
                    away=canonical_mlb(away_raw),
                    home=canonical_mlb(home_raw),
                    away_score=away_score,
                    home_score=home_score,
                    away_ml=away_ml,
                    home_ml=home_ml,
                    ml_source=source,
                    home_spread=home_spread,
                    away_spread_odds=away_odds,
                    home_spread_odds=home_odds,
                )
            )
    return games


def rebuild_mlb_games() -> list[dict]:
    sbr_games = []
    for year in range(2010, 2022):
        path = CACHE / "sbr" / f"mlb-odds-{year}.xlsx"
        fetch(SBR_TEMPLATE.format(year=year), path)
        sbr_games.extend(parse_sbr_year(path, year))
    release_path = CACHE / "mlb_odds_dataset.json"
    fetch(MLB_RELEASE, release_path)
    release_games = parse_release(release_path)
    release_counts = Counter((game["date"], game["away"], game["home"]) for game in release_games)
    used: Counter = Counter()
    kept = []
    dropped = 0
    for game in sbr_games:
        key = (game["date"], game["away"], game["home"])
        if game["date"] >= MLB_RELEASE_START and used[key] < release_counts[key]:
            used[key] += 1
            dropped += 1
            continue
        kept.append(game)
    kept.extend(release_games)
    kept.sort(key=lambda game: (game["date"], game["away"], game["home"]))
    print(f"MLB sbr {len(sbr_games)} release {len(release_games)} dropped overlap {dropped} kept {len(kept)}")
    MLB_GAMES.parent.mkdir(parents=True, exist_ok=True)
    MLB_GAMES.write_text(json.dumps({"games": kept}, separators=(",", ":")))
    return kept


def load_mlb(rebuild: bool) -> list[dict]:
    if rebuild or not MLB_GAMES.exists():
        if not rebuild and not MLB_GAMES.exists():
            raise SystemExit("data/mlb/games.json is missing. Run with --rebuild-mlb once.")
        return rebuild_mlb_games()
    return json.loads(MLB_GAMES.read_text())["games"]


def _side_result(winner: str, side: str) -> str:
    if winner == "push":
        return "T"
    return "W" if winner == side else "L"


def _ats_outcome(cover_side: str, side: str) -> str:
    if cover_side == "push":
        return "push"
    return "cover" if cover_side == side else "loss"


def summarize(sport: str, games: list[dict], names: dict[str, str], spread_market: str | None, extra: dict) -> dict:
    ml: dict[tuple, dict[str, MoneylineSplit]] = defaultdict(
        lambda: {"overall": MoneylineSplit(), "home": MoneylineSplit(), "away": MoneylineSplit()}
    )
    ats: dict[tuple, dict[str, AtsSplit]] = defaultdict(
        lambda: {
            "overall": AtsSplit(),
            "home": AtsSplit(),
            "away": AtsSplit(),
            "favorite": AtsSplit(),
            "underdog": AtsSplit(),
        }
    )
    buckets: dict[tuple, dict] = defaultdict(empty_prob_buckets)
    calib_games: Counter = Counter()
    calib_overround: dict[tuple, float] = defaultdict(float)
    coverage_games: Counter = Counter()
    coverage_ml: Counter = Counter()
    coverage_spread: Counter = Counter()
    coverage_sources: dict[tuple, Counter] = defaultdict(Counter)
    latest: dict[tuple, str] = {}

    for game in games:
        season = int(game["season"])
        phase = game["phase"]
        key = (season, phase)
        coverage_games[key] += 1
        latest[key] = max(latest.get(key, ""), game["date"])
        winner = grade_moneyline(int(game["home_score"]), int(game["away_score"]))
        home_ml = game.get("home_ml")
        away_ml = game.get("away_ml")
        priced = home_ml is not None and away_ml is not None
        if priced:
            coverage_ml[key] += 1
            if game.get("ml_source"):
                coverage_sources[key][game["ml_source"]] += 1
        for abbrev, side, odds in (
            (game["home"], "home", home_ml if priced else None),
            (game["away"], "away", away_ml if priced else None),
        ):
            result = _side_result(winner, side)
            ledger = ml[(abbrev, season, phase)]
            ledger["overall"].add(result, odds)
            ledger[side].add(result, odds)
        if priced and winner != "push":
            calib_overround[key] += add_two_way_market(buckets[key], float(home_ml), float(away_ml), winner)
            calib_games[key] += 1
        spread = game.get("home_spread")
        if spread_market and spread is not None and game.get("home_spread_odds") and game.get("away_spread_odds"):
            coverage_spread[key] += 1
            cover = grade_ats(int(game["home_score"]), int(game["away_score"]), float(spread))
            fav = favorite_side(float(spread))
            for abbrev, side, odds in (
                (game["home"], "home", float(game["home_spread_odds"])),
                (game["away"], "away", float(game["away_spread_odds"])),
            ):
                outcome = _ats_outcome(cover, side)
                book = ats[(abbrev, season, phase)]
                book["overall"].add(outcome, odds)
                book[side].add(outcome, odds)
                if fav == side:
                    book["favorite"].add(outcome, odds)
                elif fav is not None and fav != side:
                    book["underdog"].add(outcome, odds)

    def calib_block(key: tuple) -> dict:
        slot = buckets[key]
        finalized = finalize_prob_buckets(slot)
        outcomes = sum(row["outcomes"] for row in finalized)
        sum_brier = sum(row["sumBrier"] for row in finalized)
        games_n = calib_games[key]
        over = calib_overround[key]
        return {
            "games": games_n,
            "outcomes": outcomes,
            "sumOverround": round(over, 6),
            "avgOverround": round(over / games_n, 6) if games_n else None,
            "sumBrier": round(sum_brier, 6),
            "brier": round(sum_brier / outcomes, 6) if outcomes else None,
            "buckets": finalized,
        }

    phases = sorted({phase for _, phase in coverage_games})
    seasons = sorted({season for season, _ in coverage_games})
    calibration = {}
    for phase in ("regular", "playoff", "other"):
        if phase not in phases:
            continue
        by_season = []
        for season in seasons:
            if (season, phase) not in coverage_games:
                continue
            block = calib_block((season, phase))
            block["season"] = season
            by_season.append(block)
        # Overall is the sum of the season blocks' raw totals, recomputed from ledgers.
        merged_buckets = empty_prob_buckets()
        games_n = 0
        over = 0.0
        for season in seasons:
            key = (season, phase)
            if key not in coverage_games:
                continue
            games_n += calib_games[key]
            over += calib_overround[key]
            for bid, slot in buckets[key].items():
                dest = merged_buckets[bid]
                dest["outcomes"] += slot["outcomes"]
                dest["wins"] += slot["wins"]
                dest["sumPredicted"] += slot["sumPredicted"]
                dest["sumBrier"] += slot["sumBrier"]
                dest["sumOdds"] += slot["sumOdds"]
        finalized = finalize_prob_buckets(merged_buckets)
        outcomes = sum(row["outcomes"] for row in finalized)
        sum_brier = sum(row["sumBrier"] for row in finalized)
        calibration[phase] = {
            "games": games_n,
            "outcomes": outcomes,
            "sumOverround": round(over, 6),
            "avgOverround": round(over / games_n, 6) if games_n else None,
            "sumBrier": round(sum_brier, 6),
            "brier": round(sum_brier / outcomes, 6) if outcomes else None,
            "buckets": finalized,
            "bySeason": by_season,
        }

    coverage = []
    partial_seasons = set(extra.get("partialSeasons") or [])
    for season, phase in sorted(coverage_games):
        coverage.append(
            {
                "season": season,
                "phase": phase,
                "games": coverage_games[(season, phase)],
                "withMoneyline": coverage_ml[(season, phase)],
                "withSpread": coverage_spread[(season, phase)],
                "moneylineSources": dict(sorted(coverage_sources[(season, phase)].items())),
                "latestDate": latest[(season, phase)],
                "partial": season in partial_seasons,
            }
        )

    teams = []
    for abbrev in sorted(names, key=lambda code: names[code]):
        team_phases = {}
        for phase in ("regular", "playoff", "other"):
            if phase not in phases:
                continue
            season_rows = []
            ml_parts = {"overall": [], "home": [], "away": []}
            ats_parts = {name: [] for name in ("overall", "home", "away", "favorite", "underdog")}
            for season in seasons:
                ledger = ml.get((abbrev, season, phase))
                if ledger is None or ledger["overall"].played == 0:
                    continue
                row = {
                    "season": season,
                    "moneyline": {name: ledger[name].to_dict() for name in ("overall", "home", "away")},
                }
                for name in ml_parts:
                    ml_parts[name].append(ledger[name])
                if spread_market:
                    book = ats[(abbrev, season, phase)]
                    row[spread_market] = {name: book[name].to_dict() for name in ats_parts}
                    for name in ats_parts:
                        ats_parts[name].append(book[name])
                season_rows.append(row)
            block = {
                "moneyline": {
                    name: merge_moneyline(ml_parts[name]).to_dict() for name in ml_parts
                },
                "seasons": season_rows,
            }
            if spread_market:
                block[spread_market] = {
                    name: merge_ats(ats_parts[name]).to_dict() for name in ats_parts
                }
            team_phases[phase] = block
        teams.append(
            {
                "team": names[abbrev],
                "slug": slugify(names[abbrev]),
                "abbrev": abbrev,
                "phases": team_phases,
            }
        )

    return {
        "schemaVersion": 1,
        "sport": sport,
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "spreadMarket": spread_market,
        "credits": extra["credits"],
        "gaps": extra["gaps"],
        "definitions": extra["definitions"],
        "coverage": coverage,
        "calibration": calibration,
        "teams": teams,
    }


def nfl_extra(games: list[dict], meta: dict) -> dict:
    partial = set()
    for (season, _phase), scheduled in meta["scheduled"].items():
        completed = sum(1 for game in games if game["season"] == season)
        if completed < scheduled:
            partial.add(season)
    by_season_ml = Counter()
    by_season_games = Counter()
    for game in games:
        by_season_games[game["season"]] += 1
        if game["ml_source"]:
            by_season_ml[game["season"]] += 1
    return {
        "partialSeasons": sorted(partial),
        "credits": [
            {
                "id": "nflverse",
                "name": "nflverse games.csv",
                "url": NFL_URL,
                "credit": "Game results and closing lines from nflverse (Lee Sharpe and contributors), https://github.com/nflverse/nfldata.",
            }
        ],
        "gaps": [
            "No moneyline prices from 1999 through 2005. 2006 is partial. Prices are effectively complete from 2007, with a thinner 2008.",
            "Spreads use nflverse spread_line, which is positive when the home team is favored. Home covers when home_score - away_score is greater than spread_line. A missing spread price is graded at -110 (1.909).",
            "The current season stays partial until every scheduled game has a score. Upcoming games are not graded.",
        ],
        "definitions": {
            "season": "NFL season year. Wild-card through Super Bowl stay in that season, not the calendar year of the game.",
            "phase": "regular is game_type REG. playoff is WC, DIV, CON, and SB.",
            "moneyline": "Flat 1.00 unit at the nflverse closing American price, stored as decimal. A tie is a refund: counted in pushes and ties, excluded from stake and ROI.",
            "ats": "Flat 1.00 unit. Pushes are counted and excluded from stake and ROI. Favorite and underdog follow the spread, not the moneyline. A zero spread is a pick'em and is left out of both.",
            "calibration": "Two-way de-vig p = (1/odds) / ((1/home) + (1/away)). Buckets are 5 percentage points of that probability. Brier score is the mean squared error of those probabilities. Average overround is the mean of (1/home + 1/away - 1) across priced games. Ties are left out.",
            "sampleSize": "played counts final scores. bets counts decided prices. pushes are refunds.",
            "franchise": "OAK is Las Vegas, SD is the Chargers, STL is the Rams. Each relocated club is one franchise.",
        },
        "_ml": (by_season_games, by_season_ml),
    }


def nba_extra(games: list[dict]) -> dict:
    priced = [game["date"] for game in games if game["ml_source"]]
    last_ml = max(priced) if priced else None
    last_game = max(game["date"] for game in games)
    sources = Counter(game["ml_source"] for game in games if game["ml_source"])
    return {
        "partialSeasons": [],
        "credits": [
            {
                "id": "kaggle-cc0",
                "name": "NBA betting data October 2007 to June 2024",
                "url": "https://www.kaggle.com/datasets/cviaxmiwnptr/nba-betting-data-october-2007-to-june-2024",
                "license": "CC0",
                "credit": "Results, spreads, and moneylines through mid 2022-23 from the CC0 Kaggle file nba_2008-2026.csv.",
            },
            {
                "id": "betmgm",
                "name": "MGM Grand NBA betting data",
                "url": "https://www.kaggle.com/datasets/caseydurfee/mgm-grand-nba-betting-data",
                "license": "CC BY-SA 4.0",
                "credit": "BetMGM pregame moneylines, 2021-22 through 2026-02-12, used only where the CC0 file has no moneyline. CC BY-SA 4.0, Casey Durfee.",
            },
        ],
        "gaps": [
            f"Primary moneylines stop during 2022-23. Later prices are BetMGM through {last_ml}. No moneyline from {NBA_ML_GAP_FROM} onward (last completed game in this file: {last_game}).",
            "Spread and total are nearly complete from 2007-08. The spread is the favorite's number of points, alongside whos_favored. There is no spread price in the CC0 file, so every ATS bet is graded at -110 (1.909).",
            "Rows marked neither regular nor playoff (play-in and a handful of cup dates) are the phase 'other', not mixed into the regular season or the playoffs.",
            f"Moneyline rows by source: {dict(sources)}.",
        ],
        "definitions": {
            "season": "Season start year. 2007 means 2007-08. The source file stores the ending year; it is converted here.",
            "phase": "regular, playoff, or other. other is the source rows where both regular and playoffs are false.",
            "moneyline": "Flat 1.00 unit. Source is kaggle-cc0 when the CC0 file has a price, otherwise betmgm. NBA games do not tie. A missing price is not a bet.",
            "ats": "Home spread line is positive when home is favored. Cover rule matches the NFL rule. Price is always 1.909. Pushes are counted and excluded from ROI.",
            "calibration": "Same two-way de-vig, 5-point probability buckets, Brier score, and average overround as the NFL file.",
            "sampleSize": "played, bets, and pushes are separate.",
        },
    }


def mlb_extra(games: list[dict]) -> dict:
    last = max(game["date"] for game in games)
    return {
        "partialSeasons": [2025],
        "credits": [
            {
                "id": "sbr-close",
                "name": "Sportsbook Review online MLB odds archives",
                "url": "https://www.sportsbookreviewsonline.com/scoresoddsarchives/mlb/",
                "credit": "2010-2020 closing moneylines and run lines from the static mlb-odds-YYYY.xlsx archives. Downloaded once and committed as processed games. Not a live scrape.",
            },
            {
                "id": "release-current-median",
                "name": "mlb_odds_dataset.json",
                "url": MLB_RELEASE,
                "credit": "2021-04-01 through 2025-08-16 from the static GitHub release asset only. The scraper's code is not run. Closing price is the median current line across the books in that file.",
            },
        ],
        "gaps": [
            f"Nothing after {MLB_GAP_AFTER}. The last game in the frozen file is {last}. The 2025 season is partial, and 2026 is absent.",
            "2010-2020 archives do not mark the postseason, so those playoff games sit inside the regular-season totals. From 2021-04-01, playoffs are game types F, D, L, and W.",
            "The 2021 overlap is deduped. A release game replaces the archive row with the same date and teams. Spring training and the All-Star game are dropped.",
            "OAK and ATH are one franchise (Athletics). ARI and AZ are the Diamondbacks.",
        ],
        "definitions": {
            "season": "Calendar year of the MLB season.",
            "phase": "regular or playoff. Playoff is reliable only from 2021-04-01.",
            "moneyline": "Flat 1.00 unit at the closing decimal price. A tie would be a refund. Archive source id is sbr-close. Release source id is release-current-median.",
            "runLine": "Optional run line, graded with the same cover rule as ATS after converting the home number so a positive line means home is laying runs. Pushes are refunds. This is not an NFL/NBA ATS market.",
            "calibration": "Two-way moneyline de-vig, 5-point probability buckets, Brier score, and average overround.",
            "sampleSize": "played, bets, and pushes are separate. 2010-2020 regular-season counts include unmarked playoff games.",
        },
    }


def write_summary(sport: str, payload: dict) -> None:
    dest_dir = PUBLIC / sport
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / "summary.json"
    if dest.exists():
        previous = json.loads(dest.read_text())
        previous_at = previous.pop("generatedAt", None)
        current = json.loads(json.dumps(payload))
        current.pop("generatedAt", None)
        if previous == current and previous_at:
            payload["generatedAt"] = previous_at
    dest.write_text(json.dumps(payload, indent=2) + "\n")
    print(
        f"{sport}: teams {len(payload['teams'])} coverage rows {len(payload['coverage'])} -> {dest / 'summary.json'}"
    )


def print_coverage(sport: str, payload: dict) -> None:
    print(f"## {sport}")
    print("season phase games ml spread latest partial")
    for row in payload["coverage"]:
        print(
            f"{row['season']} {row['phase']} {row['games']} {row['withMoneyline']} {row['withSpread']} {row['latestDate']} {row['partial']} {row['moneylineSources']}"
        )


def main() -> None:
    rebuild_mlb = "--rebuild-mlb" in sys.argv
    nfl_games, nfl_meta = load_nfl()
    nba_games = load_nba(load_mgm())
    mlb_games = load_mlb(rebuild_mlb)
    nfl = summarize("nfl", nfl_games, NFL_NAMES, "ats", nfl_extra(nfl_games, nfl_meta))
    nba = summarize("nba", nba_games, NBA_NAMES, "ats", nba_extra(nba_games))
    mlb = summarize("mlb", mlb_games, MLB_NAMES, "runLine", mlb_extra(mlb_games))
    write_summary("nfl", nfl)
    write_summary("nba", nba)
    write_summary("mlb", mlb)
    print_coverage("nfl", nfl)
    print_coverage("nba", nba)
    print_coverage("mlb", mlb)


if __name__ == "__main__":
    main()
