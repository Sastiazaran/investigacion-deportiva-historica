/**
 * Season windows for every simulator.
 *
 * A window is "start season through the current one". Games before the
 * start are ignored. A short sample still shrinks toward the league.
 * The three comparison windows (current, last two, last three) are scored
 * on the current season only, so the sample matches. The default is the
 * window with the lower log loss.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  PRIOR_GAMES,
  addBox,
  blendBoxes,
  emptyBox,
  profileFromBoxes,
  simulateGame,
  solveHomeEfgBump,
  type BoxCounts,
  type FourFactors,
  type TeamProfile,
} from "../src/lib/nba-sim.ts";
import { bestWindowStart, windowLabel, type WindowScore } from "../src/lib/rating-window.ts";
import {
  binaryBrier,
  binaryLogLoss,
  clampRate,
  devigThree,
  devigTwo,
  marketsFromMatrix,
  marketsFromNormal,
  multiclassBrier,
  multiclassLogLoss,
  scoreMatrix,
  type BinaryRow,
  type OutcomeRow,
} from "../src/lib/sim-markets.ts";

const ROOT = path.join(process.cwd(), "..");
const PUBLIC = path.join(process.cwd(), "public", "data");
const PRIOR_FOOTBALL = 8;
const PRIOR_NFL = 8;
const PRIOR_MLB = 10;

type Score = { model: BinaryRow[]; market: BinaryRow[] };
type ClassScore = { model: OutcomeRow[]; market: OutcomeRow[] };

function round4(value: number) {
  return Math.round(value * 10000) / 10000;
}

function shrunk(sum: number, games: number, prior: number, league: number) {
  return (sum + prior * league) / (games + prior);
}

function finish(rows: Score): WindowScore | null {
  if (!rows.model.length) return null;
  return {
    games: rows.model.length,
    modelBrier: round4(binaryBrier(rows.model) ?? 0),
    modelLogLoss: round4(binaryLogLoss(rows.model) ?? 0),
    marketBrier: round4(binaryBrier(rows.market) ?? 0),
    marketLogLoss: round4(binaryLogLoss(rows.market) ?? 0),
  };
}

function finishClass(rows: ClassScore): WindowScore | null {
  if (!rows.model.length) return null;
  return {
    games: rows.model.length,
    modelBrier: round4(multiclassBrier(rows.model) ?? 0),
    modelLogLoss: round4(multiclassLogLoss(rows.model) ?? 0),
    marketBrier: round4(multiclassBrier(rows.market) ?? 0),
    marketLogLoss: round4(multiclassLogLoss(rows.market) ?? 0),
  };
}

function comparisonStarts(seasons: number[], current: number) {
  return [current, current - 1, current - 2].filter((year) => seasons.includes(year));
}

type Count = { gf: number; ga: number; gp: number };

function emptyCount(): Count {
  return { gf: 0, ga: 0, gp: 0 };
}

function addCount(target: Count, row: Count) {
  target.gf += row.gf;
  target.ga += row.ga;
  target.gp += row.gp;
}

function pool(hist: Map<string, Map<number, Count>>, code: string, start: number, through: number) {
  const out = emptyCount();
  const seasons = hist.get(code);
  if (!seasons) return out;
  for (const [year, row] of seasons) {
    if (year >= start && year <= through) addCount(out, row);
  }
  return out;
}

function remember(hist: Map<string, Map<number, Count>>, code: string, season: number, scored: number, allowed: number) {
  let seasons = hist.get(code);
  if (!seasons) {
    seasons = new Map();
    hist.set(code, seasons);
  }
  const row = seasons.get(season) ?? emptyCount();
  row.gf += scored;
  row.ga += allowed;
  row.gp += 1;
  seasons.set(season, row);
}

function buildFootball() {
  const file = JSON.parse(readFileSync(path.join(PUBLIC, "matches.json"), "utf8")) as {
    leagueNames: Record<string, string>;
    matches: { date: string; season: number; league: string; home: string; away: string; homeGoals: number; awayGoals: number; result: "H" | "D" | "A"; closing?: { home: number; draw: number; away: number } | null }[];
  };
  const existing = JSON.parse(readFileSync(path.join(PUBLIC, "football", "sim-factors.json"), "utf8")) as {
    leagues: Record<string, { rho: number }>;
  };
  const byLeague = new Map<string, typeof file.matches>();
  for (const match of file.matches) {
    const list = byLeague.get(match.league) ?? [];
    list.push(match);
    byLeague.set(match.league, list);
  }
  const seasons = [...new Set(file.matches.map((match) => match.season))].sort((a, b) => a - b);
  const current = seasons[seasons.length - 1];
  const compare = comparisonStarts(seasons, current);
  const choices = new Map<number, { games: number; leagues: Record<string, unknown>; score: ClassScore }>();
  for (const start of seasons) {
    choices.set(start, { games: 0, leagues: {}, score: { model: [], market: [] } });
  }
  for (const [code, matches] of byLeague) {
    matches.sort((a, b) => a.date.localeCompare(b.date) || a.home.localeCompare(b.home));
    const rho = existing.leagues[code]?.rho ?? -0.05;
    const hist = new Map<string, Map<number, Count>>();
    const env = new Map<number, { homeGoals: number; awayGoals: number; played: number }>();
    for (const start of compare) env.set(start, { homeGoals: 0, awayGoals: 0, played: 0 });
    for (const match of matches) {
      for (const start of compare) {
        if (match.season < start || match.season !== current) continue;
        const state = env.get(start)!;
        const leagueGpg = state.played >= 20 ? (state.homeGoals + state.awayGoals) / (2 * state.played) : 1.35;
        const homeAvg = state.played >= 20 ? state.homeGoals / state.played : 1.45;
        const awayAvg = state.played >= 20 ? state.awayGoals / state.played : 1.15;
        const home = pool(hist, match.home, start, match.season);
        const away = pool(hist, match.away, start, match.season);
        const homeRate = clampRate(homeAvg * (shrunk(home.gf, home.gp, PRIOR_FOOTBALL, leagueGpg) / leagueGpg) * (shrunk(away.ga, away.gp, PRIOR_FOOTBALL, leagueGpg) / leagueGpg), 0.15, 4.5);
        const awayRate = clampRate(awayAvg * (shrunk(away.gf, away.gp, PRIOR_FOOTBALL, leagueGpg) / leagueGpg) * (shrunk(home.ga, home.gp, PRIOR_FOOTBALL, leagueGpg) / leagueGpg), 0.1, 4);
        if (match.closing && match.closing.home > 1 && match.closing.draw > 1 && match.closing.away > 1) {
          const output = marketsFromMatrix(scoreMatrix(homeRate, awayRate, rho, 8), 0.5, 2.5, "goals");
          const actual = match.result === "H" ? 0 : match.result === "D" ? 1 : 2;
          const market = devigThree(match.closing.home, match.closing.draw, match.closing.away);
          const bucket = choices.get(start)!.score;
          bucket.model.push({ probabilities: [output.home.probability, output.draw.probability, output.away.probability], actual });
          bucket.market.push({ probabilities: [market.home, market.draw, market.away], actual });
        }
      }
      remember(hist, match.home, match.season, match.homeGoals, match.awayGoals);
      remember(hist, match.away, match.season, match.awayGoals, match.homeGoals);
      for (const start of compare) {
        if (match.season < start) continue;
        const state = env.get(start)!;
        state.homeGoals += match.homeGoals;
        state.awayGoals += match.awayGoals;
        state.played += 1;
      }
    }
    const leagueSeasons = [...new Set(matches.map((match) => match.season))];
    for (const start of seasons) {
      if (!leagueSeasons.some((year) => year >= start)) continue;
      let homeGoals = 0;
      let awayGoals = 0;
      let played = 0;
      const sides = new Map<string, Count>();
      const active = new Set<string>();
      for (const match of matches) {
        if (match.season < start) continue;
        played += 1;
        homeGoals += match.homeGoals;
        awayGoals += match.awayGoals;
        const home = sides.get(match.home) ?? emptyCount();
        home.gf += match.homeGoals;
        home.ga += match.awayGoals;
        home.gp += 1;
        sides.set(match.home, home);
        const away = sides.get(match.away) ?? emptyCount();
        away.gf += match.awayGoals;
        away.ga += match.homeGoals;
        away.gp += 1;
        sides.set(match.away, away);
        if (match.season === current) {
          active.add(match.home);
          active.add(match.away);
        }
      }
      const leagueGpg = played > 0 ? (homeGoals + awayGoals) / (2 * played) : 1.35;
      const teams: Record<string, unknown> = {};
      for (const [name, side] of sides) {
        teams[name] = {
          attack: round4(shrunk(side.gf, side.gp, PRIOR_FOOTBALL, leagueGpg) / leagueGpg),
          defense: round4(shrunk(side.ga, side.gp, PRIOR_FOOTBALL, leagueGpg) / leagueGpg),
          games: side.gp,
          active: active.has(name),
        };
      }
      const choice = choices.get(start)!;
      choice.games += played;
      choice.leagues[code] = {
        name: file.leagueNames[code] ?? code,
        homeAvg: round4(played > 0 ? homeGoals / played : 1.45),
        awayAvg: round4(played > 0 ? awayGoals / played : 1.15),
        leagueGpg: round4(leagueGpg),
        rho: round4(rho),
        priorGames: PRIOR_FOOTBALL,
        teams,
      };
    }
    console.log(`football windows ${code}`);
  }
  const list = [...choices.entries()].map(([start, choice]) => ({
    start,
    label: windowLabel(start, current),
    games: choice.games,
    backtest: compare.includes(start) ? finishClass(choice.score) : null,
    leagues: choice.leagues,
  }));
  const defaultStart = bestWindowStart(list);
  const factors = JSON.parse(readFileSync(path.join(PUBLIC, "football", "sim-factors.json"), "utf8"));
  const chosen = list.find((row) => row.start === defaultStart)!;
  factors.currentSeason = current;
  factors.defaultStart = defaultStart;
  factors.ratingWindows = {
    currentSeason: current,
    defaultStart,
    choices: list,
  };
  factors.leagues = chosen.leagues;
  writeFileSync(path.join(PUBLIC, "football", "sim-factors.json"), JSON.stringify(factors));
  console.log("football default", defaultStart, list.filter((row) => row.backtest).map((row) => [row.start, row.backtest]));
  return list.map(({ start, label, games, backtest }) => ({ start, label, games, backtest }));
}

function buildNfl() {
  const games = (JSON.parse(readFileSync(path.join(ROOT, ".cache", "us-sports", "nfl-sim-games.json"), "utf8")) as {
    games: { date: string; season: number; phase: string; home: string; away: string; home_score: number; away_score: number; home_ml: number | null; away_ml: number | null }[];
  }).games.filter((game) => game.phase === "regular").sort((a, b) => a.date.localeCompare(b.date) || a.home.localeCompare(b.home));
  const base = JSON.parse(readFileSync(path.join(PUBLIC, "nfl", "sim-factors.json"), "utf8")) as {
    marginSd: number;
    totalSd: number;
  };
  const seasons = [...new Set(games.map((game) => game.season))].sort((a, b) => a - b);
  const current = seasons[seasons.length - 1];
  const compare = comparisonStarts(seasons, current);
  const hist = new Map<string, Map<number, Count>>();
  const env = new Map<number, { points: number; games: number; margin: number }>();
  const scores = new Map<number, Score>();
  for (const start of compare) {
    env.set(start, { points: 0, games: 0, margin: 0 });
    scores.set(start, { model: [], market: [] });
  }
  for (const game of games) {
    for (const start of compare) {
      if (game.season < start) continue;
      const state = env.get(start)!;
      const league = state.games >= 16 ? state.points / (2 * state.games) : 22;
      const hfa = state.games >= 16 ? state.margin / state.games : 1.5;
      if (game.season === current && game.home_ml && game.away_ml && game.home_ml > 1 && game.away_ml > 1 && game.home_score !== game.away_score) {
        const home = pool(hist, game.home, start, game.season);
        const away = pool(hist, game.away, start, game.season);
        const homeOff = shrunk(home.gf, home.gp, PRIOR_NFL, league);
        const homeDef = shrunk(home.ga, home.gp, PRIOR_NFL, league);
        const awayOff = shrunk(away.gf, away.gp, PRIOR_NFL, league);
        const awayDef = shrunk(away.ga, away.gp, PRIOR_NFL, league);
        const output = marketsFromNormal(homeOff + awayDef - league + hfa, awayOff + homeDef - league, base.marginSd, base.totalSd, 0, 45);
        const decided = output.home.probability + output.away.probability;
        const modelHome = decided > 0 ? output.home.probability / decided : 0.5;
        const market = devigTwo(game.home_ml, game.away_ml);
        const homeWon = game.home_score > game.away_score ? 1 : 0;
        scores.get(start)!.model.push({ probability: modelHome, actual: homeWon });
        scores.get(start)!.market.push({ probability: market.home, actual: homeWon });
      }
      state.points += game.home_score + game.away_score;
      state.games += 1;
      state.margin += game.home_score - game.away_score;
    }
    remember(hist, game.home, game.season, game.home_score, game.away_score);
    remember(hist, game.away, game.season, game.away_score, game.home_score);
  }
  const choices = seasons.map((start) => {
    let points = 0;
    let count = 0;
    let margin = 0;
    const teams: Record<string, unknown> = {};
    for (const game of games) {
      if (game.season < start) continue;
      points += game.home_score + game.away_score;
      count += 1;
      margin += game.home_score - game.away_score;
    }
    const league = count > 0 ? points / (2 * count) : 22;
    const hfa = count > 0 ? margin / count : 1.5;
    for (const code of hist.keys()) {
      const side = pool(hist, code, start, current);
      if (side.gp <= 0) continue;
      teams[code] = {
        off: round4(shrunk(side.gf, side.gp, PRIOR_NFL, league)),
        def: round4(shrunk(side.ga, side.gp, PRIOR_NFL, league)),
        games: side.gp,
        seasonGames: side.gp,
      };
    }
    const backtest = compare.includes(start) ? finish(scores.get(start)!) : null;
    const home = teams.MIA as { off: number; def: number };
    const away = teams.DET as { off: number; def: number };
    const output = marketsFromNormal(home.off + away.def - league + hfa, away.off + home.def - league, base.marginSd, base.totalSd, -7, 50.5);
    const decided = output.home.probability + output.away.probability;
    return {
      start,
      label: windowLabel(start, current),
      games: count,
      backtest,
      leaguePpg: round4(league),
      homeAdvantage: round4(hfa),
      marginSd: base.marginSd,
      totalSd: base.totalSd,
      teams,
      miaHome: round4(decided > 0 ? output.home.probability / decided : 0.5),
      margin: round4(output.meanMargin),
    };
  });
  const defaultStart = bestWindowStart(choices);
  const chosen = choices.find((row) => row.start === defaultStart)!;
  const factors = JSON.parse(readFileSync(path.join(PUBLIC, "nfl", "sim-factors.json"), "utf8"));
  factors.currentSeason = current;
  factors.defaultStart = defaultStart;
  factors.leaguePpg = chosen.leaguePpg;
  factors.homeAdvantage = chosen.homeAdvantage;
  factors.teams = chosen.teams;
  factors.notes = [
    `Default window is ${chosen.label}, the lowest log loss of current season, last two seasons, and last three on ${current} games.`,
    "A window uses every regular-season game from the start season through the latest one, shrunk eight games toward that window's league average.",
    "There is no quarterback, injury, or weather input.",
  ];
  factors.ratingWindows = {
    currentSeason: current,
    defaultStart,
    choices: choices.map(({ teams, ...rest }) => ({ ...rest, teams })),
  };
  writeFileSync(path.join(PUBLIC, "nfl", "sim-factors.json"), JSON.stringify(factors));
  writeWeekNine(chosen);
  console.log("nfl default", defaultStart);
  for (const row of choices.filter((item) => item.backtest)) {
    console.log(" ", row.start, row.backtest, "mia", row.miaHome, "margin", row.margin);
  }
  return choices.map(({ start, label, games, backtest, miaHome, margin }) => ({ start, label, games, backtest, miaHome, margin }));
}

function writeWeekNine(chosen: {
  leaguePpg: number;
  homeAdvantage: number;
  marginSd: number;
  totalSd: number;
  teams: Record<string, { off: number; def: number }>;
  miaHome: number;
}) {
  const lines = readFileSync(path.join(ROOT, ".cache", "us-sports", "games.csv"), "utf8").split(/\r?\n/);
  const split = (line: string) => {
    const cells: string[] = [];
    let current = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"') quoted = !quoted;
      else if (char === "," && !quoted) {
        cells.push(current);
        current = "";
      } else current += char;
    }
    cells.push(current);
    return cells;
  };
  const header = split(lines[0]);
  const at = (name: string) => header.indexOf(name);
  const rows = [];
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const cells = split(line);
    if (cells[at("season")] !== "2026" || cells[at("week")] !== "9" || cells[at("game_type")] !== "REG") continue;
    const home = cells[at("home_team")];
    const away = cells[at("away_team")];
    const homeTeam = chosen.teams[home];
    const awayTeam = chosen.teams[away];
    if (!homeTeam || !awayTeam) continue;
    const homeMl = Number(cells[at("home_moneyline")]);
    const awayMl = Number(cells[at("away_moneyline")]);
    if (!homeMl || !awayMl) continue;
    const homeDec = homeMl > 0 ? 1 + homeMl / 100 : 1 + 100 / Math.abs(homeMl);
    const awayDec = awayMl > 0 ? 1 + awayMl / 100 : 1 + 100 / Math.abs(awayMl);
    const spread = Number(cells[at("spread_line")]);
    const output = marketsFromNormal(
      homeTeam.off + awayTeam.def - chosen.leaguePpg + chosen.homeAdvantage,
      awayTeam.off + homeTeam.def - chosen.leaguePpg,
      chosen.marginSd,
      chosen.totalSd,
      Number.isFinite(spread) ? spread : 0,
      45,
    );
    const decided = output.home.probability + output.away.probability;
    const modelHome = decided > 0 ? output.home.probability / decided : 0.5;
    const market = devigTwo(homeDec, awayDec);
    const gap = Math.abs(modelHome - market.home);
    rows.push({
      date: cells[at("gameday")],
      away,
      home,
      spread: Number.isFinite(spread) ? spread : null,
      modelHome: round4(modelHome),
      marketHome: round4(market.home),
      gap: round4(gap),
      flagged: gap > 0.15,
    });
  }
  const payload = {
    schemaVersion: 1,
    season: 2026,
    week: 9,
    threshold: 0.15,
    source: "nflverse games.csv moneylines for unplayed Week 9 games, scored with the default season window.",
    flagged: rows.filter((row) => row.flagged).map((row) => `${row.away} at ${row.home}`),
    games: rows,
    miaDet: {
      miamiHome: { home: "MIA", away: "DET", modelHome: chosen.miaHome },
    },
  };
  writeFileSync(path.join(PUBLIC, "nfl", "week9-check.json"), `${JSON.stringify(payload, null, 2)}\n`);
  console.log("week 9 flagged", payload.flagged.join(", ") || "none");
}

function buildMlb() {
  const games = (JSON.parse(readFileSync(path.join(ROOT, "data", "mlb", "games.json"), "utf8")) as {
    games: { date: string; season: number; phase: string; home: string; away: string; home_score: number; away_score: number; home_ml: number | null; away_ml: number | null }[];
  }).games.filter((game) => game.phase === "regular").sort((a, b) => a.date.localeCompare(b.date) || a.home.localeCompare(b.home));
  const base = JSON.parse(readFileSync(path.join(PUBLIC, "mlb", "sim-factors.json"), "utf8")) as { tieShare: number };
  const seasons = [...new Set(games.map((game) => game.season))].sort((a, b) => a - b);
  const current = seasons[seasons.length - 1];
  const compare = comparisonStarts(seasons, current);
  const hist = new Map<string, Map<number, Count>>();
  const env = new Map<number, { homeRuns: number; awayRuns: number; games: number }>();
  const scores = new Map<number, Score>();
  for (const start of compare) {
    env.set(start, { homeRuns: 0, awayRuns: 0, games: 0 });
    scores.set(start, { model: [], market: [] });
  }
  for (const game of games) {
    for (const start of compare) {
      if (game.season < start) continue;
      const state = env.get(start)!;
      const league = state.games >= 40 ? (state.homeRuns + state.awayRuns) / (2 * state.games) : 4.4;
      const homeAvg = state.games >= 40 ? state.homeRuns / state.games : 4.6;
      const awayAvg = state.games >= 40 ? state.awayRuns / state.games : 4.2;
      if (game.season === current && game.home_ml && game.away_ml && game.home_ml > 1 && game.away_ml > 1 && game.home_score !== game.away_score) {
        const home = pool(hist, game.home, start, game.season);
        const away = pool(hist, game.away, start, game.season);
        const homeRate = clampRate(homeAvg * (shrunk(home.gf, home.gp, PRIOR_MLB, league) / league) * (shrunk(away.ga, away.gp, PRIOR_MLB, league) / league), 1.5, 9);
        const awayRate = clampRate(awayAvg * (shrunk(away.gf, away.gp, PRIOR_MLB, league) / league) * (shrunk(home.ga, home.gp, PRIOR_MLB, league) / league), 1.5, 9);
        const grid = scoreMatrix(homeRate, awayRate, 0, 12);
        const output = marketsFromMatrix(grid, 1.5, 8.5, "runs");
        const modelHome = output.home.probability + output.draw.probability * (base.tieShare ?? 0.53);
        const market = devigTwo(game.home_ml, game.away_ml);
        scores.get(start)!.model.push({ probability: Math.min(0.999, modelHome), actual: game.home_score > game.away_score ? 1 : 0 });
        scores.get(start)!.market.push({ probability: market.home, actual: game.home_score > game.away_score ? 1 : 0 });
      }
      state.homeRuns += game.home_score;
      state.awayRuns += game.away_score;
      state.games += 1;
    }
    remember(hist, game.home, game.season, game.home_score, game.away_score);
    remember(hist, game.away, game.season, game.away_score, game.home_score);
  }
  const choices = seasons.map((start) => {
    let homeRuns = 0;
    let awayRuns = 0;
    let count = 0;
    for (const game of games) {
      if (game.season < start) continue;
      homeRuns += game.home_score;
      awayRuns += game.away_score;
      count += 1;
    }
    const league = count > 0 ? (homeRuns + awayRuns) / (2 * count) : 4.4;
    const teams: Record<string, unknown> = {};
    for (const code of hist.keys()) {
      const side = pool(hist, code, start, current);
      if (side.gp <= 0) continue;
      teams[code] = {
        attack: round4(shrunk(side.gf, side.gp, PRIOR_MLB, league) / league),
        defense: round4(shrunk(side.ga, side.gp, PRIOR_MLB, league) / league),
        games: side.gp,
      };
    }
    return {
      start,
      label: windowLabel(start, current),
      games: count,
      backtest: compare.includes(start) ? finish(scores.get(start)!) : null,
      homeAvg: round4(count > 0 ? homeRuns / count : 4.6),
      awayAvg: round4(count > 0 ? awayRuns / count : 4.2),
      leagueRpg: round4(league),
      tieShare: base.tieShare,
      priorGames: PRIOR_MLB,
      teams,
    };
  });
  const defaultStart = bestWindowStart(choices);
  const chosen = choices.find((row) => row.start === defaultStart)!;
  const factors = JSON.parse(readFileSync(path.join(PUBLIC, "mlb", "sim-factors.json"), "utf8"));
  factors.currentSeason = current;
  factors.defaultStart = defaultStart;
  factors.homeAvg = chosen.homeAvg;
  factors.awayAvg = chosen.awayAvg;
  factors.leagueRpg = chosen.leagueRpg;
  factors.teams = chosen.teams;
  factors.ratingWindows = { currentSeason: current, defaultStart, choices };
  writeFileSync(path.join(PUBLIC, "mlb", "sim-factors.json"), JSON.stringify(factors));
  console.log("mlb default", defaultStart, choices.filter((row) => row.backtest).map((row) => [row.start, row.backtest]));
  return choices.map(({ start, label, games, backtest }) => ({ start, label, games, backtest }));
}

type NbaGame = {
  date: string;
  season: number;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  homeBox: BoxCounts;
  awayBox: BoxCounts;
};

function buildNba() {
  const games = (JSON.parse(readFileSync(path.join(ROOT, ".cache", "nba-sim", "window-games.json"), "utf8")) as { games: NbaGame[] }).games
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.home.localeCompare(b.home));
  const lines = new Map<string, { home: number; away: number }>();
  const priced = JSON.parse(readFileSync(path.join(ROOT, ".cache", "us-sports", "nba-sim-games.json"), "utf8")) as {
    games: { date: string; home: string; away: string; home_ml: number | null; away_ml: number | null }[];
  };
  for (const game of priced.games) {
    if (game.home_ml && game.away_ml && game.home_ml > 1 && game.away_ml > 1) {
      lines.set(`${game.date}|${game.away}|${game.home}`, { home: game.home_ml, away: game.away_ml });
    }
  }
  const base = JSON.parse(readFileSync(path.join(PUBLIC, "nba", "team-factors.json"), "utf8")) as { paceSd: number; teams: Record<string, { team: string }> };
  const seasons = [...new Set(games.map((game) => game.season))].sort((a, b) => a - b);
  const current = seasons[seasons.length - 1];
  const compare = comparisonStarts(seasons, current);
  type Acc = { games: number; team: BoxCounts; opp: BoxCounts };
  const hist = new Map<string, Map<number, Acc>>();
  const emptyAcc = (): Acc => ({ games: 0, team: emptyBox(), opp: emptyBox() });
  const poolAcc = (code: string, start: number, through: number) => {
    const out = emptyAcc();
    const rows = hist.get(code);
    if (!rows) return out;
    for (const [year, row] of rows) {
      if (year < start || year > through) continue;
      out.games += row.games;
      out.team = addBox(out.team, row.team);
      out.opp = addBox(out.opp, row.opp);
    }
    return out;
  };
  const rememberBox = (code: string, season: number, team: BoxCounts, opp: BoxCounts) => {
    let rows = hist.get(code);
    if (!rows) {
      rows = new Map();
      hist.set(code, rows);
    }
    const row = rows.get(season) ?? emptyAcc();
    row.games += 1;
    row.team = addBox(row.team, team);
    row.opp = addBox(row.opp, opp);
    rows.set(season, row);
  };
  const scores = new Map<number, Score>();
  const margin = new Map<number, { sum: number; games: number }>();
  for (const start of compare) {
    scores.set(start, { model: [], market: [] });
    margin.set(start, { sum: 0, games: 0 });
  }
  for (const game of games) {
    for (const start of compare) {
      if (game.season < start || game.season !== current) continue;
      const home = poolAcc(game.home, start, game.season);
      const away = poolAcc(game.away, start, game.season);
      const leagueAcc = emptyAcc();
      for (const code of hist.keys()) {
        const row = poolAcc(code, start, game.season);
        leagueAcc.games += row.games;
        leagueAcc.team = addBox(leagueAcc.team, row.team);
        leagueAcc.opp = addBox(leagueAcc.opp, row.opp);
      }
      if (home.games < 1 || away.games < 1 || leagueAcc.games < 20) continue;
      const leagueProfile = profileFromBoxes(leagueAcc.team, leagueAcc.opp, leagueAcc.games);
      const edge = margin.get(start)!;
      const hfa = edge.games >= 30 ? edge.sum / edge.games : 1.7;
      const bump = solveHomeEfgBump(leagueProfile.off, leagueProfile.pace, Math.max(0, hfa));
      const homeProfile = profileFromBoxes(
        blendBoxes(leagueAcc.team, leagueAcc.games, PRIOR_GAMES, home.team),
        blendBoxes(leagueAcc.opp, leagueAcc.games, PRIOR_GAMES, home.opp),
        PRIOR_GAMES + home.games,
        PRIOR_GAMES,
      );
      const awayProfile = profileFromBoxes(
        blendBoxes(leagueAcc.team, leagueAcc.games, PRIOR_GAMES, away.team),
        blendBoxes(leagueAcc.opp, leagueAcc.games, PRIOR_GAMES, away.opp),
        PRIOR_GAMES + away.games,
        PRIOR_GAMES,
      );
      const close = lines.get(`${game.date}|${game.away}|${game.home}`);
      if (close && game.homeScore !== game.awayScore) {
        const sim = simulateGame({
          home: homeProfile,
          away: awayProfile,
          league: leagueProfile.off,
          homeAdvantagePoints: hfa,
          paceSd: base.paceSd,
          leaguePace: leagueProfile.pace,
          n: 40,
          seed: 1,
          homeEfgBump: bump,
          overtime: false,
        });
        const decided = sim.homeWinPct + sim.awayWinPct;
        const market = devigTwo(close.home, close.away);
        scores.get(start)!.model.push({ probability: decided > 0 ? sim.homeWinPct / decided : 0.5, actual: game.homeScore > game.awayScore ? 1 : 0 });
        scores.get(start)!.market.push({ probability: market.home, actual: game.homeScore > game.awayScore ? 1 : 0 });
      }
    }
    rememberBox(game.home, game.season, game.homeBox, game.awayBox);
    rememberBox(game.away, game.season, game.awayBox, game.homeBox);
    for (const start of compare) {
      if (game.season < start) continue;
      const edge = margin.get(start)!;
      edge.sum += game.homeScore - game.awayScore;
      edge.games += 1;
    }
  }
  const choices = seasons.map((start) => {
    const leagueAcc = emptyAcc();
    let marginSum = 0;
    let count = 0;
    const teams: Record<string, TeamProfile> = {};
    for (const game of games) {
      if (game.season < start) continue;
      count += 1;
      marginSum += game.homeScore - game.awayScore;
    }
    for (const code of hist.keys()) {
      const row = poolAcc(code, start, current);
      leagueAcc.games += row.games;
      leagueAcc.team = addBox(leagueAcc.team, row.team);
      leagueAcc.opp = addBox(leagueAcc.opp, row.opp);
    }
    const leagueProfile = profileFromBoxes(leagueAcc.team, leagueAcc.opp, Math.max(leagueAcc.games, 1));
    const hfa = count > 0 ? marginSum / count : 1.7;
    const bump = solveHomeEfgBump(leagueProfile.off, leagueProfile.pace, Math.max(0, hfa));
    for (const code of Object.keys(base.teams)) {
      const row = poolAcc(code, start, current);
      if (row.games <= 0) continue;
      const profile = profileFromBoxes(
        blendBoxes(leagueAcc.team, leagueAcc.games, PRIOR_GAMES, row.team),
        blendBoxes(leagueAcc.opp, leagueAcc.games, PRIOR_GAMES, row.opp),
        PRIOR_GAMES + row.games,
        PRIOR_GAMES,
      );
      profile.games = row.games;
      profile.priorGames = PRIOR_GAMES;
      teams[code] = profile;
    }
    return {
      start,
      label: windowLabel(start, current),
      games: count,
      backtest: compare.includes(start) ? finish(scores.get(start)!) : null,
      league: leagueProfile.off,
      leaguePace: round4(leagueProfile.pace),
      homeAdvantagePoints: round4(hfa),
      paceSd: base.paceSd,
      homeEfgBump: round4(bump),
      teams,
    };
  });
  const defaultStart = bestWindowStart(choices);
  const payload = {
    schemaVersion: 1,
    currentSeason: current,
    defaultStart,
    choices,
  };
  writeFileSync(path.join(PUBLIC, "nba", "rating-windows.json"), JSON.stringify(payload));
  console.log("nba default", defaultStart, choices.filter((row) => row.backtest).map((row) => [row.start, row.backtest]));
  return choices.map(({ start, label, games, backtest }) => ({ start, label, games, backtest }));
}

function main() {
  const summary = {
    football: buildFootball(),
    nfl: buildNfl(),
    mlb: buildMlb(),
    nba: buildNba(),
  };
  writeFileSync(path.join(PUBLIC, "window-scores.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log("wrote window-scores.json");
}

main();
