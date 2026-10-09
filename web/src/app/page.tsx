import Dashboard from "../components/Dashboard";
import type { SeasonRecord } from "../lib/types";
import coverage from "../../public/data/coverage.json";
import seasonData from "../../public/data/season-data.json";

export default function HomePage() {
  const records = seasonData as SeasonRecord[];
  return (
    <Dashboard
      records={records}
      coverageNotes={coverage.notes}
      hasEuropeanGaps={coverage.hasEuropeanGaps}
    />
  );
}
