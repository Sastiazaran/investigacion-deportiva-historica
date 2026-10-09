"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatProfit, formatRoi, formatWinPct, roiClass } from "../lib/metrics";
import { formatDisplayedOdds, withOddsQuery } from "../lib/odds-format";
import { combineAtsBook, combineMlBook, seasonSpread } from "../lib/us-metrics";
import {
  seasonLabel,
  spreadLabel,
  type AtsSplit,
  type MlSplit,
  type UsSport,
  type UsSummary,
  type UsTeam,
} from "../lib/us-types";
import { useOddsFormat } from "./OddsFormatProvider";

type Phase = "regular" | "playoff" | "other";

export default function UsTeamView({
  sport,
  spreadMarket,
  team,
}: {
  sport: UsSport;
  spreadMarket: UsSummary["spreadMarket"];
  team: UsTeam;
}) {
  const { format } = useOddsFormat();
  const phases = (["regular", "playoff", "other"] as Phase[]).filter((phase) => team.phases[phase]);
  const [phase, setPhase] = useState<Phase>("regular");
  const block = team.phases[phase];
  const years = (block?.seasons ?? []).map((row) => row.season);
  const minYear = years[0] ?? 2000;
  const maxYear = years[years.length - 1] ?? minYear;
  const [start, setStart] = useState(minYear);
  const [end, setEnd] = useState(maxYear);
  const market = spreadMarket;
  const marketName = spreadLabel(market);

  const picked = useMemo(
    () => (block?.seasons ?? []).filter((row) => row.season >= start && row.season <= end),
    [block, end, start],
  );
  const moneyline = useMemo(() => combineMlBook(picked.map((row) => row.moneyline)), [picked]);
  const spread = useMemo(() => {
    if (!market) return null;
    const books = picked.map((row) => seasonSpread(row, market)).filter((row) => row != null);
    return books.length ? combineAtsBook(books) : null;
  }, [market, picked]);

  const overall = moneyline.overall;
  const verdict = overall.bets
    ? `Flat-betting ${team.team} to win at the closing price — ${overall.bets} bets, ${overall.pushes} pushes, average ${formatDisplayedOdds(overall.avgOdds, format)} — ${formatRoi(overall.roi)} ROI on ${overall.played} games.`
    : `${team.team} has no closing moneyline in this range.`;

  return (
    <>
      <p className="muted small">
        <Link href={withOddsQuery(`/${sport}`, format)}>All {sport.toUpperCase()} teams</Link>
      </p>
      <header className="page-header">
        <h1>{team.team}</h1>
        <p className="lede">{verdict}</p>
      </header>

      <div className="preset-row">
        {phases.map((item) => (
          <button
            key={item}
            type="button"
            className={`chip ${phase === item ? "active" : ""}`}
            onClick={() => {
              setPhase(item);
              const next = team.phases[item]?.seasons ?? [];
              if (next.length) {
                setStart(next[0].season);
                setEnd(next[next.length - 1].season);
              }
            }}
          >
            {item === "regular" ? "Regular season" : item === "playoff" ? "Playoffs" : "Other"}
          </button>
        ))}
      </div>

      {years.length > 0 ? (
        <section className="panel">
          <div className="sliders">
            <label className="slider-block">
              <span>From <strong>{seasonLabel(sport, start)}</strong></span>
              <select value={start} onChange={(event) => setStart(Number(event.target.value))}>
                {years.map((year) => (
                  <option key={year} value={year}>{seasonLabel(sport, year)}</option>
                ))}
              </select>
            </label>
            <label className="slider-block">
              <span>Through <strong>{seasonLabel(sport, end)}</strong></span>
              <select value={end} onChange={(event) => setEnd(Number(event.target.value))}>
                {years.map((year) => (
                  <option key={year} value={year}>{seasonLabel(sport, year)}</option>
                ))}
              </select>
            </label>
          </div>
        </section>
      ) : (
        <p className="muted">No games in this phase.</p>
      )}

      <h2>Moneyline</h2>
      <section className="split-grid">
        <MlCard title="Overall" split={overall} />
        <MlCard title="Home" split={moneyline.home} />
        <MlCard title="Away" split={moneyline.away} />
      </section>

      {marketName && spread ? (
        <>
          <h2>{marketName}</h2>
          <section className="split-grid">
            <AtsCard title="Overall" split={spread.overall} />
            <AtsCard title="Home" split={spread.home} />
            <AtsCard title="Away" split={spread.away} />
            <AtsCard title="Favorite" split={spread.favorite} />
            <AtsCard title="Underdog" split={spread.underdog} />
          </section>
        </>
      ) : null}

      <h2>By season</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Season</th>
              <th className="right">Played</th>
              <th className="right">Win %</th>
              <th className="right">ML bets</th>
              <th className="right">Avg odds</th>
              <th className="right">ML ROI</th>
              {marketName ? (
                <>
                  <th className="right">{marketName} bets</th>
                  <th className="right">Cover %</th>
                  <th className="right">{marketName} ROI</th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {picked.map((row) => {
              const ml = row.moneyline.overall;
              const line = market ? seasonSpread(row, market)?.overall : null;
              return (
                <tr key={row.season}>
                  <td>{seasonLabel(sport, row.season)}</td>
                  <td className="right">{ml.played}</td>
                  <td className="right">{formatWinPct(ml.winPct)}</td>
                  <td className="right">{ml.bets}</td>
                  <td className="right">{formatDisplayedOdds(ml.avgOdds, format)}</td>
                  <td className={`right ${roiClass(ml.roi)}`}>{formatRoi(ml.roi)}</td>
                  {marketName ? (
                    <>
                      <td className="right">{line ? `${line.bets} + ${line.pushes} push` : "—"}</td>
                      <td className="right">{line ? formatWinPct(line.coverPct) : "—"}</td>
                      <td className={`right ${roiClass(line?.roi ?? null)}`}>{formatRoi(line?.roi ?? null)}</td>
                    </>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Sample size is the bet count. Pushes are refunds and are not in the ROI.
        {market === "ats" ? " ATS price is the listed spread odds, or 1.909 when the source has no price." : ""}
        {market === "runLine" ? " Run line uses the same cover rule as a point spread." : ""}
      </p>
    </>
  );
}

function MlCard({ title, split }: { title: string; split: MlSplit }) {
  const { format } = useOddsFormat();
  return (
    <div className="stat">
      <div className="stat-label">{title}</div>
      <div className={`stat-value ${roiClass(split.roi)}`}>{formatRoi(split.roi)}</div>
      <p className="muted small">
        Win {formatWinPct(split.winPct)} ({split.won}-{split.lost}
        {split.ties ? `-${split.ties}` : ""})
        <br />
        {split.bets} bets, {split.pushes} pushes, avg {formatDisplayedOdds(split.avgOdds, format)}
        <br />
        Profit {formatProfit(split.profit)} on {split.played} games
      </p>
    </div>
  );
}

function AtsCard({ title, split }: { title: string; split: AtsSplit }) {
  const { format } = useOddsFormat();
  return (
    <div className="stat">
      <div className="stat-label">{title}</div>
      <div className={`stat-value ${roiClass(split.roi)}`}>{formatRoi(split.roi)}</div>
      <p className="muted small">
        Cover {formatWinPct(split.coverPct)} ({split.covers}-{split.losses})
        <br />
        {split.bets} bets, {split.pushes} pushes, avg {formatDisplayedOdds(split.avgOdds, format)}
        <br />
        Profit {formatProfit(split.profit)}
      </p>
    </div>
  );
}
