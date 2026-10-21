import { readFileSync } from "node:fs";
import path from "node:path";
import type { FourFactors, TeamProfile } from "./nba-sim";

export type NbaTeamFactors = {
  team: string;
  abbrev: string;
  profiles: {
    current?: TeamProfile;
    "2025"?: TeamProfile;
    "2026"?: TeamProfile;
  };
};

export type NbaFactors = {
  schemaVersion: number;
  generatedAt: string;
  sims: number;
  priceMargin: number;
  priorGames: number;
  homeAdvantagePoints: number;
  homeEfgBump: number;
  paceSd: number;
  leaguePace: number;
  league: FourFactors;
  coverage: Record<string, { games: number; from: string | null; to: string | null }>;
  pbp: {
    keptGames?: number;
    requestedGames?: number;
    mismatches?: number;
    possessions?: number;
    pointsPerPossession?: number | null;
    pointShare?: Record<string, number>;
    note?: string;
  };
  sources: string[];
  notes: string[];
  teams: Record<string, NbaTeamFactors>;
};

export type BetBlock = {
  bets: number;
  wins: number;
  staked: number;
  profit: number;
  roi: number | null;
};

export type BacktestBlock = {
  games: number;
  homeWins: number;
  homeWinRate: number | null;
  meanModelHomeProb: number | null;
  meanMarketHomeProb: number | null;
  model: { brier: number | null; logLoss: number | null };
  market: { brier: number | null; logLoss: number | null };
  roiEdge5: BetBlock;
  roiAnyEdge: BetBlock;
  beatsMarket: boolean;
};

export type NbaBacktest = {
  schemaVersion: number;
  season: number;
  n: number;
  generatedAt: string;
  closingSource: string;
  closeSources?: Record<string, number>;
  repoMoneylineGap: string;
  beatsMarket: boolean;
  statement: string;
  missingClose: number;
  full: BacktestBlock;
  through2026_02_12: BacktestBlock;
  after2026_02_12: BacktestBlock;
};

function readJson<T>(name: string): T {
  const file = path.join(process.cwd(), "public", "data", "nba", name);
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

export function loadNbaFactors() {
  return readJson<NbaFactors>("team-factors.json");
}

export function loadNbaBacktest() {
  return readJson<NbaBacktest>("sim-backtest.json");
}
