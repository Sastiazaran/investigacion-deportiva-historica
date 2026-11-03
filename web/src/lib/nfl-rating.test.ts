import assert from "node:assert/strict";
import test from "node:test";
import { NFL_PRIOR_GAMES, seasonRate } from "./nfl-rating.ts";

test("eight games of a bad offense move the rating off last season", () => {
  assert.equal(NFL_PRIOR_GAMES, 8);
  const weak = seasonRate({
    current: { gf: 16.71 * 7, ga: 25.86 * 7, gp: 7 },
    previous: { gf: 20.41 * 17, ga: 24.94 * 17, gp: 17 },
    league: 22,
  });
  const strong = seasonRate({
    current: { gf: 29 * 7, ga: 25.71 * 7, gp: 7 },
    previous: { gf: 28.29 * 17, ga: 24.29 * 17, gp: 17 },
    league: 22,
  });
  assert.ok(weak.off < 20, `weak offense ${weak.off}`);
  assert.ok(strong.off > 27, `strong offense ${strong.off}`);
  const margin = weak.off + strong.def - 22 + 2.2 - (strong.off + weak.def - 22);
  assert.ok(margin < -5, `home margin ${margin}`);
});

test("with no games yet the rating is last season, shrunk toward the league", () => {
  const rate = seasonRate({
    current: { gf: 0, ga: 0, gp: 0 },
    previous: { gf: 33 * 17, ga: 20 * 17, gp: 17 },
    league: 22,
  });
  assert.ok(rate.off > 30 && rate.off < 33, `off ${rate.off}`);
  assert.ok(rate.def > 20 && rate.def < 22, `def ${rate.def}`);
});
