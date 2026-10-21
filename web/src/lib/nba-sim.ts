/**
 * Team-level NBA Monte Carlo game simulator.
 *
 * Each possession is one draw from a distribution built from pace, eFG%,
 * TOV%, OREB%, and free-throw rate, plus a home-court eFG shift. The same
 * seed and inputs always return the same result. N is 5,000.
 */

export const SIMS = 5000;
export const PRICE_MARGIN = 1.05;
export const PRIOR_GAMES = 16;
export const ML_GAP_AFTER = "2026-02-12";

export const NBA_NAMES: Record<string, string> = {
  atl: "Atlanta Hawks",
  bkn: "Brooklyn Nets",
  bos: "Boston Celtics",
  cha: "Charlotte Hornets",
  chi: "Chicago Bulls",
  cle: "Cleveland Cavaliers",
  dal: "Dallas Mavericks",
  den: "Denver Nuggets",
  det: "Detroit Pistons",
  gs: "Golden State Warriors",
  hou: "Houston Rockets",
  ind: "Indiana Pacers",
  lac: "LA Clippers",
  lal: "Los Angeles Lakers",
  mem: "Memphis Grizzlies",
  mia: "Miami Heat",
  mil: "Milwaukee Bucks",
  min: "Minnesota Timberwolves",
  no: "New Orleans Pelicans",
  ny: "New York Knicks",
  okc: "Oklahoma City Thunder",
  orl: "Orlando Magic",
  phi: "Philadelphia 76ers",
  phx: "Phoenix Suns",
  por: "Portland Trail Blazers",
  sa: "San Antonio Spurs",
  sac: "Sacramento Kings",
  tor: "Toronto Raptors",
  utah: "Utah Jazz",
  wsh: "Washington Wizards",
};

export type BoxCounts = {
  fgm: number;
  fga: number;
  fg3m: number;
  fg3a: number;
  ftm: number;
  fta: number;
  oreb: number;
  dreb: number;
  tov: number;
};

export type FourFactors = {
  efg: number;
  tov: number;
  oreb: number;
  ftr: number;
  ftPct: number;
  threeRate: number;
  fg2: number;
  fg3: number;
};

export type TeamProfile = {
  games: number;
  priorGames: number;
  pace: number;
  off: FourFactors;
  def: FourFactors;
};

export type DistSummary = {
  mean: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
};

export type HistBin = { label: string; count: number; pct: number };

export type SimResult = {
  n: number;
  seed: number;
  homeWinPct: number;
  awayWinPct: number;
  tiePct: number;
  homeEfgBump: number;
  expectedPossessions: number;
  margin: DistSummary;
  total: DistSummary;
  homePoints: DistSummary;
  awayPoints: DistSummary;
  marginHist: HistBin[];
  totalHist: HistBin[];
};

export type ScoreRow = { p: number; y: 0 | 1 };

export type BetSummary = {
  bets: number;
  wins: number;
  staked: number;
  profit: number;
  roi: number | null;
};

const MARGIN_LABELS = [
  "≤ -21",
  "-20 to -16",
  "-15 to -11",
  "-10 to -6",
  "-5 to -1",
  "0 to 4",
  "5 to 9",
  "10 to 14",
  "15 to 19",
  "20 to 24",
  "≥ 25",
];

const TOTAL_LABELS = [
  "≤ 199",
  "200–209",
  "210–219",
  "220–229",
  "230–239",
  "240–249",
  "250–259",
  "≥ 260",
];

export function emptyBox(): BoxCounts {
  return { fgm: 0, fga: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0, tov: 0 };
}

export function addBox(left: BoxCounts, right: BoxCounts): BoxCounts {
  return {
    fgm: left.fgm + right.fgm,
    fga: left.fga + right.fga,
    fg3m: left.fg3m + right.fg3m,
    fg3a: left.fg3a + right.fg3a,
    ftm: left.ftm + right.ftm,
    fta: left.fta + right.fta,
    oreb: left.oreb + right.oreb,
    dreb: left.dreb + right.dreb,
    tov: left.tov + right.tov,
  };
}

export function scaleBox(box: BoxCounts, weight: number): BoxCounts {
  return {
    fgm: box.fgm * weight,
    fga: box.fga * weight,
    fg3m: box.fg3m * weight,
    fg3a: box.fg3a * weight,
    ftm: box.ftm * weight,
    fta: box.fta * weight,
    oreb: box.oreb * weight,
    dreb: box.dreb * weight,
    tov: box.tov * weight,
  };
}

function clamp(value: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, value));
}

function safeDiv(num: number, den: number, fallback: number) {
  return den > 0 ? num / den : fallback;
}

/** Dean Oliver rates from one side's box and the opponent's defensive rebounds. */
export function fourFactors(side: BoxCounts, oppDreb: number): FourFactors {
  const fg2a = side.fga - side.fg3a;
  const fg2m = side.fgm - side.fg3m;
  return {
    efg: safeDiv(side.fgm + 0.5 * side.fg3m, side.fga, 0.54),
    tov: safeDiv(side.tov, side.fga + 0.44 * side.fta + side.tov, 0.12),
    oreb: safeDiv(side.oreb, side.oreb + oppDreb, 0.25),
    ftr: safeDiv(side.fta, side.fga, 0.25),
    ftPct: safeDiv(side.ftm, side.fta, 0.78),
    threeRate: safeDiv(side.fg3a, side.fga, 0.4),
    fg2: safeDiv(fg2m, fg2a, 0.54),
    fg3: safeDiv(side.fg3m, side.fg3a, 0.36),
  };
}

export function possessions(side: BoxCounts) {
  return side.fga + 0.44 * side.fta - side.oreb + side.tov;
}

export function profileFromBoxes(team: BoxCounts, opp: BoxCounts, games: number, priorGames = 0): TeamProfile {
  const pace = games > 0 ? (possessions(team) + possessions(opp)) / (2 * games) : 100;
  return {
    games,
    priorGames,
    pace,
    off: fourFactors(team, opp.dreb),
    def: fourFactors(opp, team.dreb),
  };
}

/** priorWeight games of `prior`, then the current sample added on top. */
export function blendBoxes(prior: BoxCounts, priorGamesPlayed: number, priorWeight: number, current: BoxCounts): BoxCounts {
  if (priorGamesPlayed <= 0 || priorWeight <= 0) return current;
  return addBox(scaleBox(prior, priorWeight / priorGamesPlayed), current);
}

export function hashSeed(text: string) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** mulberry32. Same seed, same stream, in any engine that does uint32 multiply the same way. */
export function mulberry32(seed: number) {
  let state = seed >>> 0;
  return function rand() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function minimumDecimal(probability: number): number | null {
  if (!(probability > 0) || probability > 1 || !Number.isFinite(probability)) return null;
  return (1 / probability) * PRICE_MARGIN;
}

export function devigHome(homeDecimal: number, awayDecimal: number) {
  const home = 1 / homeDecimal;
  const away = 1 / awayDecimal;
  return home / (home + away);
}

export function brierScore(rows: ScoreRow[]) {
  if (!rows.length) return null;
  let sum = 0;
  for (const row of rows) sum += (row.p - row.y) ** 2;
  return sum / rows.length;
}

export function logLoss(rows: ScoreRow[]) {
  if (!rows.length) return null;
  let sum = 0;
  for (const row of rows) {
    const p = clamp(row.p, 1e-6, 1 - 1e-6);
    sum += -(row.y * Math.log(p) + (1 - row.y) * Math.log(1 - p));
  }
  return sum / rows.length;
}

export type CloseRow = {
  pHome: number;
  homeMl: number;
  awayMl: number;
  homeWon: boolean;
};

/** Flat 1.00 unit when the close is at least fair price times `margin` (default 1.05). */
export function settleCloses(rows: CloseRow[], margin = PRICE_MARGIN): BetSummary {
  let bets = 0;
  let wins = 0;
  let profit = 0;
  for (const row of rows) {
    const homeMin = row.pHome > 0 ? (1 / row.pHome) * margin : Infinity;
    const awayP = 1 - row.pHome;
    const awayMin = awayP > 0 ? (1 / awayP) * margin : Infinity;
    if (row.homeMl >= homeMin) {
      bets += 1;
      if (row.homeWon) {
        wins += 1;
        profit += row.homeMl - 1;
      } else {
        profit -= 1;
      }
    }
    if (row.awayMl >= awayMin) {
      bets += 1;
      if (!row.homeWon) {
        wins += 1;
        profit += row.awayMl - 1;
      } else {
        profit -= 1;
      }
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

type ShotParams = {
  qTov: number;
  threeRate: number;
  fg2: number;
  fg3: number;
  ftPct: number;
  and1: number;
  pFoul: number;
  oreb: number;
};

function binomPmf(n: number, k: number, p: number) {
  let coeff = 1;
  for (let i = 0; i < k; i += 1) coeff *= (n - i) / (i + 1);
  return coeff * p ** k * (1 - p) ** (n - k);
}

export function shotSplit(efg: number, threeRate: number, fg2Base: number, fg3Base: number) {
  const ratio = fg3Base / Math.max(fg2Base, 0.05);
  const denom = 1 - threeRate + 1.5 * threeRate * ratio;
  let fg2 = denom > 0 ? efg / denom : fg2Base;
  let fg3 = fg2 * ratio;
  fg2 = clamp(fg2, 0.35, 0.75);
  fg3 = clamp(fg3, 0.22, 0.5);
  const achieved = (1 - threeRate) * fg2 + 1.5 * threeRate * fg3;
  return { fg2, fg3, efg: achieved };
}

export function possessionParams(
  off: FourFactors,
  def: FourFactors,
  league: FourFactors,
  efgBump: number,
): ShotParams {
  const efg = clamp(off.efg + def.efg - league.efg + efgBump, 0.4, 0.7);
  const tov = clamp(off.tov + def.tov - league.tov, 0.06, 0.22);
  const oreb = clamp(off.oreb + def.oreb - league.oreb, 0.12, 0.42);
  const ftr = clamp(off.ftr + def.ftr - league.ftr, 0.12, 0.48);
  const threeRate = clamp(off.threeRate + def.threeRate - league.threeRate, 0.18, 0.62);
  const ftPct = clamp(off.ftPct, 0.6, 0.95);
  const split = shotSplit(efg, threeRate, off.fg2, off.fg3);
  const fgPct = (1 - threeRate) * split.fg2 + threeRate * split.fg3;
  const fts = 2 + threeRate;
  let and1 = Math.min(0.12, (ftr * 0.35) / Math.max(fgPct, 0.2));
  if (and1 * fgPct > ftr) and1 = ftr / Math.max(fgPct, 0.2);
  const remain = Math.max(0, ftr - and1 * fgPct);
  const pFoul = clamp(remain / Math.max((1 - fgPct) * fts, 1e-6), 0, 0.85);
  const tovPerFga = (tov * (1 + 0.44 * ftr)) / Math.max(1 - tov, 1e-6);
  const qTov = clamp(tovPerFga / (1 + tovPerFga), 0.02, 0.35);
  return { qTov, threeRate, fg2: split.fg2, fg3: split.fg3, ftPct, and1, pFoul, oreb };
}

/** Probability of 0..17 points on one possession, matching `samplePossession`. */
export function possessionDistribution(params: ShotParams) {
  const dist = new Array<number>(18).fill(0);
  const add = (points: number, prob: number) => {
    if (prob <= 0) return;
    const index = Math.min(17, Math.max(0, points));
    dist[index] += prob;
  };
  const walk = (depth: number, points: number, prob: number) => {
    if (prob < 1e-14) return;
    if (depth >= 5) {
      add(points, prob);
      return;
    }
    add(points, prob * params.qTov);
    const live = prob * (1 - params.qTov);
    const sides = [
      { rate: 1 - params.threeRate, make: params.fg2, value: 2, fts: 2 },
      { rate: params.threeRate, make: params.fg3, value: 3, fts: 3 },
    ];
    for (const side of sides) {
      const branch = live * side.rate;
      add(points + side.value, branch * side.make * (1 - params.and1));
      add(points + side.value, branch * side.make * params.and1 * (1 - params.ftPct));
      add(points + side.value + 1, branch * side.make * params.and1 * params.ftPct);
      const foul = branch * (1 - side.make) * params.pFoul;
      for (let made = 0; made <= side.fts; made += 1) {
        add(points + made, foul * binomPmf(side.fts, made, params.ftPct));
      }
      const missLive = branch * (1 - side.make) * (1 - params.pFoul);
      add(points, missLive * (1 - params.oreb));
      walk(depth + 1, points, missLive * params.oreb);
    }
  };
  walk(0, 0, 1);
  const sum = dist.reduce((total, value) => total + value, 0);
  if (sum > 0 && Math.abs(sum - 1) > 1e-6) {
    for (let i = 0; i < dist.length; i += 1) dist[i] /= sum;
  }
  return dist;
}

export function distMean(dist: number[]) {
  let mean = 0;
  for (let i = 0; i < dist.length; i += 1) mean += i * dist[i];
  return mean;
}

function buildCdf(dist: number[]) {
  const cdf = new Float64Array(dist.length);
  let sum = 0;
  for (let i = 0; i < dist.length; i += 1) {
    sum += dist[i];
    cdf[i] = sum;
  }
  if (sum <= 0) throw new Error("empty possession distribution");
  for (let i = 0; i < cdf.length; i += 1) cdf[i] /= sum;
  cdf[cdf.length - 1] = 1;
  return cdf;
}

function draw(rng: () => number, cdf: Float64Array) {
  const u = rng();
  for (let i = 0; i < cdf.length; i += 1) {
    if (u <= cdf[i]) return i;
  }
  return cdf.length - 1;
}

function sampleNormal(rng: () => number) {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function expectedMargin(league: FourFactors, pace: number, efgBump: number) {
  const home = distMean(possessionDistribution(possessionParams(league, league, league, efgBump)));
  const away = distMean(possessionDistribution(possessionParams(league, league, league, -efgBump)));
  return (home - away) * pace;
}

export function solveHomeEfgBump(league: FourFactors, pace: number, targetMargin: number) {
  if (!(targetMargin > 0)) return 0;
  let lo = 0;
  let hi = 0.04;
  for (let i = 0; i < 28; i += 1) {
    const mid = (lo + hi) / 2;
    if (expectedMargin(league, pace, mid) < targetMargin) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - rank) + sorted[hi] * (rank - lo);
}

function summarize(values: Float64Array): DistSummary {
  const sorted = Array.from(values).sort((a, b) => a - b);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) sum += values[i];
  return {
    mean: sum / values.length,
    p10: percentile(sorted, 10),
    p25: percentile(sorted, 25),
    p50: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    p90: percentile(sorted, 90),
  };
}

function marginBin(margin: number) {
  if (margin <= -21) return 0;
  if (margin >= 25) return 10;
  return Math.floor((margin + 20) / 5) + 1;
}

function totalBin(total: number) {
  if (total <= 199) return 0;
  if (total >= 260) return 7;
  return 1 + Math.floor((total - 200) / 10);
}

function asHist(labels: string[], counts: number[], n: number): HistBin[] {
  return labels.map((label, index) => ({
    label,
    count: counts[index] ?? 0,
    pct: n > 0 ? (counts[index] ?? 0) / n : 0,
  }));
}

function playPeriod(
  rng: () => number,
  nPoss: number,
  homeStarts: boolean,
  homeCdf: Float64Array,
  awayCdf: Float64Array,
) {
  let home = 0;
  let away = 0;
  let homeBall = homeStarts;
  for (let i = 0; i < nPoss; i += 1) {
    const points = draw(rng, homeBall ? homeCdf : awayCdf);
    if (homeBall) home += points;
    else away += points;
    homeBall = !homeBall;
  }
  return { home, away, homeBall };
}

export function simulateGame(input: {
  home: TeamProfile;
  away: TeamProfile;
  league: FourFactors;
  homeAdvantagePoints: number;
  paceSd: number;
  leaguePace: number;
  n?: number;
  seed: number;
  homeEfgBump?: number;
  overtime?: boolean;
}): SimResult {
  const n = input.n ?? SIMS;
  if (n < 1) throw new Error("n must be at least 1");
  const bump =
    input.homeEfgBump ??
    solveHomeEfgBump(input.league, input.leaguePace, input.homeAdvantagePoints);
  const homeParams = possessionParams(input.home.off, input.away.def, input.league, bump);
  const awayParams = possessionParams(input.away.off, input.home.def, input.league, -bump);
  const homeCdf = buildCdf(possessionDistribution(homeParams));
  const awayCdf = buildCdf(possessionDistribution(awayParams));
  const rng = mulberry32(input.seed);
  // Pace is possessions per team. Alternating trips so each side gets about that many.
  const meanPoss = (input.home.pace + input.away.pace) / 2;
  const margins = new Float64Array(n);
  const totals = new Float64Array(n);
  const homePoints = new Float64Array(n);
  const awayPoints = new Float64Array(n);
  const marginCounts = new Array<number>(MARGIN_LABELS.length).fill(0);
  const totalCounts = new Array<number>(TOTAL_LABELS.length).fill(0);
  let homeWins = 0;
  let awayWins = 0;
  let ties = 0;
  for (let sim = 0; sim < n; sim += 1) {
    const gamePace = clamp(Math.round(meanPoss + sampleNormal(rng) * input.paceSd), 80, 130);
    let homeBall = rng() < 0.5;
    let score = playPeriod(rng, gamePace * 2, homeBall, homeCdf, awayCdf);
    let extra = 0;
    const playOt = input.overtime !== false;
    while (playOt && score.home === score.away && extra < 4) {
      homeBall = rng() < 0.5;
      const ot = Math.max(16, Math.round(meanPoss / 2));
      const period = playPeriod(rng, ot, homeBall, homeCdf, awayCdf);
      score = {
        home: score.home + period.home,
        away: score.away + period.away,
        homeBall: period.homeBall,
      };
      homeBall = score.homeBall;
      extra += 1;
    }
    const margin = score.home - score.away;
    const total = score.home + score.away;
    margins[sim] = margin;
    totals[sim] = total;
    homePoints[sim] = score.home;
    awayPoints[sim] = score.away;
    marginCounts[marginBin(margin)] += 1;
    totalCounts[totalBin(total)] += 1;
    if (margin > 0) homeWins += 1;
    else if (margin < 0) awayWins += 1;
    else ties += 1;
  }
  return {
    n,
    seed: input.seed >>> 0,
    homeWinPct: homeWins / n,
    awayWinPct: awayWins / n,
    tiePct: ties / n,
    homeEfgBump: bump,
    expectedPossessions: meanPoss,
    margin: summarize(margins),
    total: summarize(totals),
    homePoints: summarize(homePoints),
    awayPoints: summarize(awayPoints),
    marginHist: asHist(MARGIN_LABELS, marginCounts, n),
    totalHist: asHist(TOTAL_LABELS, totalCounts, n),
  };
}

export function round4(value: number) {
  return Math.round(value * 10000) / 10000;
}

export function roundTo(value: number, places: number) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
