import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { bestWindowStart, windowLabel, type WindowScore } from "./rating-window.ts";

test("the default window is the one with the lower log loss", () => {
  const start = bestWindowStart([
    { start: 2026, backtest: { games: 100, modelBrier: 0.2, modelLogLoss: 0.6, marketBrier: 0.19, marketLogLoss: 0.55 } },
    { start: 2024, backtest: { games: 100, modelBrier: 0.22, modelLogLoss: 0.64, marketBrier: 0.19, marketLogLoss: 0.55 } },
    { start: 2020, backtest: null },
  ]);
  assert.equal(start, 2026);
  assert.equal(windowLabel(2026, 2026), "Current season only");
  assert.equal(windowLabel(2024, 2026), "2024 → current");
});

test("published defaults are the best scored window for each sport", () => {
  const root = path.join(import.meta.dirname, "../../public/data");
  const scores = JSON.parse(readFileSync(path.join(root, "window-scores.json"), "utf8")) as Record<
    string,
    { start: number; backtest: WindowScore | null }[]
  >;
  const football = JSON.parse(readFileSync(path.join(root, "football/sim-factors.json"), "utf8")) as { defaultStart: number };
  const nfl = JSON.parse(readFileSync(path.join(root, "nfl/sim-factors.json"), "utf8")) as { defaultStart: number };
  const mlb = JSON.parse(readFileSync(path.join(root, "mlb/sim-factors.json"), "utf8")) as { defaultStart: number };
  const nba = JSON.parse(readFileSync(path.join(root, "nba/rating-windows.json"), "utf8")) as { defaultStart: number };
  assert.equal(football.defaultStart, bestWindowStart(scores.football));
  assert.equal(nfl.defaultStart, bestWindowStart(scores.nfl));
  assert.equal(mlb.defaultStart, bestWindowStart(scores.mlb));
  assert.equal(nba.defaultStart, bestWindowStart(scores.nba));
});
