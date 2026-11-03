#!/usr/bin/env python3
"""Fail when an in-season competition has stopped updating.

Reads the built football matches and web/public/data/line-dates.json.
Prints one row per competition and exits 1 if any row is stale.
Offseason competitions are reported and do not fail the job.
"""

from __future__ import annotations

import json
import sys
from datetime import date, datetime
from pathlib import Path

from freshness import COMPETITIONS, assess, assess_all, stale_rows

ROOT = Path(__file__).resolve().parents[1]
MATCHES = ROOT / "web" / "public" / "data" / "matches.json"
LINE_DATES = ROOT / "web" / "public" / "data" / "line-dates.json"
REPORT = ROOT / "web" / "public" / "data" / "freshness.json"

LEAGUE_NAMES = {
    "E0": "Premier League",
    "SP1": "La Liga",
    "I1": "Serie A",
    "D1": "Bundesliga",
    "F1": "Ligue 1",
    "N1": "Eredivisie",
    "P1": "Primeira Liga",
    "MEX": "Liga MX",
}


def _parse(value: str | None) -> date | None:
    if not value:
        return None
    return date.fromisoformat(value[:10])


def football_dates() -> tuple[dict[str, date | None], dict[str, date | None]]:
    payload = json.loads(MATCHES.read_text())
    games: dict[str, str] = {}
    prices: dict[str, str] = {}
    for match in payload["matches"]:
        name = LEAGUE_NAMES[match["league"]]
        if match["date"] > games.get(name, ""):
            games[name] = match["date"]
        if match.get("closing") and match["date"] > prices.get(name, ""):
            prices[name] = match["date"]
    return (
        {name: _parse(value) for name, value in games.items()},
        {name: _parse(prices.get(name)) for name in games},
    )


def main() -> None:
    today = datetime.now().date()
    game_dates, price_dates = football_dates()
    if LINE_DATES.exists():
        lines = json.loads(LINE_DATES.read_text())
        for label, row in lines.items():
            game_dates[label] = _parse(row.get("game"))
            price_dates[label] = _parse(row.get("moneyline"))
    else:
        print("line-dates.json is missing. US moneyline dates were not checked.", file=sys.stderr)

    rows = assess_all(game_dates, today)
    windows = {name: (predicate, threshold) for name, predicate, threshold in COMPETITIONS}
    for name, (predicate, threshold) in windows.items():
        rows.append(assess(f"{name} closing lines", price_dates.get(name), today, predicate, threshold))

    for row in rows:
        print(f"{row['status'].upper():9} {row['competition']}: {row['reason']}")

    report = {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "today": today.isoformat(),
        "rows": rows,
        "stale": [row["competition"] for row in stale_rows(rows)],
    }
    REPORT.write_text(json.dumps(report, indent=2) + "\n")
    failed = stale_rows(rows)
    if failed:
        names = ", ".join(row["competition"] for row in failed)
        print(f"STALE: {names}", file=sys.stderr)
        raise SystemExit(1)
    print("All in-season competitions are inside the freshness threshold.")


if __name__ == "__main__":
    main()
