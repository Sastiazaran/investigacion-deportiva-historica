# Investigación Deportiva Histórica

Historical win-rate, home/away, and closing-odds ROI for Europe’s top leagues plus Liga MX.

## Web dashboard (Vercel)

Production app lives in `web/` (Next.js App Router).

```bash
cd web
npm install
npm test
npm run dev
```

| URL | What it is |
| --- | --- |
| `/` | Win% , tiers, and accumulator combos |
| `/team/[slug]` | Home/away record and flat-bet ROI for one club |
| `/calibration` | Implied probability (overround removed) vs actual win rate |
| `/data/summary.json` | Public JSON for the Friday reader (canonical) |
| `/api/summary` | Same file, rewritten |
| `/data/summary.schema.json` | JSON Schema for that file |
| `/data/matches.json` | One row per match |
| `/data/season-data.json` | Club-season W/D/L records used by the win% view |

`summary.json` `schemaVersion` is `1`. Read `definitions` in the file before using the numbers.

- `teams[].overall` / `home` / `away` are all-time. `seasons[]` is the same shape per season.
- `roi` is profit divided by stakes. Stake is 1.00 unit at the closing decimal odds. `0.05` means +5%. It is `null` when there is no price.
- `winPct` is `won / played * 100` and includes matches that have no odds.
- Closing price is Pinnacle `PSCH/PSCD/PSCA` when all three exist, else Pinnacle `PSH/PSD/PSA` (or `PH/PD/PA`), else Bet365 `B365H/B365D/B365A` (or `B365CH/B365CD/B365CA` when the pre-closing columns are missing).
- `calibration[]` buckets are half-open on decimal odds, 0.05 wide from 1.20 to 1.50. `outcomes` counts home, draw, and away results, not matches. `avgImpliedProb` is `1/odds` divided by the sum of the three raw implied probabilities.

## Refresh the data

Paths are relative to the repo. Nothing writes to a machine-local absolute path.

```bash
python3 -m unittest discover -s scripts -p "test_*.py"
python3 scripts/build_season_data.py
cd web && npm test && npm run build
```

`FD_CACHE=/tmp/fd-cache` reuses CSVs already on disk. `LAST_SEASON=2026` pins the last season start year; otherwise August onward includes the new season.

## Weekly update

`.github/workflows/update-football-data.yml` runs every Friday at 06:00 UTC (and on demand). It downloads the CSVs, rebuilds the JSON, and commits to the default branch when something changed.

A Vercel cron is a poor fit: the dataset is static JSON in `public/`, and a cron invocation cannot commit that file or replace the copy the CDN is already serving. The Action commits the files; the push to the default branch is what redeploys production so Friday’s reader sees new numbers. Do not merge feature PRs by hand if a push to `main` would deploy them — the weekly job is the path that is supposed to update `main`.

## NBA, NFL, and MLB

These are separate files. `/data/summary.json` is still the soccer file, `schemaVersion` 1, with no `sport` key.

| URL | What it is |
| --- | --- |
| `/nba`, `/nfl`, `/mlb` | Team table, moneyline ROI, spread or run line, coverage |
| `/{sport}/team/[slug]` | One franchise, regular season and playoffs split |
| `/{sport}/calibration` | Two-way de-vig, 5-point probability buckets, Brier score, average overround |
| `/data/nfl/summary.json` | NFL public JSON |
| `/data/nba/summary.json` | NBA public JSON |
| `/data/mlb/summary.json` | MLB public JSON |
| `/api/nfl/summary`, `/api/nba/summary`, `/api/mlb/summary` | Same files |
| `/data/us-summary.schema.json` | Schema for those three files |

`season` is the NFL season year, the NBA start year (2007 means 2007-08), or the MLB calendar year. `roi` is profit divided by decided stakes. A tie or a push is a refund: it is counted and it is not in the stake. Read `definitions` and `gaps` in each file.

NFL lines are nflverse `games.csv`. `spread_line` is positive when the home team is favored. OAK, SD, and STL are folded into the current franchise.

NBA results and spreads are the CC0 Kaggle file `nba_2008-2026.csv`. Moneylines that file is missing are filled from the CC BY-SA 4.0 BetMGM file through 2026-02-12. There is no moneyline from 2026-02-13 onward. A missing spread price is 1.909 (−110).

MLB 2010-2020 is the static Sportsbook Review `.xlsx` archives, committed as `data/mlb/games.json`. Those years do not mark the playoffs, so postseason games sit in the regular-season totals. From 2021-04-01 the static GitHub release `mlb_odds_dataset.json` is used (the scraper is not run). Nothing after 2025-08-16. OAK/ATH and ARI/AZ are one franchise each.

The Friday Action re-downloads nflverse and the two Kaggle files. `KAGGLE_USERNAME` and `KAGGLE_KEY` are optional fallbacks. MLB is not re-downloaded.

## NBA Monte Carlo simulator

`/nba/simulator` runs 5,000 seeded possessions for one matchup. Ratings are pace, eFG%, TOV%, OREB%, and free-throw rate, with a home-court eFG shift fit to the 2025-26 average home margin. The minimum price is the model's fair decimal odds times 1.05, shown in decimal and American so it can be compared with Playdoit.

The page also prints the 2025-26 walk-forward backtest. The simulator does not beat the closing line.

On 1,230 regular-season games (one game had no close), the model's Brier score is 0.2079 and its log loss is 0.6043. The de-vigged close is 0.1948 and 0.5710. Flat 1-unit bets taken only when the close was at least the model's fair price times 1.05 returned −16.8% on 853 bets. Any positive edge returned −13.1% on 1,025 bets.

Through 2026-02-12 (819 games) the model is 0.2212 / 0.6343 against the close at 0.2141 / 0.6169, and the 5% rule returned −3.7% on 525 bets. After that date (411 games) the model is 0.1813 / 0.5446 against 0.1563 / 0.4795, and the 5% rule returned −37.6% on 328 bets.

The committed NBA summary still has no moneyline after 2026-02-12 (BetMGM). This backtest could not re-download that Kaggle extract (404 without credentials). It uses the close ESPN publishes — ESPN BET for 298 games through November 2025, DraftKings for 932 games after that — and splits the sample on 2026-02-12. Numbers are in `web/public/data/nba/sim-backtest.json`.

Box scores are the sportsdataverse ESPN team-box release for 2024-25, 2025-26, and the 2026-27 season in progress. Play-by-play is a 1-in-15 sample of 2025-26 plus every completed 2026-27 game. Raw dumps stay in `.cache/` (gitignored). Aggregates are `web/public/data/nba/team-factors.json`.

```bash
python3 scripts/nba_sim_data.py
cd web && node --experimental-strip-types scripts/nba-backtest.ts
```

Player usage, shot zones, minutes, matchups, and props are not in this version.

```bash
python3 scripts/build_us_sports.py
# first time, or to refresh the frozen MLB file:
python3 scripts/build_us_sports.py --rebuild-mlb
```

## Layout

- `web/` — Next.js dashboard
- `canvases/` — Cursor canvas plus `season-data.json`
- `scripts/` — download, ROI, and calibration
