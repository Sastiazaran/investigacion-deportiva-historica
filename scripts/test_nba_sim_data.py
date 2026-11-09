"""Play-by-play summary keys. No files, no network."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch

import nba_sim_data


def quiet(call):
    with redirect_stdout(StringIO()):
        return call()


def regular_game(game_id: str, home: int, away: int) -> dict:
    return {
        "id": game_id,
        "date": "2026-01-15",
        "season": 2025,
        "phase": "regular",
        "homeScore": home,
        "awayScore": away,
    }


class PbpSummaryTest(unittest.TestCase):
    def test_full_sample_returns_mismatch_count_and_pace(self):
        game = regular_game("kept", 60, 50)
        record = {"possessions": [60, 50], "technical": 0, "plays": 20}
        with patch("nba_sim_data.fetch_plays", return_value=record):
            summary = quiet(lambda: nba_sim_data.attach_pbp([game]))
        self.assertEqual(summary["keptGames"], 1)
        self.assertEqual(summary["mismatches"], 0)
        self.assertEqual(summary["pointsPerPossession"], 55.0)
        self.assertEqual(nba_sim_data.pbp_log(summary), "pbp kept=1 mismatches=0 ppp=55.0")

    def test_full_sample_counts_a_box_score_mismatch(self):
        game = regular_game("off", 110, 100)
        record = {"possessions": [2, 3], "technical": 0, "plays": 8}
        with patch("nba_sim_data.fetch_plays", return_value=record):
            summary = quiet(lambda: nba_sim_data.attach_pbp([game]))
        self.assertEqual(summary["keptGames"], 0)
        self.assertEqual(summary["mismatches"], 1)
        self.assertIsNone(summary["pointsPerPossession"])
        self.assertEqual(nba_sim_data.pbp_log(summary), "pbp kept=0 mismatches=1 ppp=None")

    def test_skipped_summary_logs_without_the_sample_keys(self):
        summary = nba_sim_data.skipped_pbp()
        self.assertNotIn("mismatches", summary)
        self.assertNotIn("pointsPerPossession", summary)
        self.assertEqual(nba_sim_data.pbp_log(summary), "pbp kept=0 mismatches=None ppp=None")
        self.assertEqual(nba_sim_data.pbp_log({}), "pbp kept=None mismatches=None ppp=None")

    def test_main_skip_path_writes_the_cache_and_returns(self):
        game = regular_game("1", 100, 90)
        game.update(
            home="bos",
            away="ny",
            homeBox={"fga": 1},
            awayBox={"fga": 1},
            homeMl=1.9,
            awayMl=1.9,
            mlSource="test",
        )
        with tempfile.TemporaryDirectory() as tmp:
            cache = Path(tmp)
            with (
                patch.object(nba_sim_data, "CACHE", cache),
                patch.object(nba_sim_data, "load_games", return_value=[game]),
                patch.object(nba_sim_data, "attach_odds"),
                patch.dict(os.environ, {"NBA_SIM_SKIP_PBP": "1"}),
            ):
                quiet(nba_sim_data.main)
            payload = json.loads((cache / "games.json").read_text())
        self.assertEqual(payload["games"][0]["id"], "1")
        self.assertNotIn("mismatches", payload["pbp"])
        self.assertEqual(payload["pbp"]["keptGames"], 0)
