import { readFileSync } from "node:fs";
import path from "node:path";
import type { CalibrationSeason, TeamSummary } from "./types";

type SummaryFile = {
  teams: TeamSummary[];
  calibrationBySeason: CalibrationSeason[];
  seasons: { first: number; last: number };
};

let cached: SummaryFile | null = null;

export function loadSummary(): SummaryFile {
  if (cached) return cached;
  const file = path.join(process.cwd(), "public/data/summary.json");
  cached = JSON.parse(readFileSync(file, "utf8")) as SummaryFile;
  return cached;
}
