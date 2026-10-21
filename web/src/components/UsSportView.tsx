"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatRoi, formatWinPct, roiClass } from "../lib/metrics";
import { formatDisplayedOdds, withOddsQuery } from "../lib/odds-format";
import { combineAtsBook, combineMlBook, seasonSpread } from "../lib/us-metrics";
import {
  seasonLabel,
  sportLabel,
  spreadLabel,
  type UsSport,
  type UsSummary,
} from "../lib/us-types";
import { useOddsFormat } from "./OddsFormatProvider";

type Phase = "regular" | "playoff" | "other";

const PHASES: { id: Phase; label: string }[] = [
  { id: "regular", label: "Regular season" },
  { id: "playoff", label: "Playoffs" },
  { id: "other", label: "Other" },
];

export default function UsSportView({ sport, summary }: { sport: UsSport; summary: UsSummary }) {
  const { format } = useOddsFormat();
  const available = PHASES.filter((phase) => summary.teams.some((team) => team.phases[phase.id]));
  const [phase, setPhase] = useState<Phase>("regular");
  const seasons = useMemo(() => {
    const years = new Set<number>();
    for (const team of summary.teams) {
      for (const row of team.phases[phase]?.seasons ?? []) years.add(row.season);
    }
    return [...years].sort((a, b) => a - b);
  }, [phase, summary.teams]);
  const [start, setStart] = useState(seasons[0] ?? 2000);
  const [end, setEnd] = useState(seasons[seasons.length - 1] ?? 2000);
  const market = summary.spreadMarket;
  const marketName = spreadLabel(market);

  const rows = useMemo(() => {
    return summary.teams
      .map((team) => {
        const block = team.phases[phase];
        const picked = (block?.seasons ?? []).filter((row) => row.season >= start && row.season <= end);
        const moneyline = combineMlBook(picked.map((row) => row.moneyline));
        const spread = market ? combineAtsBook(picked.map((row) => seasonSpread(row, market)).filter((row) => row != null)) : null;
        return { team, moneyline, spread };
      })
      .filter((row) => row.moneyline.overall.played > 0)
      .sort((a, b) => (b.moneyline.overall.winPct ?? -1) - (a.moneyline.overall.winPct ?? -1));
  }, [end, market, phase, start, summary.teams]);

  return (
    <>
      <header className="page-header">
        <h1>{sportLabel(sport)}</h1>
        <p className="lede">
          Flat 1-unit closing moneyline, split by home and away
          {marketName ? ` and ${marketName}` : ""}. Regular season and playoffs are separate.
          Prices stay decimal in the math. {seasonLabel(sport, start)} – {seasonLabel(sport, end)}.
        </p>
        {sport === "nba" ? (
          <p className="lede">
            <Link href={withOddsQuery("/nba/simulator", format)}>Game simulator</Link>
            {" "}for one matchup: 5,000 possessions, win probability, and a minimum price at fair odds times 1.05.
          </p>
        ) : null}
      </header>

      <div className="preset-row">
        {available.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`chip ${phase === item.id ? "active" : ""}`}
            onClick={() => {
              setPhase(item.id);
              const years = summary.teams.flatMap((team) => team.phases[item.id]?.seasons.map((row) => row.season) ?? []);
              if (years.length) {
                setStart(Math.min(...years));
                setEnd(Math.max(...years));
              }
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      <section className="panel">
        <div className="sliders">
          <label className="slider-block">
            <span>From <strong>{seasonLabel(sport, start)}</strong></span>
            <select value={start} onChange={(event) => setStart(Number(event.target.value))}>
              {seasons.map((year) => (
                <option key={year} value={year}>{seasonLabel(sport, year)}</option>
              ))}
            </select>
          </label>
          <label className="slider-block">
            <span>Through <strong>{seasonLabel(sport, end)}</strong></span>
            <select value={end} onChange={(event) => setEnd(Number(event.target.value))}>
              {seasons.map((year) => (
                <option key={year} value={year}>{seasonLabel(sport, year)}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Team</th>
              <th className="right">Played</th>
              <th className="right">Win %</th>
              <th className="right">ML bets</th>
              <th className="right">Pushes</th>
              <th className="right">Avg odds</th>
              <th className="right">ML ROI</th>
              {marketName ? (
                <>
                  <th className="right">{marketName} bets</th>
                  <th className="right">Cover %</th>
                  <th className="right">Pushes</th>
                  <th className="right">{marketName} ROI</th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const ml = row.moneyline.overall;
              const spread = row.spread?.overall;
              return (
                <tr key={row.team.abbrev}>
                  <td>
                    <Link className="club-link" href={withOddsQuery(`/${sport}/team/${row.team.slug}`, format)}>
                      {row.team.team}
                    </Link>
                  </td>
                  <td className="right">{ml.played.toLocaleString("en-GB")}</td>
                  <td className="right">{formatWinPct(ml.winPct)}</td>
                  <td className="right">{ml.bets.toLocaleString("en-GB")}</td>
                  <td className="right">{ml.pushes}</td>
                  <td className="right">{formatDisplayedOdds(ml.avgOdds, format)}</td>
                  <td className={`right ${roiClass(ml.roi)}`}>{formatRoi(ml.roi)}</td>
                  {marketName ? (
                    <>
                      <td className="right">{spread ? spread.bets.toLocaleString("en-GB") : "—"}</td>
                      <td className="right">{spread ? formatWinPct(spread.coverPct) : "—"}</td>
                      <td className="right">{spread ? spread.pushes : "—"}</td>
                      <td className={`right ${roiClass(spread?.roi ?? null)}`}>{formatRoi(spread?.roi ?? null)}</td>
                    </>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2>Coverage</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Season</th>
              <th>Phase</th>
              <th className="right">Games</th>
              <th className="right">Moneyline</th>
              <th className="right">Spread</th>
              <th>Latest</th>
              <th>Sources</th>
            </tr>
          </thead>
          <tbody>
            {summary.coverage.map((row) => (
              <tr key={`${row.season}-${row.phase}`}>
                <td>
                  {seasonLabel(sport, row.season)}
                  {row.partial ? <span className="muted"> partial</span> : null}
                </td>
                <td>{row.phase}</td>
                <td className="right">{row.games.toLocaleString("en-GB")}</td>
                <td className="right">{row.withMoneyline.toLocaleString("en-GB")}</td>
                <td className="right">{row.withSpread.toLocaleString("en-GB")}</td>
                <td>{row.latestDate}</td>
                <td className="muted">{Object.entries(row.moneylineSources).map(([name, count]) => `${name} ${count}`).join(", ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <aside className="callout warn">
        <strong>Gaps</strong>
        {summary.gaps.map((gap) => (
          <p key={gap}>{gap}</p>
        ))}
      </aside>
      <p className="muted small">
        {summary.credits.map((credit) => credit.credit).join(" ")}
      </p>
    </>
  );
}
