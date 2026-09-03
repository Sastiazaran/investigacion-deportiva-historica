#!/usr/bin/env python3
"""Download league CSVs and build per-club season records (2000-2025).

Records every team in the seven top divisions (not a club whitelist).
Known aliases are canonicalized; all other clubs are kept after light suffix trim.
Season start year 2025 = 2025/26 (partial seasons are fine).
"""

from __future__ import annotations

import csv
import io
import json
import re
import urllib.error
import urllib.request
from collections import defaultdict

LEAGUES = {
    "E0": "Premier League",
    "SP1": "La Liga",
    "D1": "Bundesliga",
    "I1": "Serie A",
    "F1": "Ligue 1",
    "N1": "Eredivisie",
    "P1": "Primeira Liga",
}

FC_FILE = {
    "E0": "eng.1.csv",
    "SP1": "es.1.csv",
    "D1": "de.1.csv",
    "I1": "it.1.csv",
    "F1": "fr.1.csv",
    "N1": "nl.1.csv",
    "P1": "pt.1.csv",
}

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

CLUB_ALIASES = {
    "Man United": ["Man United", "Manchester United", "Manchester United FC"],
    "Liverpool": ["Liverpool", "Liverpool FC"],
    "Arsenal": ["Arsenal", "Arsenal FC"],
    "Chelsea": ["Chelsea", "Chelsea FC"],
    "Man City": ["Man City", "Manchester City", "Manchester City FC"],
    "Real Madrid": ["Real Madrid", "Real Madrid CF"],
    "Barcelona": ["Barcelona", "FC Barcelona"],
    "Atletico Madrid": ["Ath Madrid", "Atletico Madrid", "Club Atlético de Madrid", "Atlético Madrid"],
    "Bayern Munich": ["Bayern Munich", "FC Bayern München", "Bayern München", "FC Bayern Munich"],
    "Dortmund": [
        "Dortmund",
        "Borussia Dortmund",
        "BV Borussia 09 Dortmund",
        "Borussia Dortmund 09",
    ],
    "PSG": ["Paris SG", "PSG", "Paris Saint-Germain", "Paris Saint Germain"],
    "Lyon": ["Lyon", "Olympique Lyonnais", "Olympique Lyon"],
    "Marseille": ["Marseille", "Olympique Marseille", "Olympique de Marseille"],
    "Juventus": ["Juventus", "Juventus FC"],
    "Inter Milan": ["Inter", "Inter Milan", "FC Internazionale Milano", "Internazionale"],
    "AC Milan": ["AC Milan", "Milan"],
    "Napoli": ["Napoli", "SSC Napoli"],
    "AS Roma": ["Roma", "AS Roma"],
    "Ajax": ["Ajax", "AFC Ajax", "Ajax Amsterdam"],
    "PSV": ["PSV Eindhoven", "PSV"],
    "Feyenoord": ["Feyenoord", "Feyenoord Rotterdam"],
    "AZ Alkmaar": ["AZ Alkmaar", "AZ"],
    "Benfica": ["Benfica", "SL Benfica", "Sport Lisboa e Benfica"],
    "Porto": ["Porto", "FC Porto"],
    "Sporting CP": [
        "Sp Lisbon",
        "Sporting CP",
        "Sporting Lisbon",
        "Sporting Clube de Portugal",
    ],
    "Braga": ["Braga", "Sporting Braga", "Sporting Clube de Braga"],
    "Athletic Bilbao": [
        "Athletic Club",
        "Athletic Club Bilbao",
        "Ath Bilbao",
        "Athletic Bilbao",
    ],
    "Rayo Vallecano": ["Rayo Vallecano", "Rayo Vallecano de Madrid"],
    "RC Strasbourg": ["RC Strasbourg", "RC Strasbourg Alsace", "Strasbourg"],
    "Greuther Furth": [
        "SpVgg Greuther Fürth",
        "SpVgg Greuther Furth",
        "SpVgg Greuther Fürth 1903",
        "Greuther Furth",
    ],
    "Rennes": ["Stade Rennais", "Stade Rennais FC 1901", "Rennes"],
    "Monchengladbach": [
        "Bor. Mönchengladbach",
        "Borussia Mönchengladbach",
        "M'Gladbach",
        "Gladbach",
        "Monchengladbach",
    ],
}

REVERSE_ALIAS = {}
for canonical, aliases in CLUB_ALIASES.items():
    for alias in aliases:
        REVERSE_ALIAS[alias.lower()] = canonical

TEAM_SUFFIXES = (
    " FC",
    " AFC",
    " CF",
    " SC",
    " UD",
    " CD",
    " AC",
    " BK",
    " SK",
    " Balompié",
    " de Fútbol",
    " de Barcelona",
)

OPENFOOTBALL_MATCH_V = re.compile(
    r"^\s+(?:\d{2}:\d{2}\s+)?(.+?)\s+v\s+(.+?)\s+(\d+)-(\d+)(?:\s|\(|$)"
)
# Newer openfootball layout: "  19:00   Home  4-2 (1-0)  Away"
OPENFOOTBALL_MATCH_SCORE_MID = re.compile(
    r"^\s+(?:\d{2}:\d{2}\s+)?(.+?)\s+(\d+)-(\d+)\s*(?:\([^)]*\)\s+)?(.+?)\s*$"
)


def season_code(year: int) -> str:
    return f"{year % 100:02d}{(year + 1) % 100:02d}"


def season_folder(year: int) -> str:
    return f"{year}-{str(year + 1)[-2:]}"


def decade_folder(year: int) -> str:
    if year < 2010:
        return "2000s"
    if year < 2020:
        return "2010s"
    return "2020s"


def normalize_team(name: str) -> str | None:
    """Return a display name for every club; unknown clubs are kept, not dropped.

    Known aliases map to a canonical label. Other names are trimmed of common
    suffixes (FC, CF, …) and otherwise preserved.
    """
    if not name:
        return None
    n = " ".join(name.strip().split())
    for suf in TEAM_SUFFIXES:
        if n.endswith(suf):
            n = n[: -len(suf)].strip()
    if not n:
        return None
    key = n.lower()
    if key in REVERSE_ALIAS:
        return REVERSE_ALIAS[key]
    return n


FD_ENABLED = True


def fetch_text(url: str) -> str | None:
    global FD_ENABLED
    if "football-data.co.uk" in url and not FD_ENABLED:
        return None
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except Exception as exc:
        if "football-data.co.uk" in url:
            # Site is often blocked; skip further FD attempts this run.
            FD_ENABLED = False
            print(f"  football-data.co.uk unavailable ({exc}); using GitHub fallbacks")
        return None


def parse_football_data_csv(text: str) -> list[dict]:
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        return []
    if "HomeTeam" in reader.fieldnames:
        return [row for row in reader if row.get("FTR") in ("H", "D", "A")]
    return parse_footballcsv(text)


def parse_footballcsv(text: str) -> list[dict]:
    reader = csv.DictReader(io.StringIO(text))
    rows: list[dict] = []
    for row in reader:
        t1 = (row.get("Team 1") or row.get("Home") or "").strip()
        t2 = (row.get("Team 2") or row.get("Away") or "").strip()
        ft = (row.get("FT") or row.get("Score") or "").strip()
        if not t1 or not t2 or "-" not in ft:
            continue
        parts = ft.replace(" ", "").split("-")
        if len(parts) < 2:
            continue
        try:
            hg, ag = int(parts[0]), int(parts[1])
        except ValueError:
            continue
        ftr = "H" if hg > ag else "A" if hg < ag else "D"
        rows.append({"HomeTeam": t1, "AwayTeam": t2, "FTR": ftr})
    return rows


def parse_openfootball_txt(text: str) -> list[dict]:
    rows: list[dict] = []
    for line in text.splitlines():
        m = OPENFOOTBALL_MATCH_V.match(line)
        if m:
            home, away = m.group(1).strip(), m.group(2).strip()
            hg, ag = int(m.group(3)), int(m.group(4))
        else:
            if " v " in line:
                continue
            m2 = OPENFOOTBALL_MATCH_SCORE_MID.match(line)
            if not m2:
                continue
            home, away = m2.group(1).strip(), m2.group(4).strip()
            hg, ag = int(m2.group(2)), int(m2.group(3))
            # Reject header-ish / non-team lines
            if not home or not away or home.startswith("#") or away.startswith("#"):
                continue
        ftr = "H" if hg > ag else "A" if hg < ag else "D"
        rows.append({"HomeTeam": home, "AwayTeam": away, "FTR": ftr})
    return rows


def source_urls(code: str, year: int) -> list[tuple[str, str]]:
    sc = season_code(year)
    season = season_folder(year)
    decade = decade_folder(year)
    fc = FC_FILE[code]
    urls: list[tuple[str, str]] = []

    urls.append(("fd", f"https://www.football-data.co.uk/mmz4281/{sc}/{code}.csv"))

    if year >= 2020:
        urls.append(
            (
                "csv",
                f"https://raw.githubusercontent.com/footballcsv/cache.api.fbdat/master/{season}/{fc}",
            )
        )
    elif year in (2018, 2019):
        attic = "2018-19" if year == 2018 else "2019-20"
        urls.append(
            (
                "csv",
                f"https://raw.githubusercontent.com/footballcsv/cache.api.fbdat/master/.attic/{attic}/{fc}",
            )
        )

    repo_by_code = {"E0": "england", "D1": "deutschland", "SP1": "espana"}
    repo = repo_by_code.get(code)
    if repo and (code != "SP1" or year >= 2012):
        urls.append(
            (
                "csv",
                f"https://raw.githubusercontent.com/footballcsv/{repo}/master/{decade}/{season}/{fc}",
            )
        )

    openfootball = {
        "E0": f"https://raw.githubusercontent.com/openfootball/england/master/{season}/1-premierleague.txt",
        "SP1": f"https://raw.githubusercontent.com/openfootball/espana/master/{season}/1-liga.txt",
        "I1": f"https://raw.githubusercontent.com/openfootball/italy/master/{season}/1-seriea.txt",
        "D1": f"https://raw.githubusercontent.com/openfootball/deutschland/master/{season}/1-bundesliga.txt",
        "F1": f"https://raw.githubusercontent.com/openfootball/europe/master/france/{season}_fr1.txt",
        "N1": f"https://raw.githubusercontent.com/openfootball/europe/master/netherlands/{season}_nl1.txt",
        "P1": f"https://raw.githubusercontent.com/openfootball/europe/master/portugal/{season}_pt1.txt",
    }
    if code in openfootball:
        urls.append(("txt", openfootball[code]))

    return urls


def fetch_csv(code: str, season_year: int) -> list[dict]:
    for kind, url in source_urls(code, season_year):
        text = fetch_text(url)
        if not text or len(text) < 80:
            continue
        if text.lstrip().startswith("<"):
            continue
        if kind == "txt":
            rows = parse_openfootball_txt(text)
        else:
            rows = parse_football_data_csv(text)
        if rows:
            if kind != "fd":
                print(f"  {code} {season_folder(season_year)}: via fallback ({kind})")
            return rows
    print(f"  skip {code} {season_code(season_year)}: all sources failed")
    return []


def process_matches(rows: list[dict], league: str, season_year: int, stats: dict):
    for row in rows:
        home = row.get("HomeTeam", "")
        away = row.get("AwayTeam", "")
        ftr = row.get("FTR", "")

        if ftr not in ("H", "D", "A"):
            continue

        for team, result in (
            (home, "W" if ftr == "H" else "D" if ftr == "D" else "L"),
            (away, "W" if ftr == "A" else "D" if ftr == "D" else "L"),
        ):
            canonical = normalize_team(team)
            if not canonical:
                continue
            key = (canonical, season_year)
            stats[key]["league"] = league
            stats[key]["played"] += 1
            if result == "W":
                stats[key]["won"] += 1
            elif result == "D":
                stats[key]["drawn"] += 1
            else:
                stats[key]["lost"] += 1


OUTPUT_PATHS = [
    "/Users/sebastianasti/Documents/Programación-proyectosAsti/InvestigacionDeportivaHistorica/Investigación/canvases/season-data.json",
    "/Users/sebastianasti/.cursor/projects/Users-sebastianasti-Documents-Programaci-n-proyectosAsti-InvestigacionDeportivaHistorica-Investigaci-n/canvases/season-data.json",
    "/Users/sebastianasti/.cursor/projects/Users-sebastianasti-Documents-Programaci-n-proyectosAsti-InvestigacionDeportivaHistorica-Sin-t-tulo/canvases/season-data.json",
    "/Users/sebastianasti/.cursor/projects/Users-sebastianasti-Documents-Programacio-n-proyectosAsti-InvestigacionDeportivaHistorica-Investigacio-n/canvases/season-data.json",
]

# Inclusive season-start years: 2000 (2000/01) … 2025 (2025/26)
FIRST_SEASON = 2000
LAST_SEASON = 2025


def main():
    stats: dict = defaultdict(
        lambda: {"played": 0, "won": 0, "drawn": 0, "lost": 0, "league": ""}
    )

    leagues_by_year: dict[int, set[str]] = defaultdict(set)

    for year in range(FIRST_SEASON, LAST_SEASON + 1):
        print(f"Season {year}/{year+1}...")
        for code, league in LEAGUES.items():
            rows = fetch_csv(code, year)
            if rows:
                process_matches(rows, league, year, stats)
                leagues_by_year[year].add(code)

    records = []
    for (club, season), s in sorted(stats.items()):
        if s["played"] == 0:
            continue
        records.append(
            {
                "club": club,
                "season": season,
                "league": s["league"],
                "played": s["played"],
                "won": s["won"],
                "drawn": s["drawn"],
                "lost": s["lost"],
            }
        )

    payload = json.dumps(records, separators=(",", ":"))
    for out in OUTPUT_PATHS:
        try:
            with open(out, "w") as f:
                f.write(payload)
            print(f"Wrote {out}")
        except OSError as exc:
            print(f"Skip write {out}: {exc}")

    clubs = {r["club"] for r in records}
    y2025 = [r for r in records if r["season"] == 2025]
    print(
        f"\n{len(records)} records ({len(clubs)} unique clubs); "
        f"{len(y2025)} records for 2025/26"
    )

    missing_2025 = [c for c in LEAGUES if c not in leagues_by_year.get(2025, set())]
    if missing_2025:
        print(
            "Leagues missing 2025/26: "
            + ", ".join(f"{c} ({LEAGUES[c]})" for c in missing_2025)
        )
    else:
        print("All leagues have 2025/26 data.")

    club_totals = defaultdict(lambda: {"played": 0, "won": 0})
    for r in records:
        club_totals[r["club"]]["played"] += r["played"]
        club_totals[r["club"]]["won"] += r["won"]

    print(f"\nTop 25 win % {FIRST_SEASON}-{LAST_SEASON} (min 20 matches):")
    ranked = [
        (club, t)
        for club, t in club_totals.items()
        if t["played"] >= 20
    ]
    ranked.sort(key=lambda x: x[1]["won"] / x[1]["played"], reverse=True)
    for club, t in ranked[:25]:
        print(f"  {club}: {100 * t['won'] / t['played']:.1f}% ({t['won']}/{t['played']})")


if __name__ == "__main__":
    main()
