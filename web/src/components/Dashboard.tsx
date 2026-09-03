"use client";

import { useMemo, useState } from "react";
import {
  MAX_YEAR,
  MIN_YEAR,
  RANGE_PRESETS,
  CHART_TOP_N,
  COMBO_TOP_N,
  aggregateClubs,
  buildCombos,
  clamp,
  datasetStats,
  formatPeriodLabel,
  formatSeasonPart,
} from "../lib/analysis";
import type { SeasonRecord, ViewTab } from "../lib/types";

type Props = {
  records: SeasonRecord[];
};

function TierBadge({ tier }: { tier: "S" | "A" | "B" }) {
  return <span className={`tier-badge tier-${tier}`}>{tier}</span>;
}

function HorizontalBarChart({
  items,
  valueSuffix = "%",
  maxValue,
  referenceLines,
}: {
  items: { label: string; value: number }[];
  valueSuffix?: string;
  maxValue?: number;
  referenceLines?: { value: number; label: string; className: string }[];
}) {
  const max = maxValue ?? Math.max(...items.map((i) => i.value), 1);

  return (
    <div className="bar-chart">
      {items.map((item) => (
        <div key={item.label} className="bar-row">
          <div className="bar-label" title={item.label}>
            {item.label}
          </div>
          <div className="bar-track">
            {referenceLines?.map((line) => (
              <div
                key={line.label}
                className={`bar-ref ${line.className}`}
                style={{ left: `${(line.value / max) * 100}%` }}
                title={`${line.label}: ${line.value}${valueSuffix}`}
              />
            ))}
            <div
              className="bar-fill"
              style={{ width: `${(item.value / max) * 100}%` }}
            />
          </div>
          <div className="bar-value">
            {item.value.toFixed(1)}
            {valueSuffix}
          </div>
        </div>
      ))}
      {referenceLines && (
        <div className="bar-legend">
          {referenceLines.map((line) => (
            <span key={line.label} className={`legend-item ${line.className}`}>
              {line.label} ({line.value}
              {valueSuffix})
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Dashboard({ records }: Props) {
  const [view, setView] = useState<ViewTab>("rates");
  const [startYear, setStartYear] = useState(2020);
  const [endYear, setEndYear] = useState(MAX_YEAR);

  const stats = useMemo(() => datasetStats(records), [records]);
  const periodLabel = useMemo(
    () => formatPeriodLabel(startYear, endYear),
    [startYear, endYear],
  );

  const clubAggs = useMemo(
    () => aggregateClubs(records, startYear, endYear),
    [records, startYear, endYear],
  );

  const tierS = useMemo(() => clubAggs.filter((c) => c.tier === "S"), [clubAggs]);
  const tierA = useMemo(() => clubAggs.filter((c) => c.tier === "A"), [clubAggs]);
  const tierB = useMemo(() => clubAggs.filter((c) => c.tier === "B"), [clubAggs]);
  const topClubsForChart = useMemo(
    () => clubAggs.slice(0, CHART_TOP_N),
    [clubAggs],
  );
  const combos = useMemo(() => buildCombos(clubAggs), [clubAggs]);

  const onStartYearChange = (value: number) => {
    setStartYear(clamp(value, MIN_YEAR, endYear));
  };

  const onEndYearChange = (value: number) => {
    setEndYear(clamp(value, startYear, MAX_YEAR));
  };

  return (
    <main className="dashboard">
      <header className="page-header">
        <h1>European Accumulator Analysis</h1>
        <p className="lede">
          Win% is <strong>won / played</strong> across La Liga, Premier League,
          Bundesliga, Ligue 1, Serie A, Eredivisie, and Primeira Liga. Dataset:{" "}
          <strong>{stats.records} season records</strong>,{" "}
          <strong>{stats.clubs} unique clubs</strong>. Tiers:{" "}
          <strong>S ≥ 57%</strong>, <strong>A = 43–56.99%</strong>,{" "}
          <strong>B &lt; 43%</strong>.
        </p>
      </header>

      <section className="panel">
        <div className="panel-head">
          <h2>Range presets</h2>
          <span className="muted">Historical seasons</span>
        </div>

        <div className="preset-row">
          {RANGE_PRESETS.map((preset) => {
            const active =
              startYear === preset.start && endYear === preset.end;
            return (
              <button
                key={preset.label}
                type="button"
                className={`chip ${active ? "active" : ""}`}
                onClick={() => {
                  setStartYear(preset.start);
                  setEndYear(preset.end);
                }}
              >
                {preset.label}
              </button>
            );
          })}
        </div>

        <div className="sliders">
          <label className="slider-block">
            <span>
              Start year: <strong>{startYear}</strong> (
              {formatSeasonPart(startYear)})
            </span>
            <input
              type="range"
              min={MIN_YEAR}
              max={MAX_YEAR}
              value={startYear}
              onChange={(e) => onStartYearChange(Number(e.target.value))}
            />
          </label>
          <label className="slider-block">
            <span>
              End year: <strong>{endYear}</strong> ({formatSeasonPart(endYear)})
            </span>
            <input
              type="range"
              min={MIN_YEAR}
              max={MAX_YEAR}
              value={endYear}
              onChange={(e) => onEndYearChange(Number(e.target.value))}
            />
          </label>
        </div>

        <aside className="callout warning">
          <strong>Coverage gaps</strong>
          <p>
            La Liga from <strong>2012</strong>, Serie A / Ligue 1 from{" "}
            <strong>2013/14</strong>, and Eredivisie / Portugal from{" "}
            <strong>2018</strong>. Early Premier League / Bundesliga seasons are
            covered; missing league-years affect reliability when the range
            includes them.
          </p>
        </aside>
      </section>

      <section className="stat-row">
        <div className="stat">
          <div className="stat-value">{clubAggs.length}</div>
          <div className="stat-label">Clubs in range</div>
        </div>
        <div className="stat success">
          <div className="stat-value">{tierS.length}</div>
          <div className="stat-label">Tier S (≥57%)</div>
        </div>
        <div className="stat info">
          <div className="stat-value">{tierA.length}</div>
          <div className="stat-label">Tier A (43–56.99%)</div>
        </div>
        <div className="stat caution">
          <div className="stat-value">{tierB.length}</div>
          <div className="stat-label">Tier B (&lt;43%)</div>
        </div>
      </section>

      <nav className="tabs" aria-label="Views">
        <button
          type="button"
          className={`chip ${view === "rates" ? "active" : ""}`}
          onClick={() => setView("rates")}
        >
          Club Win Rates
        </button>
        <button
          type="button"
          className={`chip ${view === "accumulators" ? "active" : ""}`}
          onClick={() => setView("accumulators")}
        >
          Accumulator Combos
        </button>
      </nav>

      {view === "rates" && (
        <section className="stack">
          <h2>{periodLabel}</h2>

          <div className="panel">
            <h3>
              Top {CHART_TOP_N} clubs by win % ({periodLabel})
            </h3>
            <HorizontalBarChart
              items={topClubsForChart.map((c) => ({
                label: c.club,
                value: Number(c.winPct.toFixed(1)),
              }))}
              maxValue={100}
              referenceLines={[
                { value: 57, label: "S threshold", className: "ref-s" },
                { value: 43, label: "A threshold", className: "ref-a" },
              ]}
            />
            <p className="muted small">
              Chart shows top {CHART_TOP_N} only. Table below lists every club in
              the selected range. Source: football-data / footballcsv /
              openfootball · seasons 2000/01–2024/25.
            </p>
          </div>

          <h2>All clubs in range ({clubAggs.length})</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Club</th>
                  <th className="center">Tier</th>
                  <th className="right">Win %</th>
                  <th className="right">Matches</th>
                  <th>Leagues</th>
                </tr>
              </thead>
              <tbody>
                {clubAggs.map((c) => (
                  <tr key={c.club}>
                    <td>{c.club}</td>
                    <td className="center">
                      <TierBadge tier={c.tier} />
                    </td>
                    <td className="right">{c.winPct.toFixed(1)}%</td>
                    <td className="right">{c.played}</td>
                    <td className="muted">{c.leagues.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <aside className="callout info">
            <strong>Period label logic</strong>
            <p>
              Each “year” is the season start year. For example,{" "}
              <strong>2024</strong> is <strong>2024/25</strong> (often partial).
            </p>
          </aside>
        </section>
      )}

      {view === "accumulators" && (
        <section className="stack">
          <h2>{periodLabel}</h2>

          <aside className="callout info">
            <strong>How accumulator combos are computed</strong>
            <p>
              Combos use the top {COMBO_TOP_N} clubs by win% in range. Each
              club’s win% is treated as an independent win probability and
              multiplied. Probability = product of individual win probabilities.
            </p>
          </aside>

          {(
            [
              ["Top 2-Fold Accumulators", combos.pairs],
              ["Top 3-Fold Accumulators", combos.triples],
            ] as const
          ).map(([title, rows]) => (
            <div key={title}>
              <h2>{title}</h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Combo</th>
                      <th>Tier combo</th>
                      <th className="right">Probability</th>
                      <th className="right">Approx. odds</th>
                      <th className="right">Matches</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((c) => (
                      <tr key={c.clubs.join("+")}>
                        <td>{c.clubs.join(" + ")}</td>
                        <td>{c.tierCombo}</td>
                        <td className="right">
                          {c.probabilityPct.toFixed(1)}%
                        </td>
                        <td className="right">{c.odds}</td>
                        <td className="right">{c.matches}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          <h2>Top 4-Fold Accumulators</h2>
          <div className="panel">
            <HorizontalBarChart
              items={combos.quads.map((c) => ({
                label: c.clubs.join(" + "),
                value: Number(c.probabilityPct.toFixed(1)),
              }))}
            />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Combo</th>
                  <th>Tier combo</th>
                  <th className="right">Probability</th>
                  <th className="right">Approx. odds</th>
                  <th className="right">Matches</th>
                </tr>
              </thead>
              <tbody>
                {combos.quads.map((c) => (
                  <tr key={c.clubs.join("+")}>
                    <td>{c.clubs.join(" + ")}</td>
                    <td>{c.tierCombo}</td>
                    <td className="right">{c.probabilityPct.toFixed(1)}%</td>
                    <td className="right">{c.odds}</td>
                    <td className="right">{c.matches}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <aside className="callout danger">
            <strong>Important caveat</strong>
            <p>
              These probabilities are historical averages using only win%. Real
              matchday odds are usually lower because results depend on
              opponents, home/away, injuries, and other factors.
            </p>
          </aside>
        </section>
      )}
    </main>
  );
}
