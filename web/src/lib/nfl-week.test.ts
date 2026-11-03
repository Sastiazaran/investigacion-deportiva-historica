import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { marketsFromNormal } from "./sim-markets.ts";

type Factors = {
  leaguePpg: number;
  homeAdvantage: number;
  marginSd: number;
  totalSd: number;
  teams: Record<string, { off: number; def: number; seasonGames?: number }>;
};

const data = path.join(import.meta.dirname, "../../public/data/nfl");

function homeWin(factors: Factors, home: string, away: string) {
  const homeTeam = factors.teams[home];
  const awayTeam = factors.teams[away];
  const output = marketsFromNormal(
    homeTeam.off + awayTeam.def - factors.leaguePpg + factors.homeAdvantage,
    awayTeam.off + homeTeam.def - factors.leaguePpg,
    factors.marginSd,
    factors.totalSd,
    0,
    45,
  );
  const decided = output.home.probability + output.away.probability;
  return decided > 0 ? output.home.probability / decided : 0.5;
}

test("Week 9 2026 Detroit is favored at Miami and at home", () => {
  const factors = JSON.parse(readFileSync(path.join(data, "sim-factors.json"), "utf8")) as Factors;
  const miamiHome = homeWin(factors, "MIA", "DET");
  const detroitHome = homeWin(factors, "DET", "MIA");
  assert.ok(miamiHome < 0.45, `Miami home win ${(miamiHome)}`);
  assert.ok(detroitHome > 0.6, `Detroit home win ${(detroitHome)}`);
  assert.ok(factors.teams.MIA.seasonGames != null && factors.teams.MIA.seasonGames < 20);
  assert.ok(factors.teams.DET.off > factors.teams.MIA.off + 5);
});

test("Week 9 Miami at home is within 15 points of the market", () => {
  const check = JSON.parse(readFileSync(path.join(data, "week9-check.json"), "utf8")) as {
    games: { away: string; home: string; gap: number; flagged: boolean; modelHome: number; marketHome: number }[];
    miaDet: { miamiHome: { modelHome: number } };
  };
  const game = check.games.find((row) => row.home === "MIA" && row.away === "DET");
  assert.ok(game, "Week 9 Detroit at Miami is missing");
  assert.ok(game.gap <= 0.15, `gap ${game.gap}`);
  assert.equal(game.flagged, false);
  assert.ok(game.marketHome < 0.4);
  assert.ok(Math.abs(game.modelHome - check.miaDet.miamiHome.modelHome) < 0.02);
});
