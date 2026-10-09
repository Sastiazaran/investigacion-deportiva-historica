"use client";

import { useMemo, useState } from "react";
import { clamp, dataYearBounds, formatPeriodLabel } from "../lib/analysis";
import { formatDisplayedOdds, formatOddsBucketLabel } from "../lib/odds-format";
import { combineBuckets } from "../lib/metrics";
import type { CalibrationSeason } from "../lib/types";
import { useOddsFormat } from "./OddsFormatProvider";
import YearRange from "./YearRange";

type Props = {
  bySeason: CalibrationSeason[];
};

function pct(value: number | null) {
  if (value == null) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function edge(actual: number | null, implied: number | null) {
  if (actual == null || implied == null) return null;
  return (actual - implied) * 100;
}

export default function CalibrationView({ bySeason }: Props) {
  const bounds = dataYearBounds(bySeason);
  const [startYear, setStartYear] = useState(bounds.min);
  const [endYear, setEndYear] = useState(bounds.max);

  const buckets = useMemo(() => {
    const groups = bySeason
      .filter((row) => row.season >= startYear && row.season <= endYear)
      .map((row) => row.buckets);
    return combineBuckets(groups);
  }, [bySeason, startYear, endYear]);

  const { format } = useOddsFormat();
  const priced = buckets.reduce((sum, bucket) => sum + bucket.outcomes, 0);

  return (
    <>
      <header className="page-header">
        <h1>Closing-odds calibration</h1>
        <p className="lede">
          Each priced match adds three outcomes (home, draw, away). Implied
          probability is 1/odds with the overround removed, so the three fair
          probabilities sum to 1. Buckets from 1.20 to 1.50 are 0.05 wide.
          Edge is actual win rate minus that fair probability.{" "}
          {formatPeriodLabel(startYear, endYear)}.
        </p>
      </header>

      <section className="panel">
        <YearRange
          minYear={bounds.min}
          maxYear={bounds.max}
          startYear={startYear}
          endYear={endYear}
          onStartYear={(year) => setStartYear(clamp(year, bounds.min, endYear))}
          onEndYear={(year) => setEndYear(clamp(year, startYear, bounds.max))}
        />
      </section>

      <aside className="callout info">
        <strong>{priced.toLocaleString("en-GB")} outcomes</strong>
        <p>
          A positive edge means results in that price band beat the de-vigged
          closing line. It is not a staking recommendation. 2000/01 and 2001/02
          have results but no Bet365 or Pinnacle prices, so they are absent here.
        </p>
      </aside>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Odds bucket</th>
              <th className="right">Outcomes</th>
              <th className="right">Wins</th>
              <th className="right">Actual win rate</th>
              <th className="right">Fair implied</th>
              <th className="right">Edge</th>
              <th className="right">Avg odds</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((bucket) => {
              const points = edge(bucket.actualWinRate, bucket.avgImpliedProb);
              const focus = bucket.minOdds >= 1.2 && bucket.minOdds < 1.5;
              return (
                <tr key={bucket.id} className={focus ? "bucket-focus" : undefined}>
                  <td>
                    {formatOddsBucketLabel(bucket.label, bucket.minOdds, bucket.maxOdds, format)}
                  </td>
                  <td className="right">{bucket.outcomes.toLocaleString("en-GB")}</td>
                  <td className="right">{bucket.wins.toLocaleString("en-GB")}</td>
                  <td className="right">{pct(bucket.actualWinRate)}</td>
                  <td className="right">{pct(bucket.avgImpliedProb)}</td>
                  <td className={`right ${points == null ? "" : points > 0 ? "roi-pos" : points < 0 ? "roi-neg" : ""}`}>
                    {points == null ? "—" : `${points > 0 ? "+" : ""}${points.toFixed(1)} pp`}
                  </td>
                  <td className="right">{formatDisplayedOdds(bucket.avgOdds, format)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        {format === "american"
          ? "Highlighted rows are the short-favorite band. Labels are the American equivalents of the decimal bounds, so 1.20–1.25 is -500 to -400. 10.00+ is +900 or longer."
          : "Highlighted rows are the short-favorite band (1.20–1.50). Intervals are half-open: 1.20–1.25 means 1.20 inclusive and 1.25 exclusive. 10.00+ has no upper bound."}
      </p>
    </>
  );
}
