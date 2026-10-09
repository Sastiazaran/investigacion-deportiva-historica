"""Tests for flat-bet ROI, overround removal, and odds-bucket calibration."""

from __future__ import annotations

import unittest

from metrics import (
    Split,
    add_market_to_calibration,
    bucket_for_odds,
    combine_splits,
    empty_bucket_accumulators,
    finalize_buckets,
    parse_triplet,
    remove_overround,
    result_for_side,
    select_closing,
)


class ClosingOddsTests(unittest.TestCase):
    def test_prefers_pinnacle_closing_over_earlier_prices(self):
        row = {
            "PSCH": "1.40",
            "PSCD": "4.50",
            "PSCA": "8.00",
            "PSH": "1.50",
            "PSD": "4.20",
            "PSA": "7.00",
            "B365H": "1.44",
            "B365D": "4.33",
            "B365A": "7.50",
        }
        closing, source, books = select_closing(row)
        self.assertEqual(source, "PSC")
        self.assertEqual(closing, (1.40, 4.50, 8.00))
        self.assertEqual(books["b365"], (1.44, 4.33, 7.50))
        self.assertEqual(books["pinnacle"], (1.50, 4.20, 7.00))

    def test_falls_back_to_pinnacle_then_bet365(self):
        pinnacle_only = {
            "PSH": "2.10",
            "PSD": "3.40",
            "PSA": "3.60",
            "B365H": "2.05",
            "B365D": "3.30",
            "B365A": "3.70",
        }
        closing, source, _ = select_closing(pinnacle_only)
        self.assertEqual(source, "PS")
        self.assertEqual(closing, (2.10, 3.40, 3.60))

        bet365_only = {"B365H": "1.90", "B365D": "3.40", "B365A": "4.20"}
        closing, source, _ = select_closing(bet365_only)
        self.assertEqual(source, "B365")
        self.assertEqual(closing, (1.90, 3.40, 4.20))

    def test_older_pinnacle_headers_and_bet365_closing_columns(self):
        row = {"PH": "2.2", "PD": "3.2", "PA": "3.4"}
        closing, source, books = select_closing(row)
        self.assertEqual(source, "PS")
        self.assertEqual(books["pinnacle"], (2.2, 3.2, 3.4))

        # Liga MX file publishes B365CH/CD/CA and no pre-closing B365H.
        mex = {"B365CH": "1.83", "B365CD": "3.60", "B365CA": "4.20"}
        closing, source, books = select_closing(mex)
        self.assertEqual(source, "B365")
        self.assertEqual(closing, (1.83, 3.60, 4.20))
        self.assertEqual(books["pinnacleClosing"], None)

    def test_rejects_missing_short_or_unit_prices(self):
        self.assertIsNone(parse_triplet({"B365H": "", "B365D": "3", "B365A": "4"}, ("B365H", "B365D", "B365A")))
        self.assertIsNone(parse_triplet({"B365H": "1", "B365D": "3", "B365A": "4"}, ("B365H", "B365D", "B365A")))
        self.assertIsNone(parse_triplet({"B365H": "0.9", "B365D": "3", "B365A": "4"}, ("B365H", "B365D", "B365A")))
        closing, source, _ = select_closing({"B365H": "1.5", "B365D": "", "B365A": "6"})
        self.assertIsNone(closing)
        self.assertIsNone(source)


class OverroundTests(unittest.TestCase):
    def test_fair_market_is_unchanged(self):
        self.assertEqual(remove_overround(2.0, 4.0, 4.0), (0.5, 0.25, 0.25))

    def test_overround_is_removed_proportionally(self):
        home, draw, away = remove_overround(1.5, 4.0, 6.0)
        raw = (1 / 1.5, 1 / 4.0, 1 / 6.0)
        total = sum(raw)
        self.assertAlmostEqual(home, raw[0] / total)
        self.assertAlmostEqual(draw, raw[1] / total)
        self.assertAlmostEqual(away, raw[2] / total)
        self.assertAlmostEqual(home + draw + away, 1.0)
        # The raw home price overstates the chance because of the overround.
        self.assertLess(home, raw[0])


class RoiTests(unittest.TestCase):
    def test_always_betting_a_short_price_can_still_profit(self):
        """Eight wins and two losses at 1.30: the 'Porto at 1.30' question."""
        split = Split()
        for won in (True, True, True, True, True, True, True, True, False, False):
            split.add_result("W" if won else "L")
            split.add_bet(1.30, won)
        # profit = 8 * 0.30 + 2 * -1 = 0.40; roi = 0.40 / 10
        self.assertAlmostEqual(split.profit, 0.40)
        self.assertAlmostEqual(split.roi, 0.04)
        published = split.to_dict()
        self.assertEqual(published["bets"], 10)
        self.assertEqual(published["staked"], 10)
        self.assertAlmostEqual(published["roi"], 0.04)
        self.assertAlmostEqual(published["avgOdds"], 1.30)
        self.assertAlmostEqual(published["winPct"], 80.0)

    def test_loss_and_even_money_push(self):
        lost = Split()
        lost.add_bet(1.30, False)
        self.assertEqual(lost.profit, -1)
        self.assertEqual(lost.roi, -1)

        push = Split()
        push.add_bet(2.0, True)
        push.add_bet(2.0, False)
        self.assertAlmostEqual(push.profit, 0.0)
        self.assertAlmostEqual(push.roi, 0.0)

    def test_matches_without_odds_stay_in_the_record_but_not_the_roi(self):
        split = Split()
        split.add_result("W")
        split.add_result("L")
        split.add_bet(1.50, True)
        published = split.to_dict()
        self.assertEqual(published["played"], 2)
        self.assertEqual(published["bets"], 1)
        self.assertAlmostEqual(published["profit"], 0.50)
        self.assertAlmostEqual(published["roi"], 0.50)

    def test_no_bets_leaves_roi_null(self):
        split = Split()
        split.add_result("D")
        self.assertIsNone(split.roi)
        self.assertIsNone(split.to_dict()["roi"])
        self.assertIsNone(split.to_dict()["avgOdds"])

    def test_home_and_away_are_separate_flat_bets(self):
        home = Split()
        away = Split()
        # Home win at 1.50, away loss at 2.20.
        home.add_result(result_for_side("home", "H"))
        home.add_bet(1.50, result_for_side("home", "H") == "W")
        away.add_result(result_for_side("away", "H"))
        away.add_bet(2.20, result_for_side("away", "H") == "W")
        # Second match is a draw: both sides lose the win bet.
        for side, split, odds in (("home", home, 1.80), ("away", away, 4.50)):
            outcome = result_for_side(side, "D")
            split.add_result(outcome)
            split.add_bet(odds, outcome == "W")

        self.assertEqual(home.won, 1)
        self.assertEqual(home.drawn, 1)
        self.assertEqual(away.won, 0)
        self.assertEqual(away.lost, 1)
        self.assertEqual(away.drawn, 1)
        self.assertAlmostEqual(home.profit, 0.50 + (1.80 - 1) * 0 - 1)
        self.assertAlmostEqual(away.profit, -2)

        overall = combine_splits([home, away])
        self.assertEqual(overall.played, 4)
        self.assertEqual(overall.bets, 4)
        self.assertAlmostEqual(overall.profit, home.profit + away.profit)
        self.assertAlmostEqual(overall.roi, overall.profit / 4)


class CalibrationTests(unittest.TestCase):
    def test_favorite_bucket_edges_are_fine_grained(self):
        self.assertEqual(bucket_for_odds(1.19)[0], "lt-1.20")
        self.assertEqual(bucket_for_odds(1.20)[0], "1.20-1.25")
        self.assertEqual(bucket_for_odds(1.2499)[0], "1.20-1.25")
        self.assertEqual(bucket_for_odds(1.25)[0], "1.25-1.30")
        self.assertEqual(bucket_for_odds(1.4999)[0], "1.45-1.50")
        self.assertEqual(bucket_for_odds(1.50)[0], "1.50-1.70")
        self.assertEqual(bucket_for_odds(10)[0], "10.00+")
        self.assertEqual(bucket_for_odds(51)[0], "10.00+")

    def test_actual_rate_versus_devigged_probability(self):
        buckets = empty_bucket_accumulators()
        # Fair-looking short home price, and the home side wins.
        add_market_to_calibration(buckets, 1.22, 6.0, 10.0, "H")
        # Same shape of market, home side loses (draw).
        add_market_to_calibration(buckets, 1.22, 6.0, 10.0, "D")

        rows = {row["id"]: row for row in finalize_buckets(buckets)}
        home_bucket = rows["1.20-1.25"]
        self.assertEqual(home_bucket["outcomes"], 2)
        self.assertEqual(home_bucket["wins"], 1)
        self.assertAlmostEqual(home_bucket["actualWinRate"], 0.5)

        fair_home = remove_overround(1.22, 6.0, 10.0)[0]
        self.assertAlmostEqual(home_bucket["avgImpliedProb"], round(fair_home, 6))
        self.assertAlmostEqual(home_bucket["sumImpliedProb"], round(fair_home * 2, 6))
        # Draw price 6.0 sits in 5.00-10.00; one of the two draws won.
        draw_bucket = rows["5.00-10.00"]
        self.assertEqual(draw_bucket["outcomes"], 2)
        self.assertEqual(draw_bucket["wins"], 1)
        # The 10.00 price is the open-ended favorite-longshot bucket.
        # Empty buckets still stay in the payload so the shape is stable.
        self.assertEqual(rows["10.00+"]["outcomes"], 2)
        self.assertEqual(rows["10.00+"]["wins"], 0)
        self.assertEqual(rows["1.50-1.70"]["outcomes"], 0)
        self.assertIsNone(rows["1.50-1.70"]["actualWinRate"])
        self.assertIsNone(rows["1.50-1.70"]["avgImpliedProb"])

    def test_three_outcomes_per_match_land_in_their_own_buckets(self):
        buckets = empty_bucket_accumulators()
        add_market_to_calibration(buckets, 1.38, 4.50, 8.00, "A")
        rows = {row["id"]: row for row in finalize_buckets(buckets)}
        self.assertEqual(rows["1.35-1.40"]["outcomes"], 1)
        self.assertEqual(rows["1.35-1.40"]["wins"], 0)
        self.assertEqual(rows["3.50-5.00"]["outcomes"], 1)
        self.assertEqual(rows["5.00-10.00"]["wins"], 1)


if __name__ == "__main__":
    unittest.main()
