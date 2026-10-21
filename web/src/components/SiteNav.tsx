"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { withOddsQuery } from "../lib/odds-format";
import { useOddsFormat } from "./OddsFormatProvider";

const SPORTS = [
  { href: "/", id: "soccer", label: "Futbol" },
  { href: "/nba", id: "nba", label: "NBA" },
  { href: "/nfl", id: "nfl", label: "NFL" },
  { href: "/mlb", id: "mlb", label: "MLB" },
];

function sportId(path: string) {
  if (path === "/nba" || path.startsWith("/nba/")) return "nba";
  if (path === "/nfl" || path.startsWith("/nfl/")) return "nfl";
  if (path === "/mlb" || path.startsWith("/mlb/")) return "mlb";
  return "soccer";
}

export default function SiteNav() {
  const path = usePathname();
  const { format, setFormat } = useOddsFormat();
  const sport = sportId(path);
  const links =
    sport === "soccer"
      ? [
          { href: "/", label: "Win rates", current: path === "/" || path.startsWith("/team/") },
          { href: "/calibration", label: "Calibration", current: path.startsWith("/calibration") },
        ]
      : [
          {
            href: `/${sport}`,
            label: "Teams",
            current: path === `/${sport}` || path.startsWith(`/${sport}/team/`),
          },
          {
            href: `/${sport}/calibration`,
            label: "Calibration",
            current: path.startsWith(`/${sport}/calibration`),
          },
          ...(sport === "nba"
            ? [
                {
                  href: "/nba/simulator",
                  label: "Simulator",
                  current: path.startsWith("/nba/simulator"),
                },
              ]
            : []),
        ];
  return (
    <nav className="site-nav" aria-label="Primary">
      <div className="sport-switch">
        {SPORTS.map((item) => (
          <Link
            key={item.id}
            href={withOddsQuery(item.href, format)}
            aria-current={sport === item.id ? "page" : undefined}
          >
            {item.label}
          </Link>
        ))}
      </div>
      {links.map((item) => (
        <Link
          key={item.href}
          href={withOddsQuery(item.href, format)}
          aria-current={item.current ? "page" : undefined}
        >
          {item.label}
        </Link>
      ))}
      <div className="odds-toggle" role="group" aria-label="Odds format">
        <button
          type="button"
          className={format === "decimal" ? "active" : ""}
          aria-pressed={format === "decimal"}
          onClick={() => setFormat("decimal")}
        >
          Decimal
        </button>
        <button
          type="button"
          className={format === "american" ? "active" : ""}
          aria-pressed={format === "american"}
          onClick={() => setFormat("american")}
        >
          American
        </button>
      </div>
    </nav>
  );
}
