/**
 * Test del motore, senza dipendenze esterne. Uso: npm test
 */
import { CONTINENTAL, COUNTRIES, EVENT_PACKS, EVENTS } from '../src/content/index';
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
import { applyEffects } from '../src/engine/events/runtime';
import { validatePacks } from '../src/engine/events/validate';
import { Rng } from '../src/engine/rng';
import type { GameState } from '../src/engine/types';
import { expectedSize } from '../src/engine/continental';
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
  state = choose(state, pick.int(0, 2), EVENTS);
  let guard = 0;
  while (state.phase !== 'finished' && guard++ < 80) {
    state = startSeason(state, EVENTS);
    while (state.phase === 'start_decision' || state.phase === 'mid_decision') state = choose(state, 0, EVENTS);
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
  state = choose(state, 0, EVENTS);
  state = startSeason(state, EVENTS);
  while (state.phase === 'start_decision' || state.phase === 'mid_decision') state = choose(state, 0, EVENTS);
  const copy = deserialize(serialize(state));
  const a = playSeason(state);
  const b = playSeason(copy);
  assert(serialize(a) === serialize(b), 'il salvataggio cambia il risultato');
});

test('primavera: la squadra allenata gioca anche se la prima squadra retrocede', () => {
  let state = createCareer({ name: 'Test', nationality: 'ita', style: { build: 0, press: 0 }, seed: 21, countries: COUNTRIES });
  state = choose(state, 2, EVENTS);
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
  while (state.phase === 'start_decision' || state.phase === 'mid_decision') state = choose(state, 0, EVENTS);
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

test('inizio: tre Primavera nel paese della nazionalità, di forza diversa', () => {
  for (const nat of ['ita', 'eng', 'esp', 'ger', 'fra', 'por', 'ned']) {
    const s = createCareer({ name: 'Test', nationality: nat, style: { build: 0, press: 0 }, seed: 4, countries: COUNTRIES });
    const p = s.pending;
    if (s.phase !== 'first_job' || p?.kind !== 'career') throw new Error(`${nat}: nessuna scelta iniziale`);
    assert(p.options.length === 3, `${nat}: ${p.options.length} proposte`);
    const ratings = p.options.map((o) => (o.kind === 'accept' ? (s.world.clubs[o.offer.clubId]?.rating ?? 0) : 0));
    for (const o of p.options) {
      assert(o.kind === 'accept' && o.offer.role === 'youth' && s.world.clubs[o.offer.clubId]?.country === nat, `${nat}: proposta fuori paese`);
    }
    assert((ratings[0] ?? 0) >= (ratings[1] ?? 0) && (ratings[1] ?? 0) >= (ratings[2] ?? 0), `${nat}: proposte non ordinate per forza`);
  }
  const other = createCareer({ name: 'Test', nationality: 'other', style: { build: 0, press: 0 }, seed: 4, countries: COUNTRIES });
  assert(other.pending?.kind === 'career' && other.pending.options.length === 3, 'nazionalità non modellata: nessuna proposta');
});

test('coppe continentali: qualificate complete, senza doppioni, nella confederazione giusta', () => {
  const rng = new Rng(17);
  const world = createWorld(COUNTRIES, 2026, CONTINENTAL);
  refreshYouthRatings(world, rng);
  for (let s = 0; s < 4; s++) {
    const season = simulateWorldSeason(world, rng, { first: {}, youth: {} });
    const cont = world.continental;
    if (!cont) throw new Error('coppe mancanti');
    for (const conf of cont.defs.confederations) {
      for (const comp of conf.competitions) {
        const ids = cont.qualified[comp.id] ?? [];
        const size = expectedSize(conf, comp);
        assert(ids.length === size, `${comp.id}: ${ids.length} squadre su ${size}`);
        const res = season.continental[comp.id];
        assert(res && Object.values(res.reached).filter((x) => x === 'winner').length === 1, `${comp.id}: vincitore non unico`);
        for (const id of ids) {
          const club = world.clubs[id];
          const ok = cont.poolConfed[id] === conf.id || (club && conf.countries.includes(club.country));
          assert(ok, `${comp.id}: ${id} fuori confederazione`);
        }
      }
    }
    const all = Object.values(cont.qualified).flat();
    assert(new Set(all).size === all.length, 'club qualificato a due coppe');
    if (s >= 1) assert(season.continental.eusc, 'supercoppa europea mancante');
    if (s >= 1) assert(season.continental.ic, 'trofeo intercontinentale mancante');
    if (world.season === 2029) {
      const cwc = season.continental.cwc;
      assert(cwc && Object.keys(cwc.reached).length === 32, `mondiale per club: ${Object.keys(cwc?.reached ?? {}).length} squadre`);
    }
    // Formato UEFA: 36 squadre, 12 eliminate nella fase campionato, 8 ai playoff.
    const eu1 = season.continental.eu1;
    if (eu1) {
      const stages = Object.values(eu1.reached);
      assert(stages.filter((x) => x === 'league').length === 12, 'eu1: eliminate nella fase campionato');
      assert(stages.filter((x) => x === 'playoff').length === 8, 'eu1: eliminate ai playoff');
    }
    // Sudamericana: le terze della Libertadores giocano i playoff.
    const sa2 = season.continental.sa2;
    assert(sa2 && Object.keys(sa2.reached).length === 40, `sa2: ${Object.keys(sa2?.reached ?? {}).length} partecipanti con le terze`);
    endOfSeason(world, rng, season);
  }
  // Il mondiale per club si gioca nel 2029, con 32 squadre.
  assert(world.season === 2030, `stagione ${world.season}`);
  const season2030 = simulateWorldSeason(world, rng, { first: {}, youth: {} });
  assert(!season2030.continental.cwc, 'mondiale per club fuori stagione');
});

test('coppe continentali: la squadra allenata le gioca e le ritrova nel resoconto', () => {
  let found = false;
  for (let seed = 1; seed <= 12 && !found; seed++) {
    const pick = new Rng(seed);
    let state = createCareer({ name: 'Test', nationality: 'eng', style: { build: 0, press: 0 }, seed, countries: COUNTRIES, continental: CONTINENTAL, difficulty: 'easy' });
    state = choose(state, 0, EVENTS);
    let guard = 0;
    while (state.phase !== 'finished' && guard++ < 80) {
      state = startSeason(state, EVENTS);
      while (state.phase === 'start_decision' || state.phase === 'mid_decision') state = choose(state, 0, EVENTS);
      state = playSeason(state);
      if ((state.lastReport?.continental.length ?? 0) > 0) found = true;
      state = prepareEnd(state, EVENTS);
      while (state.phase === 'end_decision') {
        const p = state.pending;
        state = choose(state, p?.kind === 'career' ? pick.int(0, p.options.length - 1) : 0, EVENTS);
      }
      state = nextSeason(state);
    }
  }
  assert(found, 'nessuna carriera ha giocato una coppa internazionale');
});

function firstTeamCareer(seed: number, clubId: string): GameState {
  let state = createCareer({ name: 'Test', nationality: 'ita', style: { build: 0, press: 0 }, seed, countries: COUNTRIES, continental: CONTINENTAL });
  state = choose(state, 0, EVENTS);
  const job = state.job;
  if (!job) throw new Error('nessun incarico');
  job.clubId = clubId;
  job.role = 'first';
  job.contractYears = 3;
  state.coach.license = 'PRO';
  return state;
}

test('retrocessione in una serie non simulata: incarico finito, niente stagione da spettatore', () => {
  let found = false;
  for (let seed = 1; seed <= 40 && !found; seed++) {
    // Club più debole della Serie B: alta probabilità di retrocedere tra i club esterni.
    const weakest = 'virtus-entella';
    let state = firstTeamCareer(seed, weakest);
    const club = state.world.clubs[weakest];
    if (club) club.rating = 45;
    state = startSeason(state, EVENTS);
    while (state.phase === 'start_decision' || state.phase === 'mid_decision') state = choose(state, 0, EVENTS);
    state = playSeason(state);
    if (state.world.clubs[weakest]?.leagueId !== null) continue;
    found = true;
    const r = state.lastReport;
    assert(r && r.headlines.some((h) => h.id === 'released' || h.id === 'fired'), 'manca il titolo di fine incarico');
    assert(state.job === null, "l'allenatore è ancora sulla panchina di un club non simulato");
  }
  assert(found, 'nessuna retrocessione tra i club esterni in 40 tentativi');
});

test('ultima stagione: niente decisioni, si passa al ritiro', () => {
  let state = firstTeamCareer(3, 'como');
  state.coach.age = 69;
  state = startSeason(state, EVENTS);
  while (state.phase === 'start_decision' || state.phase === 'mid_decision') state = choose(state, 0, EVENTS);
  state = playSeason(state);
  state = prepareEnd(state, EVENTS);
  assert(state.phase === 'season_over', `fase ${state.phase} invece della fine stagione`);
  state = nextSeason(state);
  assert(state.phase === 'finished' && state.summary?.reason === 'age', 'carriera non conclusa per età');
});

test('ritiro: solo tra le scelte di carriera, dai 50 anni', () => {
  let seenRetire = false;
  for (let seed = 1; seed <= 20; seed++) {
    let state = firstTeamCareer(seed, 'como');
    state.coach.age = 55;
    if (state.job) state.job.contractYears = 1;
    state = startSeason(state, EVENTS);
    while (state.phase === 'start_decision' || state.phase === 'mid_decision') state = choose(state, 0, EVENTS);
    state = playSeason(state);
    state = prepareEnd(state, EVENTS);
    while (state.phase === 'end_decision') {
      const p = state.pending;
      if (p?.kind === 'career') {
        assert((p.context as string) !== 'retirement', 'esiste ancora la schermata di ritiro');
        if (p.options.some((o) => o.kind === 'retire')) seenRetire = true;
      }
      state = choose(state, 0, EVENTS);
    }
  }
  assert(seenRetire, "il ritiro non compare mai tra le scelte a 55 anni");
  let young = firstTeamCareer(2, 'como');
  young = startSeason(young, EVENTS);
  while (young.phase === 'start_decision' || young.phase === 'mid_decision') young = choose(young, 0, EVENTS);
  young = playSeason(young);
  young = prepareEnd(young, EVENTS);
  while (young.phase === 'end_decision') {
    const p = young.pending;
    assert(!(p?.kind === 'career' && p.options.some((o) => o.kind === 'retire')), 'ritiro proposto a 35 anni');
    young = choose(young, 0, EVENTS);
  }
});

test('mercato di gennaio: gli effetti pesano solo sul girone di ritorno', () => {
  let state = firstTeamCareer(5, 'bologna');
  state.phase = 'mid_decision';
  const club = state.world.clubs.bologna;
  if (!club || !state.job) throw new Error('club mancante');
  const before = club.rating;
  const out = applyEffects(state, [{ type: 'teamRating', delta: 2 }, { type: 'newPlayer', profile: 'veteran' }], {}, new Rng(1));
  const job = state.job;
  const joined = job.keyPlayers.find((p) => p.profile === 'veteran');
  assert(joined, 'il veterano non è arrivato');
  const gain = club.rating - before;
  assert(gain > 0, 'il veterano non migliora la squadra');
  assert(Math.abs(job.seasonBoost + gain) < 1e-9, "il girone d'andata non è compensato");
  assert(Math.abs((job.midBoost ?? 0) - (2 + gain)) < 1e-9, `bonus del ritorno ${job.midBoost}`);
  assert(out.lines.some((l) => l.kind === 'team' && l.secondHalf), 'conseguenza del ritorno non descritta');
  assert(out.lines.some((l) => l.kind === 'playerJoined'), 'arrivo del giocatore non descritto');
});

test('conseguenze: ogni scelta lascia una descrizione', () => {
  let state = createCareer({ name: 'Test', nationality: 'ita', style: { build: 0, press: 0 }, seed: 11, countries: COUNTRIES, continental: CONTINENTAL });
  state = choose(state, 1, EVENTS);
  assert(state.lastOutcome?.[0]?.kind === 'job', 'la scelta del primo club non è descritta');
  for (let i = 0; i < 6; i++) {
    state = startSeason(state, EVENTS);
    while (state.phase === 'start_decision' || state.phase === 'mid_decision') {
      state = choose(state, 0, EVENTS);
      assert((state.lastOutcome?.length ?? 0) > 0, 'evento senza conseguenze descritte');
    }
    state = playSeason(state);
    state = prepareEnd(state, EVENTS);
    while (state.phase === 'end_decision') {
      state = choose(state, 0, EVENTS);
      assert((state.lastOutcome?.length ?? 0) > 0, 'decisione di fine stagione senza conseguenze descritte');
    }
    state = nextSeason(state);
    if (state.phase === 'finished') break;
  }
});

test('colori sociali: ogni club del mondo ne ha due', () => {
  const world = createWorld(COUNTRIES, 2026, CONTINENTAL);
  const missing = Object.values(world.clubs).filter((c) => !c.colors || c.colors.length !== 2 || !c.colors.every((x) => /^#[0-9a-f]{6}$/i.test(x)));
  assert(missing.length === 0, `club senza colori: ${missing.slice(0, 5).map((c) => c.name).join(', ')}`);
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
