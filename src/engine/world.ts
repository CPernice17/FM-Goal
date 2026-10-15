import { simulateCup, simulateLeague, type CupResult, type Entrant, type LeagueResult } from './competition';
import { clamp, Rng } from './rng';
import { attachContinental, qualifyContinental, recordWinners, simulateContinental } from './continental';
import type { Club, ContinentalData, CountryData, WorldState } from './types';

export const WORLD = {
  minRating: 45,
  maxRating: 92,
  /** Rumore annuo dei rating. */
  driftSd: 1.0,
  /** Ritorno annuo verso l'ancora. */
  meanReversion: 0.12,
  /** Spinta dei risultati: punti di rating per posizione sopra/sotto le attese. */
  resultPush: 0.12,
  anchorFollow: 0.08,
  promotionBoost: 1,
  relegationHit: 1.5,
};

export function createWorld(countries: CountryData[], season: number, continental?: ContinentalData): WorldState {
  const world: WorldState = { season, clubs: {}, leagues: {}, countries: {}, youthRatings: {} };
  for (const country of countries) {
    world.countries[country.id] = {
      name: country.name,
      cupName: country.cupName,
      youthLeagueName: country.youthLeagueName,
      leagueIds: country.leagues.map((l) => l.id),
    };
    for (const config of country.leagues) {
      const data = country.clubs[config.id] ?? [];
      world.leagues[config.id] = { config, country: country.id, clubIds: data.map((c) => c.id), lastTable: [], standings: [] };
      for (const c of data) addClub(world, c.id, c.name, country.id, config.id, c.rating, c.profile, c.colors);
    }
    for (const c of country.external) addClub(world, c.id, c.name, country.id, null, c.rating, c.profile, c.colors);
  }
  if (continental) attachContinental(world, continental);
  return world;
}

function addClub(
  world: WorldState,
  id: string,
  name: string,
  country: string,
  leagueId: string | null,
  rating: number,
  profile: Club['profile'],
  colors?: [string, string],
): void {
  if (world.clubs[id]) throw new Error(`Club duplicato: ${id}`);
  world.clubs[id] = { id, name, country, leagueId, rating, anchor: rating, profile: { ...profile }, colors };
}

export function club(world: WorldState, id: string): Club {
  const c = world.clubs[id];
  if (!c) throw new Error(`Club sconosciuto: ${id}`);
  return c;
}

/** Prima divisione del paese: le sue Primavera formano il campionato giovanile. */
export function topLeagueId(world: WorldState, country: string): string {
  const ids = world.countries[country]?.leagueIds ?? [];
  const top = ids.map((id) => world.leagues[id]).find((l) => l?.config.division === 1);
  if (!top) throw new Error(`Nessuna prima divisione per ${country}`);
  return top.config.id;
}

/**
 * Squadre del campionato Primavera: le Primavera dei club di prima divisione.
 * `include` è la Primavera allenata dal giocatore: se la prima squadra non è in
 * massima serie (per esempio dopo una retrocessione) entra comunque, al posto
 * della Primavera più debole, così il campionato resta della stessa dimensione.
 */
export function youthClubIds(world: WorldState, country: string, include?: string | null): string[] {
  const ids = [...(world.leagues[topLeagueId(world, country)]?.clubIds ?? [])];
  if (include && !ids.includes(include) && world.clubs[include]?.country === country && ids.length > 0) {
    ids.sort((a, b) => (world.youthRatings[a] ?? 0) - (world.youthRatings[b] ?? 0));
    ids[0] = include;
  }
  return ids;
}

/**
 * Rating delle Primavera di tutti i club dei paesi simulati, anche di quelli
 * scesi in una serie non simulata (la loro Primavera può essere ancora allenata).
 */
export function refreshYouthRatings(world: WorldState, rng: Rng): void {
  world.youthRatings = {};
  const pool = world.continental?.poolConfed ?? {};
  for (const c of Object.values(world.clubs)) {
    if (pool[c.id] || !world.countries[c.country]) continue;
    world.youthRatings[c.id] = clamp(Math.round(50 + (c.rating - 60) * 0.5 + rng.range(-6, 6)), 35, 80);
  }
}

/** Fascia 1–5 di un club all'interno del proprio campionato (1 = big). */
export function tierInLeague(world: WorldState, clubId: string): number {
  const c = club(world, clubId);
  if (!c.leagueId) return 5;
  const ids = world.leagues[c.leagueId]?.clubIds ?? [];
  const sorted = [...ids].sort((a, b) => club(world, b).rating - club(world, a).rating);
  const rank = sorted.indexOf(clubId);
  return Math.min(5, 1 + Math.floor((rank / sorted.length) * 5));
}

export function divisionOf(world: WorldState, clubId: string): number | null {
  const c = club(world, clubId);
  return c.leagueId ? world.leagues[c.leagueId]?.config.division ?? null : null;
}

/** Posizione attesa di ogni club: classifica per rating senza casualità. */
export function expectedPositions(entrants: Entrant[]): Record<string, number> {
  const sorted = [...entrants].sort((a, b) => b.rating - a.rating);
  const out: Record<string, number> = {};
  sorted.forEach((e, i) => (out[e.id] = i + 1));
  return out;
}

export interface WorldSeasonResult {
  leagues: Record<string, LeagueResult>;
  expected: Record<string, Record<string, number>>;
  cups: Record<string, CupResult>;
  youth: Record<string, LeagueResult>;
  youthExpected: Record<string, Record<string, number>>;
  playoffWinners: Record<string, string>;
  /** Vincitori del titolo nei campionati che lo assegnano con un playoff. */
  titleWinners: Record<string, string>;
  /** Coppe continentali, supercoppe e competizioni mondiali della stagione. */
  continental: Record<string, CupResult>;
}

/**
 * Simula l'intera stagione di tutti i campionati, delle coppe nazionali e dei
 * campionati Primavera. `override` sostituisce il rating effettivo di singole
 * squadre (quella allenata dal giocatore).
 */
export function simulateWorldSeason(
  world: WorldState,
  rng: Rng,
  override: {
    first: Record<string, number>;
    youth: Record<string, number>;
    /** Rating nel girone di ritorno, prima squadra e Primavera (stesso id del club, mappe separate). */
    secondFirst?: Record<string, number>;
    secondYouth?: Record<string, number>;
  },
): WorldSeasonResult {
  const ratingOf = (id: string) => override.first[id] ?? club(world, id).rating;
  const result: WorldSeasonResult = {
    leagues: {},
    expected: {},
    cups: {},
    youth: {},
    youthExpected: {},
    playoffWinners: {},
    titleWinners: {},
    continental: {},
  };

  for (const league of Object.values(world.leagues)) {
    const entrants = league.clubIds.map((id) => ({ id, rating: ratingOf(id) }));
    result.expected[league.config.id] = expectedPositions(entrants);
    result.leagues[league.config.id] = simulateLeague(rng, entrants, league.config.rounds ?? 2, override.secondFirst);
  }

  for (const [countryId, country] of Object.entries(world.countries)) {
    const cupEntrants = country.leagueIds.flatMap((lid) =>
      (world.leagues[lid]?.clubIds ?? []).map((id) => ({ id, rating: ratingOf(id) })),
    );
    if (cupEntrants.length >= 2) result.cups[countryId] = simulateCup(rng, cupEntrants);

    const coachYouth = Object.keys(override.youth).find((id) => world.clubs[id]?.country === countryId);
    const youthEntrants = youthClubIds(world, countryId, coachYouth).map((id) => ({
      id,
      rating: override.youth[id] ?? world.youthRatings[id] ?? 50,
    }));
    result.youthExpected[countryId] = expectedPositions(youthEntrants);
    const topRounds = world.leagues[topLeagueId(world, countryId)]?.config.rounds ?? 2;
    result.youth[countryId] = simulateLeague(rng, youthEntrants, topRounds, override.secondYouth);
  }

  // Playoff promozione: eliminazione diretta tra le posizioni indicate.
  for (const league of Object.values(world.leagues)) {
    const po = league.config.playoff;
    const table = result.leagues[league.config.id]?.table;
    if (!po || !table) continue;
    const contenders = table.slice(po.from - 1, po.to).map((r) => ({ id: r.id, rating: ratingOf(r.id) }));
    if (contenders.length >= 2) result.playoffWinners[league.config.id] = simulateCup(rng, contenders).winner;
  }

  result.continental = simulateContinental(world, rng, ratingOf);

  // Playoff per il titolo: eliminazione diretta tra le prime N.
  for (const league of Object.values(world.leagues)) {
    const n = league.config.championPlayoff;
    const table = result.leagues[league.config.id]?.table;
    if (!n || !table) continue;
    const contenders = table.slice(0, n).map((r) => ({ id: r.id, rating: ratingOf(r.id) }));
    if (contenders.length >= 2) result.titleWinners[league.config.id] = simulateCup(rng, contenders).winner;
  }
  return result;
}

export interface Movement {
  clubId: string;
  from: string | null;
  to: string | null;
}

/** Promozioni e retrocessioni, poi evoluzione dei rating. Restituisce i movimenti. */
export function endOfSeason(world: WorldState, rng: Rng, season: WorldSeasonResult): Movement[] {
  const moves: Movement[] = [];

  for (const league of Object.values(world.leagues)) {
    const table = season.leagues[league.config.id]?.table ?? [];
    league.lastTable = table.map((r) => r.id);
    league.standings = table.map((r) => ({ id: r.id, points: r.points, gf: r.gf, ga: r.ga }));
  }

  for (const league of Object.values(world.leagues)) {
    const cfg = league.config;
    const table = league.lastTable;
    if (cfg.relegated <= 0) continue;
    const down = table.slice(-cfg.relegated);

    if (cfg.down) {
      const lower = world.leagues[cfg.down];
      if (!lower) continue;
      const up = lower.lastTable.slice(0, lower.config.promotedDirect);
      const po = season.playoffWinners[cfg.down];
      if (po && !up.includes(po)) up.push(po);
      for (const id of down) moves.push({ clubId: id, from: cfg.id, to: cfg.down });
      for (const id of up.slice(0, down.length)) moves.push({ clubId: id, from: cfg.down, to: cfg.id });
    } else {
      // Ultima divisione modellata: scambio con i club esterni dello stesso paese.
      const pool = Object.values(world.clubs)
        .filter((c) => c.country === league.country && c.leagueId === null)
        .map((c) => ({ id: c.id, score: c.rating + rng.normal(0, 2) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, down.length);
      for (const id of down) moves.push({ clubId: id, from: cfg.id, to: null });
      for (const p of pool) moves.push({ clubId: p.id, from: null, to: cfg.id });
    }
  }

  for (const m of moves) {
    const c = club(world, m.clubId);
    if (m.from) {
      const l = world.leagues[m.from];
      if (l) l.clubIds = l.clubIds.filter((id) => id !== m.clubId);
    }
    if (m.to) world.leagues[m.to]?.clubIds.push(m.clubId);
    c.leagueId = m.to;
    const goingUp = m.to !== null && (m.from === null || (world.leagues[m.to]?.config.division ?? 9) < (world.leagues[m.from]?.config.division ?? 9));
    c.rating += goingUp ? WORLD.promotionBoost : -WORLD.relegationHit;
  }

  // Coppe continentali: ultimi vincitori e qualificate alla prossima stagione.
  recordWinners(world, season.continental);
  const cupWinners = Object.fromEntries(Object.entries(season.cups).map(([country, cup]) => [country, cup.winner]));
  qualifyContinental(world, rng, cupWinners);

  evolveRatings(world, rng, season);
  world.season += 1;
  return moves;
}

function evolveRatings(world: WorldState, rng: Rng, season: WorldSeasonResult): void {
  const push: Record<string, number> = {};
  for (const [leagueId, res] of Object.entries(season.leagues)) {
    const expected = season.expected[leagueId] ?? {};
    res.table.forEach((row, i) => {
      const exp = expected[row.id] ?? i + 1;
      push[row.id] = clamp((exp - (i + 1)) * WORLD.resultPush, -2, 2);
    });
  }
  for (const c of Object.values(world.clubs)) {
    c.rating += rng.normal(0, WORLD.driftSd) + WORLD.meanReversion * (c.anchor - c.rating) + (push[c.id] ?? 0);
    c.rating = clamp(Math.round(c.rating * 10) / 10, WORLD.minRating, WORLD.maxRating);
    c.anchor += WORLD.anchorFollow * (c.rating - c.anchor);
  }
}
