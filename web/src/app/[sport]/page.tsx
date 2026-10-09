import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SiteNav from "../../components/SiteNav";
import UsSportView from "../../components/UsSportView";
import { loadUsSummary } from "../../lib/load-us-summary";
import { isUsSport, sportLabel, US_SPORTS } from "../../lib/us-types";

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
  if (!isUsSport(sport)) return { title: "Sport" };
  return {
    title: `${sportLabel(sport)} closing-line ROI`,
    description: `Historical moneyline ROI, spread results, and sample sizes for ${sportLabel(sport)}.`,
  };
}

export default async function SportPage({
  params,
}: {
  params: Promise<{ sport: string }>;
}) {
  const { sport } = await params;
  if (!isUsSport(sport)) notFound();
  const summary = loadUsSummary(sport);
  return (
    <main className="dashboard">
      <SiteNav />
      <UsSportView sport={sport} summary={summary} />
    </main>
  );
}
