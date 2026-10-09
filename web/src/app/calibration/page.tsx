import type { Metadata } from "next";
import CalibrationView from "../../components/CalibrationView";
import SiteNav from "../../components/SiteNav";
import { loadSummary } from "../../lib/load-summary";

export const metadata: Metadata = {
  title: "Closing-odds calibration",
  description:
    "Implied probability with the overround removed, compared with the actual win rate by closing-odds bucket.",
};

export default function CalibrationPage() {
  const { calibrationBySeason } = loadSummary();
  return (
    <main className="dashboard">
      <SiteNav />
      <CalibrationView bySeason={calibrationBySeason} />
    </main>
  );
}
