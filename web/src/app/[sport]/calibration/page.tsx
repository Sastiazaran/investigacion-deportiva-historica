import type { Metadata } from "next";
import { readFileSync } from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";
import UsCalibrationView, { type TotalSeason } from "../../../components/UsCalibrationView";
import { loadUsSummary } from "../../../lib/load-us-summary";
import { isUsSport, sportLabel, US_SPORTS } from "../../../lib/us-types";

function loadNbaTotals(): TotalSeason[] | undefined {
  try {
    const file = path.join(process.cwd(), "public", "data", "nba", "total-calibration.json");
    const payload = JSON.parse(readFileSync(file, "utf8")) as { seasons?: TotalSeason[] };
    return payload.seasons;
  } catch {
    return undefined;
  }
}

export function generateStaticParams() {
  return US_SPORTS.map((sport) => ({ sport }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ sport: string }>;
}): Promise<Metadata> {
  const { sport } = await params;
  if (!isUsSport(sport)) return { title: "Calibration" };
  return {
    title: `${sportLabel(sport)} calibration`,
    description: `Two-way de-vigged closing prices versus actual results for ${sportLabel(sport)}.`,
  };
}

export default async function UsCalibrationPage({
  params,
}: {
  params: Promise<{ sport: string }>;
}) {
  const { sport } = await params;
  if (!isUsSport(sport)) notFound();
  return (
    <UsCalibrationView
      sport={sport}
      summary={loadUsSummary(sport)}
      totals={sport === "nba" ? loadNbaTotals() : undefined}
    />
  );
}
