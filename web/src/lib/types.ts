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
