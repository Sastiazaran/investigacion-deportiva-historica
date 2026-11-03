"""ESPN scoreboard scores and closing lines for the NBA and MLB gaps.

The Kaggle NBA extract ends on 2026-06-13 and its moneylines end on
2026-02-12. The frozen MLB file ends on 2025-08-16. ESPN's public
scoreboard still has the games, and the core odds endpoint still has a
close. Raw responses are cached under US_CACHE so the Friday job only
downloads what is new. A failed download raises; it does not return an
empty season.
"""

from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from nba_factors import ESPN_TO_NBA
from us_markets import JUICE_110, american_to_decimal, canonical_mlb, canonical_nba

USER_AGENT = "investigacion-deportiva-historica"
EASTERN = ZoneInfo("America/New_York")
NBA_ODDS_FROM = "2026-02-13"
MLB_FROM = "2025-08-17"

_rate_lock = threading.Lock()
_next_ok = 0.0
REQUEST_GAP_SEC = 0.06


def wait_turn() -> None:
    global _next_ok
    with _rate_lock:
        now = time.monotonic()
        delay = _next_ok - now
        if delay > 0:
            time.sleep(delay)
            now = time.monotonic()
        _next_ok = now + REQUEST_GAP_SEC


def us_game_date(value: str) -> str:
    """US sports date. A west-coast night game is the previous evening, not the UTC morning."""
    text = (value or "").replace("Z", "+00:00")
    moment = datetime.fromisoformat(text)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=EASTERN)
    return moment.astimezone(EASTERN).date().isoformat()


def price_decimal(node) -> float | None:
    """Decimal price from an ESPN moneyline or spread-odds node. A line like -4.5 is not a price."""
    if not isinstance(node, dict):
        return None
    decimal = node.get("decimal")
    try:
        number = float(decimal) if decimal is not None else None
    except (TypeError, ValueError):
        number = None
    if number is not None and number > 1:
        return round(number, 3)
    return american_to_decimal(node.get("american") or node.get("alternateDisplayValue"))


def spread_number(node) -> float | None:
    if isinstance(node, (int, float)) and not isinstance(node, bool):
        return float(node)
    if not isinstance(node, dict):
        return None
    for key in ("american", "alternateDisplayValue"):
        raw = node.get(key)
        if raw is None or raw == "":
            continue
        try:
            return float(str(raw).replace("+", ""))
        except ValueError:
            continue
    return None


def parse_odds_item(item: dict) -> dict | None:
    """One book's close. home_spread is positive when the home team is laying points or runs."""
    if not isinstance(item, dict):
        return None
    home = item.get("homeTeamOdds") or {}
    away = item.get("awayTeamOdds") or {}
    home_close = home.get("close") or {}
    away_close = away.get("close") or {}
    home_ml = price_decimal(home_close.get("moneyLine"))
    away_ml = price_decimal(away_close.get("moneyLine"))
    if home_ml is None or away_ml is None:
        return None
    home_point = spread_number(home_close.get("pointSpread"))
    if home_point is None:
        home_point = spread_number(item.get("spread"))
    if home_point is None:
        home_spread = None
        home_spread_odds = away_spread_odds = None
    else:
        # ESPN's number is negative when home lays. The rest of this repo uses the opposite sign.
        home_spread = -home_point
        home_spread_odds = price_decimal(home_close.get("spread")) or american_to_decimal(home.get("spreadOdds")) or JUICE_110
        away_spread_odds = price_decimal(away_close.get("spread")) or american_to_decimal(away.get("spreadOdds")) or JUICE_110
    total = item.get("overUnder")
    try:
        total_line = float(total) if total is not None and total != "" else None
    except (TypeError, ValueError):
        total_line = None
    provider = item.get("provider") or {}
    name = provider.get("name") or "unknown"
    return {
        "away_ml": away_ml,
        "home_ml": home_ml,
        "ml_source": f"espn-close:{name}",
        "provider": name,
        "home_spread": home_spread,
        "away_spread_odds": away_spread_odds,
        "home_spread_odds": home_spread_odds,
        "total_line": total_line,
        "over_odds": american_to_decimal(item.get("overOdds")),
        "under_odds": american_to_decimal(item.get("underOdds")),
    }


def choose_odds(payload: dict) -> dict | None:
    parsed = [row for row in (parse_odds_item(item) for item in payload.get("items") or []) if row]
    if not parsed:
        return None

    def rank(row: dict) -> tuple:
        name = row["provider"].lower()
        if "draftkings" in name:
            return (0, name)
        if "espn" in name:
            return (1, name)
        return (2, name)

    return min(parsed, key=rank)


def _season_type(event: dict) -> str:
    season = event.get("season") or {}
    if isinstance(season, dict):
        return str(season.get("type") or "")
    return ""


def _season_year(event: dict) -> int | None:
    season = event.get("season") or {}
    if isinstance(season, dict) and season.get("year"):
        try:
            return int(season["year"])
        except (TypeError, ValueError):
            return None
    return None


def parse_event(event: dict, league: str) -> dict | None:
    """A final NBA or MLB game, without odds. Preseason and all-star sides are dropped."""
    status = ((event.get("status") or {}).get("type") or {}).get("name") or ""
    if status not in {"STATUS_FINAL", "STATUS_FULL_TIME", "STATUS_FINAL_OVERTIME", "STATUS_FINAL_PENALTIES"}:
        return None
    kind = _season_type(event)
    if kind in {"1", "0"}:
        return None
    competitions = event.get("competitions") or []
    if not competitions:
        return None
    competition = competitions[0]
    home = away = None
    for side in competition.get("competitors") or []:
        abbrev = ((side.get("team") or {}).get("abbreviation") or "").strip()
        try:
            score = int(float(side.get("score")))
        except (TypeError, ValueError):
            return None
        slot = {"abbrev": abbrev, "score": score}
        if side.get("homeAway") == "home":
            home = slot
        elif side.get("homeAway") == "away":
            away = slot
    if home is None or away is None:
        return None
    try:
        when = us_game_date(competition.get("date") or event.get("date") or "")
    except ValueError:
        return None
    if league == "nba":
        if home["abbrev"] not in ESPN_TO_NBA or away["abbrev"] not in ESPN_TO_NBA:
            return None
        home_code = canonical_nba(ESPN_TO_NBA[home["abbrev"]])
        away_code = canonical_nba(ESPN_TO_NBA[away["abbrev"]])
        ending = _season_year(event)
        if ending is None:
            year = int(when[:4])
            ending = year + 1 if int(when[5:7]) >= 8 else year
        season = ending - 1
    elif league == "mlb":
        try:
            home_code = canonical_mlb(home["abbrev"])
            away_code = canonical_mlb(away["abbrev"])
        except KeyError:
            return None
        season = int(when[:4])
    else:
        raise ValueError(league)
    if kind == "3":
        phase = "playoff"
    elif kind == "2":
        phase = "regular"
    else:
        phase = "other"
    return {
        "espn_id": str(event.get("id") or ""),
        "date": when,
        "season": season,
        "phase": phase,
        "away": away_code,
        "home": home_code,
        "away_score": away["score"],
        "home_score": home["score"],
        "away_ml": None,
        "home_ml": None,
        "ml_source": None,
        "home_spread": None,
        "away_spread_odds": None,
        "home_spread_odds": None,
        "total_line": None,
        "over_odds": None,
        "under_odds": None,
    }


def apply_odds(game: dict, odds: dict | None) -> None:
    if not odds:
        return
    game["away_ml"] = odds["away_ml"]
    game["home_ml"] = odds["home_ml"]
    game["ml_source"] = odds["ml_source"]
    game["home_spread"] = odds["home_spread"]
    game["away_spread_odds"] = odds["away_spread_odds"]
    game["home_spread_odds"] = odds["home_spread_odds"]
    game["total_line"] = odds["total_line"]
    game["over_odds"] = odds["over_odds"]
    game["under_odds"] = odds["under_odds"]


def _get_json(url: str) -> dict:
    last_error: Exception | None = None
    for attempt in range(4):
        wait_turn()
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=40) as response:
                return json.loads(response.read().decode())
        except urllib.error.HTTPError as error:
            last_error = error
            if error.code not in {429, 500, 502, 503, 504}:
                raise
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            last_error = error
        time.sleep(1.2 * (attempt + 1))
    raise RuntimeError(f"ESPN request failed for {url}: {last_error}")


def _cached_json(dest: Path, url: str) -> dict:
    if dest.exists() and dest.stat().st_size > 2:
        return json.loads(dest.read_text())
    payload = _get_json(url)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(payload))
    return payload


def _days(start: date, end: date):
    cursor = start
    while cursor <= end:
        yield cursor
        cursor += timedelta(days=1)


def fetch_scoreboards(cache: Path, sport: str, league: str, start: date, end: date) -> list[dict]:
    games: list[dict] = []
    days = list(_days(start, end))
    print(f"ESPN {league} scoreboard {start.isoformat()} .. {end.isoformat()} ({len(days)} days)")
    for index, day in enumerate(days, start=1):
        stamp = day.strftime("%Y%m%d")
        url = f"https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard?dates={stamp}"
        payload = _cached_json(cache / "scoreboard" / f"{stamp}.json", url)
        for event in payload.get("events") or []:
            game = parse_event(event, league)
            if game:
                games.append(game)
        if index % 40 == 0 or index == len(days):
            print(f"  scoreboard {index}/{len(days)} finals {len(games)}")
    return games


def attach_closing_lines(cache: Path, sport: str, league: str, games: list[dict]) -> None:
    pending = [game for game in games if game.get("espn_id") and not game.get("home_ml")]
    print(f"ESPN {league} closing lines {len(pending)}")
    for index, game in enumerate(pending, start=1):
        game_id = game["espn_id"]
        url = (
            f"https://sports.core.api.espn.com/v2/sports/{sport}/leagues/{league}"
            f"/events/{game_id}/competitions/{game_id}/odds?lang=en&region=us"
        )
        payload = _cached_json(cache / "odds" / f"{game_id}.json", url)
        apply_odds(game, choose_odds(payload))
        if index % 100 == 0 or index == len(pending):
            priced = sum(1 for row in pending[:index] if row.get("home_ml"))
            print(f"  odds {index}/{len(pending)} priced {priced}")


def fetch_nba_gap(cache: Path, today: date | None = None) -> list[dict]:
    end = today or datetime.now(EASTERN).date()
    start = date.fromisoformat(NBA_ODDS_FROM)
    if end < start:
        return []
    games = fetch_scoreboards(cache / "nba", "basketball", "nba", start, end)
    attach_closing_lines(cache / "nba", "basketball", "nba", games)
    return games


def fetch_mlb_gap(cache: Path, today: date | None = None) -> list[dict]:
    end = today or datetime.now(EASTERN).date()
    start = date.fromisoformat(MLB_FROM)
    if end < start:
        return []
    games = fetch_scoreboards(cache / "mlb", "baseball", "mlb", start, end)
    attach_closing_lines(cache / "mlb", "baseball", "mlb", games)
    return games


def merge_nba(existing: list[dict], incoming: list[dict]) -> tuple[int, int]:
    """Fill missing moneylines from 2026-02-13 and append games the Kaggle file does not have."""
    index = {(game["date"], game["away"], game["home"]): game for game in existing}
    added = 0
    filled = 0
    for game in incoming:
        if game["date"] < NBA_ODDS_FROM:
            continue
        current = index.get((game["date"], game["away"], game["home"]))
        if current is None:
            existing.append(game)
            index[(game["date"], game["away"], game["home"])] = game
            added += 1
            continue
        if current.get("home_ml") is None and game.get("home_ml"):
            current["home_ml"] = game["home_ml"]
            current["away_ml"] = game["away_ml"]
            current["ml_source"] = game["ml_source"]
            filled += 1
        if current.get("home_spread") is None and game.get("home_spread") is not None:
            current["home_spread"] = game["home_spread"]
            current["home_spread_odds"] = game["home_spread_odds"]
            current["away_spread_odds"] = game["away_spread_odds"]
        if current.get("total_line") is None and game.get("total_line") is not None:
            current["total_line"] = game["total_line"]
            current["over_odds"] = game["over_odds"]
            current["under_odds"] = game["under_odds"]
    return added, filled


def merge_mlb(existing: list[dict], incoming: list[dict]) -> int:
    keys = {
        (game["date"], game["away"], game["home"], game["away_score"], game["home_score"]) for game in existing
    }
    added = 0
    for game in incoming:
        if game["date"] < MLB_FROM:
            continue
        key = (game["date"], game["away"], game["home"], game["away_score"], game["home_score"])
        if key in keys:
            continue
        existing.append(game)
        keys.add(key)
        added += 1
    existing.sort(key=lambda game: (game["date"], game["away"], game["home"], game.get("espn_id") or ""))
    return added
