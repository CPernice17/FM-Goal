import { Rng } from './rng';

/** Parametri del modello partita: gol come estrazioni di Poisson. */
export const MATCH = {
  /** Gol medi di una squadra contro un avversario equivalente. */
  baseGoals: 1.3,
  /** Sensibilità alla differenza di rating (per punto). */
  ratingWeight: 0.034,
  /** Vantaggio del campo, in unità dell'esponente. */
  homeAdvantage: 0.1,
};

export interface MatchResult {
  home: number;
  away: number;
}

export function expectedGoals(homeRating: number, awayRating: number, neutral = false): [number, number] {
  const diff = homeRating - awayRating;
  const adv = neutral ? 0 : MATCH.homeAdvantage;
  return [
    MATCH.baseGoals * Math.exp(MATCH.ratingWeight * diff + adv),
    MATCH.baseGoals * Math.exp(-MATCH.ratingWeight * diff - adv),
  ];
}

export function playMatch(rng: Rng, homeRating: number, awayRating: number, neutral = false): MatchResult {
  const [lh, la] = expectedGoals(homeRating, awayRating, neutral);
  return { home: rng.poisson(lh), away: rng.poisson(la) };
}

/**
 * Partita a eliminazione diretta: in caso di pareggio decidono i rigori,
 * con un leggerissimo vantaggio alla squadra più forte.
 */
export function playKnockout(
  rng: Rng,
  ratingA: number,
  ratingB: number,
  neutral: boolean,
): { winner: 'a' | 'b'; result: MatchResult; penalties: boolean } {
  const result = playMatch(rng, ratingA, ratingB, neutral);
  if (result.home !== result.away) {
    return { winner: result.home > result.away ? 'a' : 'b', result, penalties: false };
  }
  const pA = 0.5 + Math.max(-0.1, Math.min(0.1, (ratingA - ratingB) * 0.005));
  return { winner: rng.chance(pA) ? 'a' : 'b', result, penalties: true };
}
