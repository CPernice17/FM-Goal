/**
 * Verifica dove si qualificano le vincitrici delle coppe nazionali.
 * Uso: npx tsx scripts/check-cup-winners.ts [stagioni]
 */
import { CONTINENTAL, COUNTRIES } from '../src/content/index';
import { compInfo } from '../src/engine/continental';
import { Rng } from '../src/engine/rng';
import { createWorld, endOfSeason, refreshYouthRatings, simulateWorldSeason } from '../src/engine/world';

const seasons = Number(process.argv[2] ?? 10);
const rng = new Rng(2026);
const world = createWorld(COUNTRIES, 2026, CONTINENTAL);
refreshYouthRatings(world, rng);
const tally: Record<string, Record<string, number>> = {};
const holders: Record<string, Record<string, number>> = {};
for (let s = 0; s < seasons; s++) {
  const season = simulateWorldSeason(world, rng, { first: {}, youth: {} });
  const winners = Object.fromEntries(Object.entries(season.cups).map(([c, r]) => [c, r.winner]));
  endOfSeason(world, rng, season);
  const qualified = world.continental?.qualified ?? {};
  for (const [compId, id] of Object.entries(world.continental?.lastWinners ?? {})) {
    const comp = Object.entries(qualified).find(([, ids]) => ids.includes(id))?.[0];
    const key = comp ? `livello ${compInfo(world, comp)?.tier}` : 'nessuna coppa';
    const from = `${compInfo(world, compId)?.name} (livello ${compInfo(world, compId)?.tier})`;
    holders[from] ??= {};
    holders[from][key] = (holders[from][key] ?? 0) + 1;
  }
  for (const [country, id] of Object.entries(winners)) {
    const comp = Object.entries(qualified).find(([, ids]) => ids.includes(id))?.[0];
    const league = Object.values(world.leagues).find((l) => l.lastTable.includes(id));
    const pos = league ? league.lastTable.indexOf(id) + 1 : 0;
    const where = comp ? `${compInfo(world, comp)?.name} (livello ${compInfo(world, comp)?.tier})` : 'nessuna coppa';
    const key = `${where}`;
    tally[country] ??= {};
    tally[country][key] = (tally[country][key] ?? 0) + 1;
    if (s < 2) console.log(`${world.season - 1} ${country}: ${world.clubs[id]?.name}, ${pos}° in ${league?.config.name} -> ${where}`);
  }
}
console.log('\nDetentrici: dove giocano la stagione dopo');
for (const [c, t] of Object.entries(holders)) console.log(c.padEnd(36), JSON.stringify(t));
console.log('\nRiepilogo su', seasons, 'stagioni:');
for (const [c, t] of Object.entries(tally)) console.log(c.padEnd(4), JSON.stringify(t));
