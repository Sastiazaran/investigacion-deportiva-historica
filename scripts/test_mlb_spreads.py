"""Run lines outside 2.5 are archive totals, not bets."""

from __future__ import annotations

import unittest

from build_us_sports import scrub_mlb_spreads


class MlbSpreadTest(unittest.TestCase):
    def test_a_total_stored_as_a_spread_is_removed_and_a_run_line_stays(self):
        games = [
            {"home_spread": -9.0, "home_spread_odds": 1.91, "away_spread_odds": 1.91},
            {"home_spread": 1.5, "home_spread_odds": 1.87, "away_spread_odds": 1.95},
            {"home_spread": None, "home_spread_odds": None, "away_spread_odds": None},
        ]
        dropped = scrub_mlb_spreads(games)
        self.assertEqual(dropped, 1)
        self.assertIsNone(games[0]["home_spread"])
        self.assertIsNone(games[0]["home_spread_odds"])
        self.assertEqual(games[1]["home_spread"], 1.5)


if __name__ == "__main__":
    unittest.main()
