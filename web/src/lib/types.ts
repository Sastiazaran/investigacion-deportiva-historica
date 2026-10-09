export type SeasonRecord = {
  club: string;
  season: number; // season start year (e.g. 2025 => 2025/26)
  league: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
};

export type Tier = "S" | "A" | "B";

export type ClubAggregate = {
  club: string;
  tier: Tier;
  won: number;
  played: number;
  winPct: number;
  leagues: string[];
};

export type ComboRow = {
  clubs: string[];
  tierCombo: string;
  probabilityPct: number;
  odds: string;
  matches: number;
};

export type ViewTab = "rates" | "accumulators";

/** Flat 1-unit stake totals. roi is profit/staked (0.05 = +5%), null when bets is 0. */
export type SplitStats = {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  winPct: number | null;
  bets: number;
  staked: number;
  returned: number;
  profit: number;
  roi: number | null;
  avgOdds: number | null;
};

export type TeamSeason = {
  season: number;
  league: string;
  overall: SplitStats;
  home: SplitStats;
  away: SplitStats;
};

export type TeamSummary = {
  club: string;
  slug: string;
  leagues: string[];
  overall: SplitStats;
  home: SplitStats;
  away: SplitStats;
  seasons: TeamSeason[];
};

export type CalibrationBucket = {
  id: string;
  label: string;
  minOdds: number;
  maxOdds: number | null;
  outcomes: number;
  wins: number;
  actualWinRate: number | null;
  sumImpliedProb: number;
  avgImpliedProb: number | null;
  sumOdds: number;
  avgOdds: number | null;
};

export type CalibrationSeason = {
  season: number;
  buckets: CalibrationBucket[];
};
