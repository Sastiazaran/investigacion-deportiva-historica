/**
 * Walk-forward fit for football, NFL, and MLB.
 *
 * Every prediction uses only games already played. Rho, home advantage,
 * and the variance terms are refreshed from that past. The script writes
 * the ratings the site simulates with, and the backtest against the close.
 *
 * NBA stays on the possession simulator in nba-backtest.ts.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  beatsMarket,
  binaryBrier,
  binaryLogLoss,
  breakTies,
  clampRate,
  devigThree,
  devigTwo,
  halfLine,
  marketStatement,
  marketsFromMatrix,
  marketsFromNormal,
  multiclassBrier,
  multiclassLogLoss,
  scoreMatrix,
  settleBets,
  type BetRow,
  type BinaryRow,
  type OutcomeRow,
} from "../src/lib/sim-markets.ts";
import { NFL_PRIOR_GAMES, seasonRate, type Count } from "../src/lib/nfl-rating.ts";
import type { PointsFactors } from "../src/lib/predict.ts";

const ROOT = path.join(process.cwd(), "..");
const PUBLIC = path.join(process.cwd(), "public", "data");
const PRIOR_FOOTBALL = 8;
const PRIOR_POINTS = NFL_PRIOR_GAMES;
const PRIOR_RUNS = 10;
const RHO_GRID = [-0.2, -0.15, -0.1, -0.05, 0, 0.02];

type Side = { gf: number; ga: number; gp: number };

type FootballMatch = {
  date: string;
  season: number;
  league: string;
  home: string;
  away: string;
  homeGoals: number;
  awayGoals: number;
  result: "H" | "D" | "A";
  closing?: { home: number; draw: number; away: number } | null;
};

type LineGame = {
  date: string;
  season: number;
  phase: string;
  away: string;
  home: string;
  away_score: number;
  home_score: number;
  away_ml: number | null;
  home_ml: number | null;
  home_spread: number | null;
  away_spread_odds: number | null;
  home_spread_odds: number | null;
  total_line: number | null;
  over_odds: number | null;
  under_odds: number | null;
};

type MarketBlock = {
  games: number;
  model: { brier: number | null; logLoss: number | null };
  market: { brier: number | null; logLoss: number | null };
  roiEdge5: { bets: number; wins: number; staked: number; profit: number; roi: number | null };
  beatsMarket: boolean;
};

function round4(value: number | null) {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 10000) / 10000;
}

function roundBlock(bets: ReturnType<typeof settleBets>) {
  return {
    bets: bets.bets,
    wins: bets.wins,
    staked: bets.staked,
    profit: Math.round(bets.profit * 1000) / 1000,
    roi: round4(bets.roi),
  };
}

function emptySide(): Side {
  return { gf: 0, ga: 0, gp: 0 };
}

function shrunk(sum: number, games: number, prior: number, league: number) {
  return (sum + prior * league) / (games + prior);
}

function bestRho(history: { homeRate: number; awayRate: number; homeGoals: number; awayGoals: number }[]) {
  if (history.length < 40) return -0.05;
  const sample = history.slice(-800);
  let best = -0.05;
  let bestScore = -Infinity;
  for (const rho of RHO_GRID) {
    let score = 0;
    for (const row of sample) {
      const grid = scoreMatrix(row.homeRate, row.awayRate, rho, 8);
      const probability = grid[Math.min(8, row.homeGoals)]?.[Math.min(8, row.awayGoals)] ?? 1e-8;
      score += Math.log(Math.max(probability, 1e-8));
    }
    if (score > bestScore) {
      bestScore = score;
      best = rho;
    }
  }
  return best;
}

function blockFromClasses(modelRows: OutcomeRow[], marketRows: OutcomeRow[], bets: BetRow[]): MarketBlock {
  const modelBrier = multiclassBrier(modelRows);
  const marketBrier = multiclassBrier(marketRows);
  const modelLog = multiclassLogLoss(modelRows);
  const marketLog = multiclassLogLoss(marketRows);
  return {
    games: modelRows.length,
    model: { brier: round4(modelBrier), logLoss: round4(modelLog) },
    market: { brier: round4(marketBrier), logLoss: round4(marketLog) },
    roiEdge5: roundBlock(settleBets(bets)),
    beatsMarket: beatsMarket(modelBrier, marketBrier, modelLog, marketLog),
  };
}

function blockFromBinary(modelRows: BinaryRow[], marketRows: BinaryRow[], bets: BetRow[]): MarketBlock {
  const modelBrier = binaryBrier(modelRows);
  const marketBrier = binaryBrier(marketRows);
  const modelLog = binaryLogLoss(modelRows);
  const marketLog = binaryLogLoss(marketRows);
  return {
    games: modelRows.length,
    model: { brier: round4(modelBrier), logLoss: round4(modelLog) },
    market: { brier: round4(marketBrier), logLoss: round4(marketLog) },
    roiEdge5: roundBlock(settleBets(bets)),
    beatsMarket: beatsMarket(modelBrier, marketBrier, modelLog, marketLog),
  };
}

function report(sport: string, model: string, markets: Record<string, MarketBlock>, notes: string[]) {
  const scored = Object.entries(markets).filter(([, row]) => row.games > 0);
  const parts = scored.map(([name, row]) =>
    marketStatement(
      `${sport} ${name}`,
      row.games,
      row.model.brier,
      row.market.brier,
      row.model.logLoss,
      row.market.logLoss,
      row.roiEdge5.roi,
      row.roiEdge5.bets,
    ),
  );
  const beats = scored.length > 0 && scored.every(([, row]) => row.beatsMarket);
  const text = `${beats ? "Beats the closing line on every scored market." : "Does not beat the closing line on every scored market."} ${parts.join(" ")}`;
  return {
    schemaVersion: 1,
    sport,
    model,
    generatedAt: new Date().toISOString(),
    beatsMarket: beats,
    statement: text,
    markets,
    notes,
  };
}

function calibrateFootball() {
  const file = JSON.parse(readFileSync(path.join(PUBLIC, "matches.json"), "utf8")) as {
    leagueNames: Record<string, string>;
    matches: FootballMatch[];
  };
  const byLeague = new Map<string, FootballMatch[]>();
  for (const match of file.matches) {
    const list = byLeague.get(match.league) ?? [];
    list.push(match);
    byLeague.set(match.league, list);
  }
  const leagues: Record<string, unknown> = {};
  const modelRows: OutcomeRow[] = [];
  const marketRows: OutcomeRow[] = [];
  const bets: BetRow[] = [];
  for (const [code, matches] of byLeague) {
    matches.sort((a, b) => a.date.localeCompare(b.date) || a.home.localeCompare(b.home));
    const teams = new Map<string, Side>();
    let homeGoals = 0;
    let awayGoals = 0;
    let played = 0;
    let rho = -0.05;
    const history: { homeRate: number; awayRate: number; homeGoals: number; awayGoals: number }[] = [];
    const ensure = (name: string) => {
      let side = teams.get(name);
      if (!side) {
        side = emptySide();
        teams.set(name, side);
      }
      return side;
    };
    for (const match of matches) {
      const leagueGpg = played >= 20 ? (homeGoals + awayGoals) / (2 * played) : 1.35;
      const homeAvg = played >= 20 ? homeGoals / played : 1.45;
      const awayAvg = played >= 20 ? awayGoals / played : 1.15;
      const home = ensure(match.home);
      const away = ensure(match.away);
      const homeRate = clampRate(
        homeAvg * (shrunk(home.gf, home.gp, PRIOR_FOOTBALL, leagueGpg) / leagueGpg) * (shrunk(away.ga, away.gp, PRIOR_FOOTBALL, leagueGpg) / leagueGpg),
        0.15,
        4.5,
      );
      const awayRate = clampRate(
        awayAvg * (shrunk(away.gf, away.gp, PRIOR_FOOTBALL, leagueGpg) / leagueGpg) * (shrunk(home.ga, home.gp, PRIOR_FOOTBALL, leagueGpg) / leagueGpg),
        0.1,
        4,
      );
      if (played >= 30 && match.closing && match.closing.home > 1 && match.closing.draw > 1 && match.closing.away > 1) {
        const output = marketsFromMatrix(scoreMatrix(homeRate, awayRate, rho, 8), halfLine(homeRate - awayRate), 2.5, "goals");
        const actual = match.result === "H" ? 0 : match.result === "D" ? 1 : 2;
        const market = devigThree(match.closing.home, match.closing.draw, match.closing.away);
        modelRows.push({ probabilities: [output.home.probability, output.draw.probability, output.away.probability], actual });
        marketRows.push({ probabilities: [market.home, market.draw, market.away], actual });
        const sides = [
          { probability: output.home.probability, odds: match.closing.home, won: actual === 0 },
          { probability: output.draw.probability, odds: match.closing.draw, won: actual === 1 },
          { probability: output.away.probability, odds: match.closing.away, won: actual === 2 },
        ];
        bets.push(...sides);
      }
      history.push({ homeRate, awayRate, homeGoals: match.homeGoals, awayGoals: match.awayGoals });
      if (history.length % 80 === 0) rho = bestRho(history);
      home.gf += match.homeGoals;
      home.ga += match.awayGoals;
      home.gp += 1;
      away.gf += match.awayGoals;
      away.ga += match.homeGoals;
      away.gp += 1;
      homeGoals += match.homeGoals;
      awayGoals += match.awayGoals;
      played += 1;
    }
    const leagueGpg = played > 0 ? (homeGoals + awayGoals) / (2 * played) : 1.35;
    const lastSeason = matches.length ? matches[matches.length - 1].season : 0;
    const active = new Set<string>();
    for (const match of matches) {
      if (match.season !== lastSeason) continue;
      active.add(match.home);
      active.add(match.away);
    }
    const published: Record<string, unknown> = {};
    for (const [name, side] of teams) {
      if (side.gp <= 0) continue;
      published[name] = {
        attack: round4(shrunk(side.gf, side.gp, PRIOR_FOOTBALL, leagueGpg) / leagueGpg),
        defense: round4(shrunk(side.ga, side.gp, PRIOR_FOOTBALL, leagueGpg) / leagueGpg),
        games: side.gp,
        active: active.has(name),
      };
    }
    leagues[code] = {
      name: file.leagueNames[code] ?? code,
      homeAvg: round4(played > 0 ? homeGoals / played : 1.45),
      awayAvg: round4(played > 0 ? awayGoals / played : 1.15),
      leagueGpg: round4(leagueGpg),
      rho: round4(rho),
      priorGames: PRIOR_FOOTBALL,
      teams: published,
    };
    console.log(`football ${code} matches ${played} rho ${rho}`);
  }
  const factors = {
    schemaVersion: 1,
    model: "dixon-coles",
    generatedAt: new Date().toISOString(),
    priceMargin: 1.05,
    notes: [
      "Attack and defense are goals per game shrunk toward the league with an 8-game prior, divided by the league average.",
      "Expected home goals are the league home average times the home attack times the away defense. Away goals use the away average.",
      "Rho is the Dixon-Coles low-score correction, re-fit every 80 matches on the previous matches only.",
      "Ratings include every completed match. A fixture is not in its own rating.",
    ],
    leagues,
  };
  const backtest = report("football", "Dixon-Coles", { result: blockFromClasses(modelRows, marketRows, bets) }, [
    "Walk-forward 1X2 against the closing price in matches.json (Pinnacle close when it exists, else Pinnacle, else Bet365).",
    "The first 30 matches of each league are used to start the averages and are not scored.",
    "The file has no closing totals or handicaps, so over/under and the goal line are model outputs without a closing-line score.",
    "A lower Brier score and a lower log loss are better. The model beats the close only when both are better.",
  ]);
  const footballDir = path.join(PUBLIC, "football");
  mkdirSync(footballDir, { recursive: true });
  writeFileSync(path.join(footballDir, "sim-factors.json"), JSON.stringify(factors));
  writeFileSync(path.join(footballDir, "sim-backtest.json"), JSON.stringify(backtest, null, 2) + "\n");
  console.log(backtest.statement);
}

type Running = { variance: number; count: number; mean: number };

function pushResidual(state: Running, residual: number) {
  state.count += 1;
  const delta = residual - state.mean;
  state.mean += delta / state.count;
  state.variance += delta * (residual - state.mean);
}

function deviation(state: Running, fallback: number, floor: number) {
  if (state.count < 30) return fallback;
  return Math.max(floor, Math.sqrt(state.variance / (state.count - 1)));
}

type SeasonEnv = { points: number; games: number; margin: number };

function emptyCount(): Count {
  return { gf: 0, ga: 0, gp: 0 };
}

function environment(envs: Map<number, SeasonEnv>, season: number) {
  const current = envs.get(season);
  if (current && current.games >= 16) {
    return { league: current.points / (2 * current.games), hfa: current.margin / current.games };
  }
  const previous = envs.get(season - 1);
  if (previous && previous.games >= 16) {
    return { league: previous.points / (2 * previous.games), hfa: previous.margin / previous.games };
  }
  return { league: 22, hfa: 1.5 };
}

function calibratePoints(sport: "nfl" | "nba", fallbackMargin: number, fallbackTotal: number, startHfa: number) {
  const cache = process.env[`${sport.toUpperCase()}_SIM_GAMES`] ?? path.join(ROOT, ".cache", "us-sports", `${sport}-sim-games.json`);
  const games = (JSON.parse(readFileSync(cache, "utf8")) as { games: LineGame[] }).games
    .filter((game) => game.phase === "regular")
    .sort((a, b) => a.date.localeCompare(b.date) || a.home.localeCompare(b.home));
  const byTeam = new Map<string, Map<number, Count>>();
  const seasonEnv = new Map<number, SeasonEnv>();
  const teamSeason = (code: string, season: number) => {
    let seasons = byTeam.get(code);
    if (!seasons) {
      seasons = new Map();
      byTeam.set(code, seasons);
    }
    let row = seasons.get(season);
    if (!row) {
      row = emptyCount();
      seasons.set(season, row);
    }
    return row;
  };
  const marginResiduals: Running = { variance: 0, count: 0, mean: 0 };
  const totalResiduals: Running = { variance: 0, count: 0, mean: 0 };
  let played = 0;
  const mlModel: BinaryRow[] = [];
  const mlMarket: BinaryRow[] = [];
  const mlBets: BetRow[] = [];
  const spreadModel: BinaryRow[] = [];
  const spreadMarket: BinaryRow[] = [];
  const spreadBets: BetRow[] = [];
  const totalModel: BinaryRow[] = [];
  const totalMarket: BinaryRow[] = [];
  const totalBets: BetRow[] = [];
  for (const game of games) {
    const setting = environment(seasonEnv, game.season);
    const league = setting.league;
    const hfa = played >= 40 ? setting.hfa : startHfa;
    const homeRate = seasonRate({
      current: teamSeason(game.home, game.season),
      previous: byTeam.get(game.home)?.get(game.season - 1),
      league,
    });
    const awayRate = seasonRate({
      current: teamSeason(game.away, game.season),
      previous: byTeam.get(game.away)?.get(game.season - 1),
      league,
    });
    const meanHome = homeRate.off + awayRate.def - league + hfa;
    const meanAway = awayRate.off + homeRate.def - league;
    const marginSd = deviation(marginResiduals, fallbackMargin, sport === "nba" ? 8 : 7);
    const totalSd = deviation(totalResiduals, fallbackTotal, sport === "nba" ? 8 : 7);
    if (played >= 40) {
      const spreadLine = game.home_spread ?? halfLine(meanHome - meanAway);
      const totalLine = game.total_line ?? halfLine(meanHome + meanAway);
      const output = marketsFromNormal(meanHome, meanAway, marginSd, totalSd, spreadLine, totalLine);
      if (game.home_score !== game.away_score && game.home_ml && game.away_ml && game.home_ml > 1 && game.away_ml > 1) {
        const decided = output.home.probability + output.away.probability;
        const modelHome = decided > 0 ? output.home.probability / decided : 0.5;
        const market = devigTwo(game.home_ml, game.away_ml);
        const homeWon = game.home_score > game.away_score ? 1 : 0;
        mlModel.push({ probability: modelHome, actual: homeWon });
        mlMarket.push({ probability: market.home, actual: homeWon });
        mlBets.push(
          { probability: modelHome, odds: game.home_ml, won: homeWon === 1 },
          { probability: 1 - modelHome, odds: game.away_ml, won: homeWon === 0 },
        );
      }
      if (
        game.home_spread != null &&
        game.home_spread_odds &&
        game.away_spread_odds &&
        game.home_spread_odds > 1 &&
        game.away_spread_odds > 1
      ) {
        const margin = game.home_score - game.away_score;
        if (margin !== game.home_spread) {
          const homeCovered = margin > game.home_spread ? 1 : 0;
          const market = devigTwo(game.home_spread_odds, game.away_spread_odds);
          spreadModel.push({ probability: output.spread.home.probability, actual: homeCovered });
          spreadMarket.push({ probability: market.home, actual: homeCovered });
          spreadBets.push(
            { probability: output.spread.home.probability, odds: game.home_spread_odds, won: homeCovered === 1 },
            { probability: output.spread.away.probability, odds: game.away_spread_odds, won: homeCovered === 0 },
          );
        }
      }
      if (game.total_line != null && game.over_odds && game.under_odds && game.over_odds > 1 && game.under_odds > 1) {
        const total = game.home_score + game.away_score;
        if (total !== game.total_line) {
          const wentOver = total > game.total_line ? 1 : 0;
          const market = devigTwo(game.over_odds, game.under_odds);
          totalModel.push({ probability: output.total.over.probability, actual: wentOver });
          totalMarket.push({ probability: market.home, actual: wentOver });
          totalBets.push(
            { probability: output.total.over.probability, odds: game.over_odds, won: wentOver === 1 },
            { probability: output.total.under.probability, odds: game.under_odds, won: wentOver === 0 },
          );
        }
      }
    }
    const residualMargin = game.home_score - game.away_score - (meanHome - meanAway);
    const residualTotal = game.home_score + game.away_score - (meanHome + meanAway);
    pushResidual(marginResiduals, residualMargin);
    pushResidual(totalResiduals, residualTotal);
    const homeRow = teamSeason(game.home, game.season);
    homeRow.gf += game.home_score;
    homeRow.ga += game.away_score;
    homeRow.gp += 1;
    const awayRow = teamSeason(game.away, game.season);
    awayRow.gf += game.away_score;
    awayRow.ga += game.home_score;
    awayRow.gp += 1;
    const env = seasonEnv.get(game.season) ?? { points: 0, games: 0, margin: 0 };
    env.points += game.home_score + game.away_score;
    env.games += 1;
    env.margin += game.home_score - game.away_score;
    seasonEnv.set(game.season, env);
    played += 1;
  }
  const latestSeason = Math.max(...games.map((game) => game.season));
  const setting = environment(seasonEnv, latestSeason);
  const published: Record<string, unknown> = {};
  for (const [code, seasons] of byTeam) {
    const current = seasons.get(latestSeason) ?? emptyCount();
    const rate = seasonRate({
      current,
      previous: seasons.get(latestSeason - 1),
      league: setting.league,
    });
    published[code] = {
      off: round4(rate.off),
      def: round4(rate.def),
      games: current.gp,
      seasonGames: current.gp,
      priorSeason: latestSeason - 1,
    };
  }
  const factors: PointsFactors & { season: number; notes: string[] } = {
    schemaVersion: 1,
    model: "points-normal",
    sport,
    generatedAt: new Date().toISOString(),
    priceMargin: 1.05,
    leaguePpg: round4(setting.league),
    homeAdvantage: round4(setting.hfa),
    marginSd: round4(deviation(marginResiduals, fallbackMargin, 7)),
    totalSd: round4(deviation(totalResiduals, fallbackTotal, 7)),
    priorGames: PRIOR_POINTS,
    season: latestSeason,
    notes: [
      `Ratings are the ${latestSeason} season, shrunk toward ${latestSeason - 1} with ${PRIOR_POINTS} games of prior. Older seasons are not averaged in.`,
      "Home points = offense + opponent points allowed − league average + home advantage. The league average and home edge are from the current season once 16 games have been played.",
      "There is no quarterback, injury, or weather input.",
      "Margin and total are independent normals. Integer scores use a continuity correction, so a tie is possible.",
    ],
    teams: published as PointsFactors["teams"],
  };
  const backtest = report(
    sport,
    "points",
    {
      moneyline: blockFromBinary(mlModel, mlMarket, mlBets),
      spread: blockFromBinary(spreadModel, spreadMarket, spreadBets),
      total: blockFromBinary(totalModel, totalMarket, totalBets),
    },
    [
      "Regular season only. The first 40 games start the averages and are not scored.",
      "Moneyline probabilities drop the model's tie mass and are compared with the two-way de-vigged close. Tied games are left out, matching a refund.",
      "Spread and total pushes are left out. Home spread is positive when home is laying points.",
      "A market beats the model when its Brier score or its log loss is lower. Both have to be worse for the model to trail that market. The headline beats the close only when every scored market does.",
    ],
  );
  const dir = path.join(PUBLIC, sport);
  writeFileSync(path.join(dir, "sim-factors.json"), JSON.stringify(factors));
  writeFileSync(path.join(dir, "sim-backtest.json"), JSON.stringify(backtest, null, 2) + "\n");
  if (sport === "nfl") writeWeekCheck(factors);
  console.log(backtest.statement);
  for (const [name, block] of Object.entries(backtest.markets)) {
    console.log(`  ${name} games ${block.games} model ${block.model.brier}/${block.model.logLoss} market ${block.market.brier}/${block.market.logLoss}`);
  }
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function projectPoints(factors: PointsFactors, home: string, away: string, spreadLine: number, totalLine: number) {
  const homeTeam = factors.teams[home];
  const awayTeam = factors.teams[away];
  const meanHome = homeTeam.off + awayTeam.def - factors.leaguePpg + factors.homeAdvantage;
  const meanAway = awayTeam.off + homeTeam.def - factors.leaguePpg;
  return marketsFromNormal(meanHome, meanAway, factors.marginSd, factors.totalSd, spreadLine, totalLine);
}

function americanToDecimal(value: string) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return null;
  const decimal = number > 0 ? 1 + number / 100 : 1 + 100 / Math.abs(number);
  return decimal > 1 ? Math.round(decimal * 1000) / 1000 : null;
}

function writeWeekCheck(factors: PointsFactors) {
  const csvPath = path.join(ROOT, ".cache", "us-sports", "games.csv");
  const lines = readFileSync(csvPath, "utf8").split(/\r?\n/);
  const header = parseCsvLine(lines[0]);
  const index = (name: string) => header.indexOf(name);
  const rows = [];
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const cells = parseCsvLine(line);
    if (cells[index("season")] !== "2026" || cells[index("week")] !== "9" || cells[index("game_type")] !== "REG") continue;
    const home = cells[index("home_team")];
    const away = cells[index("away_team")];
    const spread = Number(cells[index("spread_line")]);
    const total = Number(cells[index("total_line")]);
    const homeMl = americanToDecimal(cells[index("home_moneyline")]);
    const awayMl = americanToDecimal(cells[index("away_moneyline")]);
    if (!factors.teams[home] || !factors.teams[away] || homeMl == null || awayMl == null) continue;
    const output = projectPoints(factors, home, away, Number.isFinite(spread) ? spread : 0, Number.isFinite(total) ? total : 45);
    const decided = output.home.probability + output.away.probability;
    const modelHome = decided > 0 ? output.home.probability / decided : 0.5;
    const market = devigTwo(homeMl, awayMl);
    const gap = Math.abs(modelHome - market.home);
    rows.push({
      date: cells[index("gameday")],
      away,
      home,
      spread: Number.isFinite(spread) ? spread : null,
      modelHome: round4(modelHome),
      marketHome: round4(market.home),
      gap: round4(gap),
      flagged: gap > 0.15,
    });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.home.localeCompare(b.home));
  const miamiHome = projectPoints(factors, "MIA", "DET", -7, 50.5);
  const detroitHome = projectPoints(factors, "DET", "MIA", 7, 50.5);
  const homeShare = (output: ReturnType<typeof projectPoints>) => {
    const decided = output.home.probability + output.away.probability;
    return decided > 0 ? output.home.probability / decided : 0.5;
  };
  const payload = {
    schemaVersion: 1,
    season: 2026,
    week: 9,
    threshold: 0.15,
    source: "nflverse games.csv moneylines. Week 9 has not been played, so these are the current lines in that file, not a settled close.",
    flagged: rows.filter((row) => row.flagged).map((row) => `${row.away} at ${row.home}`),
    games: rows,
    miaDet: {
      miamiHome: {
        home: "MIA",
        away: "DET",
        modelHome: round4(homeShare(miamiHome)),
        meanMargin: round4(miamiHome.meanMargin),
      },
      detroitHome: {
        home: "DET",
        away: "MIA",
        modelHome: round4(homeShare(detroitHome)),
        meanMargin: round4(detroitHome.meanMargin),
      },
    },
  };
  writeFileSync(path.join(PUBLIC, "nfl", "week9-check.json"), `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`week 9 flagged ${payload.flagged.length}: ${payload.flagged.join(", ") || "none"}`);
  console.log("MIA home", payload.miaDet.miamiHome, "DET home", payload.miaDet.detroitHome);
}

function calibrateRuns() {
  const cache = process.env.MLB_SIM_GAMES ?? path.join(ROOT, ".cache", "us-sports", "mlb-sim-games.json");
  const games = (JSON.parse(readFileSync(cache, "utf8")) as { games: LineGame[] }).games
    .filter((game) => game.phase === "regular" || game.phase === "playoff")
    .sort((a, b) => a.date.localeCompare(b.date) || a.home.localeCompare(b.home));
  const teams = new Map<string, Side>();
  const ensure = (code: string) => {
    let side = teams.get(code);
    if (!side) {
      side = emptySide();
      teams.set(code, side);
    }
    return side;
  };
  let homeRuns = 0;
  let awayRuns = 0;
  let played = 0;
  let tieShare = 0.53;
  let actualHome = 0;
  let regHome = 0;
  let tieMass = 0;
  const mlModel: BinaryRow[] = [];
  const mlMarket: BinaryRow[] = [];
  const mlBets: BetRow[] = [];
  const spreadModel: BinaryRow[] = [];
  const spreadMarket: BinaryRow[] = [];
  const spreadBets: BetRow[] = [];
  const totalModel: BinaryRow[] = [];
  const totalMarket: BinaryRow[] = [];
  const totalBets: BetRow[] = [];
  for (const game of games) {
    const league = played >= 60 ? (homeRuns + awayRuns) / (2 * played) : 4.4;
    const homeAvg = played >= 60 ? homeRuns / played : 4.6;
    const awayAvg = played >= 60 ? awayRuns / played : 4.2;
    const home = ensure(game.home);
    const away = ensure(game.away);
    const homeRate = clampRate(
      homeAvg * (shrunk(home.gf, home.gp, PRIOR_RUNS, league) / league) * (shrunk(away.ga, away.gp, PRIOR_RUNS, league) / league),
      1.5,
      9,
    );
    const awayRate = clampRate(
      awayAvg * (shrunk(away.gf, away.gp, PRIOR_RUNS, league) / league) * (shrunk(home.ga, home.gp, PRIOR_RUNS, league) / league),
      1.5,
      9,
    );
    if (played >= 60) {
      const grid = scoreMatrix(homeRate, awayRate, 0, 16);
      let tie = 0;
      let homeWin = 0;
      for (let score = 0; score < grid.length; score += 1) {
        for (let other = 0; other < grid[score].length; other += 1) {
          if (score > other) homeWin += grid[score][other];
          else if (score === other) tie += grid[score][other];
        }
      }
      breakTies(grid, tieShare);
      const spreadLine = game.home_spread ?? 1.5;
      const totalLine = game.total_line ?? halfLine(homeRate + awayRate);
      const output = marketsFromMatrix(grid, spreadLine, totalLine, "runs");
      if (game.home_score !== game.away_score && game.home_ml && game.away_ml && game.home_ml > 1 && game.away_ml > 1) {
        const homeWon = game.home_score > game.away_score ? 1 : 0;
        const market = devigTwo(game.home_ml, game.away_ml);
        mlModel.push({ probability: output.home.probability, actual: homeWon });
        mlMarket.push({ probability: market.home, actual: homeWon });
        mlBets.push(
          { probability: output.home.probability, odds: game.home_ml, won: homeWon === 1 },
          { probability: output.away.probability, odds: game.away_ml, won: homeWon === 0 },
        );
      }
      if (
        game.home_spread != null &&
        Math.abs(game.home_spread) <= 2.5 &&
        game.home_spread_odds &&
        game.away_spread_odds &&
        game.home_spread_odds > 1 &&
        game.away_spread_odds > 1 &&
        game.home_score - game.away_score !== game.home_spread
      ) {
        const homeCovered = game.home_score - game.away_score > game.home_spread ? 1 : 0;
        const market = devigTwo(game.home_spread_odds, game.away_spread_odds);
        spreadModel.push({ probability: output.spread.home.probability, actual: homeCovered });
        spreadMarket.push({ probability: market.home, actual: homeCovered });
        spreadBets.push(
          { probability: output.spread.home.probability, odds: game.home_spread_odds, won: homeCovered === 1 },
          { probability: output.spread.away.probability, odds: game.away_spread_odds, won: homeCovered === 0 },
        );
      }
      if (game.total_line != null && game.over_odds && game.under_odds && game.over_odds > 1 && game.under_odds > 1) {
        const total = game.home_score + game.away_score;
        if (total !== game.total_line) {
          const wentOver = total > game.total_line ? 1 : 0;
          const market = devigTwo(game.over_odds, game.under_odds);
          totalModel.push({ probability: output.total.over.probability, actual: wentOver });
          totalMarket.push({ probability: market.home, actual: wentOver });
          totalBets.push(
            { probability: output.total.over.probability, odds: game.over_odds, won: wentOver === 1 },
            { probability: output.total.under.probability, odds: game.under_odds, won: wentOver === 0 },
          );
        }
      }
      actualHome += game.home_score > game.away_score ? 1 : 0;
      regHome += homeWin;
      tieMass += tie;
      if (tieMass > 8) tieShare = Math.min(0.65, Math.max(0.4, (actualHome - regHome) / tieMass));
    }
    home.gf += game.home_score;
    home.ga += game.away_score;
    home.gp += 1;
    away.gf += game.away_score;
    away.ga += game.home_score;
    away.gp += 1;
    homeRuns += game.home_score;
    awayRuns += game.away_score;
    played += 1;
  }
  const league = played > 0 ? (homeRuns + awayRuns) / (2 * played) : 4.4;
  const published: Record<string, unknown> = {};
  for (const [code, side] of teams) {
    published[code] = {
      attack: round4(shrunk(side.gf, side.gp, PRIOR_RUNS, league) / league),
      defense: round4(shrunk(side.ga, side.gp, PRIOR_RUNS, league) / league),
      games: side.gp,
    };
  }
  const factors = {
    schemaVersion: 1,
    model: "runs-poisson",
    generatedAt: new Date().toISOString(),
    priceMargin: 1.05,
    homeAvg: round4(played > 0 ? homeRuns / played : 4.6),
    awayAvg: round4(played > 0 ? awayRuns / played : 4.2),
    leagueRpg: round4(league),
    tieShare: round4(tieShare),
    priorGames: PRIOR_RUNS,
    notes: [
      "Expected runs are the home or away league average times attack times the opponent's defense. Both are shrunk with a 10-game prior.",
      "Regulation ties are broken by one extra run. The home share of those extras is fit on past games only.",
      "Final scores already include extras, so the run rates are final-score rates.",
    ],
    teams: published,
  };
  const backtest = report(
    "mlb",
    "runs",
    {
      moneyline: blockFromBinary(mlModel, mlMarket, mlBets),
      spread: blockFromBinary(spreadModel, spreadMarket, spreadBets),
      total: blockFromBinary(totalModel, totalMarket, totalBets),
    },
    [
      "Walk-forward on final scores. The first 60 games start the averages and are not scored.",
      "2010-2020 playoff games are inside the regular-season file and are included. From 2021, postseason games are included too.",
      "The run line uses the same home-spread sign as the NFL: positive means the home team lays runs.",
      "Archive rows whose spread is outside -2.5 to 2.5 are not scored. Those numbers are not run lines.",
      "Totals are scored only when the source has a total and a price. The frozen archives often have a run line and no total.",
    ],
  );
  writeFileSync(path.join(PUBLIC, "mlb", "sim-factors.json"), JSON.stringify(factors));
  writeFileSync(path.join(PUBLIC, "mlb", "sim-backtest.json"), JSON.stringify(backtest, null, 2) + "\n");
  console.log(backtest.statement);
  for (const [name, block] of Object.entries(backtest.markets)) {
    console.log(`  ${name} games ${block.games} model ${block.model.brier}/${block.model.logLoss} market ${block.market.brier}/${block.market.logLoss}`);
  }
}

function main() {
  const which = process.argv[2] ?? "all";
  if (which === "all" || which === "football") calibrateFootball();
  if (which === "all" || which === "nfl") calibratePoints("nfl", 13.5, 13, 1.5);
  if (which === "all" || which === "mlb") calibrateRuns();
}

main();
