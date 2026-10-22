import type { Metadata } from "next";
import NbaSimulator from "../../../components/NbaSimulator";
import SiteNav from "../../../components/SiteNav";
import { loadNbaBacktest, loadNbaFactors } from "../../../lib/load-nba-sim";

export const metadata: Metadata = {
  title: "NBA Monte Carlo simulator",
  description:
    "Team-level NBA game simulator. 5,000 possessions, win probability, margin and total, and a minimum price at fair odds times 1.05.",
};

export default function NbaSimulatorPage() {
  const factors = loadNbaFactors();
  const backtest = loadNbaBacktest();
  return (
    <main className="dashboard">
      <SiteNav />
      <NbaSimulator factors={factors} backtest={backtest} />
    </main>
  );
}
