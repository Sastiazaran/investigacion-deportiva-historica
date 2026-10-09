import type { AtsBook, AtsSplit, CalibBlock, MlBook, MlSplit, ProbBucket, UsSeason } from "./us-types";

function emptyMl(): MlSplit {
  return {
    played: 0,
    won: 0,
    lost: 0,
    ties: 0,
    winPct: null,
    bets: 0,
    pushes: 0,
    staked: 0,
    returned: 0,
    profit: 0,
    roi: null,
    avgOdds: null,
  };
}

function emptyAts(): AtsSplit {
  return {
    bets: 0,
    covers: 0,
    losses: 0,
    pushes: 0,
    coverPct: null,
    staked: 0,
    returned: 0,
    profit: 0,
    roi: null,
    avgOdds: null,
  };
}

export function combineMl(parts: MlSplit[]): MlSplit {
  const total = emptyMl();
  let oddsWeighted = 0;
  for (const part of parts) {
    total.played += part.played;
    total.won += part.won;
    total.lost += part.lost;
    total.ties += part.ties;
    total.bets += part.bets;
    total.pushes += part.pushes;
    total.returned += part.returned;
    total.profit += part.profit;
    if (part.bets > 0 && part.avgOdds != null) oddsWeighted += part.avgOdds * part.bets;
  }
  const decided = total.won + total.lost + total.ties;
  total.staked = total.bets;
  total.winPct = decided > 0 ? (total.won / decided) * 100 : null;
  total.roi = total.bets > 0 ? total.profit / total.bets : null;
  total.avgOdds = total.bets > 0 ? oddsWeighted / total.bets : null;
  return total;
}

export function combineAts(parts: AtsSplit[]): AtsSplit {
  const total = emptyAts();
  let oddsWeighted = 0;
  for (const part of parts) {
    total.bets += part.bets;
    total.covers += part.covers;
    total.losses += part.losses;
    total.pushes += part.pushes;
    total.returned += part.returned;
    total.profit += part.profit;
    if (part.bets > 0 && part.avgOdds != null) oddsWeighted += part.avgOdds * part.bets;
  }
  const decided = total.covers + total.losses;
  total.staked = total.bets;
  total.coverPct = decided > 0 ? (total.covers / decided) * 100 : null;
  total.roi = total.bets > 0 ? total.profit / total.bets : null;
  total.avgOdds = total.bets > 0 ? oddsWeighted / total.bets : null;
  return total;
}

export function combineMlBook(parts: MlBook[]): MlBook {
  return {
    overall: combineMl(parts.map((part) => part.overall)),
    home: combineMl(parts.map((part) => part.home)),
    away: combineMl(parts.map((part) => part.away)),
  };
}

export function combineAtsBook(parts: AtsBook[]): AtsBook {
  return {
    overall: combineAts(parts.map((part) => part.overall)),
    home: combineAts(parts.map((part) => part.home)),
    away: combineAts(parts.map((part) => part.away)),
    favorite: combineAts(parts.map((part) => part.favorite)),
    underdog: combineAts(parts.map((part) => part.underdog)),
  };
}

export function seasonSpread(row: UsSeason, market: "ats" | "runLine" | null): AtsBook | null {
  if (market === "ats") return row.ats ?? null;
  if (market === "runLine") return row.runLine ?? null;
  return null;
}

export function combineCalibration(parts: CalibBlock[]): CalibBlock {
  const buckets = new Map<string, ProbBucket>();
  let games = 0;
  let sumOverround = 0;
  let sumBrier = 0;
  for (const part of parts) {
    games += part.games;
    sumOverround += part.sumOverround;
    sumBrier += part.sumBrier;
    for (const bucket of part.buckets) {
      const current = buckets.get(bucket.id);
      if (!current) {
        buckets.set(bucket.id, { ...bucket });
        continue;
      }
      current.outcomes += bucket.outcomes;
      current.wins += bucket.wins;
      current.sumPredicted += bucket.sumPredicted;
      current.sumBrier += bucket.sumBrier;
      current.sumOdds += bucket.sumOdds;
    }
  }
  const rows = [...buckets.values()].map((bucket) => {
    const outcomes = bucket.outcomes;
    return {
      ...bucket,
      actualWinRate: outcomes > 0 ? bucket.wins / outcomes : null,
      avgPredicted: outcomes > 0 ? bucket.sumPredicted / outcomes : null,
      brier: outcomes > 0 ? bucket.sumBrier / outcomes : null,
      avgOdds: outcomes > 0 ? bucket.sumOdds / outcomes : null,
    };
  });
  const outcomes = rows.reduce((sum, row) => sum + row.outcomes, 0);
  return {
    games,
    outcomes,
    sumOverround,
    avgOverround: games > 0 ? sumOverround / games : null,
    sumBrier,
    brier: outcomes > 0 ? sumBrier / outcomes : null,
    buckets: rows,
  };
}
