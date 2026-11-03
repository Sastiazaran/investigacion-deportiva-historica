import type { Metadata } from "next";
import CalibrationView from "../../../components/CalibrationView";
import { loadSummary } from "../../../lib/load-summary";

export const metadata: Metadata = {
  title: "Football calibration",
  description: "Implied probability with the overround removed, compared with the actual win rate by closing-odds bucket.",
};

export default function FootballCalibrationPage() {
  const { calibrationBySeason } = loadSummary();
  return <CalibrationView bySeason={calibrationBySeason} />;
}
