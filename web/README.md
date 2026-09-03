# European Accumulator Dashboard

Next.js (App Router) web app for historical club win-rate and accumulator combo analysis.

## Develop

```bash
cd web
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Data

Season records are loaded from `public/data/season-data.json` (copied from `../canvases/season-data.json`).

To refresh:

```bash
# from repo root
python3 scripts/build_season_data.py
cp canvases/season-data.json web/public/data/season-data.json
cd web && npm run build
```

Then push to `main` (or redeploy) so Vercel picks up the new data.

## Deploy

Vercel root directory: `web`.
