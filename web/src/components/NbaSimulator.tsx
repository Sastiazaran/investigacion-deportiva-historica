"use client";

import { useMemo, useState } from "react";
import { formatRoi, formatWinPct } from "../lib/metrics";
import type { NbaBacktest, NbaFactors } from "../lib/load-nba-sim";
import { decimalToAmerican } from "../lib/odds-format";
import {
  SIMS,
  hashSeed,
  minimumDecimal,
  simulateGame,
  type HistBin,
  type TeamProfile,
} from "../lib/nba-sim";

type ProfileId = "current" | "2025";

const PROFILES: { id: ProfileId; label: string }[] = [
  { id: "current", label: "Current (2026-27, shrunk)" },
  { id: "2025", label: "2025-26 season" },
];

function pct(probability: number) {
  return formatWinPct(probability * 100);
}

function points(value: number) {
  return value.toFixed(1);
}

function pricePair(probability: number) {
  const decimal = minimumDecimal(probability);
  if (decimal == null) return { decimal: "—", american: "—" };
  return { decimal: decimal.toFixed(2), american: decimalToAmerican(decimal) };
}

function Hist({ bins }: { bins: HistBin[] }) {
  const max = Math.max(...bins.map((bin) => bin.count), 1);
  return (
    <div className="bar-chart">
      {bins.map((bin) => (
        <div className="bar-row" key={bin.label}>
          <span className="bar-label">{bin.label}</span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${(bin.count / max) * 100}%` }} />
          </span>
          <span className="bar-value">{pct(bin.pct)}</span>
        </div>
      ))}
    </div>
  );
}

function FactorLine({ label, profile }: { label: string; profile: TeamProfile }) {
  const off = profile.off;
  return (
    <p className="small muted">
      <strong>{label}</strong>
      {` offense · pace ${profile.pace.toFixed(1)} · eFG ${(off.efg * 100).toFixed(1)}% · TOV ${(off.tov * 100).toFixed(1)}% · OREB ${(off.oreb * 100).toFixed(1)}% · FT rate ${(off.ftr * 100).toFixed(1)}`}
      {profile.priorGames > 0
        ? ` · ${profile.games} game${profile.games === 1 ? "" : "s"} this season, shrunk with ${profile.priorGames} games of last season`
        : ` · ${profile.games} games`}
    </p>
  );
}

export default function NbaSimulator({ factors, backtest }: { factors: NbaFactors; backtest: NbaBacktest }) {
  const teams = useMemo(
    () => Object.values(factors.teams).sort((a, b) => a.team.localeCompare(b.team)),
    [factors.teams],
  );
  const [profileId, setProfileId] = useState<ProfileId>("current");
  const [away, setAway] = useState("okc");
  const [home, setHome] = useState("sa");
  const [seedText, setSeedText] = useState("");
  const autoSeed = hashSeed(`${profileId}|${away}|${home}`);
  const seed = seedText.trim() === "" ? autoSeed : Number(seedText) >>> 0;
  const awayProfile = factors.teams[away]?.profiles[profileId];
  const homeProfile = factors.teams[home]?.profiles[profileId];
  const sameTeam = away === home;
  const result = useMemo(() => {
    if (sameTeam || !awayProfile || !homeProfile) return null;
    return simulateGame({
      home: homeProfile,
      away: awayProfile,
      league: factors.league,
      homeAdvantagePoints: factors.homeAdvantagePoints,
      paceSd: factors.paceSd,
      leaguePace: factors.leaguePace,
      n: SIMS,
      seed,
      homeEfgBump: factors.homeEfgBump,
    });
  }, [awayProfile, factors, homeProfile, sameTeam, seed]);

  const homePrice = result ? pricePair(result.homeWinPct) : null;
  const awayPrice = result ? pricePair(result.awayWinPct) : null;
  const currentSeason = factors.coverage["2026"];

  return (
    <>
      <header className="page-header">
        <h1>NBA game simulator</h1>
        <p className="lede">
          {SIMS.toLocaleString("en-GB")} possessions per game, from team pace, eFG%, turnover rate,
          offensive rebound rate, and free-throw rate, plus home court. Pick a matchup and compare
          the minimum price with Playdoit. The minimum is the model&apos;s fair decimal odds times 1.05.
        </p>
      </header>

      <aside className={`callout ${backtest.beatsMarket ? "info" : "warning"}`}>
        <strong>{backtest.beatsMarket ? "Backtest" : "Does not beat the closing line"}</strong>
        <p>{backtest.statement}</p>
      </aside>

      <section className="panel">
        <div className="matchup-grid">
          <label className="slider-block">
            <span>Away</span>
            <select value={away} onChange={(event) => setAway(event.target.value)}>
              {teams.map((team) => (
                <option key={team.abbrev} value={team.abbrev}>
                  {team.team}
                </option>
              ))}
            </select>
          </label>
          <label className="slider-block">
            <span>Home</span>
            <select value={home} onChange={(event) => setHome(event.target.value)}>
              {teams.map((team) => (
                <option key={team.abbrev} value={team.abbrev}>
                  {team.team}
                </option>
              ))}
            </select>
          </label>
          <label className="slider-block">
            <span>Ratings</span>
            <select value={profileId} onChange={(event) => setProfileId(event.target.value as ProfileId)}>
              {PROFILES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="slider-block seed-field">
          <span>Seed <span className="muted">blank uses {autoSeed}</span></span>
          <input
            value={seedText}
            inputMode="numeric"
            placeholder={String(autoSeed)}
            onChange={(event) => setSeedText(event.target.value.replace(/[^\d]/g, ""))}
          />
        </label>
        {sameTeam ? <p className="small muted">Pick two different teams.</p> : null}
        {awayProfile ? <FactorLine label={factors.teams[away].team} profile={awayProfile} /> : null}
        {homeProfile ? <FactorLine label={factors.teams[home].team} profile={homeProfile} /> : null}
      </section>

      {result && homePrice && awayPrice ? (
        <>
          <div className="stat-row">
            <div className="stat info">
              <div className="stat-value">{pct(result.homeWinPct)}</div>
              <div className="stat-label">{factors.teams[home].team} win</div>
            </div>
            <div className="stat">
              <div className="stat-value">{pct(result.awayWinPct)}</div>
              <div className="stat-label">{factors.teams[away].team} win</div>
            </div>
            <div className="stat">
              <div className="stat-value">{points(result.margin.mean)}</div>
              <div className="stat-label">Mean home margin</div>
            </div>
            <div className="stat">
              <div className="stat-value">{points(result.total.mean)}</div>
              <div className="stat-label">Mean total</div>
            </div>
          </div>

          <section className="panel">
            <div className="panel-head">
              <h2>Minimum price to bet</h2>
              <span className="muted small">fair × 1.05 · compare with Playdoit</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Side</th>
                    <th className="right">Win %</th>
                    <th className="right">Fair decimal</th>
                    <th className="right">Minimum decimal</th>
                    <th className="right">Minimum American</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{factors.teams[away].team}</td>
                    <td className="right">{pct(result.awayWinPct)}</td>
                    <td className="right">{result.awayWinPct > 0 ? (1 / result.awayWinPct).toFixed(2) : "—"}</td>
                    <td className="right">{awayPrice.decimal}</td>
                    <td className="right">{awayPrice.american}</td>
                  </tr>
                  <tr>
                    <td>{factors.teams[home].team}</td>
                    <td className="right">{pct(result.homeWinPct)}</td>
                    <td className="right">{result.homeWinPct > 0 ? (1 / result.homeWinPct).toFixed(2) : "—"}</td>
                    <td className="right">{homePrice.decimal}</td>
                    <td className="right">{homePrice.american}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="small muted">
              Seed {result.seed}. {SIMS.toLocaleString("en-GB")} sims. Home-court shift is {factors.homeAdvantagePoints.toFixed(1)} points
              ({(factors.homeEfgBump * 100).toFixed(2)} eFG points each way), from the 2025-26 regular season.
              Ties after four overtimes: {pct(result.tiePct)}.
            </p>
          </section>

          <section className="panel">
            <h2>Margin (home minus away)</h2>
            <Hist bins={result.marginHist} />
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th></th>
                    <th className="right">Mean</th>
                    <th className="right">p10</th>
                    <th className="right">p25</th>
                    <th className="right">p50</th>
                    <th className="right">p75</th>
                    <th className="right">p90</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Margin</td>
                    <td className="right">{points(result.margin.mean)}</td>
                    <td className="right">{points(result.margin.p10)}</td>
                    <td className="right">{points(result.margin.p25)}</td>
                    <td className="right">{points(result.margin.p50)}</td>
                    <td className="right">{points(result.margin.p75)}</td>
                    <td className="right">{points(result.margin.p90)}</td>
                  </tr>
                  <tr>
                    <td>Total</td>
                    <td className="right">{points(result.total.mean)}</td>
                    <td className="right">{points(result.total.p10)}</td>
                    <td className="right">{points(result.total.p25)}</td>
                    <td className="right">{points(result.total.p50)}</td>
                    <td className="right">{points(result.total.p75)}</td>
                    <td className="right">{points(result.total.p90)}</td>
                  </tr>
                  <tr>
                    <td>{factors.teams[home].team}</td>
                    <td className="right">{points(result.homePoints.mean)}</td>
                    <td className="right">{points(result.homePoints.p10)}</td>
                    <td className="right">{points(result.homePoints.p25)}</td>
                    <td className="right">{points(result.homePoints.p50)}</td>
                    <td className="right">{points(result.homePoints.p75)}</td>
                    <td className="right">{points(result.homePoints.p90)}</td>
                  </tr>
                  <tr>
                    <td>{factors.teams[away].team}</td>
                    <td className="right">{points(result.awayPoints.mean)}</td>
                    <td className="right">{points(result.awayPoints.p10)}</td>
                    <td className="right">{points(result.awayPoints.p25)}</td>
                    <td className="right">{points(result.awayPoints.p50)}</td>
                    <td className="right">{points(result.awayPoints.p75)}</td>
                    <td className="right">{points(result.awayPoints.p90)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <h2>Total</h2>
            <Hist bins={result.totalHist} />
          </section>
        </>
      ) : null}

      <section className="panel">
        <div className="panel-head">
          <h2>2025-26 backtest vs the close</h2>
          <span className="muted small">{backtest.n.toLocaleString("en-GB")} sims, walk-forward</span>
        </div>
        <BacktestTable backtest={backtest} />
        <p className="small muted">
          {backtest.repoMoneylineGap}
          {backtest.closeSources
            ? ` Closes used: ${Object.entries(backtest.closeSources)
                .map(([name, count]) => `${name} ${count}`)
                .join(", ")}.`
            : ""}
        </p>
        <p className="small muted">
          2026-27 box scores in this build: {currentSeason?.games ?? 0}
          {currentSeason?.to ? ` through ${currentSeason.to}` : ""}. Play-by-play kept{" "}
          {factors.pbp.keptGames ?? 0} of {factors.pbp.requestedGames ?? 0} sampled games
          {factors.pbp.pointsPerPossession != null ? ` (${factors.pbp.pointsPerPossession.toFixed(3)} points per possession)` : ""}.
          {" "}{factors.pbp.note}
        </p>
      </section>

      <p className="muted small">
        {factors.sources.join(" ")} Player usage, shot zones, minutes, and props are not simulated here.
      </p>
    </>
  );
}

function BacktestTable({ backtest }: { backtest: NbaBacktest }) {
  const rows = [
    ["All closes", backtest.full],
    ["Through 2026-02-12", backtest.through2026_02_12],
    ["After 2026-02-12", backtest.after2026_02_12],
  ] as const;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Sample</th>
            <th className="right">Games</th>
            <th className="right">Model Brier</th>
            <th className="right">Market Brier</th>
            <th className="right">Model log loss</th>
            <th className="right">Market log loss</th>
            <th className="right">5% edge bets</th>
            <th className="right">ROI</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, block]) => (
            <tr key={label}>
              <td>{label}</td>
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
