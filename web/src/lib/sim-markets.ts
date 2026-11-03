/**
 * Shared match markets for every sport.
 *
 * Football and baseball use a Dixon-Coles / Poisson score matrix.
 * NFL uses a normal model of margin and total.
 * Prices are probability first, then fair decimal odds, then the minimum
 * price at fair times 1.05. A spread or total push is a refund, so those
 * prices use the probability conditional on a decision.
 */

export const PRICE_MARGIN = 1.05;

export type Priced = {
  probability: number;
  fairDecimal: number | null;
  minimumDecimal: number | null;
};

export type HistBin = { label: string; count: number; pct: number };

export type LineMarket = {
  line: number;
  home: Priced;
  away: Priced;
  push: number;
};

export type TotalMarket = {
  line: number;
  over: Priced;
  under: Priced;
  push: number;
};

export type SimOutput = {
  home: Priced;
  draw: Priced;
  away: Priced;
  spread: LineMarket;
  total: TotalMarket;
  meanHome: number;
  meanAway: number;
  meanMargin: number;
  meanTotal: number;
  marginHist: HistBin[];
  totalHist: HistBin[];
};

export function price(probability: number, margin = PRICE_MARGIN): Priced {
  if (!(probability > 0) || probability > 1 || !Number.isFinite(probability)) {
    return { probability: Number.isFinite(probability) ? probability : 0, fairDecimal: null, minimumDecimal: null };
  }
  const fair = 1 / probability;
  return { probability, fairDecimal: fair, minimumDecimal: fair * margin };
}

export function devigTwo(homeDecimal: number, awayDecimal: number) {
  const home = 1 / homeDecimal;
  const away = 1 / awayDecimal;
  const total = home + away;
  return { home: home / total, away: away / total };
}

export function devigThree(homeDecimal: number, drawDecimal: number, awayDecimal: number) {
  const home = 1 / homeDecimal;
  const draw = 1 / drawDecimal;
  const away = 1 / awayDecimal;
  const total = home + draw + away;
  return { home: home / total, draw: draw / total, away: away / total };
}

export function poissonPmf(goals: number, lambda: number) {
  if (goals < 0) return 0;
  if (lambda <= 0) return goals === 0 ? 1 : 0;
  let probability = Math.exp(-lambda);
  for (let i = 1; i <= goals; i += 1) probability *= lambda / i;
  return probability;
}

/** Low-score correction. A negative rho makes 0-0 and 1-1 more common. */
export function dixonColesTau(homeGoals: number, awayGoals: number, homeRate: number, awayRate: number, rho: number) {
  let tau = 1;
  if (homeGoals === 0 && awayGoals === 0) tau = 1 - homeRate * awayRate * rho;
  else if (homeGoals === 0 && awayGoals === 1) tau = 1 + homeRate * rho;
  else if (homeGoals === 1 && awayGoals === 0) tau = 1 + awayRate * rho;
  else if (homeGoals === 1 && awayGoals === 1) tau = 1 - rho;
  return tau > 0 ? tau : 0;
}

export function scoreMatrix(homeRate: number, awayRate: number, rho: number, max = 10) {
  const grid: number[][] = [];
  let sum = 0;
  for (let home = 0; home <= max; home += 1) {
    const row: number[] = [];
    for (let away = 0; away <= max; away += 1) {
      const probability =
        poissonPmf(home, homeRate) *
        poissonPmf(away, awayRate) *
        dixonColesTau(home, away, homeRate, awayRate, rho);
      row.push(probability);
      sum += probability;
    }
    grid.push(row);
  }
  if (sum > 0) {
    for (const row of grid) {
      for (let away = 0; away < row.length; away += 1) row[away] /= sum;
    }
  }
  return grid;
}

/**
 * Final baseball scores do not tie. Move each regulation tie to a one-run
 * extra-inning result. `homeShare` is the home team's share of those extras.
 */
export function breakTies(grid: number[][], homeShare: number) {
  const max = grid.length - 1;
  const share = Math.min(1, Math.max(0, homeShare));
  for (let score = 0; score <= max; score += 1) {
    const tied = grid[score][score];
    if (tied <= 0) continue;
    grid[score][score] = 0;
    const homeWins = score < max ? score + 1 : score;
    const awayWins = score < max ? score + 1 : score;
    if (score < max) {
      grid[homeWins][score] += tied * share;
      grid[score][awayWins] += tied * (1 - share);
    } else {
      grid[score][score - 1] += tied * share;
      grid[score - 1][score] += tied * (1 - share);
    }
  }
  return grid;
}

function asHist(labels: string[], weights: number[]): HistBin[] {
  const total = weights.reduce((sum, value) => sum + value, 0);
  return labels.map((label, index) => ({
    label,
    count: weights[index] ?? 0,
    pct: total > 0 ? (weights[index] ?? 0) / total : 0,
  }));
}

function footballBins(grid: number[][]) {
  const margins = new Array<number>(7).fill(0);
  const totals = new Array<number>(7).fill(0);
  for (let home = 0; home < grid.length; home += 1) {
    for (let away = 0; away < grid[home].length; away += 1) {
      const probability = grid[home][away];
      const margin = home - away;
      const total = home + away;
      const marginIndex = margin <= -3 ? 0 : margin >= 3 ? 6 : margin + 3;
      const totalIndex = total >= 6 ? 6 : total;
      margins[marginIndex] += probability;
      totals[totalIndex] += probability;
    }
  }
  return {
    marginHist: asHist(["≤ -3", "-2", "-1", "0", "+1", "+2", "≥ +3"], margins),
    totalHist: asHist(["0", "1", "2", "3", "4", "5", "≥ 6"], totals),
  };
}

function conditional(win: number, lose: number) {
  const decided = win + lose;
  if (decided <= 0) return { win: 0, lose: 0 };
  return { win: win / decided, lose: lose / decided };
}

export function marketsFromMatrix(grid: number[][], spreadLine: number, totalLine: number, bins: "goals" | "runs"): SimOutput {
  let home = 0;
  let draw = 0;
  let away = 0;
  let cover = 0;
  let spreadPush = 0;
  let spreadLose = 0;
  let over = 0;
  let under = 0;
  let totalPush = 0;
  let meanHome = 0;
  let meanAway = 0;
  for (let homeGoals = 0; homeGoals < grid.length; homeGoals += 1) {
    for (let awayGoals = 0; awayGoals < grid[homeGoals].length; awayGoals += 1) {
      const probability = grid[homeGoals][awayGoals];
      const margin = homeGoals - awayGoals;
      const total = homeGoals + awayGoals;
      meanHome += homeGoals * probability;
      meanAway += awayGoals * probability;
      if (margin > 0) home += probability;
      else if (margin < 0) away += probability;
      else draw += probability;
      if (margin > spreadLine + 1e-9) cover += probability;
      else if (Math.abs(margin - spreadLine) <= 1e-9) spreadPush += probability;
      else spreadLose += probability;
      if (total > totalLine + 1e-9) over += probability;
      else if (Math.abs(total - totalLine) <= 1e-9) totalPush += probability;
      else under += probability;
    }
  }
  const spread = conditional(cover, spreadLose);
  const total = conditional(over, under);
  const charts =
    bins === "goals"
      ? footballBins(grid)
      : runBins(grid);
  return {
    home: price(home),
    draw: price(draw),
    away: price(away),
    spread: { line: spreadLine, home: price(spread.win), away: price(spread.lose), push: spreadPush },
    total: { line: totalLine, over: price(total.win), under: price(total.lose), push: totalPush },
    meanHome,
    meanAway,
    meanMargin: meanHome - meanAway,
    meanTotal: meanHome + meanAway,
    marginHist: charts.marginHist,
    totalHist: charts.totalHist,
  };
}

function runBins(grid: number[][]) {
  const margins = new Array<number>(7).fill(0);
  const totals = new Array<number>(7).fill(0);
  for (let home = 0; home < grid.length; home += 1) {
    for (let away = 0; away < grid[home].length; away += 1) {
      const probability = grid[home][away];
      const margin = home - away;
      const total = home + away;
      let marginIndex = 3;
      if (margin <= -3) marginIndex = 0;
      else if (margin === -2) marginIndex = 1;
      else if (margin === -1) marginIndex = 2;
      else if (margin === 0) marginIndex = 3;
      else if (margin === 1) marginIndex = 4;
      else if (margin === 2) marginIndex = 5;
      else marginIndex = 6;
      let totalIndex = 0;
      if (total <= 4) totalIndex = 0;
      else if (total <= 6) totalIndex = 1;
      else if (total <= 8) totalIndex = 2;
      else if (total <= 10) totalIndex = 3;
      else if (total <= 12) totalIndex = 4;
      else if (total <= 14) totalIndex = 5;
      else totalIndex = 6;
      margins[Math.max(0, Math.min(6, marginIndex))] += probability;
      totals[totalIndex] += probability;
    }
  }
  return {
    marginHist: asHist(["≤ -3", "-2", "-1", "0", "+1", "+2", "≥ +3"], margins),
    totalHist: asHist(["0–4", "5–6", "7–8", "9–10", "11–12", "13–14", "≥ 15"], totals),
  };
}

export function erf(value: number) {
  const sign = value < 0 ? -1 : 1;
  const absolute = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * absolute);
  const polynomial =
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t);
  const estimate = 1 - polynomial * Math.exp(-absolute * absolute);
  return sign * estimate;
}

export function normalCdf(value: number, mean: number, deviation: number) {
  if (deviation <= 0) return value >= mean ? 1 : 0;
  return 0.5 * (1 + erf((value - mean) / (deviation * Math.SQRT2)));
}

function integerTail(mean: number, deviation: number, line: number) {
  const integer = Math.abs(line - Math.round(line)) < 1e-6;
  if (!integer) {
    const cover = 1 - normalCdf(line, mean, deviation);
    return { cover, push: 0, lose: 1 - cover };
  }
  const above = 1 - normalCdf(line + 0.5, mean, deviation);
  const below = normalCdf(line - 0.5, mean, deviation);
  return { cover: above, push: Math.max(0, 1 - above - below), lose: below };
}

export function marketsFromNormal(
  meanHome: number,
  meanAway: number,
  marginDeviation: number,
  totalDeviation: number,
  spreadLine: number,
  totalLine: number,
): SimOutput {
  const margin = meanHome - meanAway;
  const total = meanHome + meanAway;
  const homeWin = 1 - normalCdf(0.5, margin, marginDeviation);
  const awayWin = normalCdf(-0.5, margin, marginDeviation);
  const tie = Math.max(0, 1 - homeWin - awayWin);
  const spread = integerTail(margin, marginDeviation, spreadLine);
  const totalSide = integerTail(total, totalDeviation, totalLine);
  const spreadPrice = conditional(spread.cover, spread.lose);
  const totalPrice = conditional(totalSide.cover, totalSide.lose);
  const marginLabels = ["≤ -14", "-13 to -7", "-6 to -1", "0 to 6", "7 to 13", "≥ 14"];
  const marginWeights = [
    normalCdf(-13.5, margin, marginDeviation),
    normalCdf(-6.5, margin, marginDeviation) - normalCdf(-13.5, margin, marginDeviation),
    normalCdf(-0.5, margin, marginDeviation) - normalCdf(-6.5, margin, marginDeviation),
    normalCdf(6.5, margin, marginDeviation) - normalCdf(-0.5, margin, marginDeviation),
    normalCdf(13.5, margin, marginDeviation) - normalCdf(6.5, margin, marginDeviation),
    1 - normalCdf(13.5, margin, marginDeviation),
  ];
  const totalLabels = ["≤ 30", "31–37", "38–44", "45–51", "52–58", "≥ 59"];
  const totalWeights = [30.5, 37.5, 44.5, 51.5, 58.5].map((edge, index, edges) => {
    const upper = normalCdf(edge, total, totalDeviation);
    const lower = index === 0 ? 0 : normalCdf(edges[index - 1], total, totalDeviation);
    return upper - lower;
  });
  totalWeights.push(1 - normalCdf(58.5, total, totalDeviation));
  return {
    home: price(homeWin),
    draw: price(tie),
    away: price(awayWin),
    spread: { line: spreadLine, home: price(spreadPrice.win), away: price(spreadPrice.lose), push: spread.push },
    total: { line: totalLine, over: price(totalPrice.win), under: price(totalPrice.lose), push: totalSide.push },
    meanHome,
    meanAway,
    meanMargin: margin,
    meanTotal: total,
    marginHist: asHist(marginLabels, marginWeights),
    totalHist: asHist(totalLabels, totalWeights),
  };
}

export function marketsFromScores(
  homeScores: number[],
  awayScores: number[],
  spreadLine: number,
  totalLine: number,
  marginHist: HistBin[],
  totalHist: HistBin[],
): SimOutput {
  const n = homeScores.length;
  let home = 0;
  let draw = 0;
  let away = 0;
  let cover = 0;
  let spreadPush = 0;
  let spreadLose = 0;
  let over = 0;
  let under = 0;
  let totalPush = 0;
  let meanHome = 0;
  let meanAway = 0;
  for (let index = 0; index < n; index += 1) {
    const homeScore = homeScores[index];
    const awayScore = awayScores[index];
    const margin = homeScore - awayScore;
    const total = homeScore + awayScore;
    meanHome += homeScore;
    meanAway += awayScore;
    if (margin > 0) home += 1;
    else if (margin < 0) away += 1;
    else draw += 1;
    if (margin > spreadLine + 1e-9) cover += 1;
    else if (Math.abs(margin - spreadLine) <= 1e-9) spreadPush += 1;
    else spreadLose += 1;
    if (total > totalLine + 1e-9) over += 1;
    else if (Math.abs(total - totalLine) <= 1e-9) totalPush += 1;
    else under += 1;
  }
  const scale = n > 0 ? n : 1;
  const spread = conditional(cover, spreadLose);
  const total = conditional(over, under);
  return {
    home: price(home / scale),
    draw: price(draw / scale),
    away: price(away / scale),
    spread: { line: spreadLine, home: price(spread.win), away: price(spread.lose), push: spreadPush / scale },
    total: { line: totalLine, over: price(total.win), under: price(total.lose), push: totalPush / scale },
    meanHome: meanHome / scale,
    meanAway: meanAway / scale,
    meanMargin: (meanHome - meanAway) / scale,
    meanTotal: (meanHome + meanAway) / scale,
    marginHist,
    totalHist,
  };
}

/** Nearest half-point line, so the default total and spread do not push. */
export function halfLine(mean: number) {
  return Math.round(mean - 0.5) + 0.5;
}

export function clampRate(value: number, low: number, high: number) {
  return Math.min(high, Math.max(low, value));
}

export type OutcomeRow = { probabilities: number[]; actual: number };

export function multiclassBrier(rows: OutcomeRow[]) {
  if (!rows.length) return null;
  let sum = 0;
  for (const row of rows) {
    for (let index = 0; index < row.probabilities.length; index += 1) {
      const outcome = index === row.actual ? 1 : 0;
      sum += (row.probabilities[index] - outcome) ** 2;
    }
  }
  return sum / rows.length;
}

export function multiclassLogLoss(rows: OutcomeRow[]) {
  if (!rows.length) return null;
  let sum = 0;
  for (const row of rows) {
    const probability = Math.min(1 - 1e-6, Math.max(1e-6, row.probabilities[row.actual] ?? 0));
    sum += -Math.log(probability);
  }
  return sum / rows.length;
}

export type BinaryRow = { probability: number; actual: 0 | 1 };

export function binaryBrier(rows: BinaryRow[]) {
  if (!rows.length) return null;
  let sum = 0;
  for (const row of rows) sum += (row.probability - row.actual) ** 2;
  return sum / rows.length;
}

export function binaryLogLoss(rows: BinaryRow[]) {
  if (!rows.length) return null;
  let sum = 0;
  for (const row of rows) {
    const probability = Math.min(1 - 1e-6, Math.max(1e-6, row.probability));
    sum += -(row.actual * Math.log(probability) + (1 - row.actual) * Math.log(1 - probability));
  }
  return sum / rows.length;
}

export type BetRow = { probability: number; odds: number; won: boolean };

export function settleBets(rows: BetRow[], margin = PRICE_MARGIN) {
  let bets = 0;
  let wins = 0;
  let profit = 0;
  for (const row of rows) {
    if (!(row.probability > 0) || !(row.odds > 1)) continue;
    const minimum = (1 / row.probability) * margin;
    if (row.odds + 1e-9 < minimum) continue;
    bets += 1;
    if (row.won) {
      wins += 1;
      profit += row.odds - 1;
    } else {
      profit -= 1;
    }
  }
  return {
    bets,
    wins,
    staked: bets,
    profit,
    roi: bets > 0 ? profit / bets : null,
  };
}

export function beatsMarket(modelBrier: number | null, marketBrier: number | null, modelLog: number | null, marketLog: number | null) {
  return (
    modelBrier != null &&
    marketBrier != null &&
    modelLog != null &&
    marketLog != null &&
    modelBrier < marketBrier &&
    modelLog < marketLog
  );
}

export function marketStatement(label: string, games: number, modelBrier: number | null, marketBrier: number | null, modelLog: number | null, marketLog: number | null, roi: number | null, bets: number) {
  if (!games || modelBrier == null || marketBrier == null || modelLog == null || marketLog == null) {
    return `${label}: no closing prices to score.`;
  }
  const verb = beatsMarket(modelBrier, marketBrier, modelLog, marketLog) ? "beats" : "trails";
  const roiText = roi == null ? "no bets" : `${roi >= 0 ? "+" : ""}${(roi * 100).toFixed(1)}%`;
  return `${label} ${verb} the closing line. Brier ${modelBrier.toFixed(4)} versus ${marketBrier.toFixed(4)}. Log loss ${modelLog.toFixed(4)} versus ${marketLog.toFixed(4)}. The 5% rule returned ${roiText} on ${bets} bets across ${games.toLocaleString("en-GB")} games.`;
}
