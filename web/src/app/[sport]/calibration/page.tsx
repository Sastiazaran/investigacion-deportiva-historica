import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SiteNav from "../../../components/SiteNav";
import UsCalibrationView from "../../../components/UsCalibrationView";
import { loadUsSummary } from "../../../lib/load-us-summary";
import { isUsSport, sportLabel, US_SPORTS } from "../../../lib/us-types";

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
    <main className="dashboard">
      <SiteNav />
      <UsCalibrationView sport={sport} summary={loadUsSummary(sport)} />
    </main>
  );
}
