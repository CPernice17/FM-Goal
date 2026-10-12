import {
  playBracket,
  playTie,
  simulateGroups,
  simulateSwissLeague,
  type CupResult,
  type Entrant,
} from './competition';
import { Rng } from './rng';
import type { CompFormat, Confederation, ContinentalComp, ContinentalData, WorldState } from './types';

/**
 * Coppe continentali, supercoppe e competizioni mondiali con i formati reali
 * 2026/27 (senza turni preliminari: chi li gioca entra nella fase principale).
 * I club dei paesi simulati si qualificano dalla classifica della massima
 * serie e dalla coppa nazionale; i posti restanti vanno ai club esterni.
 */

export function attachContinental(world: WorldState, data: ContinentalData): void {
  const poolConfed: Record<string, string> = {};
  const poolRegion: Record<string, string> = {};
  for (const c of data.pool) {
    if (world.clubs[c.id]) throw new Error(`Club esterno duplicato: ${c.id}`);
    world.clubs[c.id] = { id: c.id, name: c.name, country: c.country, leagueId: null, rating: c.rating, anchor: c.rating, profile: { build: 0, press: 10 } };
    poolConfed[c.id] = c.confed;
    if (c.region) poolRegion[c.id] = c.region;
  }
  const { pool: _pool, ...defs } = data;
  world.continental = { defs, poolConfed, poolRegion, qualified: {}, lastWinners: {} };
}

export type CompKind = 'continental' | 'supercup' | 'intercontinental' | 'clubWorldCup';

export interface CompInfo {
  id: string;
  name: string;
  kind: CompKind;
  tier: number;
}

export function compInfo(world: WorldState, id: string): CompInfo | null {
  const defs = world.continental?.defs;
  if (!defs) return null;
  for (const conf of defs.confederations) {
    const comp = conf.competitions.find((c) => c.id === id);
    if (comp) return { id, name: comp.name, kind: 'continental', tier: comp.tier };
    if (conf.supercup?.id === id) return { id, name: conf.supercup.name, kind: 'supercup', tier: 0 };
  }
  if (defs.intercontinental.id === id) return { id, name: defs.intercontinental.name, kind: 'intercontinental', tier: 0 };
  if (defs.clubWorldCup.id === id) return { id, name: defs.clubWorldCup.name, kind: 'clubWorldCup', tier: 0 };
  return null;
}

/** Numero di partecipanti di un formato (per regione, se il formato è regionale). */
function formatSize(format: CompFormat): number {
  switch (format.type) {
    case 'league':
      return format.teams;
    case 'groups':
      return format.groups * 4;
    case 'regionalLeague':
      return format.teamsPerRegion;
    case 'knockout':
      return format.teams;
  }
}

function isRegional(format: CompFormat): boolean {
  return format.type === 'regionalLeague' || (format.type === 'groups' && !!format.regional);
}

/** Club della massima serie di un paese in ordine di classifica (o di forza, alla prima stagione). */
function ranking(world: WorldState, country: string): string[] {
  const top = Object.values(world.leagues).find((l) => l.country === country && l.config.division === 1);
  if (!top) return [];
  if (top.lastTable.length > 0) return top.lastTable.filter((id) => world.clubs[id]?.leagueId === top.config.id);
  return [...top.clubIds].sort((a, b) => (world.clubs[b]?.rating ?? 0) - (world.clubs[a]?.rating ?? 0));
}

/**
 * Qualificate alla prossima stagione. Per le coppe regionali le squadre sono
 * elencate regione per regione (prima la metà ovest, poi la metà est).
 */
export function qualifyContinental(world: WorldState, rng: Rng, cupWinners: Record<string, string>): void {
  const cont = world.continental;
  if (!cont) return;
  const used = new Set<string>();
  const qualified: Record<string, string[]> = {};

  for (const conf of cont.defs.confederations) {
    const orders = Object.fromEntries(conf.countries.map((c) => [c, ranking(world, c)]));
    const regions: [string | null, string[]][] = conf.regions ? Object.entries(conf.regions) : [[null, conf.countries]];
    for (const comp of [...conf.competitions].sort((a, b) => a.tier - b.tier)) {
      const parts = isRegional(comp.format) ? regions : ([[null, conf.countries]] as [string | null, string[]][]);
      const list: string[] = [];
      for (const [region, countries] of parts) {
        const part: string[] = [];
        for (const country of countries) pickNational(comp, country, orders[country] ?? [], cupWinners[country], world, used, part);
        const size = expectedSize(conf, comp) / parts.length;
        const candidates = Object.keys(cont.poolConfed)
          .filter((id) => cont.poolConfed[id] === conf.id && !used.has(id) && (!region || cont.poolRegion[id] === region))
          .map((id) => ({ id, score: (world.clubs[id]?.rating ?? 60) + rng.normal(0, 2.5) }))
          .sort((a, b) => b.score - a.score);
        for (const c of candidates) {
          if (part.length >= size) break;
          part.push(c.id);
          used.add(c.id);
        }
        list.push(...part);
      }
      qualified[comp.id] = list;
    }
  }
  cont.qualified = qualified;
}

/** Posti di un paese in una coppa: classifica, con la vincitrice della coppa nazionale al secondo livello. */
function pickNational(
  comp: ContinentalComp,
  country: string,
  order: string[],
  cupWinner: string | undefined,
  world: WorldState,
  used: Set<string>,
  out: string[],
): void {
  let n = comp.slots[country] ?? 0;
  if (comp.tier === 2 && n > 0 && cupWinner && !used.has(cupWinner) && world.clubs[cupWinner]?.leagueId) {
    out.push(cupWinner);
    used.add(cupWinner);
    n--;
  }
  for (const id of order) {
    if (n <= 0) break;
    if (used.has(id)) continue;
    out.push(id);
    used.add(id);
    n--;
  }
}

/** Confederazione di un club: dal paese per i club simulati, dal pool per gli esterni. */
export function confedOf(world: WorldState, clubId: string): string | null {
  const cont = world.continental;
  if (!cont) return null;
  if (cont.poolConfed[clubId]) return cont.poolConfed[clubId] ?? null;
  const country = world.clubs[clubId]?.country;
  return cont.defs.confederations.find((c) => country && c.countries.includes(country))?.id ?? null;
}

function emptyResult(): CupResult {
  return { winner: '', reached: {}, penaltiesOut: {} };
}

const twoLegsButFinal = (teamsLeft: number): 1 | 2 => (teamsLeft === 2 ? 1 : 2);

/** Fase campionato + playoff + eliminazione diretta (coppe UEFA). */
function playLeagueFormat(rng: Rng, entrants: Entrant[], f: Extract<CompFormat, { type: 'league' }>): CupResult {
  const out = emptyResult();
  const table = simulateSwissLeague(rng, entrants, f.matches);
  const byId = new Map(entrants.map((e) => [e.id, e]));
  const at = (i: number) => byId.get(table[i]?.id ?? '') as Entrant;
  table.slice(f.playoffTo).forEach((r) => (out.reached[r.id] = 'league'));
  // Playoff: 9ª–16ª (teste di serie) contro 17ª–24ª.
  const seededHalf = Array.from({ length: (f.playoffTo - f.direct) / 2 }, (_, i) => at(f.direct + i));
  const unseeded = rng.shuffle(Array.from({ length: (f.playoffTo - f.direct) / 2 }, (_, i) => at(f.direct + seededHalf.length + i)));
  const playoffWinners: Entrant[] = [];
  seededHalf.forEach((s, i) => {
    const tie = playTie(rng, unseeded[i] as Entrant, s, 2);
    out.reached[tie.loser.id] = 'playoff';
    if (tie.penalties) out.penaltiesOut[tie.loser.id] = 'playoff';
    playoffWinners.push(tie.winner);
  });
  const top = Array.from({ length: f.direct }, (_, i) => at(i));
  playBracket(rng, [...top, ...playoffWinners], { legs: twoLegsButFinal, neutralFinal: true, seeded: true }, out);
  return out;
}

interface GroupsOutcome {
  result: CupResult;
  thirds: Entrant[];
}

/** Gironi da quattro, poi eliminazione diretta (Libertadores, Sudamericana, ACL Two, Mondiale per club). */
function playGroupsFormat(
  rng: Rng,
  entrants: Entrant[],
  f: Extract<CompFormat, { type: 'groups' }>,
  thirdsFromOther: Entrant[],
): GroupsOutcome {
  const out = emptyResult();
  const rounds: 1 | 2 = f.singleLeg ? 1 : 2;
  const byId = new Map(entrants.map((e) => [e.id, e]));
  // Gironi regionali: metà gironi con la prima metà delle squadre, metà con la seconda.
  const halves = f.regional ? [entrants.slice(0, entrants.length / 2), entrants.slice(entrants.length / 2)] : [entrants];
  const tables = halves.flatMap((h) => simulateGroups(rng, h, f.groups / halves.length, rounds));

  const winners: Entrant[] = [];
  const runnersUp: Entrant[] = [];
  const thirds: Entrant[] = [];
  for (const t of tables) {
    t.forEach((row, i) => {
      const e = byId.get(row.id) as Entrant;
      if (i === 0) winners.push(e);
      else if (i === 1) runnersUp.push(e);
      else {
        out.reached[row.id] = 'group';
        if (i === 2) thirds.push(e);
      }
    });
  }

  let second = runnersUp;
  if (f.advance === 1 && f.playoffWithThirdsOf && thirdsFromOther.length >= runnersUp.length) {
    // Playoff: seconde dei gironi (in casa al ritorno) contro le terze dell'altra coppa.
    const others = rng.shuffle([...thirdsFromOther]);
    second = runnersUp.map((r, i) => {
      const o = others[i] as Entrant;
      const tie = playTie(rng, o, r, 2);
      out.reached[tie.loser.id] = 'playoff';
      if (tie.penalties) out.penaltiesOut[tie.loser.id] = 'playoff';
      return tie.winner;
    });
  }
  const legs = f.singleLeg ? () => 1 as const : twoLegsButFinal;
  playBracket(rng, [...winners, ...second], { legs, neutralFinal: true, seeded: true }, out);
  return { result: out, thirds };
}

/** Fase campionato regionale, ottavi regionali, fase finale in gara secca (AFC Champions League Elite). */
function playRegionalLeague(rng: Rng, entrants: Entrant[], f: Extract<CompFormat, { type: 'regionalLeague' }>): CupResult {
  const out = emptyResult();
  const byId = new Map(entrants.map((e) => [e.id, e]));
  const halves = [entrants.slice(0, f.teamsPerRegion), entrants.slice(f.teamsPerRegion)];
  const finalists: Entrant[] = [];
  for (const half of halves) {
    if (half.length < 2) continue;
    const table = simulateSwissLeague(rng, half, Math.min(f.matches, half.length - 1));
    table.slice(f.advance).forEach((r) => (out.reached[r.id] = 'league'));
    const top = table.slice(0, f.advance).map((r) => byId.get(r.id) as Entrant);
    // Ottavi regionali: 1ª contro 8ª, 2ª contro 7ª, …
    for (let i = 0; i < top.length / 2; i++) {
      const tie = playTie(rng, top[top.length - 1 - i] as Entrant, top[i] as Entrant, 2);
      out.reached[tie.loser.id] = 'r16';
      if (tie.penalties) out.penaltiesOut[tie.loser.id] = 'r16';
      finalists.push(tie.winner);
    }
  }
  playBracket(rng, finalists, { legs: () => 1, neutralFinal: true }, out);
  return out;
}

/** Sola eliminazione diretta con ammesse agli ottavi (CONCACAF Champions Cup). */
function playKnockoutFormat(rng: Rng, entrants: Entrant[], f: Extract<CompFormat, { type: 'knockout' }>): CupResult {
  const out = emptyResult();
  const sorted = [...entrants].sort((a, b) => b.rating - a.rating);
  const byes = sorted.slice(0, f.byes);
  const firstRound = rng.shuffle(sorted.slice(f.byes));
  const winners: Entrant[] = [];
  for (let i = 0; i + 1 < firstRound.length; i += 2) {
    const tie = playTie(rng, firstRound[i] as Entrant, firstRound[i + 1] as Entrant, 2);
    out.reached[tie.loser.id] = 'r1';
    if (tie.penalties) out.penaltiesOut[tie.loser.id] = 'r1';
    winners.push(tie.winner);
  }
  playBracket(rng, [...byes, ...winners], { legs: twoLegsButFinal, neutralFinal: true, seeded: true }, out);
  return out;
}

export function simulateContinental(world: WorldState, rng: Rng, ratingOf: (id: string) => number): Record<string, CupResult> {
  const cont = world.continental;
  const out: Record<string, CupResult> = {};
  if (!cont) return out;
  if (Object.keys(cont.qualified).length === 0) qualifyContinental(world, rng, {});
  const entrant = (id: string): Entrant => ({ id, rating: ratingOf(id) });

  for (const conf of cont.defs.confederations) {
    playSupercup(conf, cont.lastWinners, rng, ratingOf, out);
    const thirds: Record<string, Entrant[]> = {};
    for (const comp of [...conf.competitions].sort((a, b) => a.tier - b.tier)) {
      const ids = cont.qualified[comp.id] ?? [];
      if (ids.length < 2) continue;
      const entrants = ids.map(entrant);
      const f = comp.format;
      if (f.type === 'league') out[comp.id] = playLeagueFormat(rng, entrants, f);
      else if (f.type === 'regionalLeague') out[comp.id] = playRegionalLeague(rng, entrants, f);
      else if (f.type === 'knockout') out[comp.id] = playKnockoutFormat(rng, entrants, f);
      else {
        const res = playGroupsFormat(rng, entrants, f, f.playoffWithThirdsOf ? (thirds[f.playoffWithThirdsOf] ?? []) : []);
        out[comp.id] = res.result;
        thirds[comp.id] = res.thirds;
      }
    }
  }

  playIntercontinental(world, rng, entrant, out);
  playClubWorldCup(world, rng, entrant, out);
  return out;
}

/** Supercoppa: vincitrici dei due livelli della stagione precedente, gara secca in campo neutro. */
function playSupercup(
  conf: Confederation,
  lastWinners: Record<string, string>,
  rng: Rng,
  ratingOf: (id: string) => number,
  out: Record<string, CupResult>,
): void {
  const sc = conf.supercup;
  const a = sc ? lastWinners[sc.from[0]] : undefined;
  const b = sc ? lastWinners[sc.from[1]] : undefined;
  if (!sc || !a || !b || a === b) return;
  const tie = playTie(rng, { id: a, rating: ratingOf(a) }, { id: b, rating: ratingOf(b) }, 1, true);
  out[sc.id] = {
    winner: tie.winner.id,
    reached: { [tie.winner.id]: 'winner', [tie.loser.id]: 'final' },
    penaltiesOut: tie.penalties ? { [tie.loser.id]: 'final' } : {},
  };
}

/**
 * Trofeo intercontinentale (formato FIFA): Nord America contro Sud America,
 * la vincente contro la campione asiatica, poi la finale con la campione europea.
 * Tutte gare secche in campo neutro.
 */
function playIntercontinental(world: WorldState, rng: Rng, entrant: (id: string) => Entrant, out: Record<string, CupResult>): void {
  const cont = world.continental;
  if (!cont) return;
  const champ = (confId: string) => {
    const tier1 = cont.defs.confederations.find((c) => c.id === confId)?.competitions.find((c) => c.tier === 1);
    return tier1 ? cont.lastWinners[tier1.id] : undefined;
  };
  const order = ['concacaf', 'conmebol', 'afc', 'uefa'].map(champ).filter((id): id is string => !!id);
  if (order.length < 2) return;
  const res = emptyResult();
  const stages = ['r1', 'semi', 'final'] as const;
  let current = entrant(order[0] as string);
  for (let i = 1; i < order.length; i++) {
    const tie = playTie(rng, current, entrant(order[i] as string), 1, true);
    const stage = stages[Math.max(0, stages.length - (order.length - i))] ?? 'final';
    res.reached[tie.loser.id] = stage;
    if (tie.penalties) res.penaltiesOut[tie.loser.id] = stage;
    current = tie.winner;
  }
  res.reached[current.id] = 'winner';
  res.winner = current.id;
  out[cont.defs.intercontinental.id] = res;
}

/** Mondiale per club ogni quattro anni: 32 squadre, gironi a sola andata, poi eliminazione diretta in gara secca. */
function playClubWorldCup(world: WorldState, rng: Rng, entrant: (id: string) => Entrant, out: Record<string, CupResult>): void {
  const cont = world.continental;
  if (!cont) return;
  const cwc = cont.defs.clubWorldCup;
  if (world.season < cwc.firstYear || (world.season - cwc.firstYear) % cwc.every !== 0) return;
  const field: string[] = [];
  for (const [confId, quota] of Object.entries(cwc.quotas)) {
    const tier1 = cont.defs.confederations.find((c) => c.id === confId)?.competitions.find((c) => c.tier === 1);
    const champ = tier1 ? cont.lastWinners[tier1.id] : undefined;
    const strongest = Object.values(world.clubs)
      .filter((c) => c.id !== champ && confedOf(world, c.id) === confId)
      .filter((c) => (c.leagueId === null ? !!cont.poolConfed[c.id] : world.leagues[c.leagueId]?.config.division === 1))
      .sort((x, y) => y.rating - x.rating)
      .map((c) => c.id);
    field.push(...[...(champ ? [champ] : []), ...strongest].slice(0, quota));
  }
  if (field.length < 32) return;
  const f: CompFormat = { type: 'groups', groups: 8, advance: 2, singleLeg: true };
  out[cwc.id] = playGroupsFormat(rng, field.slice(0, 32).map(entrant), f, []).result;
}

export function recordWinners(world: WorldState, results: Record<string, CupResult>): void {
  const cont = world.continental;
  if (!cont) return;
  for (const conf of cont.defs.confederations) {
    for (const comp of conf.competitions) {
      const r = results[comp.id];
      if (r?.winner) cont.lastWinners[comp.id] = r.winner;
    }
  }
}

/** Partecipanti attesi di una coppa (per i test e per l'interfaccia). */
export function expectedSize(conf: Confederation, comp: ContinentalComp): number {
  const regions = conf.regions ? Object.keys(conf.regions).length : 1;
  return comp.format.type === 'regionalLeague' ? comp.format.teamsPerRegion * regions : formatSize(comp.format);
}
