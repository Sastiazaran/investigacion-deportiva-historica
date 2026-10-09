"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { withOddsQuery } from "../lib/odds-format";
import { useOddsFormat } from "./OddsFormatProvider";

const LINKS = [
  { href: "/", label: "Win rates" },
  { href: "/calibration", label: "Calibration" },
];

export default function SiteNav() {
  const path = usePathname();
  const { format, setFormat } = useOddsFormat();
  return (
    <nav className="site-nav" aria-label="Primary">
      {LINKS.map((item) => {
        const current = item.href === "/" ? path === "/" : path.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={withOddsQuery(item.href, format)}
            aria-current={current ? "page" : undefined}
          >
            {item.label}
          </Link>
        );
      })}
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
