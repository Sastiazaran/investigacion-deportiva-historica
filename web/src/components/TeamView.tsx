"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { clamp, formatPeriodLabel, formatSeasonPart } from "../lib/analysis";
import {
  combineSplits,
  formatAvgOdds,
  formatProfit,
  formatRoi,
  formatWinPct,
  roiClass,
} from "../lib/metrics";
import type { SplitStats, TeamSummary } from "../lib/types";
import YearRange from "./YearRange";

type Props = {
  team: TeamSummary;
};

function recordLine(split: SplitStats) {
  if (split.played === 0) return "No matches";
  return `${split.won}-${split.drawn}-${split.lost}`;
}

function SplitCard({ title, split }: { title: string; split: SplitStats }) {
  return (
    <div className="stat">
      <div className="stat-label">{title}</div>
      <div className={`stat-value ${roiClass(split.roi)}`}>{formatRoi(split.roi)}</div>
      <p className="muted small">
        Win {formatWinPct(split.winPct)} ({recordLine(split)})
        <br />
        {split.bets} bets at avg {formatAvgOdds(split.avgOdds)}
        <br />
        Profit {formatProfit(split.profit)} units
      </p>
    </div>
  );
}

export default function TeamView({ team }: Props) {
  const minYear = team.seasons[0]?.season ?? 2000;
  const maxYear = team.seasons[team.seasons.length - 1]?.season ?? minYear;
  const [startYear, setStartYear] = useState(minYear);
  const [endYear, setEndYear] = useState(maxYear);

  const inRange = useMemo(
    () => team.seasons.filter((row) => row.season >= startYear && row.season <= endYear),
    [team.seasons, startYear, endYear],
  );
  const overall = useMemo(
    () => combineSplits(inRange.map((row) => row.overall)),
    [inRange],
  );
  const home = useMemo(() => combineSplits(inRange.map((row) => row.home)), [inRange]);
  const away = useMemo(() => combineSplits(inRange.map((row) => row.away)), [inRange]);

  const verdict = useMemo(() => {
    if (overall.bets === 0 || overall.roi == null) {
      return `${team.club} has no closing price in this range, so ROI is not defined. Win% still counts every completed match.`;
    }
    const made = overall.roi > 0 ? "made money" : "lost money";
    const homeBit =
      home.bets > 0 && home.avgOdds != null
        ? ` At home the average closing price was ${home.avgOdds.toFixed(2)} (${formatRoi(home.roi)} ROI).`
        : "";
    return `Always betting ${team.club} to win at the closing price — ${overall.bets} bets, average ${formatAvgOdds(overall.avgOdds)} — ${made}: ${formatRoi(overall.roi)} ROI, ${formatProfit(overall.profit)} units.${homeBit}`;
  }, [home, overall, team.club]);

  return (
    <>
      <p className="muted small">
        <Link href="/">All clubs</Link>
      </p>
      <header className="page-header">
        <h1>{team.club}</h1>
        <p className="lede">
          {team.leagues.join(", ")}. Home and away records are split, and ROI is a
          flat 1-unit bet on the team to win at its closing decimal odds (Pinnacle
          closing, else Pinnacle, else Bet365). {formatPeriodLabel(startYear, endYear)}.
        </p>
      </header>

      <section className="panel">
        <YearRange
          minYear={minYear}
          maxYear={maxYear}
          startYear={startYear}
          endYear={endYear}
          onStartYear={(year) => setStartYear(clamp(year, minYear, endYear))}
          onEndYear={(year) => setEndYear(clamp(year, startYear, maxYear))}
        />
      </section>

      <aside className={`callout ${overall.roi != null && overall.roi < 0 ? "danger" : "info"}`}>
        <strong>Flat-bet result</strong>
        <p>{verdict}</p>
      </aside>

      <section className="split-grid">
        <SplitCard title="Overall ROI" split={overall} />
        <SplitCard title="Home ROI" split={home} />
        <SplitCard title="Away ROI" split={away} />
      </section>

      <h2>By season</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Season</th>
              <th>League</th>
              <th className="right">Win %</th>
              <th className="right">Home</th>
              <th className="right">Away</th>
              <th className="right">Bets</th>
              <th className="right">Avg odds</th>
              <th className="right">Profit</th>
              <th className="right">ROI</th>
            </tr>
          </thead>
          <tbody>
            {inRange.map((row) => (
              <tr key={row.season}>
                <td>{formatSeasonPart(row.season)}</td>
                <td className="muted">{row.league}</td>
                <td className="right">{formatWinPct(row.overall.winPct)}</td>
                <td className="right">
                  {formatWinPct(row.home.winPct)}
                  <span className="muted"> ({row.home.won}/{row.home.played})</span>
                </td>
                <td className="right">
                  {formatWinPct(row.away.winPct)}
                  <span className="muted"> ({row.away.won}/{row.away.played})</span>
                </td>
                <td className="right">{row.overall.bets}</td>
                <td className="right">{formatAvgOdds(row.overall.avgOdds)}</td>
                <td className={`right ${roiClass(row.overall.profit)}`}>
                  {formatProfit(row.overall.profit)}
                </td>
                <td className={`right ${roiClass(row.overall.roi)}`}>
                  {formatRoi(row.overall.roi)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Home and away cells are wins/played at that venue. Profit is in units
        staked at 1.00 per bet. Seasons with 0 bets had results but no closing price.
      </p>
    </>
  );
}
