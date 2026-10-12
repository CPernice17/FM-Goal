/**
 * Test del motore, senza dipendenze esterne. Uso: npm test
 */
import { COUNTRIES, EVENT_PACKS, EVENTS } from '../src/content/index';
import {
  choose,
  createCareer,
  deserialize,
  nextSeason,
  playSeason,
  prepareEnd,
  serialize,
  startSeason,
} from '../src/engine/career';
import { roundRobin, simulateCup, simulateLeague } from '../src/engine/competition';
import type { EventPack } from '../src/engine/events/schema';
import { validatePacks } from '../src/engine/events/validate';
import { Rng } from '../src/engine/rng';
import type { GameState } from '../src/engine/types';
import { createWorld, endOfSeason, refreshYouthRatings, simulateWorldSeason } from '../src/engine/world';

let failed = 0;
let passed = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`ok    ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}\n      ${(e as Error).message}`);
  }
}
function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

test('rng: stessa seed, stessa sequenza', () => {
  const a = new Rng(42);
  const b = new Rng(42);
  for (let i = 0; i < 100; i++) assert(a.next() === b.next(), 'sequenze diverse');
});

test('calendario: ogni coppia si incontra due volte, una in casa e una fuori', () => {
  const ids = Array.from({ length: 20 }, (_, i) => `t${i}`);
  const rounds = roundRobin(ids);
  assert(rounds.length === 38, `giornate ${rounds.length}`);
  const seen = new Set<string>();
  for (const r of rounds) {
    assert(r.length === 10, 'partite per giornata');
    const playing = new Set(r.flat());
    assert(playing.size === 20, 'una squadra gioca due volte nella stessa giornata');
    for (const [h, a] of r) {
      assert(!seen.has(`${h}-${a}`), `partita ripetuta ${h}-${a}`);
      seen.add(`${h}-${a}`);
    }
  }
  assert(seen.size === 380, `partite totali ${seen.size}`);
});

test('campionato: punti coerenti e squadre più forti mediamente più in alto', () => {
  const rng = new Rng(7);
  const entrants = Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, rating: 90 - i * 1.5 }));
  let topAvg = 0;
  for (let k = 0; k < 50; k++) {
    const res = simulateLeague(rng, entrants);
    const total = res.table.reduce((s, r) => s + r.points, 0);
    assert(total >= 380 * 2 && total <= 380 * 3, `punti totali ${total}`);
    topAvg += res.table.findIndex((r) => r.id === 't0') + 1;
  }
  assert(topAvg / 50 < 4, `la squadra più forte arriva in media ${topAvg / 50}°`);
});

test('coppa: un solo vincitore e tutti i partecipanti hanno un turno', () => {
  const rng = new Rng(3);
  const entrants = Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, rating: 60 + (i % 20) }));
  const res = simulateCup(rng, entrants);
  const winners = Object.values(res.reached).filter((s) => s === 'winner');
  assert(winners.length === 1, `vincitori ${winners.length}`);
  assert(Object.keys(res.reached).length === 40, 'partecipanti senza turno');
});

test('mondo: promozioni e retrocessioni mantengono le dimensioni dei campionati', () => {
  const rng = new Rng(11);
  const world = createWorld(COUNTRIES, 2026);
  refreshYouthRatings(world, rng);
  const sizes = Object.fromEntries(Object.entries(world.leagues).map(([id, l]) => [id, l.clubIds.length]));
  for (let s = 0; s < 10; s++) {
    endOfSeason(world, rng, simulateWorldSeason(world, rng, { first: {}, youth: {} }));
    for (const [id, l] of Object.entries(world.leagues)) {
      assert(l.clubIds.length === sizes[id], `${id}: ${l.clubIds.length} squadre`);
      for (const cid of l.clubIds) assert(world.clubs[cid]?.leagueId === id, `${cid} non sa di essere in ${id}`);
    }
  }
  assert(world.season === 2036, `stagione ${world.season}`);
});

function playToEnd(seed: number): GameState {
  const pick = new Rng(seed);
  let state = createCareer({ name: 'Test', nationality: 'ita', style: { build: 20, press: 30 }, seed, countries: COUNTRIES });
  let guard = 0;
  while (state.phase !== 'finished' && guard++ < 80) {
    state = startSeason(state, EVENTS);
    while (state.phase === 'start_decision') state = choose(state, 0, EVENTS);
    state = playSeason(state);
    state = prepareEnd(state, EVENTS);
    while (state.phase === 'end_decision') {
      const p = state.pending;
      const n = p?.kind === 'career' ? p.options.length : 2;
      state = choose(state, pick.int(0, n - 1), EVENTS);
    }
    state = nextSeason(state);
  }
  return state;
}

test('carriera: stessa seed, stessa carriera', () => {
  const a = serialize(playToEnd(5));
  const b = serialize(playToEnd(5));
  assert(a === b, 'carriere diverse con la stessa seed');
});

test('carriera: termina sempre con un riepilogo', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const s = playToEnd(seed);
    assert(s.phase === 'finished' && s.summary, `seed ${seed} non termina`);
    assert(s.history.length > 0, `seed ${seed} senza stagioni`);
  }
});

test('salvataggio: un salvataggio a metà carriera riprende identico', () => {
  let state = createCareer({ name: 'Test', nationality: 'ita', style: { build: 0, press: 0 }, seed: 9, countries: COUNTRIES });
  state = startSeason(state, EVENTS);
  while (state.phase === 'start_decision') state = choose(state, 0, EVENTS);
  const copy = deserialize(serialize(state));
  const a = playSeason(state);
  const b = playSeason(copy);
  assert(serialize(a) === serialize(b), 'il salvataggio cambia il risultato');
});

test('primavera: la squadra allenata gioca anche se la prima squadra retrocede', () => {
  let state = createCareer({ name: 'Test', nationality: 'ita', style: { build: 0, press: 0 }, seed: 21, countries: COUNTRIES });
  const clubId = state.job?.clubId as string;
  // Simula la retrocessione: la prima squadra passa in Serie B.
  const a = state.world.leagues.ita1;
  const b = state.world.leagues.ita2;
  if (!a || !b) throw new Error('campionati mancanti');
  const swap = b.clubIds[0] as string;
  a.clubIds = a.clubIds.filter((id) => id !== clubId).concat(swap);
  b.clubIds = b.clubIds.filter((id) => id !== swap).concat(clubId);
  (state.world.clubs[clubId] as { leagueId: string | null }).leagueId = 'ita2';
  (state.world.clubs[swap] as { leagueId: string | null }).leagueId = 'ita1';

  state = startSeason(state, EVENTS);
  while (state.phase === 'start_decision') state = choose(state, 0, EVENTS);
  state = playSeason(state);
  const r = state.lastReport;
  if (!r) throw new Error('nessun resoconto');
  assert(r.position >= 1 && r.position <= r.teams, `posizione ${r?.position}`);
  assert(r.table.some((row) => row.clubId === clubId), 'la Primavera allenata manca dalla classifica');
  assert(r.teams === 20, `squadre ${r.teams}`);
});

test('carriera: ogni turno è una stagione', () => {
  const s = playToEnd(8);
  const seasons = s.history.map((r) => r.season);
  for (let i = 1; i < seasons.length; i++) {
    assert((seasons[i] as number) > (seasons[i - 1] as number), 'stagioni non in ordine');
  }
  const first = s.history[0];
  assert(first && first.season === 2026, `prima stagione ${first?.season}`);
  assert(s.coach.age - 35 === s.turn - 1, `età ${s.coach.age} dopo ${s.turn - 1} turni`);
});

test('eventi: i pacchetti reali sono validi', () => {
  const report = validatePacks(EVENT_PACKS);
  assert(report.errors.length === 0, report.errors.join('; '));
});

test('eventi: il validatore trova gli errori tipici', () => {
  const bad: EventPack = {
    pack: 'test',
    events: [
      {
        id: 'x',
        moment: 'start',
        category: 'management',
        conditions: [{ type: 'flag', has: 'mai_impostato' }],
        weight: 1,
        cooldown: 1,
        title: { it: 'Ciao {giocatore}' },
        body: { it: 'Testo con {sconosciuto}' },
        options: [
          { text: { it: 'Uno' }, effects: [{ type: 'schedule', event: 'inesistente', inTurns: 1 }] },
          { text: { it: 'Due' }, effects: [] },
        ],
      },
    ],
  };
  const errors = validatePacks([bad]).errors.join('\n');
  assert(errors.includes('mai_impostato'), 'flag mai impostato non segnalato');
  assert(errors.includes('{giocatore}'), 'giocatore senza condizione non segnalato');
  assert(errors.includes('{sconosciuto}'), 'segnaposto sconosciuto non segnalato');
  assert(errors.includes('inesistente'), 'evento programmato inesistente non segnalato');
});

console.log(`\n${passed} superati, ${failed} falliti`);
if (failed > 0) process.exitCode = 1;
