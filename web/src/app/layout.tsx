import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { OddsFormatProvider } from "../components/OddsFormatProvider";
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
  title: "European Accumulator Analysis",
  description:
    "Historical club win rates, home/away splits, flat-bet closing-odds ROI, and odds calibration across Europe’s top leagues and Liga MX.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <OddsFormatProvider>{children}</OddsFormatProvider>
      </body>
    </html>
  );
}
