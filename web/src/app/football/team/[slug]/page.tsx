import type { Metadata } from "next";
import { notFound } from "next/navigation";
import TeamView from "../../../../components/TeamView";
import { loadSummary } from "../../../../lib/load-summary";

export function generateStaticParams() {
  return loadSummary().teams.map((team) => ({ slug: team.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const team = loadSummary().teams.find((row) => row.slug === slug);
  if (!team) return { title: "Club" };
  return {
    title: `${team.club} home/away ROI`,
    description: `Historical win rate and flat-bet closing-odds ROI for ${team.club}, split by home and away.`,
  };
}

export default async function FootballTeamPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const team = loadSummary().teams.find((row) => row.slug === slug);
  if (!team) notFound();
  return <TeamView team={team} />;
}
