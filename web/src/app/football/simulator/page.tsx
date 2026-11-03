import type { Metadata } from "next";
import MatchSimulator from "../../../components/MatchSimulator";
import { loadFootballFactors, loadSimBacktest } from "../../../lib/load-sim";

export const metadata: Metadata = {
  title: "Football match simulator",
  description: "Dixon-Coles win, draw, loss, total, and goal-line probabilities with fair odds and a minimum price.",
};

export default function FootballSimulatorPage() {
  return <MatchSimulator kind="football" factors={loadFootballFactors()} backtest={loadSimBacktest("football")} />;
}
