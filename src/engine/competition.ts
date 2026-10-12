import { playKnockout, playMatch } from './match';
import { Rng } from './rng';

export interface Entrant {
  id: string;
  rating: number;
}

export interface TableRow {
  id: string;
  played: number;
  points: number;
  gf: number;
  ga: number;
}

export interface TeamSeasonLog {
  /** Punti partita per partita, in ordine di giornata. */
  results: { gf: number; ga: number; points: number }[];
}

export interface LeagueResult {
  table: TableRow[];
  logs: Record<string, TeamSeasonLog>;
  matchdays: number;
}

/** Calendario all'italiana (metodo del cerchio), andata e ritorno. */
export function roundRobin(ids: string[]): [string, string][][] {
  const teams = [...ids];
  if (teams.length % 2 === 1) teams.push('__bye__');
  const n = teams.length;
  const rounds: [string, string][][] = [];
  const rot = teams.slice(1);
  for (let r = 0; r < n - 1; r++) {
    const round: [string, string][] = [];
    const current = [teams[0] as string, ...rot];
    for (let i = 0; i < n / 2; i++) {
      const a = current[i] as string;
      const b = current[n - 1 - i] as string;
      if (a === '__bye__' || b === '__bye__') continue;
      round.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(round);
    rot.unshift(rot.pop() as string);
  }
  const second = rounds.map((round) => round.map(([h, a]) => [a, h] as [string, string]));
  return [...rounds, ...second];
}

export function simulateLeague(rng: Rng, entrants: Entrant[], rounds: 1 | 2 = 2): LeagueResult {
  const rating = new Map(entrants.map((e) => [e.id, e.rating]));
  const rows = new Map<string, TableRow>(
    entrants.map((e) => [e.id, { id: e.id, played: 0, points: 0, gf: 0, ga: 0 }]),
  );
  const logs: Record<string, TeamSeasonLog> = {};
  for (const e of entrants) logs[e.id] = { results: [] };

  const all = roundRobin(entrants.map((e) => e.id));
  const schedule = rounds === 1 ? all.slice(0, all.length / 2) : all;
  for (const round of schedule) {
    for (const [h, a] of round) {
      const res = playMatch(rng, rating.get(h) ?? 60, rating.get(a) ?? 60);
      const rh = rows.get(h) as TableRow;
      const ra = rows.get(a) as TableRow;
      const ph = res.home > res.away ? 3 : res.home === res.away ? 1 : 0;
      const pa = res.away > res.home ? 3 : res.home === res.away ? 1 : 0;
      rh.played++;
      ra.played++;
      rh.points += ph;
      ra.points += pa;
      rh.gf += res.home;
      rh.ga += res.away;
      ra.gf += res.away;
      ra.ga += res.home;
      logs[h]?.results.push({ gf: res.home, ga: res.away, points: ph });
      logs[a]?.results.push({ gf: res.away, ga: res.home, points: pa });
    }
  }

  // Spareggio finale casuale ma deterministico per la seed.
  const tiebreak = new Map(entrants.map((e) => [e.id, rng.next()]));
  const table = [...rows.values()].sort(
    (x, y) =>
      y.points - x.points ||
      y.gf - y.ga - (x.gf - x.ga) ||
      y.gf - x.gf ||
      (tiebreak.get(y.id) ?? 0) - (tiebreak.get(x.id) ?? 0),
  );
  return { table, logs, matchdays: schedule.length };
}

export type CupStage = 'winner' | 'final' | 'semi' | 'quarter' | 'r16' | 'r32' | 'r64' | 'prelim';

const STAGES_FROM_FINAL: CupStage[] = ['final', 'semi', 'quarter', 'r16', 'r32', 'r64'];

export interface CupResult {
  winner: string;
  /** Turno più avanzato raggiunto da ciascun partecipante. */
  reached: Record<string, CupStage>;
  /** Squadre eliminate ai rigori, con il turno in cui è successo. */
  penaltiesOut: Record<string, CupStage>;
}

/**
 * Coppa a eliminazione diretta in gara secca. Se i partecipanti non sono una
 * potenza di 2, le squadre più deboli giocano un turno preliminare.
 */
export function simulateCup(rng: Rng, entrants: Entrant[]): CupResult {
  if (entrants.length < 2) throw new Error('Coppa con meno di 2 squadre');
  const rating = new Map(entrants.map((e) => [e.id, e.rating]));
  const reached: Record<string, CupStage> = {};
  const penaltiesOut: Record<string, CupStage> = {};

  const sorted = [...entrants].sort((a, b) => b.rating - a.rating);
  let size = 1;
  while (size * 2 <= sorted.length) size *= 2;
  let alive = sorted.slice(0, sorted.length - 2 * (sorted.length - size)).map((e) => e.id);
  const prelim = sorted.slice(alive.length).map((e) => e.id);

  const playRound = (ids: string[], stage: CupStage, neutral: boolean): string[] => {
    const shuffled = rng.shuffle([...ids]);
    const next: string[] = [];
    for (let i = 0; i < shuffled.length; i += 2) {
      const a = shuffled[i] as string;
      const b = shuffled[i + 1] as string;
      const out = playKnockout(rng, rating.get(a) ?? 60, rating.get(b) ?? 60, neutral);
      const winner = out.winner === 'a' ? a : b;
      const loser = out.winner === 'a' ? b : a;
      reached[loser] = stage;
      if (out.penalties) penaltiesOut[loser] = stage;
      next.push(winner);
    }
    return next;
  };

  if (prelim.length > 0) alive = [...alive, ...playRound(prelim, 'prelim', false)];

  while (alive.length > 1) {
    const roundsLeft = Math.log2(alive.length);
    const stage = STAGES_FROM_FINAL[roundsLeft - 1] ?? 'r64';
    alive = playRound(alive, stage, stage === 'final');
  }
  const winner = alive[0] as string;
  reached[winner] = 'winner';
  return { winner, reached, penaltiesOut };
}
