#!/usr/bin/env python3
"""Download league results and closing odds, then write the app datasets.

Sources
-------
football-data.co.uk season files for E0, SP1, D1, I1, F1, N1, P1
(2000/01 through the current season), plus the all-season Liga MX file
at /new/MEX.csv. openfootball/mexico is not published anymore (the GitHub
repo 404s); Liga MX therefore starts in 2012/13, which is as far back as
football-data's Mexico file goes. Odds there are often present.

Outputs (paths are relative to the repo root, next to this script's parent)
-----------------------------------------------------------------------
- canvases/season-data.json
- web/public/data/season-data.json
- web/public/data/matches.json
- web/public/data/summary.json
- web/public/data/coverage.json

Set FD_CACHE to a directory to reuse already downloaded CSVs.
"""

from __future__ import annotations

import csv
import io
import json
import os
import sys
import urllib.error
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

from metrics import (
    Split,
    add_market_to_calibration,
    combine_splits,
    empty_bucket_accumulators,
    finalize_buckets,
    result_for_side,
    select_closing,
)
from normalize import club_slug, normalize_team

ROOT = Path(__file__).resolve().parent.parent
SEASON_PATHS = [
    ROOT / "canvases" / "season-data.json",
    ROOT / "web" / "public" / "data" / "season-data.json",
]
MATCHES_PATH = ROOT / "web" / "public" / "data" / "matches.json"
SUMMARY_PATH = ROOT / "web" / "public" / "data" / "summary.json"
COVERAGE_PATH = ROOT / "web" / "public" / "data" / "coverage.json"

FIRST_SEASON = 2000


def default_last_season() -> int:
    """Season start year that is underway. Files for a new season appear in August."""
    today = datetime.now(timezone.utc).date()
    return today.year if today.month >= 8 else today.year - 1


# Override with LAST_SEASON=2026 when rebuilding a historical snapshot.
LAST_SEASON = int(os.environ.get("LAST_SEASON", str(default_last_season())))

LEAGUES = {
    "E0": "Premier League",
    "SP1": "La Liga",
    "D1": "Bundesliga",
    "I1": "Serie A",
    "F1": "Ligue 1",
    "N1": "Eredivisie",
    "P1": "Primeira Liga",
    "MEX": "Liga MX",
}

USER_AGENT = (
    "Mozilla/5.0 (compatible; InvestigacionDeportivaHistorica/1.0; "
    "+https://github.com/)"
)

CACHE_DIR = Path(os.environ["FD_CACHE"]) if os.environ.get("FD_CACHE") else None


def season_code(year: int) -> str:
    return f"{year % 100:02d}{(year + 1) % 100:02d}"


def season_label(year: int) -> str:
    return f"{year}/{str(year + 1)[-2:]}"


def iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def fetch_bytes(url: str) -> bytes | None:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=40) as resp:
            data = resp.read()
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        print(f"  fetch failed {url}: {exc}")
        return None
    if not data or data[:1] in (b"<",) or b"<html" in data[:300].lower():
        return None
    return data


def cached_or_download(key: str, url: str) -> str | None:
    if CACHE_DIR is not None:
        path = CACHE_DIR / key
        if path.exists() and path.stat().st_size > 80:
            return path.read_text(encoding="utf-8-sig", errors="replace")
    data = fetch_bytes(url)
    if data is None:
        return None
    text = data.decode("utf-8-sig", errors="replace")
    if CACHE_DIR is not None:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        (CACHE_DIR / key).write_text(text, encoding="utf-8")
    return text


def parse_date(value: str) -> str | None:
    text = (value or "").strip()
    if not text:
        return None
    for fmt in ("%d/%m/%y", "%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def parse_goals(value: str | None) -> int | None:
    text = (value or "").strip()
    if text == "":
        return None
    try:
        return int(text)
    except ValueError:
        return None


def result_from_goals(home_goals: int, away_goals: int) -> str:
    if home_goals > away_goals:
        return "H"
    if home_goals < away_goals:
        return "A"
    return "D"


def odds_object(triplet: tuple[float, float, float] | None) -> dict | None:
    if triplet is None:
        return None
    home, draw, away = triplet
    return {"home": round(home, 4), "draw": round(draw, 4), "away": round(away, 4)}


def row_to_match(row: dict, league: str, season: int, home_key: str, away_key: str, hg_key: str, ag_key: str, res_key: str) -> dict | None:
    home = normalize_team(row.get(home_key) or "")
    away = normalize_team(row.get(away_key) or "")
    if not home or not away or home == away:
        return None
    home_goals = parse_goals(row.get(hg_key))
    away_goals = parse_goals(row.get(ag_key))
    if home_goals is None or away_goals is None:
        return None
    if home_goals < 0 or away_goals < 0:
        return None
    derived = result_from_goals(home_goals, away_goals)
    raw_result = (row.get(res_key) or "").strip().upper()
    result = raw_result if raw_result in ("H", "D", "A") else derived
    if result != derived:
        result = derived
    date = parse_date(row.get("Date") or "")
    if date is None:
        return None
    closing, source, books = select_closing(row)
    match = {
        "date": date,
        "season": season,
        "league": league,
        "home": home,
        "away": away,
        "homeGoals": home_goals,
        "awayGoals": away_goals,
        "result": result,
    }
    for field, triplet in (
        ("b365", books["b365"]),
        ("pinnacle", books["pinnacle"]),
        ("pinnacleClosing", books["pinnacleClosing"]),
        ("closing", closing),
    ):
        payload = odds_object(triplet)
        if payload is not None:
            match[field] = payload
    if source:
        match["oddsSource"] = source
    return match


def parse_football_data_csv(text: str, league: str, season: int) -> list[dict]:
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        return []
    fields = {name.lstrip("\ufeff") for name in reader.fieldnames if name}
    # Rewrite keys so a BOM on the first header does not hide Country/Div.
    rows = []
    for raw in reader:
        row = {(key or "").lstrip("\ufeff"): value for key, value in raw.items()}
        if "HomeTeam" in fields:
            match = row_to_match(row, league, season, "HomeTeam", "AwayTeam", "FTHG", "FTAG", "FTR")
        elif "Home" in fields:
            season_text = (row.get("Season") or "").strip()
            file_season = season
            if "/" in season_text:
                try:
                    file_season = int(season_text.split("/")[0])
                except ValueError:
                    file_season = season
            match = row_to_match(row, league, file_season, "Home", "Away", "HG", "AG", "Res")
        else:
            continue
        if match:
            rows.append(match)
    return rows


def download_european() -> dict[tuple[str, int], list[dict]]:
    jobs = []
    for year in range(FIRST_SEASON, LAST_SEASON + 1):
        code = season_code(year)
        for league in ("E0", "SP1", "D1", "I1", "F1", "N1", "P1"):
            url = f"https://www.football-data.co.uk/mmz4281/{code}/{league}.csv"
            jobs.append((league, year, f"{league}_{year}.csv", url))

    found: dict[tuple[str, int], list[dict]] = {}

    def work(job: tuple[str, int, str, str]) -> tuple[str, int, list[dict]]:
        league, year, key, url = job
        text = cached_or_download(key, url)
        if not text or len(text) < 80:
            return league, year, []
        return league, year, parse_football_data_csv(text, league, year)

    with ThreadPoolExecutor(max_workers=12) as pool:
        futures = [pool.submit(work, job) for job in jobs]
        for future in as_completed(futures):
            league, year, matches = future.result()
            found[(league, year)] = matches
            odds = sum(1 for match in matches if match.get("oddsSource"))
            status = f"{len(matches)} matches, {odds} with closing odds" if matches else "MISSING"
            print(f"  {league} {season_label(year)}: {status}")
    return found


def download_liga_mx() -> list[dict]:
    text = cached_or_download("MEX.csv", "https://www.football-data.co.uk/new/MEX.csv")
    if not text:
        print("  MEX: MISSING")
        return []
    matches = parse_football_data_csv(text, "MEX", FIRST_SEASON)
    matches = [match for match in matches if FIRST_SEASON <= match["season"] <= LAST_SEASON]
    print(f"  MEX: {len(matches)} matches across {len({m['season'] for m in matches})} seasons")
    return matches


def load_previous() -> dict[tuple[str, int], list[dict]]:
    if not MATCHES_PATH.exists():
        return {}
    try:
        payload = json.loads(MATCHES_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    rows = payload.get("matches") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        return {}
    grouped: dict[tuple[str, int], list[dict]] = defaultdict(list)
    for match in rows:
        try:
            grouped[(match["league"], int(match["season"]))].append(match)
        except (KeyError, TypeError, ValueError):
            continue
    return grouped


def dedupe(matches: list[dict]) -> list[dict]:
    seen: set[tuple] = set()
    unique: list[dict] = []
    for match in matches:
        key = (match["league"], match["date"], match["home"], match["away"])
        if key in seen:
            continue
        seen.add(key)
        unique.append(match)
    unique.sort(key=lambda match: (match["date"], match["league"], match["home"], match["away"]))
    return unique


def build_records(matches: list[dict]) -> tuple[list[dict], dict]:
    """Season W/D/L records (original schema) plus per-club betting splits."""
    season_overall: dict[tuple[str, int], Split] = defaultdict(Split)
    season_home: dict[tuple[str, int], Split] = defaultdict(Split)
    season_away: dict[tuple[str, int], Split] = defaultdict(Split)
    season_league: dict[tuple[str, int], str] = {}

    global_buckets = empty_bucket_accumulators()
    season_buckets: dict[int, dict] = defaultdict(empty_bucket_accumulators)

    for match in matches:
        league_name = LEAGUES[match["league"]]
        season = match["season"]
        result = match["result"]
        closing = match.get("closing")
        for side, club in (("home", match["home"]), ("away", match["away"])):
            key = (club, season)
            season_league[key] = league_name
            outcome = result_for_side(side, result)
            season_overall[key].add_result(outcome)
            venue = season_home if side == "home" else season_away
            venue[key].add_result(outcome)
            if closing:
                price = closing["home"] if side == "home" else closing["away"]
                won = outcome == "W"
                season_overall[key].add_bet(price, won)
                venue[key].add_bet(price, won)
        if closing:
            add_market_to_calibration(
                global_buckets,
                closing["home"],
                closing["draw"],
                closing["away"],
                result,
            )
            add_market_to_calibration(
                season_buckets[season],
                closing["home"],
                closing["draw"],
                closing["away"],
                result,
            )

    records = []
    clubs: dict[str, dict] = {}
    for (club, season), overall in season_overall.items():
        record = {
            "club": club,
            "season": season,
            "league": season_league[(club, season)],
            "played": overall.played,
            "won": overall.won,
            "drawn": overall.drawn,
            "lost": overall.lost,
        }
        records.append(record)
        club_row = clubs.setdefault(
            club,
            {"seasons": [], "leagues": set(), "overall_parts": [], "home_parts": [], "away_parts": []},
        )
        club_row["leagues"].add(record["league"])
        home = season_home[(club, season)]
        away = season_away[(club, season)]
        club_row["seasons"].append(
            {
                "season": season,
                "league": record["league"],
                "overall": overall.to_dict(),
                "home": home.to_dict(),
                "away": away.to_dict(),
            }
        )
        club_row["overall_parts"].append(overall)
        club_row["home_parts"].append(home)
        club_row["away_parts"].append(away)

    records.sort(key=lambda row: (row["club"], row["season"], row["league"]))

    teams = []
    for club, club_row in clubs.items():
        slug = club_slug(club)
        club_row["seasons"].sort(key=lambda row: row["season"])
        teams.append(
            {
                "club": club,
                "slug": slug,
                "leagues": sorted(club_row["leagues"]),
                "overall": combine_splits(club_row["overall_parts"]).to_dict(),
                "home": combine_splits(club_row["home_parts"]).to_dict(),
                "away": combine_splits(club_row["away_parts"]).to_dict(),
                "seasons": [
                    {
                        "season": row["season"],
                        "league": row["league"],
                        "overall": row["overall"],
                        "home": row["home"],
                        "away": row["away"],
                    }
                    for row in club_row["seasons"]
                ],
            }
        )
    teams.sort(key=lambda row: row["club"])

    slugs = [team["slug"] for team in teams]
    if len(slugs) != len(set(slugs)):
        dupes = sorted({slug for slug in slugs if slugs.count(slug) > 1})
        raise SystemExit(f"Club slug collision: {dupes}")

    summary_teams = teams
    calibration = {
        "all": finalize_buckets(global_buckets),
        "bySeason": [
            {"season": season, "buckets": finalize_buckets(season_buckets[season])}
            for season in sorted(season_buckets)
        ],
    }
    return records, {"teams": summary_teams, "calibration": calibration}


def coverage_rows(matches: list[dict]) -> list[dict]:
    grouped: dict[tuple[str, int], list[dict]] = defaultdict(list)
    for match in matches:
        grouped[(match["league"], match["season"])].append(match)
    rows = []
    for league, name in LEAGUES.items():
        years = range(FIRST_SEASON, LAST_SEASON + 1)
        if league == "MEX":
            present_years = sorted(year for (code, year) in grouped if code == league)
            years = present_years
        for year in years:
            sample = grouped.get((league, year), [])
            sources = {"PSC": 0, "PS": 0, "B365": 0, "none": 0}
            for match in sample:
                sources[match.get("oddsSource") or "none"] += 1
            latest = max((match["date"] for match in sample), default=None)
            rows.append(
                {
                    "league": league,
                    "leagueName": name,
                    "season": year,
                    "matches": len(sample),
                    "withClosingOdds": len(sample) - sources["none"],
                    "oddsSource": sources,
                    "latestMatchDate": latest,
                }
            )
    return rows


def mark_partial(rows: list[dict]) -> None:
    """The newest season is still in progress. Earlier short seasons are finished."""
    for row in rows:
        row["partial"] = row["season"] == LAST_SEASON and row["matches"] > 0


def coverage_notes(rows: list[dict]) -> tuple[list[str], bool]:
    notes: list[str] = []
    european_gap = False
    by_league: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        by_league[row["league"]].append(row)
    for league, name in LEAGUES.items():
        sample = by_league.get(league, [])
        present = [row for row in sample if row["matches"] > 0]
        if league != "MEX":
            missing = [row["season"] for row in sample if row["matches"] == 0]
            if missing:
                european_gap = True
                notes.append(
                    f"{name}: missing {', '.join(season_label(year) for year in missing)}."
                )
            elif present:
                first = present[0]["season"]
                last = present[-1]["season"]
                with_odds = [row["season"] for row in present if row["withClosingOdds"] > 0]
                odds_from = season_label(with_odds[0]) if with_odds else "none"
                notes.append(
                    f"{name}: {season_label(first)}–{season_label(last)} "
                    f"({len(present)} seasons). Closing odds from {odds_from}."
                )
        elif present:
            notes.append(
                f"Liga MX: {season_label(present[0]['season'])}–{season_label(present[-1]['season'])} "
                "from football-data.co.uk/new/MEX.csv (results and, when published, closing odds). "
                "openfootball/mexico is not available. Seasons before 2012/13 are absent."
            )
    no_odds = [
        f"{row['leagueName']} {season_label(row['season'])}"
        for row in rows
        if row["matches"] > 0 and row["withClosingOdds"] == 0
    ]
    if no_odds:
        notes.append(
            "Completed matches with no Bet365 or Pinnacle price (they count toward win% but not ROI): "
            + ", ".join(no_odds)
            + "."
        )
    return notes, european_gap


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {path.relative_to(ROOT)} ({path.stat().st_size} bytes)")


def main() -> None:
    print(f"Seasons {season_label(FIRST_SEASON)}–{season_label(LAST_SEASON)}")
    european = download_european()
    mexico = download_liga_mx()
    previous = load_previous()

    matches: list[dict] = []
    reused = 0
    for league in ("E0", "SP1", "D1", "I1", "F1", "N1", "P1"):
        for year in range(FIRST_SEASON, LAST_SEASON + 1):
            rows = european.get((league, year), [])
            if rows:
                matches.extend(rows)
            elif previous.get((league, year)):
                matches.extend(previous[(league, year)])
                reused += 1
                print(f"  reused previous {league} {season_label(year)}")
    if mexico:
        matches.extend(mexico)
    elif any(code == "MEX" for code, _year in previous):
        for (code, _year), rows in previous.items():
            if code == "MEX":
                matches.extend(rows)
        print("  reused previous Liga MX matches")

    matches = dedupe(matches)
    if not matches:
        raise SystemExit("No matches downloaded")

    previous_count = sum(len(rows) for rows in previous.values())
    if previous_count >= 1000 and len(matches) < 0.8 * previous_count:
        raise SystemExit(
            f"Refusing to replace {previous_count} matches with {len(matches)} "
            "(download looks incomplete)"
        )

    records, built = build_records(matches)
    rows = coverage_rows(matches)
    mark_partial(rows)
    notes, european_gap = coverage_notes(rows)
    generated_at = iso_now()

    for path in SEASON_PATHS:
        write_json(path, records)

    write_json(
        MATCHES_PATH,
        {
            "schemaVersion": 1,
            "generatedAt": generated_at,
            "leagueNames": LEAGUES,
            "oddsOrder": ["home", "draw", "away"],
            "closingOddsPolicy": (
                "PSCH/PSCD/PSCA when all three are decimal odds > 1; "
                "else PSH/PSD/PSA (or PH/PD/PA); "
                "else B365H/B365D/B365A (or B365CH/B365CD/B365CA when pre-closing Bet365 columns are absent)."
            ),
            "matches": matches,
        },
    )

    summary = {
        "schemaVersion": 1,
        "generatedAt": generated_at,
        "seasons": {"first": FIRST_SEASON, "last": LAST_SEASON},
        "definitions": {
            "season": "Season start year. 2026 means the 2026/27 season, which may be partial.",
            "stake": "Flat stake of 1.00 unit on the named team to win. staked equals bets.",
            "roi": (
                "profit / staked. If the team wins, that bet's profit is odds - 1; "
                "otherwise profit is -1. roi is null when bets is 0. "
                "A positive roi means always betting that team at the closing price made money."
            ),
            "winPct": "won / played * 100, using every completed match. Null when played is 0.",
            "closingOdds": (
                "Pinnacle closing PSCH/PSCD/PSCA when all three prices are decimal odds greater than 1. "
                "Otherwise Pinnacle PSH/PSD/PSA (or PH/PD/PA). "
                "Otherwise Bet365 B365H/B365D/B365A, or B365CH/B365CD/B365CA when the file has no pre-closing Bet365 columns. "
                "oddsSource on each match is PSC, PS, or B365."
            ),
            "recordVsRoi": (
                "played/won/drawn/lost include every completed match. "
                "bets/staked/returned/profit/roi/avgOdds include only matches with a closing price for that team."
            ),
            "homeAway": (
                "Home uses matches the team played at home and the home closing price. "
                "Away uses the away closing price. Overall is both."
            ),
            "impliedProbability": (
                "Calibration observes each of home, draw, and away once per priced match. "
                "Raw implied probability is 1/odds. Overround is removed by dividing by "
                "(1/home + 1/draw + 1/away). actualWinRate is wins/outcomes in the bucket. "
                "avgImpliedProb is the mean de-vigged probability. "
                "sumImpliedProb and sumOdds are the totals behind those averages so buckets can be recombined."
            ),
            "buckets": (
                "Half-open intervals on decimal closing odds: minOdds <= odds < maxOdds. "
                "The last bucket has maxOdds null. Favorites from 1.20 to 1.50 use 0.05-wide buckets. "
                "outcomes counts the three 1X2 results, not matches."
            ),
            "ligaMx": (
                "Liga MX comes from https://www.football-data.co.uk/new/MEX.csv because "
                "openfootball/mexico is not available. Coverage starts in 2012/13. "
                "The file has no separate playoff flag, so published Liga MX rows are included as-is."
            ),
        },
        "leagues": [{"code": code, "name": name} for code, name in LEAGUES.items()],
        "coverage": rows,
        "calibration": built["calibration"]["all"],
        "calibrationBySeason": built["calibration"]["bySeason"],
        "teams": built["teams"],
    }
    write_json(SUMMARY_PATH, summary)
    write_json(
        COVERAGE_PATH,
        {
            "schemaVersion": 1,
            "generatedAt": generated_at,
            "hasEuropeanGaps": european_gap,
            "notes": notes,
            "reusedLeagueSeasons": reused,
        },
    )

    priced = sum(1 for match in matches if match.get("oddsSource"))
    print(
        f"\n{len(matches)} matches, {priced} with closing odds, "
        f"{len(records)} club-seasons, {len(built['teams'])} clubs"
    )
    porto = next(team for team in built["teams"] if team["club"] == "Porto")
    overall = porto["overall"]
    print(
        f"Porto overall ROI {overall['roi']} on {overall['bets']} bets "
        f"(avg odds {overall['avgOdds']}, win% {overall['winPct']})"
    )
    if european_gap:
        print("European coverage still has gaps; see coverage.json")
    else:
        print("European leagues have a file for every requested season.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
