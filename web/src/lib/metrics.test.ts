import assert from "node:assert/strict";
import test from "node:test";
import type { CalibrationBucket, SplitStats } from "./types.ts";
import { clubSlug, combineBuckets, combineSplits, formatRoi } from "./metrics.ts";

function split(partial: Partial<SplitStats> & Pick<SplitStats, "played" | "won" | "bets" | "profit">): SplitStats {
  return {
    drawn: 0,
    lost: partial.played - partial.won,
    winPct: partial.played > 0 ? (partial.won / partial.played) * 100 : null,
    staked: partial.bets,
    returned: partial.bets + partial.profit,
    avgOdds: partial.bets > 0 ? 1.3 : null,
    roi: partial.bets > 0 ? partial.profit / partial.bets : null,
    ...partial,
  };
}

test("flat-bet ROI is total profit over total stakes, not the mean of season ROIs", () => {
  // Eight wins and two losses at 1.30, then a separate losing season.
  const favorite = split({
    played: 10,
    won: 8,
    drawn: 0,
    lost: 2,
    bets: 10,
    profit: 0.4,
    avgOdds: 1.3,
    returned: 10.4,
  });
  const losing = split({
    played: 2,
    won: 0,
    lost: 2,
    bets: 2,
    profit: -2,
    avgOdds: 1.8,
    returned: 0,
  });
  const combined = combineSplits([favorite, losing]);
  assert.equal(combined.bets, 12);
  assert.equal(combined.staked, 12);
  assert.ok(Math.abs(combined.profit - -1.6) < 1e-9);
  assert.ok(Math.abs((combined.roi ?? 0) - -1.6 / 12) < 1e-9);
  // A mean of the two ROIs (4% and -100%) would be about -48%, which is wrong.
  assert.ok(Math.abs((combined.roi ?? 0) - (0.04 + -1) / 2) > 0.2);
  assert.ok(Math.abs((combined.avgOdds ?? 0) - (1.3 * 10 + 1.8 * 2) / 12) < 1e-9);
});

test("matches without a price do not invent an ROI", () => {
  const combined = combineSplits([
    split({ played: 4, won: 2, bets: 0, profit: 0, avgOdds: null, returned: 0, roi: null }),
  ]);
  assert.equal(combined.played, 4);
  assert.equal(combined.bets, 0);
  assert.equal(combined.roi, null);
  assert.equal(combined.avgOdds, null);
  assert.equal(formatRoi(null), "—");
  assert.equal(formatRoi(0.051), "+5.1%");
  assert.equal(formatRoi(-1), "-100.0%");
});

test("calibration buckets recombine with overround-free implied probability", () => {
  const bucket = (
    outcomes: number,
    wins: number,
    sumImpliedProb: number,
    sumOdds: number,
  ): CalibrationBucket => ({
    id: "1.20-1.25",
    label: "1.20–1.25",
    minOdds: 1.2,
    maxOdds: 1.25,
    outcomes,
    wins,
    actualWinRate: outcomes ? wins / outcomes : null,
    sumImpliedProb,
    avgImpliedProb: outcomes ? sumImpliedProb / outcomes : null,
    sumOdds,
    avgOdds: outcomes ? sumOdds / outcomes : null,
  });
  const [combined] = combineBuckets([
    [bucket(10, 8, 7.9, 12.2)],
    [bucket(10, 6, 7.7, 12.4)],
  ]);
  assert.equal(combined.outcomes, 20);
  assert.equal(combined.wins, 14);
  assert.ok(Math.abs((combined.actualWinRate ?? 0) - 0.7) < 1e-12);
  assert.ok(Math.abs((combined.avgImpliedProb ?? 0) - (7.9 + 7.7) / 20) < 1e-12);
  assert.ok(Math.abs((combined.avgOdds ?? 0) - (12.2 + 12.4) / 20) < 1e-12);
});

test("club slugs match the Python pipeline", () => {
  assert.equal(clubSlug("Porto"), "porto");
  assert.equal(clubSlug("1. FC Köln"), "1-fc-koln");
  assert.equal(clubSlug("Atlético San Luis"), "atletico-san-luis");
  assert.equal(clubSlug("Bayer 04 Leverkusen"), "bayer-04-leverkusen");
});
