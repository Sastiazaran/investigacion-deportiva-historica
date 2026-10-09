"""ATS grading, two-way de-vig, and franchise mapping."""

import unittest

from us_markets import (
    JUICE_110,
    american_to_decimal,
    bucket_for_probability,
    canonical_mlb,
    canonical_nba_mgm,
    canonical_nfl,
    devig_two_way,
    grade_ats,
    grade_moneyline,
)


class AtsGradingTest(unittest.TestCase):
    def test_home_favorite_cover_push_and_loss(self):
        # Home lays 4. Margin must be greater than 4.
        self.assertEqual(grade_ats(28, 21, 4), "home")
        self.assertEqual(grade_ats(25, 21, 4), "push")
        self.assertEqual(grade_ats(24, 21, 4), "away")

    def test_kc_detroit_2023_opener(self):
        # nflverse: home KC -198, spread_line +4, result -1. Home does not cover.
        self.assertEqual(grade_ats(20, 21, 4), "away")

    def test_away_favorite_uses_a_negative_home_line(self):
        # Away lays 3, so home_spread_line is -3. Home covers when it loses by 2.
        self.assertEqual(grade_ats(20, 22, -3), "home")
        self.assertEqual(grade_ats(17, 20, -3), "push")
        self.assertEqual(grade_ats(16, 20, -3), "away")

    def test_pickem_is_just_the_margin(self):
        self.assertEqual(grade_ats(21, 20, 0), "home")
        self.assertEqual(grade_ats(20, 20, 0), "push")

    def test_moneyline_tie_is_a_push(self):
        self.assertEqual(grade_moneyline(17, 17), "push")
        self.assertEqual(grade_moneyline(24, 17), "home")
        self.assertEqual(grade_moneyline(10, 17), "away")


class DevigTest(unittest.TestCase):
    def test_even_prices_are_a_half(self):
        p_home, p_away, overround = devig_two_way(2.0, 2.0)
        self.assertAlmostEqual(p_home, 0.5)
        self.assertAlmostEqual(p_away, 0.5)
        self.assertAlmostEqual(overround, 0.0)

    def test_overround_is_removed_in_proportion(self):
        # q = 2/3 and 1/2. Fair probs share the same ratio.
        p_home, p_away, overround = devig_two_way(1.5, 2.0)
        self.assertAlmostEqual(p_home + p_away, 1.0)
        self.assertAlmostEqual(p_home / p_away, (1 / 1.5) / (1 / 2.0))
        self.assertAlmostEqual(overround, (1 / 1.5) + (1 / 2.0) - 1)

    def test_standard_juice(self):
        self.assertEqual(american_to_decimal(-110), JUICE_110)
        self.assertEqual(JUICE_110, 1.909)
        p_home, p_away, overround = devig_two_way(JUICE_110, JUICE_110)
        self.assertAlmostEqual(p_home, 0.5)
        self.assertAlmostEqual(p_away, 0.5)
        self.assertGreater(overround, 0)

    def test_probability_buckets_are_five_points(self):
        self.assertEqual(bucket_for_probability(0.0)[1], "0–5%")
        self.assertEqual(bucket_for_probability(0.05)[1], "5–10%")
        self.assertEqual(bucket_for_probability(0.999)[1], "95–100%")
        self.assertEqual(bucket_for_probability(1.0)[1], "95–100%")


class FranchiseMapTest(unittest.TestCase):
    def test_nfl_relocations(self):
        self.assertEqual(canonical_nfl("OAK"), "LV")
        self.assertEqual(canonical_nfl("SD"), "LAC")
        self.assertEqual(canonical_nfl("STL"), "LA")
        self.assertEqual(canonical_nfl("LA"), "LA")
        self.assertEqual(canonical_nfl("LAC"), "LAC")
        self.assertEqual(canonical_nfl("lv"), "LV")

    def test_nba_city_labels(self):
        self.assertEqual(canonical_nba_mgm("LA Lakers"), "lal")
        self.assertEqual(canonical_nba_mgm("LA Clippers"), "lac")
        self.assertEqual(canonical_nba_mgm("Golden State"), "gs")

    def test_mlb_aliases(self):
        self.assertEqual(canonical_mlb("OAK"), "ATH")
        self.assertEqual(canonical_mlb("ATH"), "ATH")
        self.assertEqual(canonical_mlb("ARI"), "ARI")
        self.assertEqual(canonical_mlb("AZ"), "ARI")
        self.assertEqual(canonical_mlb("CUB"), "CHC")
        self.assertEqual(canonical_mlb("SDG"), "SD")
        self.assertEqual(canonical_mlb("LOS"), "LAD")
        self.assertEqual(canonical_mlb("BRS"), "BOS")


if __name__ == "__main__":
    unittest.main()
