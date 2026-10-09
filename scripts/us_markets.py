"""Shared grading for NBA, NFL, and MLB.

Moneyline prices stay decimal inside the math. American prices are converted
once at ingest. A tie or a push is a refund: it is counted, and it is left
out of the stake so it does not move ROI.

ATS uses one spread convention for every sport: ``home_spread_line`` is
positive when the home side is favored, and it is the number of points the
home side must win by. The home side covers when
``home_score - away_score > home_spread_line``, and the bet pushes when the
two are equal. That matches nflverse ``games.csv`` (verified: 2023-09-07
KC was -198 with ``spread_line`` +4).

Two-way de-vig is ``p_i = q_i / (q_home + q_away)`` with ``q = 1/decimal``.
"""

from __future__ import annotations

import math

# -110 American, rounded to three decimal places. Used when a spread has no price.
JUICE_110 = 1.909

NFL_RELOCATED = {
    "OAK": "LV",
    "SD": "LAC",
    "STL": "LA",
}

NFL_NAMES = {
    "ARI": "Arizona Cardinals",
    "ATL": "Atlanta Falcons",
    "BAL": "Baltimore Ravens",
    "BUF": "Buffalo Bills",
    "CAR": "Carolina Panthers",
    "CHI": "Chicago Bears",
    "CIN": "Cincinnati Bengals",
    "CLE": "Cleveland Browns",
    "DAL": "Dallas Cowboys",
    "DEN": "Denver Broncos",
    "DET": "Detroit Lions",
    "GB": "Green Bay Packers",
    "HOU": "Houston Texans",
    "IND": "Indianapolis Colts",
    "JAX": "Jacksonville Jaguars",
    "KC": "Kansas City Chiefs",
    "LA": "Los Angeles Rams",
    "LAC": "Los Angeles Chargers",
    "LV": "Las Vegas Raiders",
    "MIA": "Miami Dolphins",
    "MIN": "Minnesota Vikings",
    "NE": "New England Patriots",
    "NO": "New Orleans Saints",
    "NYG": "New York Giants",
    "NYJ": "New York Jets",
    "PHI": "Philadelphia Eagles",
    "PIT": "Pittsburgh Steelers",
    "SEA": "Seattle Seahawks",
    "SF": "San Francisco 49ers",
    "TB": "Tampa Bay Buccaneers",
    "TEN": "Tennessee Titans",
    "WAS": "Washington Commanders",
}

# Canonical abbrev is the primary file's code.
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

# BetMGM city labels, including "LA Lakers".
MGM_CITY_TO_NBA = {
    "Atlanta": "atl",
    "Boston": "bos",
    "Brooklyn": "bkn",
    "Charlotte": "cha",
    "Chicago": "chi",
    "Cleveland": "cle",
    "Dallas": "dal",
    "Denver": "den",
    "Detroit": "det",
    "Golden State": "gs",
    "Houston": "hou",
    "Indiana": "ind",
    "LA Clippers": "lac",
    "LA Lakers": "lal",
    "Memphis": "mem",
    "Miami": "mia",
    "Milwaukee": "mil",
    "Minnesota": "min",
    "New Orleans": "no",
    "New York": "ny",
    "Oklahoma City": "okc",
    "Orlando": "orl",
    "Philadelphia": "phi",
    "Phoenix": "phx",
    "Portland": "por",
    "Sacramento": "sac",
    "San Antonio": "sa",
    "Toronto": "tor",
    "Utah": "utah",
    "Washington": "wsh",
}

# Canonical MLB abbrev. Relocations and archive spellings fold in here.
MLB_ALIASES = {
    "OAK": "ATH",
    "ATH": "ATH",
    "AZ": "ARI",
    "ARI": "ARI",
    "CUB": "CHC",
    "CHC": "CHC",
    "CWS": "CHW",
    "CHW": "CHW",
    "LOS": "LAD",
    "BRS": "BOS",
    "SDG": "SD",
    "SD": "SD",
    "SFO": "SF",
    "SF": "SF",
    "KAN": "KC",
    "KC": "KC",
    "TAM": "TB",
    "TBD": "TB",
    "TB": "TB",
    "FLA": "MIA",
    "MIA": "MIA",
    "ANA": "LAA",
    "LAA": "LAA",
    "WAS": "WSH",
    "WSH": "WSH",
    "NYN": "NYM",
    "NYM": "NYM",
    "NYA": "NYY",
    "NYY": "NYY",
    "KCR": "KC",
    "SDP": "SD",
    "SFG": "SF",
    "TBR": "TB",
    "WSN": "WSH",
}

MLB_NAMES = {
    "ARI": "Arizona Diamondbacks",
    "ATH": "Athletics",
    "ATL": "Atlanta Braves",
    "BAL": "Baltimore Orioles",
    "BOS": "Boston Red Sox",
    "CHC": "Chicago Cubs",
    "CHW": "Chicago White Sox",
    "CIN": "Cincinnati Reds",
    "CLE": "Cleveland Guardians",
    "COL": "Colorado Rockies",
    "DET": "Detroit Tigers",
    "HOU": "Houston Astros",
    "KC": "Kansas City Royals",
    "LAA": "Los Angeles Angels",
    "LAD": "Los Angeles Dodgers",
    "MIA": "Miami Marlins",
    "MIL": "Milwaukee Brewers",
    "MIN": "Minnesota Twins",
    "NYM": "New York Mets",
    "NYY": "New York Yankees",
    "PHI": "Philadelphia Phillies",
    "PIT": "Pittsburgh Pirates",
    "SD": "San Diego Padres",
    "SEA": "Seattle Mariners",
    "SF": "San Francisco Giants",
    "STL": "St. Louis Cardinals",
    "TB": "Tampa Bay Rays",
    "TEX": "Texas Rangers",
    "TOR": "Toronto Blue Jays",
    "WSH": "Washington Nationals",
}

# Half-open 5-point bins on de-vigged probability. The last bin includes 1.
PROB_BUCKETS: list[tuple[str, str, float, float]] = []
for _i in range(20):
    _low = _i * 0.05
    _high = _low + 0.05
    _label = f"{int(_low * 100)}–{int(_high * 100)}%"
    PROB_BUCKETS.append((f"p{_i:02d}", _label, _low, _high))


def canonical_nfl(code: str) -> str:
    """Fold relocated franchises onto the current abbrev. OAK->LV, SD->LAC, STL->LA."""
    key = code.strip().upper()
    mapped = NFL_RELOCATED.get(key, key)
    if mapped not in NFL_NAMES:
        raise KeyError(f"unknown NFL team {code}")
    return mapped


def canonical_nba(code: str) -> str:
    key = code.strip().lower()
    if key not in NBA_NAMES:
        raise KeyError(f"unknown NBA team {code}")
    return key


def canonical_nba_mgm(city: str) -> str:
    """Map a BetMGM label such as 'LA Lakers' onto the primary-file abbrev."""
    if city not in MGM_CITY_TO_NBA:
        raise KeyError(f"unknown BetMGM NBA team {city}")
    return MGM_CITY_TO_NBA[city]


def canonical_mlb(code: str) -> str:
    """Fold OAK/ATH and ARI/AZ, plus Sportsbook Review spellings, onto one abbrev."""
    key = code.strip().upper()
    mapped = MLB_ALIASES.get(key, key)
    if mapped not in MLB_NAMES:
        raise KeyError(f"unknown MLB team {code}")
    return mapped


def slugify(name: str) -> str:
    folded = name.lower()
    out = []
    prev_dash = False
    for char in folded:
        if char.isascii() and char.isalnum():
            out.append(char)
            prev_dash = False
        elif not prev_dash:
            out.append("-")
            prev_dash = True
    return "".join(out).strip("-")


def american_to_decimal(value) -> float | None:
    """American moneyline to decimal, rounded to 3 places. -110 is 1.909."""
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() in {"pk", "nl", "na", "nan", "none"}:
        return None
    try:
        number = float(text)
    except ValueError:
        return None
    if not math.isfinite(number) or number == 0:
        return None
    if number > 0:
        decimal = 1.0 + number / 100.0
    else:
        decimal = 1.0 + 100.0 / abs(number)
    decimal = round(decimal, 3)
    if decimal <= 1.0:
        return None
    return decimal


def grade_ats(home_score: int, away_score: int, home_spread_line: float) -> str:
    """Return 'home', 'away', or 'push'.

    ``home_spread_line`` is positive when home is favored.
    """
    margin = home_score - away_score
    if margin > home_spread_line:
        return "home"
    if margin < home_spread_line:
        return "away"
    return "push"


def grade_moneyline(home_score: int, away_score: int) -> str:
    """Return 'home', 'away', or 'push' (tie, graded as a refund)."""
    if home_score > away_score:
        return "home"
    if home_score < away_score:
        return "away"
    return "push"


def devig_two_way(home_decimal: float, away_decimal: float) -> tuple[float, float, float]:
    """Return (p_home, p_away, overround). Overround is q_home + q_away - 1."""
    if home_decimal <= 1.0 or away_decimal <= 1.0:
        raise ValueError("decimal odds must be > 1")
    q_home = 1.0 / home_decimal
    q_away = 1.0 / away_decimal
    total = q_home + q_away
    if total <= 0:
        raise ValueError("implied total must be positive")
    return q_home / total, q_away / total, total - 1.0


def bucket_for_probability(probability: float) -> tuple[str, str, float, float]:
    if probability < 0 or probability > 1:
        raise ValueError(probability)
    if probability == 1:
        index = 19
    else:
        index = int(probability / 0.05)
        if index > 19:
            index = 19
    return PROB_BUCKETS[index]


def merge_moneyline(parts: list[MoneylineSplit]) -> MoneylineSplit:
    total = MoneylineSplit()
    for part in parts:
        total.played += part.played
        total.won += part.won
        total.lost += part.lost
        total.ties += part.ties
        total.bets += part.bets
        total.pushes += part.pushes
        total.returned += part.returned
        total.odds_sum += part.odds_sum
    return total


def merge_ats(parts: list[AtsSplit]) -> AtsSplit:
    total = AtsSplit()
    for part in parts:
        total.covers += part.covers
        total.losses += part.losses
        total.pushes += part.pushes
        total.returned += part.returned
        total.odds_sum += part.odds_sum
    return total


def favorite_side(home_spread_line: float) -> str | None:
    """'home', 'away', or None when the number is a pick'em."""
    if home_spread_line > 0:
        return "home"
    if home_spread_line < 0:
        return "away"
    return None


class MoneylineSplit:
    def __init__(self) -> None:
        self.played = 0
        self.won = 0
        self.lost = 0
        self.ties = 0
        self.bets = 0
        self.pushes = 0
        self.returned = 0.0
        self.odds_sum = 0.0

    def add(self, result: str, odds: float | None) -> None:
        if result not in ("W", "L", "T"):
            raise ValueError(result)
        self.played += 1
        if result == "W":
            self.won += 1
        elif result == "L":
            self.lost += 1
        else:
            self.ties += 1
        if odds is None:
            return
        if odds <= 1.0:
            raise ValueError(odds)
        if result == "T":
            self.pushes += 1
            return
        self.bets += 1
        self.odds_sum += odds
        if result == "W":
            self.returned += odds

    def to_dict(self) -> dict:
        decided = self.won + self.lost + self.ties
        return {
            "played": self.played,
            "won": self.won,
            "lost": self.lost,
            "ties": self.ties,
            "winPct": round(100.0 * self.won / decided, 4) if decided else None,
            "bets": self.bets,
            "pushes": self.pushes,
            "staked": self.bets,
            "returned": round(self.returned, 6),
            "profit": round(self.returned - self.bets, 6),
            "roi": round((self.returned - self.bets) / self.bets, 6) if self.bets else None,
            "avgOdds": round(self.odds_sum / self.bets, 4) if self.bets else None,
        }


class AtsSplit:
    def __init__(self) -> None:
        self.covers = 0
        self.losses = 0
        self.pushes = 0
        self.returned = 0.0
        self.odds_sum = 0.0

    def add(self, outcome: str, odds: float) -> None:
        if outcome not in ("cover", "loss", "push"):
            raise ValueError(outcome)
        if odds <= 1.0:
            raise ValueError(odds)
        if outcome == "push":
            self.pushes += 1
            return
        if outcome == "cover":
            self.covers += 1
            self.returned += odds
        else:
            self.losses += 1
        self.odds_sum += odds

    def to_dict(self) -> dict:
        decided = self.covers + self.losses
        return {
            "bets": decided,
            "covers": self.covers,
            "losses": self.losses,
            "pushes": self.pushes,
            "coverPct": round(100.0 * self.covers / decided, 4) if decided else None,
            "staked": decided,
            "returned": round(self.returned, 6),
            "profit": round(self.returned - decided, 6),
            "roi": round((self.returned - decided) / decided, 6) if decided else None,
            "avgOdds": round(self.odds_sum / decided, 4) if decided else None,
        }


def empty_prob_buckets() -> dict[str, dict]:
    acc: dict[str, dict] = {}
    for bid, label, low, high in PROB_BUCKETS:
        acc[bid] = {
            "id": bid,
            "label": label,
            "minProb": low,
            "maxProb": high,
            "outcomes": 0,
            "wins": 0,
            "sumPredicted": 0.0,
            "sumBrier": 0.0,
            "sumOdds": 0.0,
        }
    return acc


def add_two_way_market(
    buckets: dict[str, dict],
    home_decimal: float,
    away_decimal: float,
    winner: str,
) -> float:
    """Record both sides. ``winner`` is 'home' or 'away'. Returns the overround."""
    if winner not in ("home", "away"):
        raise ValueError(winner)
    p_home, p_away, overround = devig_two_way(home_decimal, away_decimal)
    for side, probability, odds, won in (
        ("home", p_home, home_decimal, winner == "home"),
        ("away", p_away, away_decimal, winner == "away"),
    ):
        bid = bucket_for_probability(probability)[0]
        slot = buckets[bid]
        slot["outcomes"] += 1
        slot["sumPredicted"] += probability
        slot["sumOdds"] += odds
        slot["sumBrier"] += (probability - (1.0 if won else 0.0)) ** 2
        if won:
            slot["wins"] += 1
    return overround


def finalize_prob_buckets(buckets: dict[str, dict]) -> list[dict]:
    rows = []
    for bid, _, _, _ in PROB_BUCKETS:
        slot = buckets[bid]
        outcomes = slot["outcomes"]
        wins = slot["wins"]
        rows.append(
            {
                "id": slot["id"],
                "label": slot["label"],
                "minProb": slot["minProb"],
                "maxProb": slot["maxProb"],
                "outcomes": outcomes,
                "wins": wins,
                "actualWinRate": round(wins / outcomes, 6) if outcomes else None,
                "sumPredicted": round(slot["sumPredicted"], 6),
                "avgPredicted": round(slot["sumPredicted"] / outcomes, 6) if outcomes else None,
                "sumBrier": round(slot["sumBrier"], 6),
                "brier": round(slot["sumBrier"] / outcomes, 6) if outcomes else None,
                "sumOdds": round(slot["sumOdds"], 6),
                "avgOdds": round(slot["sumOdds"] / outcomes, 4) if outcomes else None,
            }
        )
    return rows
