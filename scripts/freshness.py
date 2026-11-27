"""Season windows and the staleness rule for the Friday data job.

A competition is stale when today falls inside its season and the latest
final is older than the threshold. Offseason silence is not stale.
The Friday job records stale competitions as warnings and still publishes
the rebuilt files. A broken build is the only hard failure.

The European threshold is 25 days so it covers an international break
plus a cup weekend. The All-Star gap sits inside the NBA threshold.
"""

from __future__ import annotations

from datetime import date, datetime


def _on_or_after(day: date, month: int, day_of_month: int) -> bool:
    return (day.month, day.day) >= (month, day_of_month)


def _on_or_before(day: date, month: int, day_of_month: int) -> bool:
    return (day.month, day.day) <= (month, day_of_month)


def europe_in_season(day: date) -> bool:
    """Top European leagues, early August through the end of May."""
    return _on_or_after(day, 8, 7) or _on_or_before(day, 5, 31)


def liga_mx_in_season(day: date) -> bool:
    """Apertura and Clausura. The winter break and the summer break are out."""
    apertura = _on_or_after(day, 7, 10) and _on_or_before(day, 12, 18)
    clausura = _on_or_after(day, 1, 8) and _on_or_before(day, 5, 28)
    return apertura or clausura


def nfl_in_season(day: date) -> bool:
    return _on_or_after(day, 9, 5) or _on_or_before(day, 2, 16)


def nba_in_season(day: date) -> bool:
    return _on_or_after(day, 10, 15) or _on_or_before(day, 6, 25)


def mlb_in_season(day: date) -> bool:
    return _on_or_after(day, 3, 18) and _on_or_before(day, 11, 6)


# 25 days covers an international break plus a cup weekend.
EUROPE_STALE_DAYS = 25

# name, in-season predicate, maximum age of the latest final in days
COMPETITIONS = (
    ("Premier League", europe_in_season, EUROPE_STALE_DAYS),
    ("La Liga", europe_in_season, EUROPE_STALE_DAYS),
    ("Serie A", europe_in_season, EUROPE_STALE_DAYS),
    ("Bundesliga", europe_in_season, EUROPE_STALE_DAYS),
    ("Ligue 1", europe_in_season, EUROPE_STALE_DAYS),
    ("Eredivisie", europe_in_season, EUROPE_STALE_DAYS),
    ("Primeira Liga", europe_in_season, EUROPE_STALE_DAYS),
    ("Liga MX", liga_mx_in_season, 16),
    ("NFL", nfl_in_season, 11),
    ("NBA", nba_in_season, 10),
    ("MLB", mlb_in_season, 8),
)


def assess(name: str, latest: date | None, today: date, in_season, threshold_days: int) -> dict:
    age = None if latest is None else (today - latest).days
    active = bool(in_season(today))
    if not active:
        status = "offseason"
        reason = "outside the season window"
    elif latest is None:
        status = "stale"
        reason = "in season and there is no completed game"
    elif age is not None and age > threshold_days:
        status = "stale"
        reason = f"latest game {latest.isoformat()} is {age} days old; threshold is {threshold_days}"
    else:
        status = "fresh"
        reason = f"latest game {latest.isoformat()} is {age} days old; threshold is {threshold_days}"
    return {
        "competition": name,
        "status": status,
        "latest": None if latest is None else latest.isoformat(),
        "ageDays": age,
        "thresholdDays": threshold_days,
        "inSeason": active,
        "reason": reason,
    }


def assess_all(latest_by_name: dict[str, date | None], today: date | None = None) -> list[dict]:
    current = today or datetime.now().date()
    rows = []
    for name, in_season, threshold in COMPETITIONS:
        rows.append(assess(name, latest_by_name.get(name), current, in_season, threshold))
    return rows


def stale_rows(rows: list[dict]) -> list[dict]:
    return [row for row in rows if row["status"] == "stale"]
