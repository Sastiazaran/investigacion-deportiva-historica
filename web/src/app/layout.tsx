import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { readFileSync } from "node:fs";
import path from "node:path";
import { OddsFormatProvider } from "../components/OddsFormatProvider";
import SiteNav from "../components/SiteNav";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Lines",
  description:
    "Historical results, closing-line calibration, and match simulators for European football, Liga MX, the NFL, the NBA, and MLB.",
};

function freshnessLine() {
  try {
    const file = path.join(process.cwd(), "public", "data", "freshness.json");
    const report = JSON.parse(readFileSync(file, "utf8")) as {
      rows?: { competition: string; latest: string | null; status: string }[];
    };
    const games = (report.rows ?? []).filter((row) => !row.competition.includes("closing"));
    if (!games.length) return null;
    return games
      .map((row) => `${row.competition} ${row.latest ?? "none"}`)
      .join(" · ");
  } catch {
    return null;
  }
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <OddsFormatProvider>
          <SiteNav />
          <main className="dashboard">
            {children}
            <p className="freshness">{freshnessLine()}</p>
          </main>
        </OddsFormatProvider>
      </body>
    </html>
  );
}
