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

export type CupStage = 'winner' | 'final' | 'semi' | 'quarter' | 'r16' | 'r32' | 'r64' | 'prelim' | 'group' | 'league' | 'playoff' | 'r1';

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

export interface TieResult {
  winner: Entrant;
  loser: Entrant;
  penalties: boolean;
}

/**
 * Sfida a eliminazione diretta. Con due partite conta la somma dei gol e la
 * seconda si gioca in casa di `b` (la testa di serie); in parità, rigori.
 */
export function playTie(rng: Rng, a: Entrant, b: Entrant, legs: 1 | 2, neutral = false): TieResult {
  if (legs === 1) {
    const out = playKnockout(rng, a.rating, b.rating, neutral);
    return out.winner === 'a' ? { winner: a, loser: b, penalties: out.penalties } : { winner: b, loser: a, penalties: out.penalties };
  }
  const first = playMatch(rng, a.rating, b.rating);
  const second = playMatch(rng, b.rating, a.rating);
  const goalsA = first.home + second.away;
  const goalsB = first.away + second.home;
  if (goalsA !== goalsB) return goalsA > goalsB ? { winner: a, loser: b, penalties: false } : { winner: b, loser: a, penalties: false };
  const pA = 0.5 + Math.max(-0.1, Math.min(0.1, (a.rating - b.rating) * 0.005));
  return rng.chance(pA) ? { winner: a, loser: b, penalties: true } : { winner: b, loser: a, penalties: true };
}

export interface BracketOptions {
  /** Partite per turno, in base al numero di squadre rimaste (la finale ha 2 squadre). */
  legs: (teamsLeft: number) => 1 | 2;
  /** Finale in campo neutro. */
  neutralFinal: boolean;
  /** Primo turno: la metà alta (teste di serie) contro la metà bassa. */
  seeded?: boolean;
}

/** Tabellone a eliminazione diretta su squadre in numero potenza di 2. */
export function playBracket(rng: Rng, teams: Entrant[], opts: BracketOptions, out: CupResult): Entrant {
  let alive = [...teams];
  let first = true;
  while (alive.length > 1) {
    const stage = STAGES_FROM_FINAL[Math.log2(alive.length) - 1] ?? 'r64';
    const legs = opts.legs(alive.length);
    let pairs: [Entrant, Entrant][] = [];
    if (first && opts.seeded) {
      const half = alive.length / 2;
      const top = alive.slice(0, half);
      const bottom = rng.shuffle(alive.slice(half));
      pairs = top.map((t, i) => [bottom[i] as Entrant, t]);
    } else {
      const shuffled = rng.shuffle([...alive]);
      for (let i = 0; i < shuffled.length; i += 2) pairs.push([shuffled[i] as Entrant, shuffled[i + 1] as Entrant]);
    }
    const next: Entrant[] = [];
    for (const [a, b] of pairs) {
      const tie = playTie(rng, a, b, legs, alive.length === 2 && opts.neutralFinal);
      out.reached[tie.loser.id] = stage;
      if (tie.penalties) out.penaltiesOut[tie.loser.id] = stage;
      next.push(tie.winner);
    }
    alive = next;
    first = false;
  }
  const winner = alive[0] as Entrant;
  out.reached[winner.id] = 'winner';
  out.winner = winner.id;
  return winner;
}

/**
 * Fase campionato "svizzera": ogni squadra gioca `matches` partite contro
 * avversari diversi (accoppiamenti casuali, senza ripetizioni quando possibile).
 */
export function simulateSwissLeague(rng: Rng, entrants: Entrant[], matches: number): TableRow[] {
  const rows = new Map<string, TableRow>(entrants.map((e) => [e.id, { id: e.id, played: 0, points: 0, gf: 0, ga: 0 }]));
  const met = new Set<string>();
  const key = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);
  for (let round = 0; round < matches; round++) {
    let pairs: [Entrant, Entrant][] = [];
    for (let attempt = 0; attempt < 30; attempt++) {
      const pool = rng.shuffle([...entrants]);
      pairs = [];
      let ok = true;
      while (pool.length > 1) {
        const a = pool.shift() as Entrant;
        const idx = pool.findIndex((b) => !met.has(key(a.id, b.id)));
        if (idx < 0) {
          ok = false;
          pairs.push([a, pool.shift() as Entrant]);
        } else {
          pairs.push([a, pool.splice(idx, 1)[0] as Entrant]);
        }
      }
      if (ok) break;
    }
    for (const [a, b] of pairs) {
      met.add(key(a.id, b.id));
      const [home, away] = round % 2 === 0 ? [a, b] : [b, a];
      const res = playMatch(rng, home.rating, away.rating);
      const rh = rows.get(home.id) as TableRow;
      const ra = rows.get(away.id) as TableRow;
      rh.played++;
      ra.played++;
      rh.gf += res.home;
      rh.ga += res.away;
      ra.gf += res.away;
      ra.ga += res.home;
      rh.points += res.home > res.away ? 3 : res.home === res.away ? 1 : 0;
      ra.points += res.away > res.home ? 3 : res.home === res.away ? 1 : 0;
    }
  }
  const tiebreak = new Map(entrants.map((e) => [e.id, rng.next()]));
  return [...rows.values()].sort(
    (x, y) => y.points - x.points || y.gf - y.ga - (x.gf - x.ga) || y.gf - x.gf || (tiebreak.get(y.id) ?? 0) - (tiebreak.get(x.id) ?? 0),
  );
}

/** Gironi da quattro con teste di serie per rating; restituisce le classifiche. */
export function simulateGroups(rng: Rng, entrants: Entrant[], groupsCount: number, rounds: 1 | 2): TableRow[][] {
  const sorted = [...entrants].sort((a, b) => b.rating - a.rating);
  const groups: Entrant[][] = Array.from({ length: groupsCount }, () => []);
  const pots = Math.ceil(sorted.length / groupsCount);
  for (let pot = 0; pot < pots; pot++) {
    const potTeams = rng.shuffle(sorted.slice(pot * groupsCount, (pot + 1) * groupsCount));
    potTeams.forEach((team, i) => groups[i]?.push(team));
  }
  return groups.filter((g) => g.length >= 2).map((g) => simulateLeague(rng, g, rounds).table);
}
