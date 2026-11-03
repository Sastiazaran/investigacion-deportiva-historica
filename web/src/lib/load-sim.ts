import { readFileSync } from "node:fs";
import path from "node:path";
import type { SimBacktest } from "../components/MatchSimulator";
import type { FootballFactors, PointsFactors, RunsFactors } from "./predict";

function readJson<T>(parts: string[]): T {
  const file = path.join(process.cwd(), "public", "data", ...parts);
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

export function loadFootballFactors() {
  return readJson<FootballFactors>(["football", "sim-factors.json"]);
}

export function loadPointsFactors(sport: "nfl") {
  return readJson<PointsFactors>([sport, "sim-factors.json"]);
}

export function loadRunsFactors() {
  return readJson<RunsFactors>(["mlb", "sim-factors.json"]);
}

export function loadSimBacktest(sport: "football" | "nfl" | "mlb") {
  return readJson<SimBacktest>([sport, "sim-backtest.json"]);
}
