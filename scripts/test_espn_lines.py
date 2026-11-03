"""ESPN close parsing. No network."""

from __future__ import annotations

import unittest

from espn_lines import choose_odds, parse_event, parse_odds_item, us_game_date


class EspnLinesTest(unittest.TestCase):
    def test_us_date_rolls_back_a_west_coast_night(self):
        self.assertEqual(us_game_date("2026-11-03T02:30:00Z"), "2026-11-02")
        self.assertEqual(us_game_date("2026-11-02T18:00:00Z"), "2026-11-02")

    def test_nba_close_sign_and_prices(self):
        item = {
            "provider": {"name": "DraftKings"},
            "spread": -4.5,
            "overUnder": 229.5,
            "overOdds": -110,
            "underOdds": -110,
            "homeTeamOdds": {
                "spreadOdds": -105,
                "close": {
                    "pointSpread": {"american": "-4.5"},
                    "spread": {"decimal": 1.95, "american": "-105"},
                    "moneyLine": {"decimal": 1.57, "american": "-173"},
                },
            },
            "awayTeamOdds": {
                "close": {
                    "spread": {"decimal": 1.87, "american": "-115"},
                    "moneyLine": {"decimal": 2.46, "american": "+146"},
                },
            },
        }
        parsed = parse_odds_item(item)
        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertEqual(parsed["home_spread"], 4.5)
        self.assertEqual(parsed["home_ml"], 1.57)
        self.assertEqual(parsed["away_ml"], 2.46)
        self.assertEqual(parsed["home_spread_odds"], 1.95)
        self.assertEqual(parsed["total_line"], 229.5)
        self.assertEqual(parsed["ml_source"], "espn-close:DraftKings")

    def test_run_line_uses_the_home_point_spread(self):
        item = {
            "provider": {"name": "ESPN BET"},
            "spread": 1.5,
            "overUnder": 8.5,
            "overOdds": -105,
            "underOdds": -115,
            "homeTeamOdds": {
                "close": {
                    "pointSpread": {"american": "+1.5", "decimal": 0.0},
                    "spread": {"decimal": 1.83},
                    "moneyLine": {"decimal": 2.1},
                }
            },
            "awayTeamOdds": {
                "close": {
                    "spread": {"decimal": 1.95},
                    "moneyLine": {"decimal": 1.74},
                }
            },
        }
        parsed = parse_odds_item(item)
        assert parsed is not None
        self.assertEqual(parsed["home_spread"], -1.5)
        self.assertAlmostEqual(parsed["over_odds"], 1.952, places=3)

    def test_choose_prefers_draftkings_when_both_books_price_the_game(self):
        chosen = choose_odds(
            {
                "items": [
                    {
                        "provider": {"name": "ESPN BET"},
                        "homeTeamOdds": {"close": {"moneyLine": {"decimal": 1.5}}},
                        "awayTeamOdds": {"close": {"moneyLine": {"decimal": 2.6}}},
                    },
                    {
                        "provider": {"name": "DraftKings"},
                        "spread": -3.5,
                        "homeTeamOdds": {"close": {"moneyLine": {"decimal": 1.6}, "pointSpread": {"american": "-3.5"}}},
                        "awayTeamOdds": {"close": {"moneyLine": {"decimal": 2.4}}},
                    },
                ]
            }
        )
        assert chosen is not None
        self.assertEqual(chosen["provider"], "DraftKings")
        self.assertEqual(chosen["home_ml"], 1.6)

    def test_final_nba_game_uses_the_ending_season_year(self):
        event = {
            "id": "401",
            "date": "2026-10-23T02:00:00Z",
            "season": {"year": 2027, "type": 2},
            "status": {"type": {"name": "STATUS_FINAL"}},
            "competitions": [
                {
                    "date": "2026-10-23T02:00:00Z",
                    "competitors": [
                        {"homeAway": "home", "score": "110", "team": {"abbreviation": "BOS"}},
                        {"homeAway": "away", "score": "99", "team": {"abbreviation": "NY"}},
                    ],
                }
            ],
        }
        game = parse_event(event, "nba")
        assert game is not None
        self.assertEqual(game["date"], "2026-10-22")
        self.assertEqual(game["season"], 2026)
        self.assertEqual(game["phase"], "regular")
        self.assertEqual(game["home"], "bos")
        self.assertEqual(game["away"], "ny")
        self.assertEqual(game["home_score"], 110)

    def test_preseason_and_all_star_are_dropped(self):
        final = {
            "id": "9",
            "date": "2026-10-10T23:00:00Z",
            "season": {"year": 2027, "type": 1},
            "status": {"type": {"name": "STATUS_FINAL"}},
            "competitions": [
                {
                    "date": "2026-10-10T23:00:00Z",
                    "competitors": [
                        {"homeAway": "home", "score": "1", "team": {"abbreviation": "BOS"}},
                        {"homeAway": "away", "score": "2", "team": {"abbreviation": "NY"}},
                    ],
                }
            ],
        }
        self.assertIsNone(parse_event(final, "nba"))
        stars = {
            "id": "8",
            "date": "2026-07-15T00:00:00Z",
            "season": {"year": 2026, "type": 3},
            "status": {"type": {"name": "STATUS_FINAL"}},
            "competitions": [
                {
                    "date": "2026-07-15T00:00:00Z",
                    "competitors": [
                        {"homeAway": "home", "score": "4", "team": {"abbreviation": "AL"}},
                        {"homeAway": "away", "score": "3", "team": {"abbreviation": "NL"}},
                    ],
                }
            ],
        }
        self.assertIsNone(parse_event(stars, "mlb"))

    def test_mlb_playoff_keeps_the_calendar_season(self):
        event = {
            "id": "77",
            "date": "2026-10-25T00:10:00Z",
            "season": {"type": 3, "year": 2026},
            "status": {"type": {"name": "STATUS_FINAL"}},
            "competitions": [
                {
                    "date": "2026-10-25T00:10:00Z",
                    "competitors": [
                        {"homeAway": "home", "score": "5", "team": {"abbreviation": "MIL"}},
                        {"homeAway": "away", "score": "4", "team": {"abbreviation": "TB"}},
                    ],
                }
            ],
        }
        game = parse_event(event, "mlb")
        assert game is not None
        self.assertEqual(game["phase"], "playoff")
        self.assertEqual(game["season"], 2026)
        self.assertEqual(game["home"], "MIL")
        self.assertEqual(game["away"], "TB")
        self.assertEqual(game["date"], "2026-10-24")


if __name__ == "__main__":
    unittest.main()
