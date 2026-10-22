"""Unit tests for NBA box-score and play-by-play parsing."""

from __future__ import annotations

import unittest

from nba_factors import (
    ESPN_TO_NBA,
    NBA_NAMES,
    box_from_row,
    parse_possessions,
    point_share,
)


def play(text, **kwargs):
    base = {
        "type": {"text": text},
        "scoringPlay": False,
        "scoreValue": 0,
        "pointsAttempted": 0,
        "shootingPlay": False,
        "team": {"id": "1"},
    }
    base.update(kwargs)
    return base


class FactorParseTest(unittest.TestCase):
    def test_abbrev_map_covers_the_thirty_franchises(self):
        self.assertEqual(len(ESPN_TO_NBA), 30)
        self.assertEqual(set(ESPN_TO_NBA.values()), set(NBA_NAMES))
        self.assertEqual(ESPN_TO_NBA["SA"], "sa")
        self.assertEqual(ESPN_TO_NBA["OKC"], "okc")
        self.assertEqual(ESPN_TO_NBA["GS"], "gs")
        self.assertEqual(ESPN_TO_NBA["UTAH"], "utah")

    def test_box_row_requires_a_field_goal_attempt(self):
        row = {
            "field_goals_made": "10",
            "field_goals_attempted": "0",
            "three_point_field_goals_made": "1",
            "three_point_field_goals_attempted": "2",
            "free_throws_made": "1",
            "free_throws_attempted": "2",
            "offensive_rebounds": "1",
            "defensive_rebounds": "5",
            "total_turnovers": "2",
        }
        self.assertIsNone(box_from_row(row))

    def test_box_row_falls_back_to_turnovers(self):
        row = {
            "field_goals_made": "40",
            "field_goals_attempted": "86",
            "three_point_field_goals_made": "19",
            "three_point_field_goals_attempted": "46",
            "free_throws_made": "12",
            "free_throws_attempted": "18",
            "offensive_rebounds": "4",
            "defensive_rebounds": "28",
            "total_turnovers": "",
            "turnovers": "15",
        }
        box = box_from_row(row)
        self.assertIsNotNone(box)
        self.assertEqual(box["tov"], 15)
        self.assertEqual(box["fg3a"], 46)

    def test_possession_parser_scores_makes_misses_and_and_ones(self):
        plays = [
            play("Jumpball"),
            play("Jump Shot", shootingPlay=True, pointsAttempted=2),
            play("Defensive Rebound", team={"id": "2"}),
            play(
                "Layup Shot",
                scoringPlay=True,
                scoreValue=2,
                pointsAttempted=2,
                shootingPlay=True,
                team={"id": "2"},
            ),
            play(
                "Free Throw - 1 of 1",
                scoringPlay=True,
                scoreValue=1,
                pointsAttempted=1,
                shootingPlay=True,
                team={"id": "2"},
            ),
            play("Bad Pass\nTurnover", team={"id": "1"}),
        ]
        possessions, technical = parse_possessions(plays)
        self.assertEqual(technical, 0)
        self.assertEqual(possessions, [0, 3, 0])
        self.assertEqual(sum(possessions), 3)
        self.assertEqual(point_share(possessions)["0"], round(2 / 3, 4))

    def test_last_free_throw_does_not_double_count_the_rebound(self):
        plays = [
            play("Jumpball"),
            play("Free Throw - 1 of 2", shootingPlay=True, pointsAttempted=1),
            play("Free Throw - 2 of 2", shootingPlay=True, pointsAttempted=1),
            play("Defensive Rebound", team={"id": "2"}),
            play(
                "Jump Shot",
                scoringPlay=True,
                scoreValue=3,
                pointsAttempted=3,
                shootingPlay=True,
                team={"id": "2"},
            ),
        ]
        possessions, technical = parse_possessions(plays)
        self.assertEqual(technical, 0)
        self.assertEqual(possessions, [0, 3])

    def test_technical_free_throw_is_separate_from_possessions(self):
        plays = [
            play("Jumpball"),
            play(
                "Free Throw - Technical",
                scoringPlay=True,
                scoreValue=1,
                pointsAttempted=1,
                shootingPlay=True,
            ),
            play("End Game"),
        ]
        possessions, technical = parse_possessions(plays)
        self.assertEqual(technical, 1)
        self.assertEqual(sum(possessions), 0)


if __name__ == "__main__":
    unittest.main()
