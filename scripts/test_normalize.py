"""Team names from football-data must collapse onto the existing club labels."""

from __future__ import annotations

import unittest

from normalize import club_slug, normalize_team


class NormalizeTests(unittest.TestCase):
    def test_football_data_names_match_existing_clubs(self):
        cases = {
            "Man United": "Man United",
            "Manchester United": "Man United",
            "Ath Madrid": "Atletico Madrid",
            "Atlético de Madrid": "Atletico Madrid",
            "Ath Bilbao": "Athletic Bilbao",
            "Sp Lisbon": "Sporting CP",
            "Sp Braga": "Braga",
            "Paris SG": "PSG",
            "M'gladbach": "Monchengladbach",
            "Leverkusen": "Bayer 04 Leverkusen",
            "Inter": "Inter Milan",
            "Milan": "AC Milan",
            "Porto": "Porto",
            "FC Porto": "Porto",
            "Nott'm Forest": "Nottingham Forest",
            "Vallecano": "Rayo Vallecano",
            "Celta": "RC Celta Vigo",
            "Wolfsburg": "VfL Wolfsburg",
            "FC Koln": "1. FC Köln",
        }
        for raw, expected in cases.items():
            self.assertEqual(normalize_team(raw), expected, raw)

    def test_empty_names_are_dropped(self):
        self.assertIsNone(normalize_team(""))
        self.assertIsNone(normalize_team("   "))
        self.assertIsNone(normalize_team(None))

    def test_unknown_club_is_kept(self):
        self.assertEqual(normalize_team("Brand New FC"), "Brand New")

    def test_slugs_are_stable_and_ascii(self):
        self.assertEqual(club_slug("Porto"), "porto")
        self.assertEqual(club_slug("1. FC Köln"), "1-fc-koln")
        self.assertEqual(club_slug("Atlético San Luis"), "atletico-san-luis")
        self.assertEqual(club_slug("Bayer 04 Leverkusen"), "bayer-04-leverkusen")


if __name__ == "__main__":
    unittest.main()
