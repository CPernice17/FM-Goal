import { clamp, Rng } from '../rng';
import { LICENSE_ORDER, type Bindings, type GameState, type Lang, type Localized } from '../types';
import { club, divisionOf, tierInLeague } from '../world';
import type { Comparator, Condition, Effect, EventDef, Moment } from './schema';

export function compare(a: number, op: Comparator, b: number): boolean {
  switch (op) {
    case '<':
      return a < b;
    case '<=':
      return a <= b;
    case '>':
      return a > b;
    case '>=':
      return a >= b;
    case '==':
      return a === b;
  }
}

function varValue(state: GameState, name: string): number | undefined {
  if (name === 'reputation') return state.coach.reputation;
  if (!state.job) return undefined;
  if (name === 'board') return state.job.board;
  if (name === 'dressing') return state.job.dressing;
  if (name === 'environment') return state.job.environment;
  return undefined;
}

/**
 * Verifica le condizioni. Le condizioni sui giocatori chiave scelgono anche
 * quale giocatore citare nel testo (scritto in `bindings`).
 */
export function conditionsMet(state: GameState, ev: EventDef, rng: Rng, bindings: Bindings): boolean {
  for (const c of ev.conditions) if (!conditionMet(state, c, rng, bindings)) return false;
  return true;
}

function conditionMet(state: GameState, c: Condition, rng: Rng, bindings: Bindings): boolean {
  const job = state.job;
  switch (c.type) {
    case 'var': {
      const v = varValue(state, c.var);
      return v !== undefined && compare(v, c.op, c.value);
    }
    case 'role':
      return !!job && c.is.includes(job.role);
    case 'tier':
      return !!job && compare(tierInLeague(state.world, job.clubId), c.op, c.value);
    case 'division': {
      if (!job || job.role !== 'first') return false;
      const d = divisionOf(state.world, job.clubId);
      return d !== null && c.is.includes(d);
    }
    case 'style':
      return compare(state.coach.style[c.axis], c.op, c.value);
    case 'flag':
      if (c.has && !state.flags[c.has]) return false;
      if (c.missing && state.flags[c.missing]) return false;
      return true;
    case 'headline':
      return !!state.lastReport?.headlines.some((h) => h.id === c.is);
    case 'keyPlayer': {
      if (!job) return false;
      const matches = job.keyPlayers.filter(
        (p) =>
          (!c.trait || p.trait === c.trait) &&
          (!c.satisfaction || compare(p.satisfaction, c.satisfaction.op, c.satisfaction.value)),
      );
      if (matches.length === 0) return false;
      bindings.playerId = rng.pick(matches).id;
      return true;
    }
    case 'seasonsInJob':
      return !!job && compare(job.seasons, c.op, c.value);
    case 'license':
      return c.is.includes(state.coach.license);
    case 'age':
      return compare(state.coach.age, c.op, c.value);
  }
}

function onCooldown(state: GameState, ev: EventDef): boolean {
  const last = state.eventLog[ev.id];
  if (last === undefined) return false;
  if (ev.cooldown === 'once') return true;
  return state.turn - last < ev.cooldown;
}

export interface Selected {
  event: EventDef;
  bindings: Bindings;
}

/**
 * Sceglie l'evento da mostrare: prima i seguiti programmati ormai scaduti,
 * poi un'estrazione pesata tra gli eventi eleggibili della categoria richiesta.
 */
export function selectEvent(
  state: GameState,
  rng: Rng,
  events: readonly EventDef[],
  moment: Moment,
  category: EventDef['category'],
): Selected | null {
  const byId = new Map(events.map((e) => [e.id, e]));
  for (const s of [...state.scheduled]) {
    const ev = byId.get(s.eventId);
    if (!ev || s.turn > state.turn || ev.moment !== moment || ev.category !== category) continue;
    const bindings = withRival(state, rng, {});
    state.scheduled = state.scheduled.filter((x) => x !== s);
    if (conditionsMet(state, ev, rng, bindings)) return { event: ev, bindings };
  }

  const eligible: Selected[] = [];
  for (const ev of events) {
    if (ev.moment !== moment || ev.category !== category || ev.followUpOnly || onCooldown(state, ev)) continue;
    const bindings = withRival(state, rng, {});
    if (conditionsMet(state, ev, rng, bindings)) eligible.push({ event: ev, bindings });
  }
  return rng.weighted(eligible, (s) => s.event.weight) ?? null;
}

function withRival(state: GameState, rng: Rng, bindings: Bindings): Bindings {
  const job = state.job;
  if (!job) return bindings;
  const leagueId = club(state.world, job.clubId).leagueId;
  const others = leagueId ? (state.world.leagues[leagueId]?.clubIds ?? []).filter((id) => id !== job.clubId) : [];
  if (others.length > 0) bindings.rivalId = rng.pick(others);
  return bindings;
}

export interface EffectOutcome {
  endJob: boolean;
  retire: boolean;
}

export function applyEffects(state: GameState, effects: readonly Effect[], bindings: Bindings): EffectOutcome {
  const out: EffectOutcome = { endJob: false, retire: false };
  const job = state.job;
  for (const e of effects) {
    switch (e.type) {
      case 'var':
        if (e.var === 'reputation') {
          state.coach.reputation = clamp(state.coach.reputation + e.delta, 0, 100);
          state.coach.peakReputation = Math.max(state.coach.peakReputation, state.coach.reputation);
        } else if (job) {
          job[e.var] = clamp(job[e.var] + e.delta, 0, 100);
        }
        break;
      case 'flag':
        if (e.set) state.flags[e.set] = true;
        if (e.clear) delete state.flags[e.clear];
        break;
      case 'style':
        state.coach.style[e.axis] = clamp(state.coach.style[e.axis] + e.delta, -100, 100);
        break;
      case 'keyPlayer': {
        if (!job || !bindings.playerId) break;
        const p = job.keyPlayers.find((x) => x.id === bindings.playerId);
        if (!p) break;
        if (e.satisfaction) p.satisfaction = clamp(p.satisfaction + e.satisfaction, 0, 100);
        if (e.leave) {
          job.keyPlayers = job.keyPlayers.filter((x) => x !== p);
          job.seasonBoost -= p.contribution;
          if (job.role === 'first') club(state.world, job.clubId).rating -= p.contribution * 0.5;
        }
        break;
      }
      case 'teamRating':
        if (job) job.seasonBoost += e.delta;
        break;
      case 'schedule':
        state.scheduled.push({ eventId: e.event, turn: state.turn + e.inTurns });
        break;
      case 'license': {
        const i = LICENSE_ORDER.indexOf(state.coach.license);
        state.coach.license = LICENSE_ORDER[Math.min(i + 1, LICENSE_ORDER.length - 1)] ?? state.coach.license;
        break;
      }
      case 'skipOffers':
        state.skipOffers = true;
        break;
      case 'endJob':
        out.endJob = true;
        break;
      case 'retire':
        out.retire = true;
        break;
    }
  }
  return out;
}

/** Testo localizzato con i segnaposto sostituiti. Mai articoli davanti ai nomi. */
export function renderText(state: GameState, text: Localized, bindings: Bindings, lang: Lang = state.lang): string {
  const raw = text[lang] ?? text.it;
  const job = state.job;
  const clubId = job?.clubId ?? state.lastClubId;
  const c = clubId ? state.world.clubs[clubId] : undefined;
  const league = c?.leagueId ? state.world.leagues[c.leagueId] : undefined;
  const player = job?.keyPlayers.find((p) => p.id === bindings.playerId);
  const rival = bindings.rivalId ? state.world.clubs[bindings.rivalId] : undefined;
  const values: Record<string, string> = {
    club: c?.name ?? '',
    giocatore: player?.name ?? '',
    rivale: rival?.name ?? '',
    campionato: job?.role === 'youth' ? (state.world.countries[c?.country ?? '']?.youthLeagueName ?? '') : (league?.config.name ?? ''),
    coppa: state.world.countries[c?.country ?? '']?.cupName ?? '',
  };
  return raw.replace(/\{(\w+)\}/g, (m, key: string) => values[key] ?? m);
}
