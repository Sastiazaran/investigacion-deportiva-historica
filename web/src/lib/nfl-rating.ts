/**
 * NFL team rates for the matchup model.
 *
 * A rating is this season's points scored and allowed, shrunk toward last
 * season. Last season is itself shrunk a little toward the league so one
 * wild year does not become the prior. Career totals are not used: a decade
 * of old games would hide a quarterback change.
 */

export const NFL_PRIOR_GAMES = 8;
export const NFL_PREVIOUS_SHRINK = 4;

export type Count = { gf: number; ga: number; gp: number };

export function shrunkRate(sum: number, games: number, priorGames: number, league: number) {
  return (sum + priorGames * league) / (games + priorGames);
}

export function seasonRate(input: {
  current: Count;
  previous?: Count;
  league: number;
  priorGames?: number;
}) {
  const priorGames = input.priorGames ?? NFL_PRIOR_GAMES;
  const previous = input.previous && input.previous.gp > 0 ? input.previous : null;
  const baseOff = previous
    ? shrunkRate(previous.gf, previous.gp, NFL_PREVIOUS_SHRINK, input.league)
    : input.league;
  const baseDef = previous
    ? shrunkRate(previous.ga, previous.gp, NFL_PREVIOUS_SHRINK, input.league)
    : input.league;
  return {
    off: shrunkRate(input.current.gf, input.current.gp, priorGames, baseOff),
    def: shrunkRate(input.current.ga, input.current.gp, priorGames, baseDef),
  };
}
