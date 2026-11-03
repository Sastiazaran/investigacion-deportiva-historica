"use client";

import { useMemo, useState } from "react";
import { formatRoi, formatWinPct } from "../lib/metrics";
import { simulateGame, type TeamProfile } from "../lib/nba-sim";
import { formatDisplayedOdds } from "../lib/odds-format";
import {
  predictFootball,
  predictPoints,
  predictRuns,
  type FootballFactors,
  type PointsFactors,
  type RunsFactors,
} from "../lib/predict";
import { halfLine, marketsFromScores, type HistBin, type Priced, type SimOutput } from "../lib/sim-markets";
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

type Props =
  | (Common & { kind: "football"; factors: FootballFactors })
  | (Common & { kind: "nfl" | "mlb"; factors: PointsFactors | RunsFactors })
  | (Common & { kind: "nba"; factors: NbaFactors });

function pct(probability: number) {
  return formatWinPct(probability * 100);
}

function teamOptions(ids: string[], names: Record<string, string> | undefined) {
  return ids
    .map((id) => ({ id, name: names?.[id] ?? id }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function preferred(ids: string[], candidates: string[]) {
  for (const id of candidates) {
    if (ids.includes(id)) return id;
  }
  return ids[0] ?? "";
}

export default function MatchSimulator(props: Props) {
  const { format } = useOddsFormat();
  const leagues = props.kind === "football" ? LEAGUE_ORDER.filter((code) => props.factors.leagues[code]) : [];
  const [league, setLeague] = useState(leagues[0] ?? "");
  const ids = useMemo(() => {
    if (props.kind === "football") {
      return Object.entries(props.factors.leagues[league]?.teams ?? {})
        .filter(([, team]) => team.active !== false)
        .map(([name]) => name);
    }
    if (props.kind === "nba") return Object.keys(props.factors.teams);
    return Object.keys(props.factors.teams);
  }, [league, props]);
  const options = teamOptions(ids, props.kind === "nba" ? undefined : props.names);
  const nbaNames = props.kind === "nba" ? props.factors.teams : null;
  const [away, setAway] = useState(() =>
    preferred(ids, props.kind === "football" ? ["Arsenal", "Liverpool"] : props.kind === "nba" ? ["okc"] : props.kind === "nfl" ? ["KC"] : ["NYY"]),
  );
  const [home, setHome] = useState(() =>
    preferred(ids, props.kind === "football" ? ["Chelsea", "Manchester City"] : props.kind === "nba" ? ["sa"] : props.kind === "nfl" ? ["BUF"] : ["LAD"]),
  );
  const [profile, setProfile] = useState<"current" | "2025">("current");
  const [seedText, setSeedText] = useState("");
  const [customSpread, setCustomSpread] = useState<number | null>(null);
  const [customTotal, setCustomTotal] = useState<number | null>(null);
  const seed = seedText.trim() === "" ? hashTeams(props.kind, league, away, home, profile) : Number(seedText) >>> 0;
  const same = away === home;

  function resetLines() {
    setCustomSpread(null);
    setCustomTotal(null);
  }

  const nbaSim = useMemo(() => {
    if (props.kind !== "nba" || same) return null;
    const homeProfile = props.factors.teams[home]?.profiles[profile];
    const awayProfile = props.factors.teams[away]?.profiles[profile];
    if (!homeProfile || !awayProfile) return null;
    return simulateGame({
      home: homeProfile,
      away: awayProfile,
      league: props.factors.league,
      homeAdvantagePoints: props.factors.homeAdvantagePoints,
      paceSd: props.factors.paceSd,
      leaguePace: props.factors.leaguePace,
      seed,
      homeEfgBump: props.factors.homeEfgBump,
    });
  }, [away, home, profile, props, same, seed]);

  const baseline = useMemo(() => {
    if (same) return null;
    if (props.kind === "nba") {
      if (!nbaSim) return null;
      return marketsFromScores(nbaSim.homeScores, nbaSim.awayScores, 0, 200, nbaSim.marginHist, nbaSim.totalHist);
    }
    if (props.kind === "football") {
      const row = props.factors.leagues[league];
      if (!row?.teams[home] || !row.teams[away]) return null;
      return predictFootball(row, home, away, 0, 2.5);
    }
    if (props.kind === "nfl") return predictPoints(props.factors as PointsFactors, home, away, 0, 40);
    return predictRuns(props.factors as RunsFactors, home, away, 1.5, 8.5);
  }, [away, home, league, nbaSim, props, same]);

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
    if (props.kind === "nba" && nbaSim) {
      return marketsFromScores(nbaSim.homeScores, nbaSim.awayScores, spreadLine, totalLine, nbaSim.marginHist, nbaSim.totalHist);
    }
    if (props.kind === "football") return predictFootball(props.factors.leagues[league], home, away, spreadLine, totalLine);
    if (props.kind === "nfl") return predictPoints(props.factors as PointsFactors, home, away, spreadLine, totalLine);
    return predictRuns(props.factors as RunsFactors, home, away, spreadLine, totalLine);
  }, [away, baseline, home, league, nbaSim, props, same, spreadLine, totalLine]);

  const homeName = labelOf(props, home, nbaNames);
  const awayName = labelOf(props, away, nbaNames);
  const copy = copyFor(props.kind);
  const listed = props.kind === "nba" && nbaNames
    ? Object.values(nbaNames).map((team) => ({ id: team.abbrev, name: team.team })).sort((a, b) => a.name.localeCompare(b.name))
    : options;

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
                  const nextIds = Object.keys(props.factors.leagues[next]?.teams ?? {});
                  setAway(nextIds[0] ?? "");
                  setHome(nextIds[1] ?? nextIds[0] ?? "");
                  resetLines();
                }}
              >
                {leagues.map((code) => (
                  <option key={code} value={code}>
                    {props.factors.leagues[code].name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="slider-block">
            <span>Away</span>
            <select
              value={away}
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
              value={home}
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
          {props.kind === "nba" ? (
            <label className="slider-block">
              <span>Ratings</span>
              <select value={profile} onChange={(event) => setProfile(event.target.value as "current" | "2025")}>
                <option value="current">Current season, shrunk</option>
                <option value="2025">2025-26 season</option>
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
            <span>Seed <span className="muted">blank uses {hashTeams(props.kind, league, away, home, profile)}</span></span>
            <input
              value={seedText}
              inputMode="numeric"
              onChange={(event) => setSeedText(event.target.value.replace(/[^\d]/g, ""))}
            />
          </label>
        </div>
        {same ? <p className="small muted">Pick two different teams.</p> : null}
        {result ? <p className="small muted">{detailFor(props, away, home, profile, league)}</p> : null}
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
          <span className="muted small">Walk-forward. Lower Brier and log loss are better.</span>
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

function detailFor(props: Props, away: string, home: string, profile: "current" | "2025", leagueId: string) {
  if (props.kind === "football") {
    const row = props.factors.leagues[leagueId]?.teams[home];
    const awayRow = props.factors.leagues[leagueId]?.teams[away];
    if (!row || !awayRow) return "";
    return `${away} attack ${awayRow.attack.toFixed(2)} defense ${awayRow.defense.toFixed(2)}. ${home} attack ${row.attack.toFixed(2)} defense ${row.defense.toFixed(2)}.`;
  }
  if (props.kind === "nfl") {
    const factors = props.factors as PointsFactors;
    const homeTeam = factors.teams[home];
    const awayTeam = factors.teams[away];
    const games = (team: { seasonGames?: number; games: number }) =>
      team.seasonGames != null ? `${team.seasonGames} games this season, shrunk toward last season` : `${team.games} games`;
    return `${props.names?.[away] ?? away} scores ${awayTeam.off.toFixed(1)} and allows ${awayTeam.def.toFixed(1)} (${games(awayTeam)}). ${props.names?.[home] ?? home} scores ${homeTeam.off.toFixed(1)} and allows ${homeTeam.def.toFixed(1)} (${games(homeTeam)}). Home edge ${factors.homeAdvantage.toFixed(1)} points.`;
  }
  if (props.kind === "mlb") {
    const factors = props.factors as RunsFactors;
    const homeTeam = factors.teams[home];
    const awayTeam = factors.teams[away];
    return `${props.names?.[away] ?? away} attack ${awayTeam.attack.toFixed(2)} defense ${awayTeam.defense.toFixed(2)}. ${props.names?.[home] ?? home} attack ${homeTeam.attack.toFixed(2)} defense ${homeTeam.defense.toFixed(2)}.`;
  }
  if (props.kind !== "nba") return "";
  const homeProfile: TeamProfile | undefined = props.factors.teams[home]?.profiles[profile];
  const awayProfile: TeamProfile | undefined = props.factors.teams[away]?.profiles[profile];
  if (!homeProfile || !awayProfile) return "";
  return `${props.factors.teams[away].team} pace ${awayProfile.pace.toFixed(1)}, eFG ${(awayProfile.off.efg * 100).toFixed(1)}%. ${props.factors.teams[home].team} pace ${homeProfile.pace.toFixed(1)}, eFG ${(homeProfile.off.efg * 100).toFixed(1)}%.`;
}

function copyFor(kind: Props["kind"]) {
  if (kind === "football") {
    return {
      kicker: "Football",
      title: "Match simulator",
      lede: "Dixon-Coles goals for the eight leagues. Win, draw, and loss come from the score matrix, then the goal line and the 2.5 total. Probability is shown before the fair price and the minimum price.",
      draw: "Draw",
      unit: "goals",
    };
  }
  if (kind === "nfl") {
    return {
      kicker: "NFL",
      title: "Game simulator",
      lede: "Points model. Each team is this season's scoring, shrunk toward last season. There is no quarterback or injury input. Margin and total are normal, so a tie is possible. The spread is positive when the home team lays points.",
      draw: "Tie",
      unit: "points",
    };
  }
  if (kind === "mlb") {
    return {
      kicker: "MLB",
      title: "Game simulator",
      lede: "Runs model. Each team’s runs are Poisson. A regulation tie is broken by one extra run, with the home share fit on past games. The run line is positive when the home team lays runs.",
      draw: "Tie",
      unit: "runs",
    };
  }
  return {
    kicker: "NBA",
    title: "Game simulator",
    lede: "5,000 possessions from pace, eFG%, turnovers, offensive rebounds, and free-throw rate, plus home court. The spread and total are counted from those games. Probability is shown before the fair price and the minimum price.",
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
