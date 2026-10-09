import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SiteNav from "../../../../components/SiteNav";
import UsTeamView from "../../../../components/UsTeamView";
import { loadUsSummary } from "../../../../lib/load-us-summary";
import { isUsSport, sportLabel, US_SPORTS } from "../../../../lib/us-types";

export function generateStaticParams() {
  const params: { sport: string; slug: string }[] = [];
  for (const sport of US_SPORTS) {
    for (const team of loadUsSummary(sport).teams) {
      params.push({ sport, slug: team.slug });
    }
  }
  return params;
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ sport: string; slug: string }>;
}): Promise<Metadata> {
  const { sport, slug } = await params;
  if (!isUsSport(sport)) return { title: "Team" };
  const team = loadUsSummary(sport).teams.find((row) => row.slug === slug);
  if (!team) return { title: "Team" };
  return {
    title: `${team.team} ${sportLabel(sport)} ROI`,
    description: `Closing moneyline and spread results for ${team.team}.`,
  };
}

export default async function UsTeamPage({
  params,
}: {
  params: Promise<{ sport: string; slug: string }>;
}) {
  const { sport, slug } = await params;
  if (!isUsSport(sport)) notFound();
  const summary = loadUsSummary(sport);
  const team = summary.teams.find((row) => row.slug === slug);
  if (!team) notFound();
  return (
    <main className="dashboard">
      <SiteNav />
      <UsTeamView sport={sport} spreadMarket={summary.spreadMarket} team={team} />
    </main>
  );
}
