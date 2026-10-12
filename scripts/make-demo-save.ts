/**
 * Crea un salvataggio dimostrativo con l'allenatore in prima squadra in un
 * club qualificato alle coppe, fermo al resoconto di una stagione con coppa
 * internazionale. Serve per controllare l'interfaccia senza giocare una
 * carriera intera. Uso: npm run demo-save -- <club-id> > save.json
 */
import { CONTINENTAL, COUNTRIES, EVENTS } from '../src/content/index';
import { choose, createCareer, playSeason, prepareEnd, nextSeason, serialize, startSeason } from '../src/engine/career';
import type { GameState } from '../src/engine/types';

const clubId = process.argv[2] ?? 'eng-arsenal';
let state: GameState = createCareer({ name: 'Marco Rinaldi', nationality: 'ita', style: { build: 40, press: 60 }, seed: 3, countries: COUNTRIES, continental: CONTINENTAL });
state = choose(state, 0, EVENTS);
state.coach.license = 'PRO';
state.coach.reputation = 70;
state.coach.peakReputation = 70;
const job = state.job;
if (!job) throw new Error('nessun incarico');
job.clubId = clubId;
job.role = 'first';
job.contractYears = 5;
job.board = 65;
state.clubsCoached = [clubId];

for (let i = 0; i < 6; i++) {
  state = startSeason(state, EVENTS);
  while (state.phase === 'start_decision') state = choose(state, 0, EVENTS);
  state = playSeason(state);
  if ((state.lastReport?.continental.length ?? 0) > 0) break;
  state = prepareEnd(state, EVENTS);
  while (state.phase === 'end_decision') {
    const p = state.pending;
    const stay = p?.kind === 'career' ? p.options.findIndex((o) => o.kind === 'stay' || o.kind === 'renew') : 0;
    state = choose(state, Math.max(0, stay), EVENTS);
  }
  state = nextSeason(state);
}
console.log(serialize(state));
