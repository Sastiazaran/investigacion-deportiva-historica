"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { withOddsQuery } from "../lib/odds-format";
import { useOddsFormat } from "./OddsFormatProvider";

const SPORTS = [
  { id: "football", href: "/football", label: "Football" },
  { id: "nba", href: "/nba", label: "NBA" },
  { id: "nfl", href: "/nfl", label: "NFL" },
  { id: "mlb", href: "/mlb", label: "MLB" },
] as const;

function sportId(path: string) {
  if (path === "/nba" || path.startsWith("/nba/")) return "nba";
  if (path === "/nfl" || path.startsWith("/nfl/")) return "nfl";
  if (path === "/mlb" || path.startsWith("/mlb/")) return "mlb";
  return "football";
}

function basePath(sport: string) {
  return sport === "football" ? "/football" : `/${sport}`;
}

export default function SiteNav() {
  const path = usePathname();
  const { format, setFormat } = useOddsFormat();
  const sport = sportId(path);
  const base = basePath(sport);
  const sections = [
    {
      href: base,
      label: "Overview",
      current:
        path === base ||
        path === "/" ||
        path.startsWith(`${base}/team/`) ||
        (sport === "football" && path.startsWith("/team/")),
    },
    {
      href: `${base}/calibration`,
      label: "Calibration",
      current: path.startsWith(`${base}/calibration`) || (sport === "football" && path.startsWith("/calibration")),
    },
    {
      href: `${base}/simulator`,
      label: "Simulator",
      current: path.startsWith(`${base}/simulator`),
    },
  ];
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <div className="brand-row">
          <Link className="brand" href={withOddsQuery("/football", format)}>
            Lines
          </Link>
          <div className="odds-toggle" role="group" aria-label="Odds format">
            <button type="button" className={format === "decimal" ? "active" : ""} aria-pressed={format === "decimal"} onClick={() => setFormat("decimal")}>
              Decimal
            </button>
            <button type="button" className={format === "american" ? "active" : ""} aria-pressed={format === "american"} onClick={() => setFormat("american")}>
              American
            </button>
          </div>
        </div>
        <nav className="sport-select" aria-label="Sport">
          {SPORTS.map((item) => (
            <Link key={item.id} href={withOddsQuery(item.href, format)} aria-current={sport === item.id ? "page" : undefined}>
              {item.label}
            </Link>
          ))}
        </nav>
        <nav className="section-nav" aria-label="Section">
          {sections.map((item) => (
            <Link key={item.href} href={withOddsQuery(item.href, format)} aria-current={item.current ? "page" : undefined}>
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
