"use client";

import { useMemo, useState } from "react";
import { formatRoi, formatWinPct } from "../lib/metrics";
import { simulateGame } from "../lib/nba-sim";
import { formatDisplayedOdds } from "../lib/odds-format";
import {
  predictFootball,
  predictPoints,
  predictRuns,
  type FootballFactors,
  type PointsFactors,
  type RunsFactors,
  type WindowBacktest,
} from "../lib/predict";
import type { FourFactors, TeamProfile } from "../lib/nba-sim";
import { halfLine, marketsFromScores, type HistBin, type Priced } from "../lib/sim-markets";
import type { NbaFactors } from "../lib/load-nba-sim";
import { useOddsFormat } from "./OddsFormatProvider";

const LEAGUE_ORDER = ["E0", "SP1", "I1", "D1", "F1", "N1", "P1", "MEX"];

type MarketBlock = {
  games: number;
  model: { brier: number | null; logLoss: number | null };
  market: { brier: number | null; logLoss: number | null };
  roiEdge5: { bets: number; roi: number | null };
  beatsMarket: boolean;
};

export type SimBacktest = {
  beatsMarket: boolean;
  statement: string;
  markets: Record<string, MarketBlock>;
  notes: string[];
};

type Common = {
  backtest: SimBacktest;
  names?: Record<string, string>;
};

export type NbaWindowChoice = {
  start: number;
  label: string;
  games: number;
  backtest: WindowBacktest | null;
  league: FourFactors;
  leaguePace: number;
  homeAdvantagePoints: number;
  paceSd: number;
  homeEfgBump: number;
  teams: Record<string, TeamProfile>;
};

export type NbaWindows = {
  currentSeason: number;
  defaultStart: number;
  choices: NbaWindowChoice[];
};

type Props =
  | (Common & { kind: "football"; factors: FootballFactors })
  | (Common & { kind: "nfl"; factors: PointsFactors })
  | (Common & { kind: "mlb"; factors: RunsFactors })
  | (Common & { kind: "nba"; factors: NbaFactors; nbaWindows?: NbaWindows });

function seasonChoices(props: Props): { start: number; label: string; games: number; backtest: WindowBacktest | null }[] {
  if (props.kind === "football") return props.factors.ratingWindows?.choices ?? [];
  if (props.kind === "nfl") return props.factors.ratingWindows?.choices ?? [];
  if (props.kind === "mlb") return props.factors.ratingWindows?.choices ?? [];
  return props.nbaWindows?.choices ?? [];
}

function defaultSeason(props: Props) {
  if (props.kind === "football") return props.factors.ratingWindows?.defaultStart ?? 0;
  if (props.kind === "nfl") return props.factors.ratingWindows?.defaultStart ?? 0;
  if (props.kind === "mlb") return props.factors.ratingWindows?.defaultStart ?? 0;
  return props.nbaWindows?.defaultStart ?? 0;
}

function pct(probability: number) {
  return formatWinPct(probability * 100);
}

function teamOptions(ids: string[], names: Record<string, string> | undefined) {
  return ids
    .map((id) => ({ id, name: names?.[id] ?? id }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function pointsView(factors: PointsFactors, start: number): PointsFactors {
  const choice = factors.ratingWindows?.choices.find((row) => row.start === start);
  if (!choice) return factors;
  return {
    ...factors,
    leaguePpg: choice.leaguePpg,
    homeAdvantage: choice.homeAdvantage,
    marginSd: choice.marginSd,
    totalSd: choice.totalSd,
    teams: choice.teams,
  };
}

function runsView(factors: RunsFactors, start: number): RunsFactors {
  const choice = factors.ratingWindows?.choices.find((row) => row.start === start);
  if (!choice) return factors;
  return {
    ...factors,
    homeAvg: choice.homeAvg,
    awayAvg: choice.awayAvg,
    leagueRpg: choice.leagueRpg,
    tieShare: choice.tieShare,
    teams: choice.teams,
  };
}

function preferred(ids: string[], candidates: string[]) {
  for (const id of candidates) {
    if (ids.includes(id)) return id;
  }
  return ids[0] ?? "";
}

export default function MatchSimulator(props: Props) {
  const { format } = useOddsFormat();
  const seasons = seasonChoices(props);
  const [windowStart, setWindowStart] = useState(defaultSeason(props));
  const activeWindow = seasons.find((choice) => choice.start === windowStart) ?? seasons[0];
  const footballLeagues =
    props.kind === "football"
      ? (props.factors.ratingWindows?.choices.find((choice) => choice.start === (activeWindow?.start ?? windowStart))?.leagues ??
        props.factors.leagues)
      : {};
  const leagues = props.kind === "football" ? LEAGUE_ORDER.filter((code) => footballLeagues[code]) : [];
  const [league, setLeague] = useState(leagues[0] ?? "");
  const ids = useMemo(() => {
    if (props.kind === "football") {
      return Object.entries(footballLeagues[league]?.teams ?? {})
        .filter(([, team]) => team.active !== false)
        .map(([name]) => name);
    }
    if (props.kind === "nfl") {
      const choice = props.factors.ratingWindows?.choices.find((row) => row.start === (activeWindow?.start ?? windowStart));
      return Object.keys(choice?.teams ?? props.factors.teams);
    }
    if (props.kind === "mlb") {
      const choice = props.factors.ratingWindows?.choices.find((row) => row.start === (activeWindow?.start ?? windowStart));
      return Object.keys(choice?.teams ?? props.factors.teams);
    }
    if (props.nbaWindows) {
      const choice = props.nbaWindows.choices.find((row) => row.start === (activeWindow?.start ?? windowStart));
      if (choice) return Object.keys(choice.teams);
    }
    return Object.keys(props.factors.teams);
  }, [activeWindow, footballLeagues, league, props, windowStart]);
  const names =
    props.kind === "nba"
      ? Object.fromEntries(Object.entries(props.factors.teams).map(([id, team]) => [id, team.team]))
      : props.names;
  const options = teamOptions(ids, names);
  const nbaNames = props.kind === "nba" ? props.factors.teams : null;
  const [away, setAway] = useState(() =>
    preferred(ids, props.kind === "football" ? ["Arsenal", "Liverpool"] : props.kind === "nba" ? ["okc"] : props.kind === "nfl" ? ["KC"] : ["NYY"]),
  );
  const [home, setHome] = useState(() =>
    preferred(ids, props.kind === "football" ? ["Chelsea", "Manchester City"] : props.kind === "nba" ? ["sa"] : props.kind === "nfl" ? ["BUF"] : ["LAD"]),
  );
  const awayId = ids.includes(away) ? away : (ids[0] ?? "");
  const homeId = ids.includes(home) && home !== awayId ? home : (ids.find((id) => id !== awayId) ?? "");
  const profile = "current" as const;
  const [seedText, setSeedText] = useState("");
  const [customSpread, setCustomSpread] = useState<number | null>(null);
  const [customTotal, setCustomTotal] = useState<number | null>(null);
  const seed =
    seedText.trim() === ""
      ? hashTeams(props.kind, league, awayId, homeId, String(activeWindow?.start ?? windowStart))
      : Number(seedText) >>> 0;
  const same = awayId !== "" && awayId === homeId;

  function resetLines() {
    setCustomSpread(null);
    setCustomTotal(null);
  }

  const nbaWindow = props.kind === "nba"
    ? props.nbaWindows?.choices.find((choice) => choice.start === (activeWindow?.start ?? windowStart))
    : undefined;
  const nbaSim = useMemo(() => {
    if (props.kind !== "nba" || same) return null;
    const homeProfile = nbaWindow?.teams[homeId] ?? props.factors.teams[homeId]?.profiles[profile];
    const awayProfile = nbaWindow?.teams[awayId] ?? props.factors.teams[awayId]?.profiles[profile];
    if (!homeProfile || !awayProfile) return null;
    return simulateGame({
      home: homeProfile,
      away: awayProfile,
      league: nbaWindow?.league ?? props.factors.league,
      homeAdvantagePoints: nbaWindow?.homeAdvantagePoints ?? props.factors.homeAdvantagePoints,
      paceSd: nbaWindow?.paceSd ?? props.factors.paceSd,
      leaguePace: nbaWindow?.leaguePace ?? props.factors.leaguePace,
      seed,
      homeEfgBump: nbaWindow?.homeEfgBump ?? props.factors.homeEfgBump,
    });
  }, [awayId, homeId, nbaWindow, profile, props, same, seed]);

  const baseline = useMemo(() => {
    if (same) return null;
    if (props.kind === "nba") {
      if (!nbaSim) return null;
      return marketsFromScores(nbaSim.homeScores, nbaSim.awayScores, 0, 200, nbaSim.marginHist, nbaSim.totalHist);
    }
    if (props.kind === "football") {
      const row = footballLeagues[league];
      if (!row?.teams[homeId] || !row.teams[awayId]) return null;
      return predictFootball(row, homeId, awayId, 0, 2.5);
    }
    if (props.kind === "nfl") {
      const view = pointsView(props.factors, activeWindow?.start ?? windowStart);
      if (!view.teams[homeId] || !view.teams[awayId]) return null;
      return predictPoints(view, homeId, awayId, 0, 40);
    }
    const view = runsView(props.factors, activeWindow?.start ?? windowStart);
    if (!view.teams[homeId] || !view.teams[awayId]) return null;
    return predictRuns(view, homeId, awayId, 1.5, 8.5);
  }, [activeWindow, awayId, footballLeagues, homeId, league, nbaSim, props, same, windowStart]);

  const spreadLine =
    customSpread ??
    (props.kind === "mlb"
      ? baseline && baseline.meanMargin < 0
        ? -1.5
        : 1.5
      : baseline
        ? halfLine(baseline.meanMargin)
        : 0);
  const totalLine = customTotal ?? (props.kind === "football" ? 2.5 : baseline ? halfLine(baseline.meanTotal) : 0);

  const result = useMemo(() => {
    if (!baseline || same) return null;
    if (props.kind === "nba") {
      if (!nbaSim) return null;
      return marketsFromScores(nbaSim.homeScores, nbaSim.awayScores, spreadLine, totalLine, nbaSim.marginHist, nbaSim.totalHist);
    }
    if (props.kind === "football") return predictFootball(footballLeagues[league], homeId, awayId, spreadLine, totalLine);
    if (props.kind === "nfl") return predictPoints(pointsView(props.factors, activeWindow?.start ?? windowStart), homeId, awayId, spreadLine, totalLine);
    return predictRuns(runsView(props.factors, activeWindow?.start ?? windowStart), homeId, awayId, spreadLine, totalLine);
  }, [activeWindow, awayId, baseline, footballLeagues, homeId, league, nbaSim, props, same, spreadLine, totalLine, windowStart]);

  const homeName = labelOf(props, homeId, nbaNames);
  const awayName = labelOf(props, awayId, nbaNames);
  const start = activeWindow?.start ?? windowStart;
  const homeGames = gamesInWindow(props, homeId, league, start, footballLeagues);
  const awayGames = gamesInWindow(props, awayId, league, start, footballLeagues);
  const copy = copyFor(props.kind);
  const listed = options;
  const defaultStart = defaultSeason(props);

  return (
    <>
      <header className="page-header">
        <p className="eyebrow">{copy.kicker}</p>
        <h1>{copy.title}</h1>
        <p className="lede">{copy.lede}</p>
      </header>

      <aside className={`callout ${props.backtest.beatsMarket ? "info" : "warning"}`}>
        <strong>{props.backtest.beatsMarket ? "Beats the closing line" : "Does not beat the closing line"}</strong>
        <p>{props.backtest.statement}</p>
      </aside>

      <section className="panel">
        <div className="matchup-grid">
          {props.kind === "football" ? (
            <label className="slider-block">
              <span>League</span>
              <select
                value={league}
                onChange={(event) => {
                  const next = event.target.value;
                  setLeague(next);
                  const nextIds = Object.entries(footballLeagues[next]?.teams ?? {})
                    .filter(([, team]) => team.active !== false)
                    .map(([name]) => name);
                  setAway(nextIds[0] ?? "");
                  setHome(nextIds[1] ?? nextIds[0] ?? "");
                  resetLines();
                }}
              >
                {leagues.map((code) => (
                  <option key={code} value={code}>
                    {footballLeagues[code].name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="slider-block">
            <span>Away</span>
            <select
              value={awayId}
              onChange={(event) => {
                setAway(event.target.value);
                resetLines();
              }}
            >
              {listed.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>
          <label className="slider-block">
            <span>Home</span>
            <select
              value={homeId}
              onChange={(event) => {
                setHome(event.target.value);
                resetLines();
              }}
            >
              {listed.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>
          {seasons.length > 0 ? (
            <label className="slider-block">
              <span>Seasons</span>
              <select
                value={activeWindow?.start ?? windowStart}
                onChange={(event) => {
                  setWindowStart(Number(event.target.value));
                  resetLines();
                }}
              >
                {seasons.map((choice) => (
                  <option key={choice.start} value={choice.start}>
                    {choice.label}
                    {choice.start === defaultStart ? " (default)" : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        <div className="matchup-grid line-grid">
          <label className="slider-block">
            <span>Spread line <span className="muted">positive means home lays</span></span>
            <input
              type="number"
              step="0.5"
              value={spreadLine}
              onChange={(event) => setCustomSpread(Number(event.target.value))}
            />
          </label>
          <label className="slider-block">
            <span>Total line</span>
            <input
              type="number"
              step="0.5"
              value={totalLine}
              onChange={(event) => setCustomTotal(Number(event.target.value))}
            />
          </label>
          <label className="slider-block">
            <span>Seed <span className="muted">blank uses {hashTeams(props.kind, league, awayId, homeId, String(start))}</span></span>
            <input
              value={seedText}
              inputMode="numeric"
              onChange={(event) => setSeedText(event.target.value.replace(/[^\d]/g, ""))}
            />
          </label>
        </div>
        {same ? <p className="small muted">Pick two different teams.</p> : null}
        {activeWindow ? (
          <p className="small muted">
            Active: {activeWindow.label}
            {start === defaultStart ? " (default)" : ""}. {activeWindow.games.toLocaleString("en-GB")} games in this window
            {homeGames != null && awayGames != null
              ? `. ${awayName} ${awayGames.toLocaleString("en-GB")} games, ${homeName} ${homeGames.toLocaleString("en-GB")} games`
              : ""}
            . A short sample shrinks toward the league.
            {activeWindow.backtest?.modelLogLoss != null
              ? ` On the current season this window's log loss is ${activeWindow.backtest.modelLogLoss.toFixed(4)} against the close at ${activeWindow.backtest.marketLogLoss?.toFixed(4)}.`
              : ""}
          </p>
        ) : null}
        {result ? <p className="small muted">{detailFor(props, awayId, homeId, profile, league, footballLeagues, start)}</p> : null}
      </section>

      {result ? (
        <>
          <div className="stat-row">
            <OutcomeStat label={`${homeName} win`} priced={result.home} />
            <OutcomeStat label={copy.draw} priced={result.draw} />
            <OutcomeStat label={`${awayName} win`} priced={result.away} />
            <div className="stat">
              <div className="stat-value">{result.meanTotal.toFixed(1)}</div>
              <div className="stat-label">Expected total {copy.unit}</div>
            </div>
          </div>

          <section className="panel">
            <div className="panel-head">
              <h2>Prices</h2>
              <span className="muted small">Probability, then fair odds, then minimum at fair × 1.05</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Market</th>
                    <th className="right">Probability</th>
                    <th className="right">Fair odds</th>
                    <th className="right">Minimum odds</th>
                  </tr>
                </thead>
                <tbody>
                  <PriceRow label={`${awayName} win`} priced={result.away} format={format} />
                  <PriceRow label={copy.draw} priced={result.draw} format={format} />
                  <PriceRow label={`${homeName} win`} priced={result.home} format={format} />
                  <PriceRow label={`Home ${spreadLine > 0 ? "-" : "+"}${Math.abs(spreadLine)}`} priced={result.spread.home} format={format} />
                  <PriceRow label={`Away ${spreadLine > 0 ? "+" : "-"}${Math.abs(spreadLine)}`} priced={result.spread.away} format={format} />
                  <PriceRow label={`Over ${totalLine}`} priced={result.total.over} format={format} />
                  <PriceRow label={`Under ${totalLine}`} priced={result.total.under} format={format} />
                </tbody>
              </table>
            </div>
            <p className="small muted">
              Spread push {pct(result.spread.push)}. Total push {pct(result.total.push)}. Expected margin {result.meanMargin.toFixed(1)} {copy.unit}.
              {props.kind === "nba" ? ` ${nbaSim?.n.toLocaleString("en-GB")} possessions, seed ${seed}.` : " The score model is deterministic for these ratings."}
            </p>
          </section>

          <section className="panel">
            <h2>Margin (home minus away)</h2>
            <Chart bins={result.marginHist} />
          </section>
          <section className="panel">
            <h2>Total {copy.unit}</h2>
            <Chart bins={result.totalHist} />
          </section>
        </>
      ) : null}

      <section className="panel">
        <div className="panel-head">
          <h2>Backtest vs the close</h2>
          <span className="muted small">Walk-forward file. The season menu is scored on the current season only. Lower Brier and log loss are better.</span>
        </div>
        <BacktestTable backtest={props.backtest} />
        {props.backtest.notes.map((note) => (
          <p className="small muted" key={note}>
            {note}
          </p>
        ))}
      </section>
    </>
  );
}

function hashTeams(kind: string, league: string, away: string, home: string, profile: string) {
  const text = `${kind}|${league}|${away}|${home}|${profile}`;
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function labelOf(props: Props, id: string, nbaNames: NbaFactors["teams"] | null) {
  if (nbaNames) return nbaNames[id]?.team ?? id;
  return props.names?.[id] ?? id;
}

function gamesInWindow(
  props: Props,
  id: string,
  leagueId: string,
  start: number,
  footballLeagues: Record<string, { teams: Record<string, { games: number }> }>,
) {
  if (props.kind === "football") return footballLeagues[leagueId]?.teams[id]?.games;
  if (props.kind === "nfl") return pointsView(props.factors, start).teams[id]?.games;
  if (props.kind === "mlb") return runsView(props.factors, start).teams[id]?.games;
  return props.nbaWindows?.choices.find((choice) => choice.start === start)?.teams[id]?.games;
}

function detailFor(
  props: Props,
  away: string,
  home: string,
  profile: "current" | "2025",
  leagueId: string,
  footballLeagues: Record<string, { teams: Record<string, { attack: number; defense: number }> }>,
  start: number,
) {
  if (props.kind === "football") {
    const row = footballLeagues[leagueId]?.teams[home];
    const awayRow = footballLeagues[leagueId]?.teams[away];
    if (!row || !awayRow) return "";
    return `${away} attack ${awayRow.attack.toFixed(2)} defense ${awayRow.defense.toFixed(2)}. ${home} attack ${row.attack.toFixed(2)} defense ${row.defense.toFixed(2)}.`;
  }
  if (props.kind === "nfl") {
    const factors = pointsView(props.factors, start);
    const homeTeam = factors.teams[home];
    const awayTeam = factors.teams[away];
    if (!homeTeam || !awayTeam) return "";
    return `${props.names?.[away] ?? away} scores ${awayTeam.off.toFixed(1)} and allows ${awayTeam.def.toFixed(1)} (${awayTeam.games} games in this window). ${props.names?.[home] ?? home} scores ${homeTeam.off.toFixed(1)} and allows ${homeTeam.def.toFixed(1)} (${homeTeam.games} games in this window). Home edge ${factors.homeAdvantage.toFixed(1)} points.`;
  }
  if (props.kind === "mlb") {
    const factors = runsView(props.factors, start);
    const homeTeam = factors.teams[home];
    const awayTeam = factors.teams[away];
    if (!homeTeam || !awayTeam) return "";
    return `${props.names?.[away] ?? away} attack ${awayTeam.attack.toFixed(2)} defense ${awayTeam.defense.toFixed(2)}. ${props.names?.[home] ?? home} attack ${homeTeam.attack.toFixed(2)} defense ${homeTeam.defense.toFixed(2)}.`;
  }
  if (props.kind !== "nba") return "";
  const windowTeams = props.nbaWindows?.choices.find((choice) => choice.start === start)?.teams;
  const homeProfile: TeamProfile | undefined = windowTeams?.[home] ?? props.factors.teams[home]?.profiles[profile];
  const awayProfile: TeamProfile | undefined = windowTeams?.[away] ?? props.factors.teams[away]?.profiles[profile];
  if (!homeProfile || !awayProfile) return "";
  return `${props.factors.teams[away]?.team ?? away} pace ${awayProfile.pace.toFixed(1)}, eFG ${(awayProfile.off.efg * 100).toFixed(1)}%. ${props.factors.teams[home]?.team ?? home} pace ${homeProfile.pace.toFixed(1)}, eFG ${(homeProfile.off.efg * 100).toFixed(1)}%.`;
}

function copyFor(kind: Props["kind"]) {
  if (kind === "football") {
    return {
      kicker: "Football",
      title: "Match simulator",
      lede: "Dixon-Coles goals for the eight leagues. The season menu chooses which seasons feed the ratings, and a short sample shrinks toward the league. Win, draw, and loss come from the score matrix, then the goal line and the 2.5 total. Probability is shown before the fair price and the minimum price.",
      draw: "Draw",
      unit: "goals",
    };
  }
  if (kind === "nfl") {
    return {
      kicker: "NFL",
      title: "Game simulator",
      lede: "Points model. The season menu chooses which seasons feed the ratings, shrunk toward that window's league average. There is no quarterback or injury input. Margin and total are normal, so a tie is possible. The spread is positive when the home team lays points.",
      draw: "Tie",
      unit: "points",
    };
  }
  if (kind === "mlb") {
    return {
      kicker: "MLB",
      title: "Game simulator",
      lede: "Runs model. The season menu chooses which seasons feed the ratings, shrunk toward that window's league average. Each team’s runs are Poisson. A regulation tie is broken by one extra run, with the home share fit on past games. The run line is positive when the home team lays runs.",
      draw: "Tie",
      unit: "runs",
    };
  }
  return {
    kicker: "NBA",
    title: "Game simulator",
    lede: "5,000 possessions from pace, eFG%, turnovers, offensive rebounds, and free-throw rate, plus home court. The season menu chooses which seasons feed those ratings, and a short sample shrinks toward the league. The spread and total are counted from those games. Probability is shown before the fair price and the minimum price.",
    draw: "Tie",
    unit: "points",
  };
}

function OutcomeStat({ label, priced }: { label: string; priced: Priced }) {
  return (
    <div className="stat">
      <div className="stat-value">{pct(priced.probability)}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function PriceRow({ label, priced, format }: { label: string; priced: Priced; format: "decimal" | "american" }) {
  return (
    <tr>
      <td>{label}</td>
      <td className="right">{pct(priced.probability)}</td>
      <td className="right">{formatDisplayedOdds(priced.fairDecimal, format)}</td>
      <td className="right">{formatDisplayedOdds(priced.minimumDecimal, format)}</td>
    </tr>
  );
}

function Chart({ bins }: { bins: HistBin[] }) {
  const max = Math.max(...bins.map((bin) => bin.pct), 0.001);
  return (
    <div className="bar-chart">
      {bins.map((bin) => (
        <div className="bar-row" key={bin.label}>
          <span className="bar-label">{bin.label}</span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${(bin.pct / max) * 100}%` }} />
          </span>
          <span className="bar-value">{pct(bin.pct)}</span>
        </div>
      ))}
    </div>
  );
}

function BacktestTable({ backtest }: { backtest: SimBacktest }) {
  const rows = Object.entries(backtest.markets);
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Market</th>
            <th className="right">Games</th>
            <th className="right">Model Brier</th>
            <th className="right">Market Brier</th>
            <th className="right">Model log loss</th>
            <th className="right">Market log loss</th>
            <th className="right">5% bets</th>
            <th className="right">ROI</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, block]) => (
            <tr key={name}>
              <td>{name}</td>
              <td className="right">{block.games.toLocaleString("en-GB")}</td>
              <td className="right">{block.model.brier?.toFixed(4) ?? "—"}</td>
              <td className="right">{block.market.brier?.toFixed(4) ?? "—"}</td>
              <td className="right">{block.model.logLoss?.toFixed(4) ?? "—"}</td>
              <td className="right">{block.market.logLoss?.toFixed(4) ?? "—"}</td>
              <td className="right">{block.roiEdge5.bets.toLocaleString("en-GB")}</td>
              <td className="right">{formatRoi(block.roiEdge5.roi)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
