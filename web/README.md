# European Accumulator Dashboard

Next.js (App Router) app for historical win rates, accumulator combos, home/away splits, and flat-bet ROI at closing odds.

## Develop

```bash
cd web
npm install
npm test
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Club pages are `/team/[slug]`. Calibration is `/calibration`.

## Data

`public/data/season-data.json` feeds the win% view. `public/data/summary.json` is the public ROI and calibration file (`/data/summary.json`, also `/api/summary`). The schema is `public/data/summary.schema.json`.

Refresh from the repo root:

```bash
python3 scripts/build_season_data.py
cd web && npm test && npm run build
```

The Friday GitHub Action documented in the root README commits those files. Vercel’s root directory is `web`.

`/nba/simulator` is the team-level Monte Carlo page (5,000 possessions). It reads `public/data/nba/team-factors.json` and `public/data/nba/sim-backtest.json`. Those files do not replace `public/data/summary.json`. Refresh them from the repo root with `python3 scripts/nba_sim_data.py`, then `node --experimental-strip-types scripts/nba-backtest.ts` inside `web/`.

The 2025-26 walk-forward backtest does not beat the closing line: Brier 0.2079 vs 0.1948, log loss 0.6043 vs 0.5710, and −16.8% ROI on 853 bets at a 5% price margin (1,230 games). Through 2026-02-12 the same rule is −3.7% (525 bets); after that date it is −37.6% (328 bets). Closes are ESPN BET (298) then DraftKings (932). The site's NBA summary still has no BetMGM moneyline after 2026-02-12.
