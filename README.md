# Investigación Deportiva Histórica

Historical win-rate analysis across Europe’s top football leagues (accumulator-style season view).

## Web dashboard (Vercel)

Production app lives in `web/` (Next.js App Router). Season data: `web/public/data/season-data.json`.

```bash
cd web
npm install
npm run dev
```

## Refresh season data

```bash
python3 scripts/build_season_data.py
cp canvases/season-data.json web/public/data/season-data.json
```

Then commit and push to `main` so Vercel redeploys, or run `npm run build` locally to verify.

## Layout

- `web/` — deployable Next.js dashboard
- `canvases/` — Cursor canvas + source `season-data.json`
- `scripts/build_season_data.py` — data pipeline
