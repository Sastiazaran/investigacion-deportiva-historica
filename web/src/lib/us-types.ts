export type UsSport = "nba" | "nfl" | "mlb";

export type MlSplit = {
  played: number;
  won: number;
  lost: number;
  ties: number;
  winPct: number | null;
  bets: number;
  pushes: number;
  staked: number;
  returned: number;
  profit: number;
  roi: number | null;
  avgOdds: number | null;
};

export type AtsSplit = {
  bets: number;
  covers: number;
  losses: number;
  pushes: number;
  coverPct: number | null;
  staked: number;
  returned: number;
  profit: number;
  roi: number | null;
  avgOdds: number | null;
};

export type AtsBook = {
  overall: AtsSplit;
  home: AtsSplit;
  away: AtsSplit;
  favorite: AtsSplit;
  underdog: AtsSplit;
};

export type MlBook = {
  overall: MlSplit;
  home: MlSplit;
  away: MlSplit;
};

export type UsSeason = {
  season: number;
  moneyline: MlBook;
  ats?: AtsBook;
  runLine?: AtsBook;
};

export type UsPhase = {
  moneyline: MlBook;
  seasons: UsSeason[];
  ats?: AtsBook;
  runLine?: AtsBook;
};

export type UsTeam = {
  team: string;
  slug: string;
  abbrev: string;
  phases: {
    regular: UsPhase;
    playoff: UsPhase;
    other?: UsPhase;
  };
};

export type ProbBucket = {
  id: string;
  label: string;
  minProb: number;
  maxProb: number;
  outcomes: number;
  wins: number;
  actualWinRate: number | null;
  sumPredicted: number;
  avgPredicted: number | null;
  sumBrier: number;
  brier: number | null;
  sumOdds: number;
  avgOdds: number | null;
};

export type CalibBlock = {
  season?: number;
  games: number;
  outcomes: number;
  sumOverround: number;
  avgOverround: number | null;
  sumBrier: number;
  brier: number | null;
  buckets: ProbBucket[];
};

export type PhaseCalibration = CalibBlock & {
  bySeason: CalibBlock[];
};

export type CoverageRow = {
  season: number;
  phase: string;
  games: number;
  withMoneyline: number;
  withSpread: number;
  moneylineSources: Record<string, number>;
  latestDate: string;
  partial: boolean;
};

export type UsSummary = {
  schemaVersion: number;
  sport: UsSport;
  generatedAt: string;
  spreadMarket: "ats" | "runLine" | null;
  credits: { id: string; name: string; url: string; credit: string; license?: string }[];
  gaps: string[];
  definitions: Record<string, string>;
  coverage: CoverageRow[];
  calibration: Partial<Record<"regular" | "playoff" | "other", PhaseCalibration>>;
  teams: UsTeam[];
};

export const US_SPORTS: UsSport[] = ["nba", "nfl", "mlb"];

export function isUsSport(value: string): value is UsSport {
  return value === "nba" || value === "nfl" || value === "mlb";
}

export function sportLabel(sport: UsSport) {
  if (sport === "nba") return "NBA";
  if (sport === "nfl") return "NFL";
  return "MLB";
}

export function seasonLabel(sport: UsSport, season: number) {
  if (sport === "nba") return `${season}/${String(season + 1).slice(-2)}`;
  return String(season);
}

export function spreadLabel(market: UsSummary["spreadMarket"]) {
  if (market === "runLine") return "Run line";
  if (market === "ats") return "ATS";
  return null;
}
