export type OddsFormat = "decimal" | "american";

export const ODDS_FORMAT_QUERY = "odds";
export const ODDS_FORMAT_STORAGE_KEY = "odds-format";

/** Nearest integer, with halves away from zero. JS Math.round goes the other way on negatives. */
function roundHalfAwayFromZero(value: number) {
  const sign = value < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(value));
}

/**
 * Decimal price to American moneyline.
 * decimal >= 2 -> +((d - 1) * 100); decimal < 2 -> -(100 / (d - 1)).
 * 2.00 is +100. Null, non-finite, or prices at or below 1.00 are "—".
 */
export function decimalToAmerican(decimal: number | null | undefined): string {
  if (decimal == null || typeof decimal !== "number" || !Number.isFinite(decimal) || decimal <= 1) {
    return "—";
  }
  const raw = decimal >= 2 ? (decimal - 1) * 100 : -(100 / (decimal - 1));
  const rounded = roundHalfAwayFromZero(raw);
  if (rounded > 0) return `+${rounded}`;
  return String(rounded);
}

export function formatDisplayedOdds(
  decimal: number | null | undefined,
  format: OddsFormat,
): string {
  if (format === "american") return decimalToAmerican(decimal);
  if (decimal == null || typeof decimal !== "number" || !Number.isFinite(decimal)) return "—";
  return decimal.toFixed(2);
}

/** Bucket label. Decimal keeps the published label. American converts each bound. */
export function formatOddsBucketLabel(
  decimalLabel: string,
  minOdds: number,
  maxOdds: number | null,
  format: OddsFormat,
): string {
  if (format === "decimal") return decimalLabel;
  if (maxOdds == null) {
    const low = decimalToAmerican(minOdds);
    return low === "—" ? decimalLabel : `${low}+`;
  }
  if (!(minOdds > 1)) {
    const high = decimalToAmerican(maxOdds);
    return high === "—" ? decimalLabel : `< ${high}`;
  }
  const low = decimalToAmerican(minOdds);
  const high = decimalToAmerican(maxOdds);
  if (low === "—" || high === "—") return decimalLabel;
  return `${low} to ${high}`;
}

/** Combo table. Decimal keeps the existing "2.5:1" string. American converts 1/probability. */
export function formatComboOdds(
  probabilityPct: number,
  decimalLabel: string,
  format: OddsFormat,
): string {
  if (format === "decimal") return decimalLabel;
  if (!(probabilityPct > 0) || !Number.isFinite(probabilityPct)) return "—";
  return decimalToAmerican(100 / probabilityPct);
}

export function withOddsQuery(href: string, format: OddsFormat) {
  if (format !== "american") return href;
  const splitAt = href.indexOf("?");
  const path = splitAt === -1 ? href : href.slice(0, splitAt);
  const params = new URLSearchParams(splitAt === -1 ? "" : href.slice(splitAt + 1));
  params.set(ODDS_FORMAT_QUERY, "american");
  return `${path}?${params.toString()}`;
}

export function isOddsFormat(value: string | null | undefined): value is OddsFormat {
  return value === "decimal" || value === "american";
}
