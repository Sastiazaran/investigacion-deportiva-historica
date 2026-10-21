"""Counting-stat and play-by-play helpers for the NBA simulator.

Raw dumps stay in the cache. These functions turn a box-score row into
counting stats and a play list into possessions.
"""

from __future__ import annotations

ESPN_TO_NBA = {
    "ATL": "atl",
    "BKN": "bkn",
    "BOS": "bos",
    "CHA": "cha",
    "CHI": "chi",
    "CLE": "cle",
    "DAL": "dal",
    "DEN": "den",
    "DET": "det",
    "GS": "gs",
    "HOU": "hou",
    "IND": "ind",
    "LAC": "lac",
    "LAL": "lal",
    "MEM": "mem",
    "MIA": "mia",
    "MIL": "mil",
    "MIN": "min",
    "NO": "no",
    "NY": "ny",
    "OKC": "okc",
    "ORL": "orl",
    "PHI": "phi",
    "PHX": "phx",
    "POR": "por",
    "SA": "sa",
    "SAC": "sac",
    "TOR": "tor",
    "UTAH": "utah",
    "WSH": "wsh",
}

# All-Star and exhibition sides that show up in the ESPN team-box file.
SKIP_ABBREV = {"STARS", "STRIPES", "WORLD", "CHK", "SHQ", "KEN", "CAN"}

NBA_NAMES = {
    "atl": "Atlanta Hawks",
    "bkn": "Brooklyn Nets",
    "bos": "Boston Celtics",
    "cha": "Charlotte Hornets",
    "chi": "Chicago Bulls",
    "cle": "Cleveland Cavaliers",
    "dal": "Dallas Mavericks",
    "den": "Denver Nuggets",
    "det": "Detroit Pistons",
    "gs": "Golden State Warriors",
    "hou": "Houston Rockets",
    "ind": "Indiana Pacers",
    "lac": "LA Clippers",
    "lal": "Los Angeles Lakers",
    "mem": "Memphis Grizzlies",
    "mia": "Miami Heat",
    "mil": "Milwaukee Bucks",
    "min": "Minnesota Timberwolves",
    "no": "New Orleans Pelicans",
    "ny": "New York Knicks",
    "okc": "Oklahoma City Thunder",
    "orl": "Orlando Magic",
    "phi": "Philadelphia 76ers",
    "phx": "Phoenix Suns",
    "por": "Portland Trail Blazers",
    "sa": "San Antonio Spurs",
    "sac": "Sacramento Kings",
    "tor": "Toronto Raptors",
    "utah": "Utah Jazz",
    "wsh": "Washington Wizards",
}

# ESPN season_type: 2 regular season, 3 playoffs. Others (preseason, play-in,
# all-star) are dropped.
PHASE_BY_SEASON_TYPE = {"2": "regular", "3": "playoff"}

LAST_FREE_THROW = {
    "Free Throw - 1 of 1",
    "Free Throw - 2 of 2",
    "Free Throw - 3 of 3",
}

SKIP_PLAY = {
    "Substitution",
    "Full Timeout",
    "Challenge",
    "Coach's Challenge (Overturned)",
    "Personal Foul",
    "Shooting Foul",
    "Loose Ball Foul",
    "Offensive Foul",
    "Personal Take Foul",
    "Technical Foul",
}


def blank(value) -> bool:
    return value is None or str(value).strip() == ""


def as_float(value) -> float | None:
    if blank(value):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number:
        return None
    return number


def as_int(value) -> int | None:
    number = as_float(value)
    if number is None:
        return None
    return int(number)


def norm_play(text: str) -> str:
    return " ".join(text.replace("\n", " ").split())


def is_turnover(text: str) -> bool:
    return "Turnover" in norm_play(text)


def box_from_row(row: dict) -> dict | None:
    """Team counting stats from one ESPN team-box row."""
    keys = {
        "fgm": "field_goals_made",
        "fga": "field_goals_attempted",
        "fg3m": "three_point_field_goals_made",
        "fg3a": "three_point_field_goals_attempted",
        "ftm": "free_throws_made",
        "fta": "free_throws_attempted",
        "oreb": "offensive_rebounds",
        "dreb": "defensive_rebounds",
        "tov": "total_turnovers",
    }
    out = {}
    for name, column in keys.items():
        number = as_float(row.get(column))
        if number is None and name == "tov":
            number = as_float(row.get("turnovers"))
        if number is None:
            return None
        out[name] = number
    if out["fga"] <= 0:
        return None
    return out


def parse_possessions(plays: list[dict]) -> tuple[list[int], int]:
    """Split ESPN plays into points per possession.

    A possession stays open through an offensive rebound and closes on a
    made field goal (and-1 free throws included), a turnover, a defensive
    rebound, or the last free throw of a trip. Technical free throws are
    returned separately so the point total can still match the box score.
    """
    possessions: list[int] = []
    points = 0
    technical = 0
    open_poss = False
    index = 0

    def flush() -> None:
        nonlocal points, open_poss
        if open_poss:
            possessions.append(points)
        points = 0
        open_poss = False

    while index < len(plays):
        play = plays[index]
        raw = (play.get("type") or {}).get("text") or ""
        text = norm_play(raw)
        if text == "Jumpball":
            flush()
            open_poss = True
            index += 1
            continue
        if text in {"End Period", "End Game"}:
            flush()
            index += 1
            continue
        if is_turnover(text):
            open_poss = True
            flush()
            index += 1
            continue
        if text == "Defensive Rebound":
            flush()
            open_poss = True
            index += 1
            continue
        if text == "Offensive Rebound":
            open_poss = True
            index += 1
            continue
        shooting = bool(play.get("shootingPlay"))
        score_value = int(play.get("scoreValue") or 0)
        attempted = int(play.get("pointsAttempted") or 0)
        if play.get("scoringPlay") and score_value in {2, 3} and attempted in {2, 3}:
            open_poss = True
            points += score_value
            index += 1
            while index < len(plays):
                nxt = plays[index]
                nxt_text = norm_play((nxt.get("type") or {}).get("text") or "")
                if "Free Throw" not in nxt_text or "Technical" in nxt_text:
                    break
                if nxt.get("scoringPlay"):
                    points += int(nxt.get("scoreValue") or 0)
                last = nxt_text in LAST_FREE_THROW
                index += 1
                if last:
                    break
            flush()
            continue
        if "Free Throw" in text and "Technical" in text:
            if play.get("scoringPlay"):
                technical += score_value
            index += 1
            continue
        if "Free Throw" in text:
            open_poss = True
            if play.get("scoringPlay"):
                points += score_value
            last = text in LAST_FREE_THROW
            index += 1
            if last:
                look = index
                while look < len(plays) and (plays[look].get("type") or {}).get("text") in SKIP_PLAY:
                    look += 1
                nxt_text = ""
                if look < len(plays):
                    nxt_text = (plays[look].get("type") or {}).get("text") or ""
                if nxt_text != "Offensive Rebound":
                    flush()
            continue
        if shooting:
            open_poss = True
        index += 1
    flush()
    return possessions, technical


def point_share(possessions: list[int]) -> dict[str, float]:
    if not possessions:
        return {"0": 0.0, "1": 0.0, "2": 0.0, "3": 0.0, "4plus": 0.0}
    total = len(possessions)
    buckets = {"0": 0, "1": 0, "2": 0, "3": 0, "4plus": 0}
    for points in possessions:
        if points <= 0:
            buckets["0"] += 1
        elif points == 1:
            buckets["1"] += 1
        elif points == 2:
            buckets["2"] += 1
        elif points == 3:
            buckets["3"] += 1
        else:
            buckets["4plus"] += 1
    return {key: round(count / total, 4) for key, count in buckets.items()}
