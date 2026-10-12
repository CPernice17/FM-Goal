/**
 * Gioca migliaia di carriere senza interfaccia, con scelte casuali, e stampa
 * le statistiche da confrontare con i criteri della fetta verticale.
 * Uso: npm run sim [-- --n=2000 --seed=1]
 */
import { COUNTRIES, EVENTS } from '../src/content/index';
import { choose, createCareer, nextSeason, playSeason, prepareEnd, startSeason } from '../src/engine/career';
import { Rng } from '../src/engine/rng';
import type { CareerOption, GameState } from '../src/engine/types';
import { divisionOf } from '../src/engine/world';

const arg = (name: string, fallback: number) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? Number(a.split('=')[1]) : fallback;
};
const N = arg('n', 2000);
const SEED = arg('seed', 1);
/**
 * Strategia per le decisioni di carriera:
 * - sensible: accetta l'offerta migliore, rinnova, altrimenti studia o aspetta;
 * - random: sceglie a caso (stress test).
 * Gli eventi di gestione sono sempre scelti a caso.
 */
const POLICY = process.argv.includes('--policy=random') ? 'random' : 'sensible';

/** Secondi stimati per schermata: scheda, resoconto, ogni decisione. */
const SECONDS = { sheet: 3, report: 5, decision: 5 };

interface CareerStats {
  turns: number;
  seasons: number;
  youthTurns: number;
  decisions: number;
  firings: number;
  reason: string;
  peakRep: number;
  reachedFirstTeam: boolean;
  reachedTopDivision: boolean;
  bigClub: boolean;
  topTitles: number;
  cups: number;
  promotions: number;
  seconds: number;
}

const eventCount: Record<string, number> = {};
for (const e of EVENTS) eventCount[e.id] = 0;

function note(state: GameState): void {
  if (state.pending?.kind === 'event') eventCount[state.pending.eventId] = (eventCount[state.pending.eventId] ?? 0) + 1;
}

function sensibleCareerChoice(state: GameState, options: CareerOption[]): number {
  const score = (o: CareerOption): number => {
    switch (o.kind) {
      case 'accept': {
        const rating = state.world.clubs[o.offer.clubId]?.rating ?? 0;
        // Un'offerta deve essere un passo avanti rispetto all'incarico attuale.
        const current = state.job?.role === 'first' ? (state.world.clubs[state.job.clubId]?.rating ?? 0) : 0;
        return rating >= current + 1 ? 100 + rating : 10;
      }
      case 'renew':
        return 50;
      case 'stay':
        return 40;
      case 'study':
        return 30;
      case 'wait':
        return 20;
      case 'leave':
        return 0;
    }
  };
  let best = 0;
  options.forEach((o, i) => {
    if (score(o) > score(options[best] as CareerOption)) best = i;
  });
  return best;
}

function runCareer(seed: number, pick: Rng): CareerStats {
  let state = createCareer({
    name: 'Test',
    nationality: 'ita',
    style: { build: pick.int(-80, 80), press: pick.int(-80, 80) },
    seed,
    countries: COUNTRIES,
  });
  let seconds = 0;
  let reachedTop = false;
  let bigClub = false;
  let guard = 0;
  while (state.phase !== 'finished') {
    if (++guard > 80) throw new Error(`Carriera senza fine (seed ${seed})`);
    state = startSeason(state, EVENTS);
    seconds += SECONDS.sheet;
    while (state.phase === 'start_decision') {
      note(state);
      seconds += SECONDS.decision;
      const n = state.pending?.kind === 'event' ? (EVENTS.find((e) => e.id === (state.pending as { eventId: string }).eventId)?.options.length ?? 1) : 1;
      state = choose(state, pick.int(0, n - 1), EVENTS);
    }
    if (state.job?.role === 'first') {
      if (divisionOf(state.world, state.job.clubId) === 1) reachedTop = true;
      if ((state.world.clubs[state.job.clubId]?.rating ?? 0) >= 80) bigClub = true;
    }
    state = playSeason(state);
    seconds += state.lastReport ? SECONDS.report : SECONDS.sheet;
    state = prepareEnd(state, EVENTS);
    while (state.phase === 'end_decision') {
      note(state);
      seconds += SECONDS.decision;
      const p = state.pending;
      let index: number;
      if (p?.kind === 'career' && POLICY === 'sensible') {
        index = sensibleCareerChoice(state, p.options);
      } else {
        const n = !p ? 1 : p.kind === 'event' ? (EVENTS.find((e) => e.id === p.eventId)?.options.length ?? 1) : p.options.length;
        index = pick.int(0, n - 1);
      }
      state = choose(state, index, EVENTS);
    }
    state = nextSeason(state);
  }
  const s = state.summary;
  const topTitles = state.trophies.filter((t) => t.startsWith('league:') && state.world.leagues[t.split(':')[1] ?? '']?.config.division === 1).length;
  return {
    turns: state.turn - 1,
    seasons: state.history.length,
    youthTurns: state.history.filter((r) => r.role === 'youth').length,
    decisions: state.decisions,
    firings: state.firings,
    reason: s?.reason ?? '?',
    peakRep: s?.peakReputation ?? 0,
    reachedFirstTeam: state.history.some((r) => r.role === 'first'),
    reachedTopDivision: reachedTop,
    bigClub,
    topTitles,
    cups: state.trophies.filter((t) => t.startsWith('cup:')).length,
    promotions: state.trophies.filter((t) => t.startsWith('promotion:')).length,
    seconds,
  };
}

const pick = new Rng(SEED * 7919);
const started = Date.now();
const results: CareerStats[] = [];
for (let i = 0; i < N; i++) results.push(runCareer(SEED * 100000 + i, pick));
const elapsed = (Date.now() - started) / 1000;

const mean = (f: (s: CareerStats) => number) => results.reduce((a, s) => a + f(s), 0) / results.length;
const pct = (f: (s: CareerStats) => boolean) => `${((results.filter(f).length / results.length) * 100).toFixed(1)}%`;
const quant = (f: (s: CareerStats) => number, q: number) => {
  const v = results.map(f).sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.floor(q * v.length))] ?? 0;
};
const reasons: Record<string, number> = {};
for (const r of results) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;

console.log(`Strategia: ${POLICY}`);
console.log(`Carriere simulate: ${N} in ${elapsed.toFixed(1)} s (${((elapsed / N) * 1000).toFixed(1)} ms ciascuna)\n`);
console.log('Durata');
console.log(`  turni:            media ${mean((s) => s.turns).toFixed(1)}  (p10 ${quant((s) => s.turns, 0.1)}, p90 ${quant((s) => s.turns, 0.9)})   obiettivo 15–20`);
console.log(`  turni Primavera:  media ${mean((s) => s.youthTurns).toFixed(1)}   obiettivo 2–3`);
console.log(`  decisioni:        media ${mean((s) => s.decisions).toFixed(1)}   obiettivo ~30`);
console.log(`  tempo stimato:    media ${(mean((s) => s.seconds) / 60).toFixed(1)} min   obiettivo ~5`);
console.log('\nFine carriera');
for (const [k, v] of Object.entries(reasons)) console.log(`  ${k.padEnd(12)} ${((v / N) * 100).toFixed(1)}%`);
console.log('\nProgressione');
console.log(`  prima squadra raggiunta:   ${pct((s) => s.reachedFirstTeam)}`);
console.log(`  Serie A raggiunta:         ${pct((s) => s.reachedTopDivision)}`);
console.log(`  club di vertice (≥80):     ${pct((s) => s.bigClub)}`);
console.log(`  almeno uno scudetto:       ${pct((s) => s.topTitles > 0)}`);
console.log(`  almeno una coppa:          ${pct((s) => s.cups > 0)}`);
console.log(`  promozioni per carriera:   ${mean((s) => s.promotions).toFixed(2)}`);
console.log(`  reputazione massima:       media ${mean((s) => s.peakRep).toFixed(0)} (p10 ${quant((s) => s.peakRep, 0.1)}, p90 ${quant((s) => s.peakRep, 0.9)})`);
console.log('\nEsoneri');
console.log(`  per carriera:              media ${mean((s) => s.firings).toFixed(2)}`);
console.log(`  carriere con 0 esoneri:    ${pct((s) => s.firings === 0)}`);
console.log(`  carriere con 3+ esoneri:   ${pct((s) => s.firings >= 3)}`);

console.log('\nEventi mostrati (per 100 carriere)');
const sorted = Object.entries(eventCount).sort((a, b) => b[1] - a[1]);
for (const [id, c] of sorted) console.log(`  ${id.padEnd(32)} ${((c / N) * 100).toFixed(0)}`);
const never = sorted.filter(([, c]) => c === 0).map(([id]) => id);
if (never.length > 0) console.log(`\nMai mostrati: ${never.join(', ')}`);
