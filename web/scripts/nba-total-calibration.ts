/**
 * Projected NBA totals against the actual score and the closing total.
 *
 * Uses the same possession simulator as the page, with the published
 * 2025-26 ratings for that season and the current ratings for 2026-27.
 * Writes public/data/nba/total-calibration.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { hashSeed, simulateGame, solveHomeEfgBump, type FourFactors, type TeamProfile } from "../src/lib/nba-sim.ts";

type Game = {
  date: string;
  season: number;
  phase: string;
  home: string;
  away: string;
  home_score: number;
  away_score: number;
  total_line: number | null;
};

type Factors = {
  league: FourFactors;
  leaguePace: number;
  homeAdvantagePoints: number;
  paceSd: number;
  homeEfgBump: number;
  teams: Record<string, { profiles: { current?: TeamProfile; "2025"?: TeamProfile } }>;
};

const SIMS = 40;

function summarize(rows: { simulated: number; actual: number; close: number | null; simHome: number; simAway: number; actualHome: number; actualAway: number }[]) {
  const n = rows.length;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const simulated = mean(rows.map((row) => row.simulated));
  const actual = mean(rows.map((row) => row.actual));
  const bias = simulated - actual;
  const mae = mean(rows.map((row) => Math.abs(row.simulated - row.actual)));
  const priced = rows.filter((row) => row.close != null);
  const closing = priced.length ? mean(priced.map((row) => row.close as number)) : null;
  const biasVsClose = priced.length ? mean(priced.map((row) => row.simulated - (row.close as number))) : null;
  const maeVsClose = priced.length ? mean(priced.map((row) => Math.abs(row.simulated - (row.close as number)))) : null;
  return {
    games: n,
    meanSimulated: round(simulated),
    meanSimHome: round(mean(rows.map((row) => row.simHome))),
    meanSimAway: round(mean(rows.map((row) => row.simAway))),
    meanActual: round(actual),
    meanActualHome: round(mean(rows.map((row) => row.actualHome))),
    meanActualAway: round(mean(rows.map((row) => row.actualAway))),
    bias: round(bias),
    mae: round(mae),
    closingGames: priced.length,
    meanClosing: closing == null ? null : round(closing),
    biasVsClose: biasVsClose == null ? null : round(biasVsClose),
    maeVsClose: maeVsClose == null ? null : round(maeVsClose),
  };
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function main() {
  const factorsPath = path.join(process.cwd(), "public/data/nba/team-factors.json");
  const factors = JSON.parse(readFileSync(factorsPath, "utf8")) as Factors;
  const games = (
    JSON.parse(readFileSync(path.join(process.cwd(), "..", ".cache/us-sports/nba-sim-games.json"), "utf8")) as { games: Game[] }
  ).games.filter((game) => game.phase === "regular" && (game.season === 2025 || game.season === 2026));
  const bump = solveHomeEfgBump(factors.league, factors.leaguePace, factors.homeAdvantagePoints);
  const roundedBump = Math.round(bump * 10000) / 10000;
  const raw = readFileSync(factorsPath, "utf8");
  writeFileSync(factorsPath, raw.replace(/"homeEfgBump": [0-9.]+/, `"homeEfgBump": ${roundedBump.toFixed(4)}`));
  const seasons = [2025, 2026];
  const blocks = [];
  for (const season of seasons) {
    const rows: { simulated: number; actual: number; close: number | null; simHome: number; simAway: number; actualHome: number; actualAway: number }[] = [];
    for (const game of games.filter((item) => item.season === season)) {
      const home = factors.teams[game.home]?.profiles[season === 2026 ? "current" : "2025"] ?? factors.teams[game.home]?.profiles["2025"];
      const away = factors.teams[game.away]?.profiles[season === 2026 ? "current" : "2025"] ?? factors.teams[game.away]?.profiles["2025"];
      if (!home || !away) continue;
      const sim = simulateGame({
        home,
        away,
        league: factors.league,
        homeAdvantagePoints: factors.homeAdvantagePoints,
        paceSd: factors.paceSd,
        leaguePace: factors.leaguePace,
        n: SIMS,
        seed: hashSeed(`${game.date}|${game.away}|${game.home}|total`),
        homeEfgBump: bump,
      });
      rows.push({
        simulated: sim.total.mean,
        actual: game.home_score + game.away_score,
        close: game.total_line,
        simHome: sim.homePoints.mean,
        simAway: sim.awayPoints.mean,
        actualHome: game.home_score,
        actualAway: game.away_score,
      });
    }
    blocks.push({
      season,
      label: season === 2025 ? "2025-26" : "2026-27",
      ...summarize(rows),
    });
    console.log(season, blocks[blocks.length - 1]);
  }
  const payload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sims: SIMS,
    homeEfgBump: Math.round(bump * 10000) / 10000,
    note: "Bias is mean simulated total minus the comparison total. Positive means the simulator is high. The simulated total is the mean of the possession model for that matchup, including overtime.",
    seasons: blocks,
  };
  writeFileSync(path.join(process.cwd(), "public/data/nba/total-calibration.json"), `${JSON.stringify(payload, null, 2)}\n`);
}

main();
