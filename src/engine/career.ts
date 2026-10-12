import type { LeagueResult } from './competition';
import { applyEffects, selectEvent } from './events/runtime';
import type { EventDef } from './events/schema';
import { clamp, Rng } from './rng';
import { ageKeyPlayers, averageSatisfaction, fillKeyPlayers } from './squad';
import {
  LICENSE_ORDER,
  type CareerOption,
  type CareerSummary,
  type Coach,
  type CountryData,
  type GameState,
  type Headline,
  type Job,
  type Lang,
  type ObjectiveId,
  type Offer,
  type Pending,
  type Role,
  type SeasonReport,
  type Style,
} from './types';
import {
  club,
  createWorld,
  divisionOf,
  endOfSeason,
  expectedPositions,
  refreshYouthRatings,
  simulateWorldSeason,
  tierInLeague,
  youthClubIds,
  type WorldSeasonResult,
} from './world';

export const SAVE_VERSION = 1;

/** Tutti i numeri da bilanciare con il simulatore di carriere. */
export const BALANCE = {
  startAge: 35,
  retireAge: 70,
  /** Da quest'età, a fine stagione, può arrivare la proposta di ritiro. */
  retireOfferAge: 52,
  /** Probabilità della proposta: base + incremento per ogni anno oltre la soglia. */
  retireOfferBase: 0.15,
  retireOfferPerYear: 0.10,
  startReputation: 10,
  maxUnemployedTurns: 3,
  youthPrestige: 0.35,
  youthTurnYears: 2,
  /** Rendimento: spogliatoio (±punti di rating agli estremi). */
  dressingImpact: 3.5,
  /** Rendimento: penalità massima per stile opposto alla rosa. */
  styleFitImpact: 4,
  /** Forma stagionale casuale della squadra (deviazione standard). */
  formSd: 1.5,
  boardPerPosition: 3.5,
  environmentPerPosition: 3,
  reputationPerPosition: 2.0,
  experienceReputation: 0.5,
  midSeasonFireBoard: 15,
  midSeasonFireJudgment: -3,
  endSeasonFireBoard: 20,
  renewalBoard: 50,
  /** Ritorno verso 50 delle variabili d'incarico a ogni stagione. */
  meanReversion: 0.1,
  /** Quanto la rosa si avvicina allo stile dell'allenatore ogni stagione. */
  profileFollow: 0.15,
  /** Rating del club più adatto a una reputazione: base + rep × slope. */
  offerTargetBase: 55,
  offerTargetSlope: 0.33,
  offerSpread: 4,
};

export interface NewCareerOptions {
  name: string;
  nationality: string;
  style: Style;
  seed: number;
  lang?: Lang;
  countries: CountryData[];
  /** Paese della prima Primavera. */
  startCountry?: string;
}

// ---------------------------------------------------------------------------
// Creazione
// ---------------------------------------------------------------------------

export function createCareer(opts: NewCareerOptions): GameState {
  const rng = new Rng(opts.seed);
  const world = createWorld(opts.countries, 2026);
  refreshYouthRatings(world, rng);
  const coach: Coach = {
    name: opts.name,
    nationality: opts.nationality,
    age: BALANCE.startAge,
    style: { build: clamp(opts.style.build, -100, 100), press: clamp(opts.style.press, -100, 100) },
    license: 'B',
    reputation: BALANCE.startReputation,
    peakReputation: BALANCE.startReputation,
  };
  const state: GameState = {
    version: SAVE_VERSION,
    lang: opts.lang ?? 'it',
    rng: 0,
    turn: 1,
    world,
    coach,
    job: null,
    lastClubId: null,
    unemployedTurns: 0,
    flags: {},
    scheduled: [],
    eventLog: {},
    phase: 'preseason',
    pending: null,
    endQueue: [],
    careerShown: false,
    skipOffers: false,
    retireRequested: false,
    lastReport: null,
    history: [],
    firings: 0,
    trophies: [],
    clubsCoached: [],
    summary: null,
    decisions: 0,
  };

  // Prima Primavera: un club di Serie A di fascia medio-bassa.
  const country = opts.startCountry ?? opts.countries[0]?.id ?? 'ita';
  const candidates = youthClubIds(world, country).filter((id) => tierInLeague(world, id) >= 3);
  takeJob(state, rng, { clubId: rng.pick(candidates), role: 'youth', years: 2, challenge: false });
  state.rng = rng.snapshot;
  return state;
}

function withRng<T>(state: GameState, fn: (rng: Rng) => T): T {
  const rng = new Rng(state.rng);
  const out = fn(rng);
  state.rng = rng.snapshot;
  return out;
}

function takeJob(state: GameState, rng: Rng, offer: Offer): void {
  const c = club(state.world, offer.clubId);
  const fitRating = (state.coach.reputation * BALANCE.offerTargetSlope + BALANCE.offerTargetBase - c.rating) * 1.5;
  const job: Job = {
    clubId: offer.clubId,
    role: offer.role,
    contractYears: offer.role === 'youth' ? offer.years * BALANCE.youthTurnYears : offer.years,
    seasons: 0,
    board: clamp(Math.round(50 + clamp(fitRating, -15, 15)), 30, 70),
    dressing: 50,
    environment: offer.challenge ? 40 : 50,
    keyPlayers: [],
    seasonBoost: 0,
  };
  fillKeyPlayers(rng, job, c.country);
  state.job = job;
  state.lastClubId = offer.clubId;
  if (!state.clubsCoached.includes(offer.clubId)) state.clubsCoached.push(offer.clubId);
}

// ---------------------------------------------------------------------------
// Inizio stagione
// ---------------------------------------------------------------------------

export interface Preseason {
  clubName: string;
  leagueName: string;
  role: Role;
  objective: ObjectiveId;
  expectedPosition: number;
  teams: number;
}

/** Forza effettiva della squadra allenata: rating più effetti dell'allenatore. */
export function teamStrength(state: GameState, rng?: Rng): number {
  const job = state.job;
  if (!job) return 0;
  const c = club(state.world, job.clubId);
  const base = job.role === 'youth' ? (state.world.youthRatings[job.clubId] ?? 50) : c.rating;
  const dressing = ((job.dressing - 50) / 50) * BALANCE.dressingImpact;
  const dist = Math.hypot(state.coach.style.build - c.profile.build, state.coach.style.press - c.profile.press);
  const fit = -(dist / 283) * BALANCE.styleFitImpact;
  const form = rng ? rng.normal(0, BALANCE.formSd) : 0;
  return base + job.seasonBoost + dressing + fit + form;
}

function competitionEntrants(state: GameState): { ids: string[]; rating: (id: string) => number; name: string } | null {
  const job = state.job;
  if (!job) return null;
  const c = club(state.world, job.clubId);
  if (job.role === 'youth') {
    return {
      ids: youthClubIds(state.world, c.country),
      rating: (id) => state.world.youthRatings[id] ?? 50,
      name: state.world.countries[c.country]?.youthLeagueName ?? '',
    };
  }
  const league = c.leagueId ? state.world.leagues[c.leagueId] : undefined;
  if (!league) return null;
  return { ids: league.clubIds, rating: (id) => club(state.world, id).rating, name: league.config.name };
}

export function objectiveFor(role: Role, division: number | null, expected: number, teams: number): ObjectiveId {
  if (role === 'youth') return 'youth_growth';
  if (division === 1) {
    if (expected <= 2) return 'title';
    if (expected <= 6) return 'europe';
    if (expected <= Math.floor(teams / 2)) return 'top_half';
    if (expected <= teams - 4) return 'mid_table';
    return 'survival';
  }
  if (expected <= 2) return 'promotion';
  if (expected <= 8) return 'playoff';
  if (expected <= teams - 5) return 'mid_table';
  return 'survival';
}

export function preseason(state: GameState): Preseason | null {
  const job = state.job;
  const comp = competitionEntrants(state);
  if (!job || !comp) return null;
  const strength = teamStrength(state);
  const entrants = comp.ids.map((id) => ({ id, rating: id === job.clubId ? strength : comp.rating(id) }));
  const expected = expectedPositions(entrants)[job.clubId] ?? comp.ids.length;
  return {
    clubName: club(state.world, job.clubId).name,
    leagueName: comp.name,
    role: job.role,
    objective: objectiveFor(job.role, divisionOf(state.world, job.clubId), expected, comp.ids.length),
    expectedPosition: expected,
    teams: comp.ids.length,
  };
}

export function startSeason(state: GameState, events: readonly EventDef[]): GameState {
  assertPhase(state, 'preseason');
  state.careerShown = false;
  if (!state.job) {
    state.phase = 'ready';
    return state;
  }
  const picked = withRng(state, (rng) => selectEvent(state, rng, events, 'start', 'management'));
  if (picked) {
    state.eventLog[picked.event.id] = state.turn;
    state.pending = { kind: 'event', eventId: picked.event.id, bindings: picked.bindings };
    state.phase = 'start_decision';
  } else {
    state.phase = 'ready';
  }
  return state;
}

// ---------------------------------------------------------------------------
// Scelte
// ---------------------------------------------------------------------------

export function choose(state: GameState, optionIndex: number, events: readonly EventDef[]): GameState {
  const pending = state.pending;
  if (!pending || (state.phase !== 'start_decision' && state.phase !== 'end_decision')) {
    throw new Error(`Nessuna decisione in sospeso (fase ${state.phase})`);
  }
  state.decisions += 1;
  if (pending.kind === 'event') {
    const ev = events.find((e) => e.id === pending.eventId);
    const option = ev?.options[optionIndex];
    if (!ev || !option) throw new Error(`Opzione non valida: ${pending.eventId}#${optionIndex}`);
    const out = applyEffects(state, option.effects, pending.bindings);
    if (out.endJob && state.job) loseJob(state);
    if (out.retire) state.retireRequested = true;
  } else {
    const option = pending.options[optionIndex];
    if (!option) throw new Error(`Opzione di carriera non valida: ${optionIndex}`);
    withRng(state, (rng) => applyCareerOption(state, rng, option));
  }
  state.pending = null;

  if (state.phase === 'start_decision') {
    state.phase = 'ready';
    return state;
  }
  return advanceEnd(state, events);
}

function applyCareerOption(state: GameState, rng: Rng, option: CareerOption): void {
  switch (option.kind) {
    case 'accept':
      takeJob(state, rng, option.offer);
      break;
    case 'renew':
      if (state.job) state.job.contractYears = option.years;
      break;
    case 'leave':
      loseJob(state);
      break;
    case 'study': {
      const i = LICENSE_ORDER.indexOf(state.coach.license);
      state.coach.license = LICENSE_ORDER[Math.min(i + 1, LICENSE_ORDER.length - 1)] ?? state.coach.license;
      break;
    }
    case 'retire':
      state.retireRequested = true;
      break;
    case 'stay':
    case 'wait':
    case 'continue':
      break;
  }
}

function loseJob(state: GameState): void {
  if (state.job) state.lastClubId = state.job.clubId;
  state.job = null;
}

// ---------------------------------------------------------------------------
// Stagione
// ---------------------------------------------------------------------------

export function playSeason(state: GameState): GameState {
  assertPhase(state, 'ready');
  withRng(state, (rng) => {
    const job = state.job;
    const override = { first: {} as Record<string, number>, youth: {} as Record<string, number> };
    const pre = preseason(state);
    if (job) {
      const strength = teamStrength(state, rng);
      if (job.role === 'youth') override.youth[job.clubId] = strength;
      else override.first[job.clubId] = strength;
    }
    const season = simulateWorldSeason(state.world, rng, override);
    const report = job && pre ? buildReport(state, rng, season, pre) : null;
    const moves = endOfSeason(state.world, rng, season);

    if (job && report) {
      const move = moves.find((m) => m.clubId === job.clubId);
      if (move && job.role === 'first') {
        const fromDiv = move.from ? state.world.leagues[move.from]?.config.division ?? 9 : 9;
        const toDiv = move.to ? state.world.leagues[move.to]?.config.division ?? 9 : 9;
        if (toDiv < fromDiv) {
          report.headlines.unshift({ id: 'promoted' });
          report.trophies.push(`promotion:${move.from}:${report.season}`);
        } else {
          report.headlines.unshift({ id: 'relegated' });
        }
      }
      applyOutcome(state, rng, report);
      report.headlines = prioritize(report.headlines);
      state.history.push(report);
    }
    state.lastReport = report;
  });
  state.phase = 'report';
  return state;
}

function leagueContext(state: GameState, season: WorldSeasonResult, job: Job) {
  const c = club(state.world, job.clubId);
  if (job.role === 'youth') {
    return {
      res: season.youth[c.country] as LeagueResult,
      prestige: BALANCE.youthPrestige,
      division: null as number | null,
      leagueKey: `youth:${c.country}`,
    };
  }
  const leagueId = c.leagueId as string;
  const league = state.world.leagues[leagueId];
  return {
    res: season.leagues[leagueId] as LeagueResult,
    prestige: league?.config.prestige ?? 0.5,
    division: league?.config.division ?? null,
    leagueKey: `league:${leagueId}`,
  };
}

function buildReport(state: GameState, rng: Rng, season: WorldSeasonResult, pre: Preseason): SeasonReport {
  const job = state.job as Job;
  const c = club(state.world, job.clubId);
  const ctx = leagueContext(state, season, job);
  const table = ctx.res.table;
  const position = table.findIndex((r) => r.id === job.clubId) + 1;
  const row = table[position - 1];
  const judgment = pre.expectedPosition - position;
  const headlines: Headline[] = [];
  const trophies: string[] = [];
  const seasonYear = state.world.season;

  // Esonero a metà stagione: classifica del girone d'andata.
  const half = Math.floor(ctx.res.matchdays / 2);
  const halfTable = Object.entries(ctx.res.logs)
    .map(([id, log]) => ({ id, pts: log.results.slice(0, half).reduce((s, r) => s + r.points, 0) }))
    .sort((a, b) => b.pts - a.pts);
  const halfPos = halfTable.findIndex((r) => r.id === job.clubId) + 1;
  const halfJudgment = pre.expectedPosition - halfPos;
  const boardMid = job.board + clamp(halfJudgment * BALANCE.boardPerPosition, -25, 20);
  let firedAt: number | null = null;
  if (boardMid < BALANCE.midSeasonFireBoard && halfJudgment <= BALANCE.midSeasonFireJudgment) {
    firedAt = clamp(half + rng.int(-4, 4), 8, ctx.res.matchdays - 6);
  }

  const log = ctx.res.logs[job.clubId]?.results ?? [];
  const firstHalf = log.slice(0, half).reduce((s, r) => s + r.points, 0);
  const secondHalf = log.slice(half).reduce((s, r) => s + r.points, 0);
  let streak = 0;
  let best = 0;
  for (const r of log) {
    streak = r.points === 3 ? streak + 1 : 0;
    best = Math.max(best, streak);
  }

  let cup: SeasonReport['cup'] = null;
  if (firedAt !== null) {
    headlines.push({ id: 'fired', values: { matchday: firedAt } });
  } else {
    if (position === 1) {
      headlines.push({ id: 'champion' });
      trophies.push(`${ctx.leagueKey}:${seasonYear}`);
    }
    if (job.role === 'first') {
      const cupRes = season.cups[c.country];
      const reached = cupRes?.reached[job.clubId];
      if (cupRes && reached) {
        cup = { reached, won: reached === 'winner' };
        if (reached === 'winner') {
          headlines.push({ id: 'cup_winner' });
          trophies.push(`cup:${c.country}:${seasonYear}`);
        } else if (cupRes.penaltiesOut[job.clubId]) {
          headlines.push({ id: 'cup_penalties_out', values: { stage: reached } });
        }
      }
    }
    if (judgment >= 4) headlines.push({ id: 'above_expectations' });
    if (judgment <= -4) headlines.push({ id: 'below_expectations' });
    if (best >= 6) headlines.push({ id: 'win_streak', values: { n: best } });
    if (secondHalf <= firstHalf - 10) headlines.push({ id: 'second_half_collapse' });
    if (secondHalf >= firstHalf + 10) headlines.push({ id: 'second_half_surge' });
    const minGa = Math.min(...table.map((r) => r.ga));
    const maxGf = Math.max(...table.map((r) => r.gf));
    if (row && row.ga === minGa) headlines.push({ id: 'best_defence' });
    if (row && row.gf === maxGf) {
      const fw = job.keyPlayers.find((p) => p.position === 'FW');
      headlines.push(fw ? { id: 'top_scorer', values: { player: fw.name } } : { id: 'best_attack' });
    }
  }

  return {
    season: seasonYear,
    clubId: job.clubId,
    clubName: c.name,
    role: job.role,
    leagueName: pre.leagueName,
    position,
    teams: table.length,
    expectedPosition: pre.expectedPosition,
    objective: pre.objective,
    points: row?.points ?? 0,
    table: table.map((r) => ({ clubId: r.id, name: club(state.world, r.id).name, points: r.points, gf: r.gf, ga: r.ga })),
    cup,
    headlines,
    firedAtMatchday: firedAt,
    trophies,
    deltas: { board: 0, dressing: 0, environment: 0, reputation: 0 },
  };
}

const TROPHY_REPUTATION = { league1: 14, league2: 6, youth: 4, cup: 6, promotion: 5, relegation: -6 };

function applyOutcome(state: GameState, rng: Rng, report: SeasonReport): void {
  const job = state.job as Job;
  const ctx = { prestige: job.role === 'youth' ? BALANCE.youthPrestige : (state.world.leagues[club(state.world, job.clubId).leagueId ?? '']?.config.prestige ?? 0.6) };
  const judgment = report.expectedPosition - report.position;
  const has = (id: Headline['id']) => report.headlines.some((h) => h.id === id);
  const before = { board: job.board, dressing: job.dressing, environment: job.environment, reputation: state.coach.reputation };

  let repGain = BALANCE.experienceReputation;
  if (report.firedAtMatchday !== null) {
    repGain += -6 * ctx.prestige;
    job.board = 0;
  } else {
    repGain += clamp(judgment * BALANCE.reputationPerPosition, -8, 10) * ctx.prestige;
    if (has('champion')) {
      const division = divisionOf(state.world, job.clubId);
      repGain += job.role === 'youth' ? TROPHY_REPUTATION.youth : division === 1 ? TROPHY_REPUTATION.league1 : TROPHY_REPUTATION.league2;
    }
    if (has('cup_winner')) repGain += TROPHY_REPUTATION.cup;
    if (has('promoted')) repGain += TROPHY_REPUTATION.promotion;
    if (has('relegated')) repGain += TROPHY_REPUTATION.relegation;

    let board = clamp(judgment * BALANCE.boardPerPosition, -25, 20);
    if (has('champion')) board += 10;
    if (has('cup_winner')) board += 6;
    if (has('promoted')) board += 10;
    if (has('relegated')) board -= 15;
    job.board = clamp(job.board + board, 0, 100);

    let env = clamp(judgment * BALANCE.environmentPerPosition, -20, 15);
    if (state.coach.style.press > 40 && state.coach.style.build > 20) env += 2;
    job.environment = clamp(job.environment + env, 0, 100);

    const sat = averageSatisfaction(job);
    job.dressing = clamp(job.dressing + (sat - job.dressing) * 0.3 + (judgment > 0 ? 2 : judgment < 0 ? -2 : 0), 0, 100);
  }

  state.coach.reputation = clamp(state.coach.reputation + repGain, 0, 100);
  state.coach.peakReputation = Math.max(state.coach.peakReputation, state.coach.reputation);
  state.trophies.push(...report.trophies);

  report.deltas = {
    board: Math.round(job.board - before.board),
    dressing: Math.round(job.dressing - before.dressing),
    environment: Math.round(job.environment - before.environment),
    reputation: Math.round((state.coach.reputation - before.reputation) * 10) / 10,
  };

  job.seasons += 1;
  job.contractYears -= job.role === 'youth' ? BALANCE.youthTurnYears : 1;

  const endFired = report.firedAtMatchday === null && job.board < BALANCE.endSeasonFireBoard;
  if (report.firedAtMatchday !== null || endFired) {
    if (endFired) {
      report.firedAtMatchday = report.table.length * 2 - 2;
      report.headlines.unshift({ id: 'fired', values: { matchday: report.firedAtMatchday } });
    }
    state.firings += 1;
    loseJob(state);
    return;
  }

  const changes = ageKeyPlayers(rng, job, judgment);
  if (job.role === 'first') {
    const c = club(state.world, job.clubId);
    c.rating -= changes.ratingLoss;
    c.profile.build += (state.coach.style.build - c.profile.build) * BALANCE.profileFollow;
    c.profile.press += (state.coach.style.press - c.profile.press) * BALANCE.profileFollow;
  }
  fillKeyPlayers(rng, job, club(state.world, job.clubId).country);
}

const HEADLINE_PRIORITY: Headline['id'][] = [
  'fired',
  'champion',
  'promoted',
  'relegated',
  'cup_winner',
  'above_expectations',
  'below_expectations',
  'win_streak',
  'second_half_collapse',
  'second_half_surge',
  'top_scorer',
  'best_attack',
  'best_defence',
  'cup_penalties_out',
];

function prioritize(headlines: Headline[]): Headline[] {
  const unique = headlines.filter((h, i) => headlines.findIndex((x) => x.id === h.id) === i);
  return unique.sort((a, b) => HEADLINE_PRIORITY.indexOf(a.id) - HEADLINE_PRIORITY.indexOf(b.id)).slice(0, 3);
}

// ---------------------------------------------------------------------------
// Fine stagione
// ---------------------------------------------------------------------------

export function prepareEnd(state: GameState, events: readonly EventDef[]): GameState {
  assertPhase(state, 'report');
  state.endQueue = ['retirement', 'career_event', 'career_decision', 'management_event'];
  state.careerShown = false;
  return advanceEnd(state, events);
}

function advanceEnd(state: GameState, events: readonly EventDef[]): GameState {
  while (state.endQueue.length > 0) {
    const step = state.endQueue.shift();
    const pending = withRng(state, (rng) => buildEndStep(state, rng, events, step));
    if (pending) {
      state.pending = pending;
      state.phase = 'end_decision';
      return state;
    }
  }
  state.phase = 'season_over';
  return state;
}

function buildEndStep(state: GameState, rng: Rng, events: readonly EventDef[], step: string | undefined): Pending | null {
  if (state.retireRequested) return null;
  const moment = state.job ? 'end' : 'unemployed';
  if (step === 'retirement') {
    // Proposta di ritiro sempre più probabile con l'età: la carriera finisce
    // in modo naturale prima del limite massimo.
    const years = state.coach.age - BALANCE.retireOfferAge;
    if (years < 0 || !rng.chance(clamp(BALANCE.retireOfferBase + years * BALANCE.retireOfferPerYear, 0, 0.9))) return null;
    state.careerShown = true;
    return { kind: 'career', context: 'retirement', options: [{ kind: 'retire' }, { kind: 'continue' }] };
  }
  if (step === 'career_event') {
    const picked = selectEvent(state, rng, events, moment, 'career');
    if (!picked) return null;
    state.eventLog[picked.event.id] = state.turn;
    state.careerShown = true;
    return { kind: 'event', eventId: picked.event.id, bindings: picked.bindings };
  }
  if (step === 'career_decision') {
    const pending = buildCareerDecision(state, rng);
    if (pending) state.careerShown = true;
    return pending;
  }
  if (step === 'management_event') {
    // Con un incarico, un evento di gestione a fine stagione solo se non c'è già
    // stata una decisione di carriera. Senza panchina il turno ha spazio libero.
    if ((state.job && state.careerShown) || !rng.chance(0.6)) return null;
    const picked = selectEvent(state, rng, events, moment, 'management');
    if (!picked) return null;
    state.eventLog[picked.event.id] = state.turn;
    return { kind: 'event', eventId: picked.event.id, bindings: picked.bindings };
  }
  return null;
}

function buildCareerDecision(state: GameState, rng: Rng): Pending | null {
  const job = state.job;
  const canStudy = state.coach.license !== 'PRO';
  const accept = (offers: Offer[]): CareerOption[] => offers.map((offer) => ({ kind: 'accept', offer }));

  if (job) {
    const offers = state.skipOffers ? [] : generateOffers(state, rng, 'employed');
    if (job.contractYears > 0) {
      if (offers.length === 0) return null;
      return { kind: 'career', context: 'contract_running', options: [...accept(offers), { kind: 'stay' }] };
    }
    if (job.board >= BALANCE.renewalBoard) {
      const years = job.role === 'youth' ? 1 : rng.int(1, 3);
      return { kind: 'career', context: 'renewal', options: [{ kind: 'renew', years }, ...accept(offers), { kind: 'leave' }] };
    }
    loseJob(state);
    const extra: CareerOption[] = canStudy ? [{ kind: 'wait' }, { kind: 'study' }] : [{ kind: 'wait' }];
    return { kind: 'career', context: 'contract_ended', options: [...accept(offers), ...extra] };
  }

  const last = state.lastReport;
  const fired = !!last && last.firedAtMatchday !== null && last.clubId === state.lastClubId;
  const offers = state.skipOffers ? [] : generateOffers(state, rng, fired ? 'fired' : 'unemployed');
  const extra: CareerOption[] = canStudy ? [{ kind: 'wait' }, { kind: 'study' }] : [{ kind: 'wait' }];
  return { kind: 'career', context: fired ? 'fired' : 'unemployed', options: [...accept(offers), ...extra] };
}

/** Offerte di fine stagione, pescate in base a reputazione, patentino e stile. */
export function generateOffers(state: GameState, rng: Rng, mode: 'employed' | 'unemployed' | 'fired'): Offer[] {
  const job = state.job;
  const coach = state.coach;
  const world = state.world;
  const lastJudgment = state.lastReport ? state.lastReport.expectedPosition - state.lastReport.position : 0;

  // Con UEFA B si allenano solo le giovanili.
  if (coach.license === 'B') {
    if (mode === 'employed') return [];
    const pool = Object.keys(world.youthRatings).filter((id) => id !== state.lastClubId);
    return pool.length > 0 ? [{ clubId: rng.pick(pool), role: 'youth', years: 1, challenge: false }] : [];
  }

  let p: number;
  if (job?.role === 'youth') p = 0.45 + 0.15 * job.seasons + 0.05 * lastJudgment;
  else if (mode === 'employed') p = 0.3 + 0.07 * lastJudgment;
  else if (mode === 'fired') p = 0.45;
  else p = 0.6;
  p = clamp(p, 0.05, 0.9);

  let count = 0;
  for (const factor of [1, 0.5, 0.25]) if (rng.chance(p * factor)) count++;
  // Dopo tre turni di gavetta con UEFA A almeno un'offerta arriva sempre.
  if (job?.role === 'youth' && job.seasons >= 3) count = Math.max(count, 1);
  if (count === 0) return [];

  const target = BALANCE.offerTargetBase + coach.reputation * BALANCE.offerTargetSlope - (mode === 'fired' ? 4 : 0);
  const eligible = Object.values(world.clubs).filter((c) => {
    if (!c.leagueId || c.id === job?.clubId) return false;
    if (coach.license === 'A') {
      const div = divisionOf(world, c.id);
      return div !== 1 || tierInLeague(world, c.id) >= 4;
    }
    return true;
  });

  const offers: Offer[] = [];
  for (let i = 0; i < count; i++) {
    const challenge = rng.chance(0.15);
    const center = challenge ? target + 6 : target;
    const choice = rng.weighted(eligible, (c) => {
      if (offers.some((o) => o.clubId === c.id)) return 0;
      const closeness = Math.exp(-(((c.rating - center) / BALANCE.offerSpread) ** 2));
      const dist = Math.hypot(coach.style.build - c.profile.build, coach.style.press - c.profile.press);
      return closeness * (1.2 - dist / 283);
    });
    if (choice) offers.push({ clubId: choice.id, role: 'first', years: rng.int(1, 3), challenge });
  }
  return offers;
}

// ---------------------------------------------------------------------------
// Passaggio alla stagione successiva
// ---------------------------------------------------------------------------

export function nextSeason(state: GameState): GameState {
  assertPhase(state, 'season_over');
  withRng(state, (rng) => {
    const job = state.job;
    const wasYouth = state.history.at(-1)?.role === 'youth' && state.history.at(-1)?.season === state.world.season - 1;
    if (job) {
      job.board += (50 - job.board) * BALANCE.meanReversion;
      job.dressing += (50 - job.dressing) * BALANCE.meanReversion;
      job.environment += (50 - job.environment) * BALANCE.meanReversion;
      job.seasonBoost = 0;
    }
    // Un turno di gavetta vale due anni: il mondo gioca una stagione in più.
    if (wasYouth) {
      const extra = simulateWorldSeason(state.world, rng, { first: {}, youth: {} });
      endOfSeason(state.world, rng, extra);
    }
    state.coach.age += wasYouth ? BALANCE.youthTurnYears : 1;
    state.unemployedTurns = job ? 0 : state.unemployedTurns + 1;
    state.turn += 1;
    state.skipOffers = false;
    refreshYouthRatings(state.world, rng);
  });

  const reason = state.retireRequested
    ? 'voluntary'
    : state.coach.age >= BALANCE.retireAge
      ? 'age'
      : state.unemployedTurns >= BALANCE.maxUnemployedTurns
        ? 'unemployed'
        : null;
  if (reason) {
    state.summary = summarize(state, reason);
    state.phase = 'finished';
  } else {
    state.phase = 'preseason';
  }
  return state;
}

export function summarize(state: GameState, reason: CareerSummary['reason']): CareerSummary {
  const leagueTitles = state.trophies.filter((t) => t.startsWith('league:'));
  const topTitles = leagueTitles.filter((t) => state.world.leagues[t.split(':')[1] ?? '']?.config.division === 1);
  const promotions = state.trophies.filter((t) => t.startsWith('promotion:')).length;
  const survivals = state.history.filter((r) => r.objective === 'survival' && r.firedAtMatchday === null && !r.headlines.some((h) => h.id === 'relegated')).length;
  let title = 'field_man';
  if (topTitles.length >= 3) title = 'legend';
  else if (topTitles.length >= 1) title = 'champion';
  else if (promotions >= 3) title = 'promotion_specialist';
  else if (survivals >= 3) title = 'survival_king';
  else if (state.firings >= 4) title = 'journeyman';
  else if (state.coach.peakReputation >= 60) title = 'top_flight';
  return {
    reason,
    seasons: state.history.length,
    clubs: state.clubsCoached.map((id) => state.world.clubs[id]?.name ?? id),
    trophies: [...state.trophies],
    peakReputation: Math.round(state.coach.peakReputation),
    finalStyle: { ...state.coach.style },
    firings: state.firings,
    title,
  };
}

function assertPhase(state: GameState, phase: GameState['phase']): void {
  if (state.phase !== phase) throw new Error(`Fase attesa ${phase}, trovata ${state.phase}`);
}

// ---------------------------------------------------------------------------
// Salvataggio
// ---------------------------------------------------------------------------

export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

export function deserialize(json: string): GameState {
  const state = JSON.parse(json) as GameState;
  if (state.version !== SAVE_VERSION) throw new Error(`Salvataggio versione ${state.version}, attesa ${SAVE_VERSION}`);
  return state;
}
