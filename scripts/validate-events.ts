/**
 * Controlla i pacchetti di eventi. Uso: npm run validate [-- --strict]
 * Con --strict le traduzioni inglese e spagnola mancanti diventano errori.
 */
import { EVENT_PACKS } from '../src/content/index';
import { validatePacks } from '../src/engine/events/validate';

const strict = process.argv.includes('--strict');
const report = validatePacks(EVENT_PACKS, strict ? ['it', 'en', 'es'] : ['it']);

const total = EVENT_PACKS.reduce((s, p) => s + p.events.length, 0);
console.log(`Pacchetti: ${EVENT_PACKS.length}, eventi: ${total}`);

const translations = report.warnings.filter((w) => w.includes('traduzione'));
const other = report.warnings.filter((w) => !w.includes('traduzione'));
for (const w of other) console.log(`AVVISO  ${w}`);
if (translations.length > 0) console.log(`AVVISO  ${translations.length} testi senza traduzione (en/es)`);
for (const e of report.errors) console.log(`ERRORE  ${e}`);

if (report.errors.length > 0) {
  console.log(`\n${report.errors.length} errori.`);
  process.exitCode = 1;
} else {
  console.log('\nNessun errore.');
}
