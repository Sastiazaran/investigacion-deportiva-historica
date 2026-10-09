"""ROI and calibration math for flat bets at closing decimal odds.

Stake is always 1 unit. A winning bet returns the decimal odds (profit = odds - 1);
a losing bet returns 0 (profit = -1). ROI is total profit divided by total stake.

Closing-price selection, per match, when every price in the trio is a decimal
odds value strictly greater than 1:

1. Pinnacle closing (PSCH/PSCD/PSCA)
2. Pinnacle (PSH/PSD/PSA, or the older PH/PD/PA headers)
3. Bet365 (B365H/B365D/B365A, or B365CH/B365CD/B365CA when the pre-closing
   Bet365 columns are absent, as in the Liga MX file)

Calibration treats each of the three outcomes (home, draw, away) as one
observation. Implied probability is 1/odds with the market overround removed:

    fair_i = (1/odds_i) / (1/odds_home + 1/odds_draw + 1/odds_away)

Buckets are half-open on the decimal closing odds, with 0.05-wide buckets
from 1.20 up to 1.50.
"""

from __future__ import annotations

ODDS_SOURCES = ("PSC", "PS", "B365")

# (id, label, min_inclusive, max_exclusive or None)
BUCKETS: list[tuple[str, str, float, float | None]] = [
    ("lt-1.20", "< 1.20", 1.0, 1.20),
    ("1.20-1.25", "1.20–1.25", 1.20, 1.25),
    ("1.25-1.30", "1.25–1.30", 1.25, 1.30),
    ("1.30-1.35", "1.30–1.35", 1.30, 1.35),
    ("1.35-1.40", "1.35–1.40", 1.35, 1.40),
    ("1.40-1.45", "1.40–1.45", 1.40, 1.45),
    ("1.45-1.50", "1.45–1.50", 1.45, 1.50),
    ("1.50-1.70", "1.50–1.70", 1.50, 1.70),
    ("1.70-2.00", "1.70–2.00", 1.70, 2.00),
    ("2.00-2.50", "2.00–2.50", 2.00, 2.50),
    ("2.50-3.50", "2.50–3.50", 2.50, 3.50),
    ("3.50-5.00", "3.50–5.00", 3.50, 5.00),
    ("5.00-10.00", "5.00–10.00", 5.00, 10.0),
    ("10.00+", "10.00+", 10.0, None),
]

TRIPLET_KEYS = {
    "PSC": ("PSCH", "PSCD", "PSCA"),
    "PS": ("PSH", "PSD", "PSA"),
    "PS_ALT": ("PH", "PD", "PA"),
    "B365": ("B365H", "B365D", "B365A"),
    "B365C": ("B365CH", "B365CD", "B365CA"),
}


def parse_triplet(row: dict, keys: tuple[str, str, str]) -> tuple[float, float, float] | None:
    """Return (home, draw, away) decimal odds, or None if any price is unusable."""
    values: list[float] = []
    for key in keys:
        raw = row.get(key)
        if raw is None:
            return None
        text = str(raw).strip()
        if not text:
            return None
        try:
            number = float(text)
        except ValueError:
            return None
        if number <= 1.0:
            return None
        values.append(number)
    return (values[0], values[1], values[2])


def select_closing(
    row: dict,
) -> tuple[tuple[float, float, float] | None, str | None, dict]:
    """Pick the closing trio and also return whichever raw books were present.

    The side dict always has keys b365, pinnacle, pinnacleClosing. Values are
    triplets or None. Closing falls back in the order documented above.
    """
    b365 = parse_triplet(row, TRIPLET_KEYS["B365"])
    if b365 is None:
        b365 = parse_triplet(row, TRIPLET_KEYS["B365C"])
    pinnacle = parse_triplet(row, TRIPLET_KEYS["PS"])
    if pinnacle is None:
        pinnacle = parse_triplet(row, TRIPLET_KEYS["PS_ALT"])
    pinnacle_closing = parse_triplet(row, TRIPLET_KEYS["PSC"])

    books = {
        "b365": b365,
        "pinnacle": pinnacle,
        "pinnacleClosing": pinnacle_closing,
    }
    if pinnacle_closing is not None:
        return pinnacle_closing, "PSC", books
    if pinnacle is not None:
        return pinnacle, "PS", books
    if b365 is not None:
        return b365, "B365", books
    return None, None, books


def remove_overround(
    home: float, draw: float, away: float
) -> tuple[float, float, float]:
    """De-vig a 1X2 market. Prices must be decimal odds > 1."""
    raw = (1.0 / home, 1.0 / draw, 1.0 / away)
    total = raw[0] + raw[1] + raw[2]
    if total <= 0:
        raise ValueError("overround total must be positive")
    return (raw[0] / total, raw[1] / total, raw[2] / total)


def bucket_for_odds(odds: float) -> tuple[str, str, float, float | None]:
    if odds <= 1.0:
        raise ValueError(f"decimal odds must be > 1, got {odds}")
    for spec in BUCKETS:
        _, _, low, high = spec
        if odds >= low and (high is None or odds < high):
            return spec
    raise ValueError(f"no bucket for odds {odds}")


class Split:
    """Win/draw/loss counts plus flat-stake betting totals."""

    def __init__(self) -> None:
        self.played = 0
        self.won = 0
        self.drawn = 0
        self.lost = 0
        self.bets = 0
        self.returned = 0.0
        self.odds_sum = 0.0

    def add_result(self, result: str) -> None:
        if result not in ("W", "D", "L"):
            raise ValueError(result)
        self.played += 1
        if result == "W":
            self.won += 1
        elif result == "D":
            self.drawn += 1
        else:
            self.lost += 1

    def add_bet(self, odds: float, won: bool) -> None:
        if odds <= 1.0:
            raise ValueError(odds)
        self.bets += 1
        self.odds_sum += odds
        if won:
            self.returned += odds

    @property
    def profit(self) -> float:
        return self.returned - self.bets

    @property
    def roi(self) -> float | None:
        if self.bets == 0:
            return None
        return self.profit / self.bets

    def to_dict(self) -> dict:
        profit = self.profit
        return {
            "played": self.played,
            "won": self.won,
            "drawn": self.drawn,
            "lost": self.lost,
            "winPct": round(100.0 * self.won / self.played, 4) if self.played else None,
            "bets": self.bets,
            "staked": self.bets,
            "returned": round(self.returned, 6),
            "profit": round(profit, 6),
            "roi": round(profit / self.bets, 6) if self.bets else None,
            "avgOdds": round(self.odds_sum / self.bets, 4) if self.bets else None,
        }


def combine_splits(parts: list[Split]) -> Split:
    total = Split()
    for part in parts:
        total.played += part.played
        total.won += part.won
        total.drawn += part.drawn
        total.lost += part.lost
        total.bets += part.bets
        total.returned += part.returned
        total.odds_sum += part.odds_sum
    return total


def empty_bucket_accumulators() -> dict[str, dict]:
    acc: dict[str, dict] = {}
    for bid, label, low, high in BUCKETS:
        acc[bid] = {
            "id": bid,
            "label": label,
            "minOdds": low,
            "maxOdds": high,
            "outcomes": 0,
            "wins": 0,
            "sumImpliedProb": 0.0,
            "sumOdds": 0.0,
        }
    return acc


def add_market_to_calibration(
    buckets: dict[str, dict],
    home: float,
    draw: float,
    away: float,
    result: str,
) -> None:
    """Record the three outcomes of one match into odds buckets."""
    if result not in ("H", "D", "A"):
        raise ValueError(result)
    fair = remove_overround(home, draw, away)
    settled = {"H": 0, "D": 1, "A": 2}[result]
    for index, odds in enumerate((home, draw, away)):
        bid = bucket_for_odds(odds)[0]
        slot = buckets[bid]
        slot["outcomes"] += 1
        slot["sumImpliedProb"] += fair[index]
        slot["sumOdds"] += odds
        if index == settled:
            slot["wins"] += 1


def finalize_buckets(buckets: dict[str, dict]) -> list[dict]:
    rows: list[dict] = []
    for bid, _, _, _ in BUCKETS:
        slot = buckets[bid]
        outcomes = slot["outcomes"]
        wins = slot["wins"]
        rows.append(
            {
                "id": slot["id"],
                "label": slot["label"],
                "minOdds": slot["minOdds"],
                "maxOdds": slot["maxOdds"],
                "outcomes": outcomes,
                "wins": wins,
                "actualWinRate": round(wins / outcomes, 6) if outcomes else None,
                "sumImpliedProb": round(slot["sumImpliedProb"], 6),
                "avgImpliedProb": round(slot["sumImpliedProb"] / outcomes, 6)
                if outcomes
                else None,
                "sumOdds": round(slot["sumOdds"], 6),
                "avgOdds": round(slot["sumOdds"] / outcomes, 4) if outcomes else None,
            }
        )
    return rows


def result_for_side(side: str, ftr: str) -> str:
    """W/D/L for the home or away club."""
    if side not in ("home", "away") or ftr not in ("H", "D", "A"):
        raise ValueError((side, ftr))
    if ftr == "D":
        return "D"
    if side == "home":
        return "W" if ftr == "H" else "L"
    return "W" if ftr == "A" else "L"
