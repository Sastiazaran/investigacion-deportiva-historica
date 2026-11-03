import type { Metadata } from "next";
import MatchSimulator from "../../../components/MatchSimulator";
import { loadRunsFactors, loadSimBacktest } from "../../../lib/load-sim";
import { loadUsSummary } from "../../../lib/load-us-summary";

export const metadata: Metadata = {
  title: "MLB game simulator",
  description: "Runs model for an MLB matchup: win probability, run line, and total with fair odds.",
};

export default function MlbSimulatorPage() {
  const summary = loadUsSummary("mlb");
  const names = Object.fromEntries(summary.teams.map((team) => [team.abbrev, team.team]));
  return <MatchSimulator kind="mlb" factors={loadRunsFactors()} names={names} backtest={loadSimBacktest("mlb")} />;
}
