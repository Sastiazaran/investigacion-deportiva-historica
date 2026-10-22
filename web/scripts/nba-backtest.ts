/**
 * Walk-forward backtest and the small JSON the site reads.
 *
 * Reads .cache/nba-sim/games.json from scripts/nba_sim_data.py.
 * Writes public/data/nba/team-factors.json and sim-backtest.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  ML_GAP_AFTER,
  NBA_NAMES,
  PRIOR_GAMES,
  SIMS,
  addBox,
  brierScore,
  blendBoxes,
  devigHome,
  emptyBox,
  hashSeed,
  logLoss,
  profileFromBoxes,
  round4,
  roundTo,
  settleCloses,
  simulateGame,
  solveHomeEfgBump,
  type BetSummary,
  type BoxCounts,
  type CloseRow,
  type FourFactors,
  type ScoreRow,
  type TeamProfile,
} from "../src/lib/nba-sim.ts";

type CachedGame = {
  id: string;
  date: string;
  season: number;
  phase: string;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  homeBox: BoxCounts;
  awayBox: BoxCounts;
  homeMl: number | null;
  awayMl: number | null;
  mlSource: string | null;
};

type CacheFile = {
  pbp: Record<string, unknown>;
  games: CachedGame[];
};

type Acc = { games: number; team: BoxCounts; opp: BoxCounts };

type Graded = CloseRow & { y: 0 | 1; market: number; date: string };

function emptyAcc(): Acc {
  return { games: 0, team: emptyBox(), opp: emptyBox() };
}

function addSide(acc: Acc, team: BoxCounts, opp: BoxCounts) {
  acc.games += 1;
  acc.team = addBox(acc.team, team);
  acc.opp = addBox(acc.opp, opp);
}

function blendedProfile(prior: Acc | undefined, current: Acc): TeamProfile | null {
  const priorGames = prior?.games ?? 0;
  const weight = priorGames > 0 ? PRIOR_GAMES : 0;
  const games = weight + current.games;
  if (games <= 0) return null;
  const team = blendBoxes(prior?.team ?? emptyBox(), priorGames, weight, current.team);
  const opp = blendBoxes(prior?.opp ?? emptyBox(), priorGames, weight, current.opp);
  if (team.fga <= 0 || opp.fga <= 0) return null;
  const profile = profileFromBoxes(team, opp, games, weight);
  profile.games = current.games;
  profile.priorGames = weight;
  return profile;
}

function roundFactors(factors: FourFactors): FourFactors {
  return {
    efg: round4(factors.efg),
    tov: round4(factors.tov),
    oreb: round4(factors.oreb),
    ftr: round4(factors.ftr),
    ftPct: round4(factors.ftPct),
    threeRate: round4(factors.threeRate),
    fg2: round4(factors.fg2),
    fg3: round4(factors.fg3),
  };
}

function roundProfile(profile: TeamProfile): TeamProfile {
  return {
    games: profile.games,
    priorGames: profile.priorGames,
    pace: roundTo(profile.pace, 2),
    off: roundFactors(profile.off),
    def: roundFactors(profile.def),
  };
}

function sampleSd(values: number[]) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function gamePace(game: CachedGame) {
  const home = game.homeBox.fga + 0.44 * game.homeBox.fta - game.homeBox.oreb + game.homeBox.tov;
  const away = game.awayBox.fga + 0.44 * game.awayBox.fta - game.awayBox.oreb + game.awayBox.tov;
  return (home + away) / 2;
}

function summaryBlock(rows: Graded[]) {
  const modelRows: ScoreRow[] = rows.map((row) => ({ p: row.pHome, y: row.y }));
  const marketRows: ScoreRow[] = rows.map((row) => ({ p: row.market, y: row.y }));
  const modelBrier = brierScore(modelRows);
  const marketBrier = brierScore(marketRows);
  const modelLog = logLoss(modelRows);
  const marketLog = logLoss(marketRows);
  const beatsMarket =
    modelBrier != null &&
    marketBrier != null &&
    modelLog != null &&
    marketLog != null &&
    modelBrier < marketBrier &&
    modelLog < marketLog;
  const homeWins = rows.reduce((sum, row) => sum + row.y, 0);
  return {
    games: rows.length,
    homeWins,
    homeWinRate: rows.length ? round4(homeWins / rows.length) : null,
    meanModelHomeProb: rows.length ? round4(rows.reduce((sum, row) => sum + row.pHome, 0) / rows.length) : null,
    meanMarketHomeProb: rows.length ? round4(rows.reduce((sum, row) => sum + row.market, 0) / rows.length) : null,
    model: { brier: modelBrier == null ? null : round4(modelBrier), logLoss: modelLog == null ? null : round4(modelLog) },
    market: { brier: marketBrier == null ? null : round4(marketBrier), logLoss: marketLog == null ? null : round4(marketLog) },
    roiEdge5: roundBets(settleCloses(rows, 1.05)),
    roiAnyEdge: roundBets(settleCloses(rows, 1)),
    beatsMarket,
  };
}

function roundBets(bets: BetSummary) {
  return {
    bets: bets.bets,
    wins: bets.wins,
    staked: bets.staked,
    profit: roundTo(bets.profit, 3),
    roi: bets.roi == null ? null : round4(bets.roi),
  };
}

function statement(block: ReturnType<typeof summaryBlock>) {
  if (!block.games || block.model.brier == null || block.market.brier == null || block.model.logLoss == null || block.market.logLoss == null) {
    return "The backtest has no closing prices to score.";
  }
  const roi = block.roiEdge5.roi == null ? "no bets" : `${block.roiEdge5.roi >= 0 ? "+" : ""}${(block.roiEdge5.roi * 100).toFixed(1)}%`;
  const scores = `On ${block.games.toLocaleString("en-GB")} regular-season games the simulator's Brier score is ${block.model.brier.toFixed(4)} and its log loss is ${block.model.logLoss.toFixed(4)}. The de-vigged closing line is ${block.market.brier.toFixed(4)} and ${block.market.logLoss.toFixed(4)}. Flat 1-unit bets taken only when the close was at least the model's fair price times 1.05 returned ${roi} on ${block.roiEdge5.bets} bets.`;
  if (block.beatsMarket) {
    return `The simulator beat the closing line on both Brier score and log loss. ${scores}`;
  }
  return `The simulator does not beat the closing line. ${scores}`;
}

function main() {
  const root = path.join(process.cwd(), "..");
  const cachePath = process.env.NBA_SIM_GAMES ?? path.join(root, ".cache", "nba-sim", "games.json");
  const cache = JSON.parse(readFileSync(cachePath, "utf8")) as CacheFile;
  const games = cache.games.filter((game) => game.phase === "regular");
  const bySeason = new Map<number, Map<string, Acc>>();
  const ensure = (season: number, code: string) => {
    let seasonMap = bySeason.get(season);
    if (!seasonMap) {
      seasonMap = new Map();
      bySeason.set(season, seasonMap);
    }
    let acc = seasonMap.get(code);
    if (!acc) {
      acc = emptyAcc();
      seasonMap.set(code, acc);
    }
    return acc;
  };
  for (const game of games) {
    addSide(ensure(game.season, game.home), game.homeBox, game.awayBox);
    addSide(ensure(game.season, game.away), game.awayBox, game.homeBox);
  }

  const season2025 = games.filter((game) => game.season === 2025);
  const margins = season2025.map((game) => game.homeScore - game.awayScore);
  const homeAdvantagePoints = margins.reduce((sum, value) => sum + value, 0) / margins.length;
  const paces = season2025.map(gamePace);
  const paceSd = sampleSd(paces);
  const leagueAcc = emptyAcc();
  for (const game of season2025) {
    addSide(leagueAcc, game.homeBox, game.awayBox);
    addSide(leagueAcc, game.awayBox, game.homeBox);
  }
  const leagueProfile = profileFromBoxes(leagueAcc.team, leagueAcc.opp, leagueAcc.games);
  const league = roundFactors(leagueProfile.off);
  const leaguePace = roundTo(leagueProfile.pace, 2);
  const homeEfgBump = solveHomeEfgBump(league, leaguePace, homeAdvantagePoints);

  const prior = bySeason.get(2024) ?? new Map<string, Acc>();
  const running = new Map<string, Acc>();
  const graded: Graded[] = [];
  let missingClose = 0;
  const ordered = season2025.slice().sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const started = Date.now();
  for (let index = 0; index < ordered.length; index += 1) {
    const game = ordered[index];
    const homeProfile = blendedProfile(prior.get(game.home), running.get(game.home) ?? emptyAcc());
    const awayProfile = blendedProfile(prior.get(game.away), running.get(game.away) ?? emptyAcc());
    if (
      homeProfile &&
      awayProfile &&
      game.homeScore !== game.awayScore &&
      game.homeMl &&
      game.awayMl &&
      game.homeMl > 1 &&
      game.awayMl > 1
    ) {
      const sim = simulateGame({
        home: homeProfile,
        away: awayProfile,
        league,
        homeAdvantagePoints,
        paceSd,
        leaguePace,
        n: SIMS,
        seed: hashSeed(`${game.date}|${game.away}|${game.home}`),
        homeEfgBump,
      });
      graded.push({
        pHome: sim.homeWinPct,
        homeMl: game.homeMl,
        awayMl: game.awayMl,
        homeWon: game.homeScore > game.awayScore,
        y: game.homeScore > game.awayScore ? 1 : 0,
        market: devigHome(game.homeMl, game.awayMl),
        date: game.date,
      });
    } else if (!game.homeMl || !game.awayMl) {
      missingClose += 1;
    }
    addSide(accFor(running, game.home), game.homeBox, game.awayBox);
    addSide(accFor(running, game.away), game.awayBox, game.homeBox);
    if ((index + 1) % 200 === 0 || index + 1 === ordered.length) {
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`backtest ${index + 1}/${ordered.length} in ${seconds}s`);
    }
  }

  const through = graded.filter((row) => row.date <= ML_GAP_AFTER);
  const after = graded.filter((row) => row.date > ML_GAP_AFTER);
  const full = summaryBlock(graded);
  const text = statement(full);

  const factors = publishFactors({
    games,
    bySeason,
    league,
    leaguePace,
    homeAdvantagePoints,
    paceSd,
    homeEfgBump,
    pbp: cache.pbp,
  });

  const closeSources: Record<string, number> = {};
  for (const game of ordered) {
    if (!game.mlSource || !game.homeMl || !game.awayMl) continue;
    closeSources[game.mlSource] = (closeSources[game.mlSource] ?? 0) + 1;
  }

  const backtest = {
    schemaVersion: 1,
    season: 2025,
    n: SIMS,
    generatedAt: new Date().toISOString(),
    closeSources,
    closingSource:
      "ESPN odds close.moneyLine.decimal. ESPN BET (provider 58) through November 2025; DraftKings (provider 100) after that.",
    repoMoneylineGap:
      "The site's NBA summary has no moneyline after 2026-02-12. That file's prices are BetMGM through that date. This backtest could not re-download the Kaggle extracts (the public download URL returned 404 without credentials). It uses the close ESPN publishes and splits the sample on 2026-02-12.",
    beatsMarket: full.beatsMarket,
    statement: text,
    missingClose,
    full,
    through2026_02_12: summaryBlock(through),
    after2026_02_12: summaryBlock(after),
  };

  const outDir = path.join(process.cwd(), "public", "data", "nba");
  writeFileSync(path.join(outDir, "team-factors.json"), `${JSON.stringify(factors, null, 2)}\n`);
  writeFileSync(path.join(outDir, "sim-backtest.json"), `${JSON.stringify(backtest, null, 2)}\n`);
  console.log(text);
  console.log(`missing close ${missingClose}`);
}

function accFor(running: Map<string, Acc>, code: string) {
  let acc = running.get(code);
  if (!acc) {
    acc = emptyAcc();
    running.set(code, acc);
  }
  return acc;
}

function publishFactors(input: {
  games: CachedGame[];
  bySeason: Map<number, Map<string, Acc>>;
  league: FourFactors;
  leaguePace: number;
  homeAdvantagePoints: number;
  paceSd: number;
  homeEfgBump: number;
  pbp: Record<string, unknown>;
}) {
  const season2026 = input.bySeason.get(2026) ?? new Map<string, Acc>();
  const pure2025 = input.bySeason.get(2025) ?? new Map<string, Acc>();
  const teams: Record<string, unknown> = {};
  for (const code of Object.keys(NBA_NAMES).sort()) {
    const seasonProfile = pure2025.get(code);
    // Current form shrinks toward the finished 2025-26 season, not toward 2024-25.
    const currentProfile = blendedProfile(pure2025.get(code), season2026.get(code) ?? emptyAcc());
    const profiles: Record<string, TeamProfile> = {};
    if (seasonProfile && seasonProfile.games > 0) {
      profiles["2025"] = roundProfile(profileFromBoxes(seasonProfile.team, seasonProfile.opp, seasonProfile.games, 0));
    }
    if (currentProfile) profiles.current = roundProfile(currentProfile);
    const raw2026 = season2026.get(code);
    if (raw2026 && raw2026.games > 0) {
      profiles["2026"] = roundProfile(profileFromBoxes(raw2026.team, raw2026.opp, raw2026.games, 0));
    }
    teams[code] = { team: NBA_NAMES[code], abbrev: code, profiles };
  }
  const dates = (season: number) => {
    const rows = input.games.filter((game) => game.season === season);
    return {
      games: rows.length,
      from: rows[0]?.date ?? null,
      to: rows[rows.length - 1]?.date ?? null,
    };
  };
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sims: SIMS,
    priceMargin: 1.05,
    priorGames: PRIOR_GAMES,
    homeAdvantagePoints: roundTo(input.homeAdvantagePoints, 2),
    homeEfgBump: round4(input.homeEfgBump),
    paceSd: roundTo(input.paceSd, 2),
    leaguePace: input.leaguePace,
    league: input.league,
    coverage: {
      "2024": dates(2024),
      "2025": dates(2025),
      "2026": dates(2026),
    },
    pbp: input.pbp,
    sources: [
      "ESPN team box scores via the sportsdataverse release espn_nba_team_boxscores (team_box_2025.csv, team_box_2026.csv, team_box_2027.csv). Season in that file is the ending year.",
      "Closing moneylines from sports.core.api.espn.com (close.moneyLine.decimal). ESPN BET through November 2025, DraftKings after that. One request per 2025-26 regular-season game, cached, with a 0.12s gap.",
      "ESPN play-by-play from the game summary endpoint for every 15th 2025-26 regular-season game and every completed 2026-27 game. Raw plays are not stored.",
    ],
    notes: [
      "Ratings use regular-season box scores only. 2024-25 is the walk-forward prior (16 games of weight). The page's current profile shrinks 2026-27 games toward the finished 2025-26 season with the same weight.",
      "The simulator does not use the BetMGM moneylines in web/public/data/nba/summary.json. Those stop after 2026-02-12, and the Kaggle extract was not available without credentials.",
      "Player usage, shot zones, minutes, matchups, and props are not in this version.",
    ],
    teams,
  };
}

main();
