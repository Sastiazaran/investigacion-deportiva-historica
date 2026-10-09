"use client";

import { useMemo, useState } from "react";
import { formatDisplayedOdds } from "../lib/odds-format";
import { combineCalibration } from "../lib/us-metrics";
import { seasonLabel, sportLabel, type UsSport, type UsSummary } from "../lib/us-types";
import { useOddsFormat } from "./OddsFormatProvider";

type Phase = "regular" | "playoff" | "other";

export default function UsCalibrationView({ sport, summary }: { sport: UsSport; summary: UsSummary }) {
  const { format } = useOddsFormat();
  const phases = (["regular", "playoff", "other"] as Phase[]).filter((phase) => summary.calibration[phase]);
  const [phase, setPhase] = useState<Phase>(phases[0] ?? "regular");
  const block = summary.calibration[phase];
  const seasons = block?.bySeason.map((row) => row.season).filter((year): year is number => year != null) ?? [];
  const [start, setStart] = useState(seasons[0] ?? 2000);
  const [end, setEnd] = useState(seasons[seasons.length - 1] ?? 2000);

  const combined = useMemo(() => {
    const picked = (block?.bySeason ?? []).filter((row) => (row.season ?? 0) >= start && (row.season ?? 0) <= end);
    return combineCalibration(picked);
  }, [block, end, start]);

  return (
    <>
      <header className="page-header">
        <h1>{sportLabel(sport)} calibration</h1>
        <p className="lede">
          Two-way de-vig: fair probability is 1/odds divided by the sum of the two implied
          probabilities. Buckets are 5 percentage points wide. Brier score is the mean squared
          error. Average overround is the mean of (1/home + 1/away − 1).
        </p>
      </header>

      <div className="preset-row">
        {phases.map((item) => (
          <button
            key={item}
            type="button"
            className={`chip ${phase === item ? "active" : ""}`}
            onClick={() => {
              setPhase(item);
              const next = summary.calibration[item]?.bySeason ?? [];
              const years = next.map((row) => row.season).filter((year): year is number => year != null);
              if (years.length) {
                setStart(years[0]);
                setEnd(years[years.length - 1]);
              }
            }}
          >
            {item === "regular" ? "Regular season" : item === "playoff" ? "Playoffs" : "Other"}
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

      <aside className="callout info">
        <strong>
          {combined.games.toLocaleString("en-GB")} games, {combined.outcomes.toLocaleString("en-GB")} outcomes
        </strong>
        <p>
          Brier {combined.brier == null ? "—" : combined.brier.toFixed(4)}. Average overround{" "}
          {combined.avgOverround == null ? "—" : `${(combined.avgOverround * 100).toFixed(2)}%`}.
          Ties are left out. Bucket labels are probabilities, not prices. Average odds still follow the toggle.
        </p>
      </aside>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Fair probability</th>
              <th className="right">Outcomes</th>
              <th className="right">Wins</th>
              <th className="right">Actual</th>
              <th className="right">Predicted</th>
              <th className="right">Edge</th>
              <th className="right">Brier</th>
              <th className="right">Avg odds</th>
            </tr>
          </thead>
          <tbody>
            {combined.buckets.map((bucket) => {
              const edge =
                bucket.actualWinRate == null || bucket.avgPredicted == null
                  ? null
                  : (bucket.actualWinRate - bucket.avgPredicted) * 100;
              return (
                <tr key={bucket.id}>
                  <td>{bucket.label}</td>
                  <td className="right">{bucket.outcomes.toLocaleString("en-GB")}</td>
                  <td className="right">{bucket.wins.toLocaleString("en-GB")}</td>
                  <td className="right">{bucket.actualWinRate == null ? "—" : `${(bucket.actualWinRate * 100).toFixed(1)}%`}</td>
                  <td className="right">{bucket.avgPredicted == null ? "—" : `${(bucket.avgPredicted * 100).toFixed(1)}%`}</td>
                  <td className={`right ${edge == null ? "" : edge > 0 ? "roi-pos" : edge < 0 ? "roi-neg" : ""}`}>
                    {edge == null ? "—" : `${edge > 0 ? "+" : ""}${edge.toFixed(1)} pp`}
                  </td>
                  <td className="right">{bucket.brier == null ? "—" : bucket.brier.toFixed(3)}</td>
                  <td className="right">{formatDisplayedOdds(bucket.avgOdds, format)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
