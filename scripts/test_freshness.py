"""Season windows. No files, no network."""

from __future__ import annotations

import unittest
from datetime import date

from freshness import assess, assess_all, europe_in_season, liga_mx_in_season, mlb_in_season, nba_in_season, nfl_in_season, stale_rows


class FreshnessTest(unittest.TestCase):
    def test_windows_around_the_known_calendar(self):
        self.assertTrue(europe_in_season(date(2026, 11, 3)))
        self.assertFalse(europe_in_season(date(2026, 7, 15)))
        self.assertTrue(liga_mx_in_season(date(2026, 11, 3)))
        self.assertFalse(liga_mx_in_season(date(2026, 12, 28)))
        self.assertTrue(nfl_in_season(date(2026, 11, 3)))
        self.assertFalse(nfl_in_season(date(2026, 3, 20)))
        self.assertTrue(nba_in_season(date(2026, 11, 3)))
        self.assertFalse(nba_in_season(date(2026, 8, 1)))
        self.assertTrue(mlb_in_season(date(2026, 10, 28)))
        self.assertFalse(mlb_in_season(date(2026, 12, 1)))

    def test_in_season_gap_fails_and_offseason_does_not(self):
        stale = assess("NBA", date(2026, 6, 13), date(2026, 11, 3), nba_in_season, 10)
        self.assertEqual(stale["status"], "stale")
        quiet = assess("MLB", date(2026, 10, 28), date(2026, 12, 20), mlb_in_season, 8)
        self.assertEqual(quiet["status"], "offseason")
        fresh = assess("NFL", date(2026, 11, 1), date(2026, 11, 3), nfl_in_season, 11)
        self.assertEqual(fresh["status"], "fresh")
        missing = assess("MLB", None, date(2026, 6, 1), mlb_in_season, 8)
        self.assertEqual(missing["status"], "stale")

    def test_assess_all_collects_only_the_stale_rows(self):
        rows = assess_all(
            {
                "Premier League": date(2026, 10, 25),
                "La Liga": date(2026, 10, 26),
                "Serie A": date(2026, 10, 29),
                "Bundesliga": date(2026, 10, 25),
                "Ligue 1": date(2026, 10, 26),
                "Eredivisie": date(2026, 10, 25),
                "Primeira Liga": date(2026, 10, 26),
                "Liga MX": date(2026, 10, 29),
                "NFL": date(2026, 11, 2),
                "NBA": date(2026, 6, 13),
                "MLB": date(2025, 8, 16),
            },
            date(2026, 11, 3),
        )
        names = [row["competition"] for row in stale_rows(rows)]
        self.assertEqual(names, ["NBA", "MLB"])


if __name__ == "__main__":
    unittest.main()
