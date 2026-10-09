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
