import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { decimalToAmerican } from "./odds-format.ts";
import {
  NBA_NAMES,
  PRICE_MARGIN,
  SIMS,
  addBox,
  brierScore,
  blendBoxes,
  devigHome,
  distMean,
  emptyBox,
  fourFactors,
  hashSeed,
  logLoss,
  minimumDecimal,
  mulberry32,
  possessionDistribution,
  possessionParams,
  possessions,
  profileFromBoxes,
  round4,
  settleCloses,
  simulateGame,
  solveHomeEfgBump,
  type BoxCounts,
  type FourFactors,
  type TeamProfile,
} from "./nba-sim.ts";

const teamBox: BoxCounts = {
  fgm: 46,
  fga: 100,
  fg3m: 12,
  fg3a: 40,
  ftm: 15,
  fta: 20,
  oreb: 10,
  dreb: 30,
  tov: 12,
};

const oppBox: BoxCounts = {
  fgm: 40,
  fga: 90,
  fg3m: 10,
  fg3a: 30,
  ftm: 10,
  fta: 15,
  oreb: 8,
  dreb: 25,
  tov: 14,
};

function close(actual: number, expected: number, tol = 1e-9) {
  assert.ok(Math.abs(actual - expected) < tol, `${actual} vs ${expected}`);
}

function leagueProfile(): FourFactors {
  return {
    efg: 0.545,
    tov: 0.125,
    oreb: 0.27,
    ftr: 0.25,
    ftPct: 0.78,
    threeRate: 0.42,
    fg2: 0.55,
    fg3: 0.36,
  };
}

function teamFrom(factors: FourFactors, pace = 100): TeamProfile {
  return { games: 82, priorGames: 0, pace, off: factors, def: factors };
}

test("four factors and pace follow the box-score definitions", () => {
  const off = fourFactors(teamBox, oppBox.dreb);
  close(off.efg, 0.52);
  close(off.tov, 12 / 120.8);
  close(off.oreb, 10 / 35);
  close(off.ftr, 0.2);
  close(off.ftPct, 0.75);
  close(off.threeRate, 0.4);
  close(off.fg2, 34 / 60);
  close(off.fg3, 0.3);
  const def = fourFactors(oppBox, teamBox.dreb);
  close(def.efg, 0.5);
  close(def.tov, 14 / 110.6);
  close(def.oreb, 8 / 38);
  close(def.ftr, 15 / 90);
  close(possessions(teamBox), 110.8);
  const profile = profileFromBoxes(teamBox, oppBox, 1);
  close(profile.pace, (110.8 + 102.6) / 2);
  assert.equal(Object.keys(NBA_NAMES).length, 30);
});

test("a prior is scaled to a fixed number of games before the current sample is added", () => {
  const prior = teamBox;
  const current = emptyBox();
  current.fga = 50;
  current.fgm = 25;
  const blended = blendBoxes(prior, 80, 16, current);
  close(blended.fga, 100 * (16 / 80) + 50);
  close(blended.fgm, 46 * 0.2 + 25);
  const sum = addBox(teamBox, oppBox);
  close(sum.tov, 26);
});

test("minimum price is fair decimal odds times 1.05", () => {
  assert.equal(PRICE_MARGIN, 1.05);
  const price = minimumDecimal(0.5);
  assert.equal(price, 2.1);
  assert.equal(decimalToAmerican(price), "+110");
  const favorite = minimumDecimal(0.6);
  assert.ok(favorite != null);
  close(favorite, 1.75);
  assert.equal(decimalToAmerican(favorite), "-133");
  assert.equal(minimumDecimal(0), null);
  assert.equal(minimumDecimal(1.2), null);
});

test("Brier, log loss, de-vig, and closing-line ROI use one flat unit", () => {
  close(brierScore([{ p: 0.25, y: 1 }]) ?? 0, 0.5625);
  close(logLoss([{ p: 0.5, y: 1 }]) ?? 0, Math.log(2));
  close(devigHome(2, 2), 0.5);
  close(devigHome(1.833, 2), (1 / 1.833) / (1 / 1.833 + 0.5), 1e-12);
  const edge = settleCloses([{ pHome: 0.5, homeMl: 2.1, awayMl: 1.8, homeWon: true }]);
  assert.equal(edge.bets, 1);
  close(edge.profit, 1.1);
  close(edge.roi ?? 0, 1.1);
  const noBet = settleCloses([{ pHome: 0.5, homeMl: 2.09, awayMl: 1.8, homeWon: true }]);
  assert.equal(noBet.bets, 0);
  assert.equal(noBet.roi, null);
  const any = settleCloses([{ pHome: 0.5, homeMl: 2.05, awayMl: 1.9, homeWon: false }], 1);
  assert.equal(any.bets, 1);
  close(any.profit, -1);
});

test("the home-court eFG shift is sized to the target margin", () => {
  const league = leagueProfile();
  const bump = solveHomeEfgBump(league, 100, 3);
  const margin = distMean(possessionDistribution(possessionParams(league, league, league, bump))) * 100
    - distMean(possessionDistribution(possessionParams(league, league, league, -bump))) * 100;
  close(margin, 3, 0.05);
  assert.ok(bump > 0);
});

test("possession probabilities sum to one and the Monte Carlo mean matches them", () => {
  const params = possessionParams(leagueProfile(), leagueProfile(), leagueProfile(), 0);
  const dist = possessionDistribution(params);
  close(dist.reduce((sum, value) => sum + value, 0), 1, 1e-8);
  const rng = mulberry32(11);
  const cdf: number[] = [];
  let running = 0;
  for (const value of dist) {
    running += value;
    cdf.push(running);
  }
  let total = 0;
  const draws = 12000;
  for (let i = 0; i < draws; i += 1) {
    const u = rng();
    let points = dist.length - 1;
    for (let bin = 0; bin < cdf.length; bin += 1) {
      if (u <= cdf[bin]) {
        points = bin;
        break;
      }
    }
    total += points;
  }
  close(total / draws, distMean(dist), 0.03);
});

test("a seeded game is repeatable and home court shows up in the win rate", () => {
  const league = leagueProfile();
  const team = teamFrom(league);
  const input = {
    home: team,
    away: team,
    league,
    homeAdvantagePoints: 5,
    paceSd: 3,
    leaguePace: 100,
    n: SIMS,
    seed: 7,
  };
  const first = simulateGame(input);
  const second = simulateGame(input);
  assert.equal(first.n, 5000);
  assert.deepEqual(first, second);
  assert.ok(first.homeWinPct > 0.55, `home win ${(first.homeWinPct)}`);
  assert.ok(first.margin.p10 <= first.margin.p25);
  assert.ok(first.margin.p25 <= first.margin.p50);
  assert.ok(first.margin.p50 <= first.margin.p75);
  assert.ok(first.margin.p75 <= first.margin.p90);
  assert.ok(first.total.p10 <= first.total.p90);
  const hist = first.marginHist.reduce((sum, bin) => sum + bin.count, 0);
  assert.equal(hist, SIMS);
  assert.ok(Math.abs(first.homeWinPct + first.awayWinPct + first.tiePct - 1) < 1e-12);
  const other = simulateGame({ ...input, seed: 8 });
  assert.notEqual(other.margin.mean, first.margin.mean);
});

test("a large efficiency edge moves the win probability", () => {
  const league = leagueProfile();
  const home = teamFrom(league);
  const away = teamFrom(league);
  home.off = { ...home.off, efg: league.efg + 0.06 };
  const result = simulateGame({
    home,
    away,
    league,
    homeAdvantagePoints: 0,
    paceSd: 3,
    leaguePace: 100,
    n: 2000,
    seed: 4,
    homeEfgBump: 0,
    overtime: false,
  });
  assert.ok(result.homeWinPct > 0.65, `win ${(result.homeWinPct)}`);
  const neutral = simulateGame({
    home: teamFrom(league),
    away: teamFrom(league),
    league,
    homeAdvantagePoints: 0,
    paceSd: 0,
    leaguePace: 100,
    n: 2000,
    seed: 4,
    homeEfgBump: 0,
    overtime: false,
  });
  const params = possessionParams(league, league, league, 0);
  const expected = distMean(possessionDistribution(params)) * 100;
  close(neutral.homePoints.mean, expected, 0.8);
  assert.ok(result.homePoints.mean > neutral.homePoints.mean);
});

test("the matchup seed is stable", () => {
  assert.equal(hashSeed("2026-10-20|okc|sa"), hashSeed("2026-10-20|okc|sa"));
  assert.notEqual(hashSeed("2026-10-20|okc|sa"), hashSeed("2026-10-20|sa|okc"));
  assert.equal(round4(1 / 3), 0.3333);
});

test("published sim files do not touch the soccer summary", () => {
  const data = path.join(import.meta.dirname, "../../public/data");
  const soccer = JSON.parse(readFileSync(path.join(data, "summary.json"), "utf8"));
  assert.equal(soccer.schemaVersion, 1);
  assert.equal(soccer.sport, undefined);
  const factors = JSON.parse(readFileSync(path.join(data, "nba/team-factors.json"), "utf8"));
  const backtest = JSON.parse(readFileSync(path.join(data, "nba/sim-backtest.json"), "utf8"));
  assert.equal(factors.schemaVersion, 1);
  assert.equal(Object.keys(factors.teams).length, 30);
  assert.equal(factors.sims, 5000);
  assert.equal(backtest.n, 5000);
  assert.equal(typeof backtest.beatsMarket, "boolean");
  assert.equal(typeof backtest.statement, "string");
  assert.ok(backtest.full.games > 0);
  assert.ok(factors.teams.okc.profiles.current);
  assert.ok(factors.teams.sa.profiles["2025"]);
});
