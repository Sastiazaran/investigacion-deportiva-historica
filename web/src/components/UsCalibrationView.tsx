"use client";

import { useMemo, useState } from "react";
import { formatDisplayedOdds } from "../lib/odds-format";
import { combineCalibration } from "../lib/us-metrics";
import { seasonLabel, sportLabel, type UsSport, type UsSummary } from "../lib/us-types";
import { useOddsFormat } from "./OddsFormatProvider";

type Phase = "regular" | "playoff" | "other";

export type TotalSeason = {
  season: number;
  label: string;
  games: number;
  meanSimulated: number;
  meanSimHome: number;
  meanSimAway: number;
  meanActual: number;
  meanActualHome: number;
  meanActualAway: number;
  bias: number;
  mae: number;
  closingGames: number;
  meanClosing: number | null;
  biasVsClose: number | null;
  maeVsClose: number | null;
};

function signed(value: number | null) {
  if (value == null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

export default function UsCalibrationView({
  sport,
  summary,
  totals,
}: {
  sport: UsSport;
  summary: UsSummary;
  totals?: TotalSeason[];
}) {
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
        <p className="eyebrow">{sportLabel(sport)}</p>
        <h1>Calibration</h1>
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

      {sport === "nba" && totals && totals.length > 0 ? (
        <section className="panel">
          <div className="panel-head">
            <h2>Game total</h2>
            <span className="muted small">Simulated mean versus the final score and the closing total</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Season</th>
                  <th className="right">Games</th>
                  <th className="right">Simulated</th>
                  <th className="right">Sim home</th>
                  <th className="right">Sim away</th>
                  <th className="right">Actual</th>
                  <th className="right">Actual home</th>
                  <th className="right">Actual away</th>
                  <th className="right">Bias</th>
                  <th className="right">MAE</th>
                  <th className="right">Closing games</th>
                  <th className="right">Closing total</th>
                  <th className="right">Bias vs close</th>
                  <th className="right">MAE vs close</th>
                </tr>
              </thead>
              <tbody>
                {totals.map((row) => (
                  <tr key={row.season}>
                    <td>{row.label}</td>
                    <td className="right">{row.games.toLocaleString("en-GB")}</td>
                    <td className="right">{row.meanSimulated.toFixed(1)}</td>
                    <td className="right">{row.meanSimHome.toFixed(1)}</td>
                    <td className="right">{row.meanSimAway.toFixed(1)}</td>
                    <td className="right">{row.meanActual.toFixed(1)}</td>
                    <td className="right">{row.meanActualHome.toFixed(1)}</td>
                    <td className="right">{row.meanActualAway.toFixed(1)}</td>
                    <td className={`right ${row.bias > 1 ? "roi-neg" : row.bias < -1 ? "roi-pos" : ""}`}>{signed(row.bias)}</td>
                    <td className="right">{row.mae.toFixed(1)}</td>
                    <td className="right">{row.closingGames.toLocaleString("en-GB")}</td>
                    <td className="right">{row.meanClosing == null ? "—" : row.meanClosing.toFixed(1)}</td>
                    <td className="right">{signed(row.biasVsClose)}</td>
                    <td className="right">{row.maeVsClose == null ? "—" : row.maeVsClose.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">
            Bias is the mean simulated total minus the actual total, in points. Positive means the
            simulator is high. Closing totals are the ESPN line where one was posted.
          </p>
        </section>
      ) : null}

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
