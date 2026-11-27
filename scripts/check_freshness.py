#!/usr/bin/env python3
"""Warn when an in-season competition has stopped updating.

Reads the built football matches and web/public/data/line-dates.json.
Prints one row per competition. Stale rows become GitHub Actions warnings
and a job-summary note, and the process still exits 0 so the refresh can
be committed. Missing or unreadable match data is a broken build and
exits 1. Offseason competitions are reported and do not warn.
"""

from __future__ import annotations

import json
import os
import sys
from datetime import date, datetime
from pathlib import Path
from typing import NoReturn

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


def _broken(message: str) -> NoReturn:
    print(f"BROKEN BUILD: {message}", file=sys.stderr)
    raise SystemExit(1)


def load_matches() -> dict:
    if not MATCHES.is_file():
        _broken(f"{MATCHES} is missing")
    try:
        payload = json.loads(MATCHES.read_text())
    except json.JSONDecodeError as exc:
        _broken(f"{MATCHES} is not valid JSON ({exc})")
    matches = payload.get("matches") if isinstance(payload, dict) else None
    if not isinstance(matches, list) or not matches:
        _broken(f"{MATCHES} has no matches")
    return payload


def football_dates(payload: dict) -> tuple[dict[str, date | None], dict[str, date | None]]:
    games: dict[str, str] = {}
    prices: dict[str, str] = {}
    for match in payload["matches"]:
        code = match.get("league")
        try:
            name = LEAGUE_NAMES[code]
        except KeyError:
            _broken(f"unknown league code {code!r} in {MATCHES}")
        if match["date"] > games.get(name, ""):
            games[name] = match["date"]
        if match.get("closing") and match["date"] > prices.get(name, ""):
            prices[name] = match["date"]
    return (
        {name: _parse(value) for name, value in games.items()},
        {name: _parse(prices.get(name)) for name in games},
    )


def warning_command(row: dict) -> str:
    return f"::warning title=Stale competition::{row['competition']}: {row['reason']}"


def summary_text(rows: list[dict]) -> str:
    failed = stale_rows(rows)
    if not failed:
        body = "All in-season competitions are inside the freshness threshold."
    else:
        items = "\n".join(f"- **{row['competition']}**: {row['reason']}" for row in failed)
        body = (
            "Stale competitions (warning only; the rebuilt data is still committed):\n\n" + items
        )
    return f"## Freshness\n\n{body}\n"


def emit_warnings(rows: list[dict]) -> None:
    failed = stale_rows(rows)
    for row in failed:
        # Flush so Actions sees the annotation even when stdout is fully buffered.
        print(warning_command(row), flush=True)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write(summary_text(rows))
    if failed:
        names = ", ".join(row["competition"] for row in failed)
        print(
            f"WARNING: stale competitions will still be published: {names}",
            file=sys.stderr,
        )
        return
    print("All in-season competitions are inside the freshness threshold.")


def main() -> None:
    today = datetime.now().date()
    game_dates, price_dates = football_dates(load_matches())
    if LINE_DATES.exists():
        try:
            lines = json.loads(LINE_DATES.read_text())
        except json.JSONDecodeError as exc:
            _broken(f"{LINE_DATES} is not valid JSON ({exc})")
        if not isinstance(lines, dict):
            _broken(f"{LINE_DATES} is not an object")
        for label, row in lines.items():
            if not isinstance(row, dict):
                _broken(f"line-dates row {label!r} is not an object")
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
    emit_warnings(rows)


if __name__ == "__main__":
    main()
