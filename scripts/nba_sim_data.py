#!/usr/bin/env python3
"""Build the cached NBA game file for the Monte Carlo simulator.

Box scores come from the sportsdataverse ESPN team-box release (one CSV per
season, cached under .cache/). Closing moneylines are ESPN BET `close` prices,
one request per 2025-26 regular-season game, cached and rate-limited. Play-by-play
is a stratified ESPN sample plus every 2026-27 game played so far. Raw responses
stay in .cache/. The committed files are the small aggregates written by
`web/scripts/nba-backtest.ts`.

stats.nba.com did not answer from this environment. Basketball-Reference game
logs are disallowed by that site's robots.txt, so they are not fetched.
"""

from __future__ import annotations

import http.client
import json
import os
import threading
import time
import csv
import urllib.request
from collections import Counter
from pathlib import Path

from nba_factors import (
    ESPN_TO_NBA,
    NBA_NAMES,
    PHASE_BY_SEASON_TYPE,
    SKIP_ABBREV,
    box_from_row,
    parse_possessions,
    point_share,
)

ROOT = Path(__file__).resolve().parents[1]
CACHE = Path(os.environ.get("NBA_SIM_CACHE", ROOT / ".cache" / "nba-sim"))
BOX_URL = (
    "https://github.com/sportsdataverse/sportsdataverse-data/releases/download/"
    "espn_nba_team_boxscores/team_box_{season}.csv"
)
# ESPN season is the ending year. 2025 is 2024-25, 2027 is the season in progress.
BOX_SEASONS = (2025, 2026, 2027)
USER_AGENT = "investigacion-deportiva-historica"
# Gap in the repo's BetMGM file. Reported by the backtest; odds here are ESPN BET.
ML_GAP_AFTER = "2026-02-12"
REQUEST_GAP_SEC = 0.12
PBP_STRIDE = 15

_thread = threading.local()
_rate_lock = threading.Lock()
_next_ok = 0.0


def wait_turn() -> None:
    global _next_ok
    with _rate_lock:
        now = time.monotonic()
        delay = _next_ok - now
        if delay > 0:
            time.sleep(delay)
            now = time.monotonic()
        _next_ok = now + REQUEST_GAP_SEC


def download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0:
        return
    print(f"download {url}")
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=180) as response:
        dest.write_bytes(response.read())


def connection(host: str) -> http.client.HTTPSConnection:
    conn = getattr(_thread, "conn", None)
    current = getattr(_thread, "host", None)
    if conn is None or current != host:
        if conn is not None:
            conn.close()
        conn = http.client.HTTPSConnection(host, timeout=40)
        _thread.conn = conn
        _thread.host = host
    return conn


def get_json(host: str, path: str) -> dict:
    last_error: Exception | None = None
    for attempt in range(4):
        wait_turn()
        conn = connection(host)
        try:
            conn.request(
                "GET",
                path,
                headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            )
            response = conn.getresponse()
            body = response.read()
            status = response.status
        except Exception as error:  # noqa: BLE001 - retry on any socket error
            last_error = error
            if getattr(_thread, "conn", None) is not None:
                _thread.conn.close()
            _thread.conn = None
            time.sleep(1.5 * (attempt + 1))
            continue
        if status == 200:
            return json.loads(body)
        if status in {429, 500, 502, 503, 504}:
            last_error = RuntimeError(f"{host}{path} -> {status}")
            time.sleep(2.0 * (attempt + 1))
            _thread.conn.close()
            _thread.conn = None
            continue
        raise RuntimeError(f"{host}{path} -> {status} {body[:180]!r}")
    raise RuntimeError(f"gave up on {host}{path}: {last_error}")


def decimal_price(close: dict | None) -> float | None:
    """ESPN stores the close as {moneyLine: {decimal, american, ...}}."""
    if not isinstance(close, dict):
        return None
    money = close.get("moneyLine")
    if isinstance(money, dict):
        decimal = money.get("decimal")
    elif "decimal" in close:
        decimal = close.get("decimal")
    else:
        return None
    try:
        number = float(decimal)
    except (TypeError, ValueError):
        return None
    if number <= 1:
        return None
    return round(number, 3)


def fetch_close(game_id: str) -> dict:
    dest = CACHE / "odds" / f"{game_id}.json"
    if dest.exists():
        return json.loads(dest.read_text())
    payload = get_json(
        "sports.core.api.espn.com",
        f"/v2/sports/basketball/leagues/nba/events/{game_id}/competitions/{game_id}/odds?lang=en&region=us",
    )
    found = None
    fallback = None
    for item in payload.get("items") or []:
        provider = item.get("provider") or {}
        away = decimal_price((item.get("awayTeamOdds") or {}).get("close"))
        home = decimal_price((item.get("homeTeamOdds") or {}).get("close"))
        if away is None or home is None:
            continue
        name = provider.get("name") or "unknown"
        record = {"away": away, "home": home, "source": f"espn-close:{name}"}
        # ESPN BET is the book through November 2025. Later games are DraftKings.
        if str(provider.get("id")) == "58":
            found = record
            break
        if fallback is None:
            fallback = record
    if found is None:
        found = fallback or {"away": None, "home": None, "source": None}
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(found))
    return found


def fetch_plays(game_id: str) -> dict:
    dest = CACHE / "pbp" / f"{game_id}.json"
    if dest.exists():
        return json.loads(dest.read_text())
    payload = get_json(
        "site.api.espn.com",
        f"/apis/site/v2/sports/basketball/nba/summary?event={game_id}",
    )
    plays = payload.get("plays") or []
    possessions, technical = parse_possessions(plays)
    record = {
        "plays": len(plays),
        "possessions": possessions,
        "technical": technical,
    }
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(record))
    return record


def load_games() -> list[dict]:
    paired: dict[str, dict] = {}
    for ending in BOX_SEASONS:
        path = CACHE / f"team_box_{ending}.csv"
        download(BOX_URL.format(season=ending), path)
        with path.open(newline="") as handle:
            for row in csv.DictReader(handle):
                if str(row.get("season")) != str(ending):
                    raise SystemExit(f"{path.name} season column is {row.get('season')}, expected {ending}")
                abbrev = (row.get("team_abbreviation") or "").strip()
                if abbrev in SKIP_ABBREV:
                    continue
                phase = PHASE_BY_SEASON_TYPE.get(str(row.get("season_type")))
                if phase is None:
                    continue
                if abbrev not in ESPN_TO_NBA:
                    raise SystemExit(f"unknown ESPN abbreviation {abbrev}")
                code = ESPN_TO_NBA[abbrev]
                box = box_from_row(row)
                points = row.get("team_score")
                try:
                    team_score = int(float(points))
                except (TypeError, ValueError):
                    continue
                if box is None:
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
                        "phase": phase,
                    },
                )
                side = (row.get("team_home_away") or "").strip().lower()
                if side not in {"home", "away"}:
                    continue
                slot[side] = code
                slot[f"{side}Score"] = team_score
                slot[f"{side}Box"] = box
                slot[f"{side}Name"] = NBA_NAMES[code]
    games = []
    for slot in paired.values():
        if not all(key in slot for key in ("home", "away", "homeBox", "awayBox", "homeScore", "awayScore", "date")):
            continue
        games.append(slot)
    games.sort(key=lambda game: (game["date"], game["id"]))
    return games


def attach_odds(games: list[dict]) -> None:
    targets = [game for game in games if game["season"] == 2025 and game["phase"] == "regular"]
    print(f"closing lines for {len(targets)} regular-season 2025-26 games")
    done = 0
    for game in targets:
        close = fetch_close(game["id"])
        game["homeMl"] = close["home"]
        game["awayMl"] = close["away"]
        game["mlSource"] = close["source"]
        done += 1
        if done % 100 == 0 or done == len(targets):
            print(f"  odds {done}/{len(targets)}")
    for game in games:
        game.setdefault("homeMl", None)
        game.setdefault("awayMl", None)
        game.setdefault("mlSource", None)


def pbp_sample(games: list[dict]) -> list[dict]:
    regular = [game for game in games if game["season"] == 2025 and game["phase"] == "regular"]
    sampled = [game for index, game in enumerate(regular) if index % PBP_STRIDE == 0]
    current = [game for game in games if game["season"] == 2026 and game["phase"] == "regular"]
    picked = {game["id"]: game for game in sampled}
    for game in current:
        picked.setdefault(game["id"], game)
    return [picked[key] for key in sorted(picked, key=lambda game_id: (picked[game_id]["date"], game_id))]


def attach_pbp(games: list[dict]) -> dict:
    sample = pbp_sample(games)
    print(f"play-by-play sample: {len(sample)} games")
    possessions: list[int] = []
    plays = 0
    technical = 0
    box_points = 0
    parsed_points = 0
    kept = 0
    mismatches = 0
    for index, game in enumerate(sample, start=1):
        record = fetch_plays(game["id"])
        game_possessions = [int(points) for points in record["possessions"]]
        game_technical = int(record["technical"])
        total = sum(game_possessions) + game_technical
        box = int(game["homeScore"]) + int(game["awayScore"])
        plays += int(record["plays"])
        if abs(total - box) <= 2:
            possessions.extend(game_possessions)
            technical += game_technical
            parsed_points += total
            box_points += box
            kept += 1
        else:
            mismatches += 1
        if index % 20 == 0 or index == len(sample):
            print(f"  pbp {index}/{len(sample)}")
    share = point_share(possessions)
    ppp = round(sum(possessions) / len(possessions), 4) if possessions else None
    return {
        "stride": PBP_STRIDE,
        "requestedGames": len(sample),
        "keptGames": kept,
        "mismatches": mismatches,
        "plays": plays,
        "possessions": len(possessions),
        "points": parsed_points,
        "technicalPoints": technical,
        "boxPoints": box_points,
        "pointsPerPossession": ppp,
        "pointShare": share,
        "note": (
            "Full-season play-by-play is not downloaded. A 1-in-15 sample of 2025-26 "
            "regular-season games plus every completed 2026-27 game is parsed and "
            "kept when the play points are within 2 of the box score. Raw plays are not stored."
        ),
    }


def main() -> None:
    games = load_games()
    attach_odds(games)
    pbp = attach_pbp(games)
    # Drop display names from the cache file; the backtest script has the codes.
    slim = []
    for game in games:
        slim.append(
            {
                "id": game["id"],
                "date": game["date"],
                "season": game["season"],
                "phase": game["phase"],
                "home": game["home"],
                "away": game["away"],
                "homeScore": game["homeScore"],
                "awayScore": game["awayScore"],
                "homeBox": game["homeBox"],
                "awayBox": game["awayBox"],
                "homeMl": game["homeMl"],
                "awayMl": game["awayMl"],
                "mlSource": game["mlSource"],
            }
        )
    counts = Counter((game["season"], game["phase"]) for game in slim)
    with_close = sum(1 for game in slim if game["homeMl"] and game["awayMl"])
    through_gap = sum(
        1
        for game in slim
        if game["season"] == 2025
        and game["phase"] == "regular"
        and game["date"] <= ML_GAP_AFTER
        and game["homeMl"]
        and game["awayMl"]
    )
    payload = {
        "generatedFrom": "espn team box via sportsdataverse, espn bet close, espn play-by-play sample",
        "moneylineGapAfter": ML_GAP_AFTER,
        "counts": {f"{season}-{phase}": count for (season, phase), count in sorted(counts.items())},
        "closingLines": with_close,
        "closingLinesThroughGap": through_gap,
        "pbp": pbp,
        "games": slim,
    }
    dest = CACHE / "games.json"
    dest.write_text(json.dumps(payload))
    print(f"wrote {dest} games={len(slim)} closes={with_close} through_gap={through_gap}")
    print(f"pbp kept={pbp['keptGames']} mismatches={pbp['mismatches']} ppp={pbp['pointsPerPossession']}")


if __name__ == "__main__":
    main()
