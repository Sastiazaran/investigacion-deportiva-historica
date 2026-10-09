import type { ClubAggregate, ComboRow, SeasonRecord, Tier } from "./types";

export const MIN_YEAR = 2000;
export const MAX_YEAR = 2026;
export const CHART_TOP_N = 20;
export const COMBO_TOP_N = 10;

const TIER_S_MIN = 57;
const TIER_A_MIN = 43;

export function dataYearBounds(records: { season: number }[]) {
  if (records.length === 0) return { min: MIN_YEAR, max: MAX_YEAR };
  let min = records[0].season;
  let max = records[0].season;
  for (const record of records) {
    if (record.season < min) min = record.season;
    if (record.season > max) max = record.season;
  }
  return { min, max };
}

export function rangePresets(minYear: number, maxYear: number) {
  const endCalendar = maxYear + 1;
  const presets: { label: string; start: number; end: number }[] = [
    { label: `${minYear}–${endCalendar}`, start: minYear, end: maxYear },
  ];
  if (minYear <= 2017 && maxYear >= 2017) {
    presets.push({ label: `2017–${endCalendar}`, start: 2017, end: maxYear });
  }
  if (minYear <= 2020 && maxYear >= 2020) {
    presets.push({ label: `2020–${endCalendar}`, start: 2020, end: maxYear });
  }
  presets.push({
    label: `${maxYear}–${endCalendar}`,
    start: maxYear,
    end: maxYear,
  });
  return presets;
}

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function tierFromWinPct(winPct: number): Tier {
  if (winPct >= TIER_S_MIN) return "S";
  if (winPct >= TIER_A_MIN) return "A";
  return "B";
}

export function formatSeasonPart(startYear: number) {
  const endYear = startYear + 1;
  return `${startYear}/${String(endYear).slice(-2)}`;
}

export function formatPeriodLabel(startYear: number, endYear: number) {
  return `Seasons ${formatSeasonPart(startYear)} – ${formatSeasonPart(endYear)}`;
}

export function formatOdds(probability: number) {
  if (probability <= 0) return "—";
  const approxDecimal = 1 / probability;
  return `${approxDecimal.toFixed(1)}:1`;
}

export function makeComboTierLabel(tiers: Tier[]) {
  const counts = { S: 0, A: 0, B: 0 } as Record<Tier, number>;
  for (const t of tiers) counts[t] += 1;
  const parts: string[] = [];
  if (counts.S) parts.push(`S${counts.S > 1 ? `x${counts.S}` : ""}`);
  if (counts.A) parts.push(`A${counts.A > 1 ? `x${counts.A}` : ""}`);
  if (counts.B) parts.push(`B${counts.B > 1 ? `x${counts.B}` : ""}`);
  return parts.length ? parts.join("+") : "—";
}

export function generateCombinations<T>(items: T[], size: number) {
  const result: T[][] = [];
  const n = items.length;
  if (size <= 0 || size > n) return result;

  const indices = Array.from({ length: size }, (_, i) => i);
  while (true) {
    result.push(indices.map((i) => items[i]));
    let i = size - 1;
    while (i >= 0 && indices[i] === n - size + i) i--;
    if (i < 0) break;
    indices[i]++;
    for (let j = i + 1; j < size; j++) {
      indices[j] = indices[j - 1] + 1;
    }
  }
  return result;
}

export function aggregateClubs(
  records: SeasonRecord[],
  startYear: number,
  endYear: number,
): ClubAggregate[] {
  const map = new Map<
    string,
    { club: string; won: number; played: number; leagues: Set<string> }
  >();

  for (const r of records) {
    if (r.season < startYear || r.season > endYear) continue;
    const existing = map.get(r.club);
    if (!existing) {
      map.set(r.club, {
        club: r.club,
        won: r.won,
        played: r.played,
        leagues: new Set([r.league]),
      });
    } else {
      existing.won += r.won;
      existing.played += r.played;
      existing.leagues.add(r.league);
    }
  }

  const aggregates: ClubAggregate[] = Array.from(map.values()).map((v) => {
    const winPct = v.played > 0 ? (v.won / v.played) * 100 : 0;
    return {
      club: v.club,
      won: v.won,
      played: v.played,
      winPct,
      tier: tierFromWinPct(winPct),
      leagues: Array.from(v.leagues).sort(),
    };
  });

  aggregates.sort((a, b) => b.winPct - a.winPct);
  return aggregates;
}

export function buildCombos(clubAggs: ClubAggregate[]) {
  const top = [...clubAggs].sort((a, b) => b.winPct - a.winPct).slice(0, COMBO_TOP_N);

  const makeRowsForSize = (size: number): ComboRow[] => {
    const comboList = generateCombinations(top, size);
    const rows: ComboRow[] = [];

    for (const combo of comboList) {
      const probability = combo.reduce((p, c) => p * (c.winPct / 100), 1);
      const probabilityPct = probability * 100;
      rows.push({
        clubs: combo.map((c) => c.club),
        tierCombo: makeComboTierLabel(combo.map((c) => c.tier)),
        probabilityPct,
        odds: formatOdds(probability),
        matches: combo.reduce((sum, c) => sum + c.played, 0),
      });
    }

    rows.sort((a, b) => b.probabilityPct - a.probabilityPct);
    return rows.slice(0, 18);
  };

  return {
    pairs: makeRowsForSize(2),
    triples: makeRowsForSize(3),
    quads: makeRowsForSize(4),
  };
}

export function datasetStats(records: SeasonRecord[]) {
  const clubs = new Set(records.map((r) => r.club));
  return { records: records.length, clubs: clubs.size };
}
