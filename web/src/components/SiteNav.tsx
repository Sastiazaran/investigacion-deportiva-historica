"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Win rates" },
  { href: "/calibration", label: "Calibration" },
];

export default function SiteNav() {
  const path = usePathname();
  return (
    <nav className="site-nav" aria-label="Primary">
      {LINKS.map((item) => {
        const current = item.href === "/" ? path === "/" : path.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={current ? "page" : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
