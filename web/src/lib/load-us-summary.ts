import { readFileSync } from "node:fs";
import path from "node:path";
import type { UsSport, UsSummary } from "./us-types";

const cache = new Map<UsSport, UsSummary>();

export function loadUsSummary(sport: UsSport): UsSummary {
  const cached = cache.get(sport);
  if (cached) return cached;
  const file = path.join(process.cwd(), "public", "data", sport, "summary.json");
  const summary = JSON.parse(readFileSync(file, "utf8")) as UsSummary;
  cache.set(sport, summary);
  return summary;
}
