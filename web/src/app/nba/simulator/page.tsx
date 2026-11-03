import type { Metadata } from "next";
import MatchSimulator, { type SimBacktest } from "../../../components/MatchSimulator";
import { loadNbaBacktest, loadNbaFactors, type BacktestBlock } from "../../../lib/load-nba-sim";

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
  return <MatchSimulator kind="nba" factors={loadNbaFactors()} backtest={backtest} />;
}
