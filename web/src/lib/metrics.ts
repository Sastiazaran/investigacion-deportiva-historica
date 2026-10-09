import type { CalibrationBucket, SplitStats } from "./types";

/**
 * Year-range math for numbers the pipeline already aggregated.
 * Bet-level ROI and de-vigging live in scripts/metrics.py, which writes these
 * season rows. Combining seasons is profit summed over stakes summed — not the
 * average of each season's ROI.
 */

export function clubSlug(name: string) {
  const folded = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return folded
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function combineSplits(parts: SplitStats[]): SplitStats {
  let played = 0;
  let won = 0;
  let drawn = 0;
  let lost = 0;
  let bets = 0;
  let returned = 0;
  let profit = 0;
  let oddsWeighted = 0;
  for (const part of parts) {
    played += part.played;
    won += part.won;
    drawn += part.drawn;
    lost += part.lost;
    bets += part.bets;
    returned += part.returned;
    profit += part.profit;
    if (part.bets > 0 && part.avgOdds != null) {
      oddsWeighted += part.avgOdds * part.bets;
    }
  }
  return {
    played,
    won,
    drawn,
    lost,
    winPct: played > 0 ? (won / played) * 100 : null,
    bets,
    staked: bets,
    returned,
    profit,
    roi: bets > 0 ? profit / bets : null,
    avgOdds: bets > 0 ? oddsWeighted / bets : null,
  };
}

export function combineBuckets(groups: CalibrationBucket[][]): CalibrationBucket[] {
  if (groups.length === 0) return [];
  return groups[0].map((bucket, index) => {
    let outcomes = 0;
    let wins = 0;
    let sumImpliedProb = 0;
    let sumOdds = 0;
    for (const group of groups) {
      const row = group[index];
      if (!row || row.id !== bucket.id) {
        throw new Error(`Bucket mismatch at ${bucket.id}`);
      }
      outcomes += row.outcomes;
      wins += row.wins;
      sumImpliedProb += row.sumImpliedProb;
      sumOdds += row.sumOdds;
    }
    return {
      id: bucket.id,
      label: bucket.label,
      minOdds: bucket.minOdds,
      maxOdds: bucket.maxOdds,
      outcomes,
      wins,
      actualWinRate: outcomes > 0 ? wins / outcomes : null,
      sumImpliedProb,
      avgImpliedProb: outcomes > 0 ? sumImpliedProb / outcomes : null,
      sumOdds,
      avgOdds: outcomes > 0 ? sumOdds / outcomes : null,
    };
  });
}

export function formatRoi(roi: number | null) {
  if (roi == null || Number.isNaN(roi)) return "—";
  const pct = roi * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

export function formatProfit(profit: number) {
  const sign = profit > 0 ? "+" : "";
  return `${sign}${profit.toFixed(2)}`;
}

export function formatWinPct(winPct: number | null) {
  if (winPct == null) return "—";
  return `${winPct.toFixed(1)}%`;
}

export function formatAvgOdds(odds: number | null) {
  if (odds == null) return "—";
  return odds.toFixed(2);
}

export function roiClass(roi: number | null) {
  if (roi == null || roi === 0) return "";
  return roi > 0 ? "roi-pos" : "roi-neg";
}
