# Investigación Deportiva Histórica

Historical win-rate analysis across Europe’s top football leagues (accumulator-style season view).

## What this is

A Cursor canvas project that explores club season records from **2000** through **2025/26** across **seven** top divisions. Season aggregates live in `canvases/season-data.json` and are embedded/consumed by `canvases/european-accumulator-analysis.canvas.tsx`.

## Refresh season data

```bash
python3 scripts/build_season_data.py
```

This downloads league CSVs, builds per-club season records, and writes `canvases/season-data.json`. Re-open or reload the canvas after regenerating data.

## Layout

- `canvases/` — analysis canvas and season JSON
- `scripts/build_season_data.py` — data pipeline
