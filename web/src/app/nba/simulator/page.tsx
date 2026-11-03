import type { Metadata } from "next";
import { readFileSync } from "node:fs";
import path from "node:path";
import MatchSimulator, { type NbaWindows, type SimBacktest } from "../../../components/MatchSimulator";
import { loadNbaBacktest, loadNbaFactors, type BacktestBlock } from "../../../lib/load-nba-sim";

function loadNbaWindows() {
  const file = path.join(process.cwd(), "public", "data", "nba", "rating-windows.json");
  return JSON.parse(readFileSync(file, "utf8")) as NbaWindows;
}

export const metadata: Metadata = {
  title: "NBA game simulator",
  description: "Possession simulator for an NBA matchup: win probability, spread, and total with fair odds.",
};

function block(row: BacktestBlock): SimBacktest["markets"][string] {
  return {
    games: row.games,
    model: row.model,
    market: row.market,
    roiEdge5: { bets: row.roiEdge5.bets, roi: row.roiEdge5.roi },
    beatsMarket: row.beatsMarket,
  };
}

export default function NbaSimulatorPage() {
  const raw = loadNbaBacktest();
  const backtest: SimBacktest = {
    beatsMarket: raw.beatsMarket,
    statement: raw.statement,
    markets: {
      moneyline: block(raw.full),
      "through 2026-02-12": block(raw.through2026_02_12),
      "after 2026-02-12": block(raw.after2026_02_12),
    },
    notes: [raw.closingSource, raw.repoMoneylineGap],
  };
  return <MatchSimulator kind="nba" factors={loadNbaFactors()} nbaWindows={loadNbaWindows()} backtest={backtest} />;
}
