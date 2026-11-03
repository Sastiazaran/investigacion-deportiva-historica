import { simulateGame, type TeamProfile } from "./nba-sim";
import {
  breakTies,
  clampRate,
  marketsFromMatrix,
  marketsFromNormal,
  marketsFromScores,
  scoreMatrix,
  type HistBin,
  type SimOutput,
} from "./sim-markets";

export type Rating = { attack: number; defense: number; games: number; active?: boolean };

export type FootballLeague = {
  name: string;
  homeAvg: number;
  awayAvg: number;
  leagueGpg: number;
  rho: number;
  teams: Record<string, Rating>;
};

export type FootballFactors = {
  schemaVersion: number;
  model: string;
  notes: string[];
  leagues: Record<string, FootballLeague>;
};

export type PointsTeam = { off: number; def: number; games: number; seasonGames?: number; priorSeason?: number };

export type PointsFactors = {
  schemaVersion: number;
  model: string;
  sport: string;
  notes: string[];
  leaguePpg: number;
  homeAdvantage: number;
  marginSd: number;
  totalSd: number;
  teams: Record<string, PointsTeam>;
};

export type RunsFactors = {
  schemaVersion: number;
  model: string;
  notes: string[];
  homeAvg: number;
  awayAvg: number;
  leagueRpg: number;
  tieShare: number;
  teams: Record<string, Rating>;
};

export function predictFootball(league: FootballLeague, home: string, away: string, spreadLine: number, totalLine: number): SimOutput {
  const homeRating = league.teams[home];
  const awayRating = league.teams[away];
  const homeRate = clampRate(league.homeAvg * homeRating.attack * awayRating.defense, 0.15, 4.5);
  const awayRate = clampRate(league.awayAvg * awayRating.attack * homeRating.defense, 0.1, 4);
  return marketsFromMatrix(scoreMatrix(homeRate, awayRate, league.rho, 10), spreadLine, totalLine, "goals");
}

export function predictPoints(factors: PointsFactors, home: string, away: string, spreadLine: number, totalLine: number): SimOutput {
  const homeTeam = factors.teams[home];
  const awayTeam = factors.teams[away];
  const meanHome = homeTeam.off + awayTeam.def - factors.leaguePpg + factors.homeAdvantage;
  const meanAway = awayTeam.off + homeTeam.def - factors.leaguePpg;
  return marketsFromNormal(meanHome, meanAway, factors.marginSd, factors.totalSd, spreadLine, totalLine);
}

export function predictRuns(factors: RunsFactors, home: string, away: string, spreadLine: number, totalLine: number): SimOutput {
  const homeTeam = factors.teams[home];
  const awayTeam = factors.teams[away];
  const homeRate = clampRate(factors.homeAvg * homeTeam.attack * awayTeam.defense, 1.5, 9);
  const awayRate = clampRate(factors.awayAvg * awayTeam.attack * homeTeam.defense, 1.5, 9);
  const grid = scoreMatrix(homeRate, awayRate, 0, 16);
  breakTies(grid, factors.tieShare);
  return marketsFromMatrix(grid, spreadLine, totalLine, "runs");
}

export function predictNba(input: {
  home: TeamProfile;
  away: TeamProfile;
  league: Parameters<typeof simulateGame>[0]["league"];
  homeAdvantagePoints: number;
  paceSd: number;
  leaguePace: number;
  homeEfgBump: number;
  seed: number;
  spreadLine: number;
  totalLine: number;
  marginHist?: HistBin[];
  totalHist?: HistBin[];
  homeScores?: number[];
  awayScores?: number[];
}): SimOutput {
  const scores =
    input.homeScores && input.awayScores
      ? { homeScores: input.homeScores, awayScores: input.awayScores, marginHist: input.marginHist ?? [], totalHist: input.totalHist ?? [] }
      : simulateGame({
          home: input.home,
          away: input.away,
          league: input.league,
          homeAdvantagePoints: input.homeAdvantagePoints,
          paceSd: input.paceSd,
          leaguePace: input.leaguePace,
          seed: input.seed,
          homeEfgBump: input.homeEfgBump,
        });
  return marketsFromScores(scores.homeScores, scores.awayScores, input.spreadLine, input.totalLine, scores.marginHist, scores.totalHist);
}
