import type { Metadata } from "next";
import MatchSimulator from "../../../components/MatchSimulator";
import { loadPointsFactors, loadSimBacktest } from "../../../lib/load-sim";
import { loadUsSummary } from "../../../lib/load-us-summary";

export const metadata: Metadata = {
  title: "NFL game simulator",
  description: "Points model for an NFL matchup: win, tie, spread, and total probabilities with fair odds.",
};

export default function NflSimulatorPage() {
  const summary = loadUsSummary("nfl");
  const names = Object.fromEntries(summary.teams.map((team) => [team.abbrev, team.team]));
  return <MatchSimulator kind="nfl" factors={loadPointsFactors("nfl")} names={names} backtest={loadSimBacktest("nfl")} />;
}
