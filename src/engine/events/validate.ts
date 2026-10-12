import type { Lang } from '../types';
import { TEMPLATE_VARS, type Condition, type Effect, type EventDef, type EventPack } from './schema';

export interface ValidationReport {
  errors: string[];
  warnings: string[];
}

const LANGS: Lang[] = ['it', 'en', 'es'];
const CONDITION_TYPES = new Set([
  'var', 'role', 'tier', 'division', 'style', 'flag', 'headline', 'keyPlayer', 'seasonsInJob', 'license', 'age',
]);
const EFFECT_TYPES = new Set([
  'var', 'flag', 'style', 'keyPlayer', 'teamRating', 'schedule', 'license', 'skipOffers', 'endJob', 'retire',
]);
const MOMENTS = new Set(['start', 'end', 'unemployed']);

export const LIMITS = {
  maxBodyChars: 170,
  maxOptionWords: 8,
  maxVarDelta: 25,
  maxStyleDelta: 40,
  maxTeamDelta: 4,
};

/**
 * Controlla i pacchetti di eventi: struttura, riferimenti, segnaposto, testi
 * mancanti e valori fuori scala. Gli errori bloccano, gli avvisi no.
 */
export function validatePacks(packs: readonly EventPack[], requiredLangs: Lang[] = ['it']): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const all: EventDef[] = [];
  const ids = new Map<string, string>();

  for (const pack of packs) {
    for (const ev of pack.events) {
      const where = `${pack.pack}/${ev.id ?? '?'}`;
      if (!ev.id) errors.push(`${where}: id mancante`);
      else if (ids.has(ev.id)) errors.push(`${where}: id duplicato (già in ${ids.get(ev.id)})`);
      else ids.set(ev.id, pack.pack);
      all.push(ev);
      checkEvent(ev, where, errors, warnings, requiredLangs);
    }
  }

  const flagsSet = new Set<string>();
  const flagsUsed = new Map<string, string>();
  const scheduled = new Set<string>();
  for (const ev of all) {
    for (const o of ev.options ?? []) {
      for (const e of o.effects ?? []) {
        if (e.type === 'flag' && e.set) flagsSet.add(e.set);
        if (e.type === 'schedule') {
          scheduled.add(e.event);
          if (!ids.has(e.event)) errors.push(`${ev.id}: programma un evento inesistente "${e.event}"`);
        }
      }
    }
    for (const c of ev.conditions ?? []) if (c.type === 'flag' && c.has) flagsUsed.set(c.has, ev.id);
  }
  for (const [flag, evId] of flagsUsed) {
    if (!flagsSet.has(flag)) errors.push(`${evId}: richiede il flag "${flag}", che nessun evento imposta (mai attivabile)`);
  }
  for (const ev of all) {
    if (ev.followUpOnly && !scheduled.has(ev.id)) errors.push(`${ev.id}: è solo un seguito ma nessun evento lo programma`);
  }
  return { errors, warnings };
}

function checkEvent(ev: EventDef, where: string, errors: string[], warnings: string[], required: Lang[]): void {
  if (!MOMENTS.has(ev.moment)) errors.push(`${where}: momento non valido "${String(ev.moment)}"`);
  if (ev.category !== 'management' && ev.category !== 'career') errors.push(`${where}: categoria non valida`);
  if (!(ev.weight > 0)) errors.push(`${where}: il peso deve essere maggiore di zero`);
  if (ev.cooldown !== 'once' && !(typeof ev.cooldown === 'number' && ev.cooldown >= 0)) {
    errors.push(`${where}: cooldown non valido`);
  }
  if (!Array.isArray(ev.conditions)) errors.push(`${where}: condizioni mancanti`);
  if (!Array.isArray(ev.options) || ev.options.length < 2 || ev.options.length > 3) {
    errors.push(`${where}: servono da 2 a 3 opzioni`);
  }

  const hasPlayerCondition = (ev.conditions ?? []).some((c) => c.type === 'keyPlayer');
  for (const c of ev.conditions ?? []) checkCondition(c, where, errors);
  checkContradictions(ev, where, errors);

  checkText(ev.title, `${where} titolo`, errors, warnings, required, hasPlayerCondition);
  checkText(ev.body, `${where} corpo`, errors, warnings, required, hasPlayerCondition);
  if ((ev.body?.it ?? '').length > LIMITS.maxBodyChars) {
    warnings.push(`${where}: corpo più lungo di ${LIMITS.maxBodyChars} caratteri`);
  }

  (ev.options ?? []).forEach((o, i) => {
    const ow = `${where} opzione ${i + 1}`;
    checkText(o.text, ow, errors, warnings, required, hasPlayerCondition);
    const words = (o.text?.it ?? '').trim().split(/\s+/).length;
    if (words > LIMITS.maxOptionWords) warnings.push(`${ow}: più di ${LIMITS.maxOptionWords} parole`);
    if (!Array.isArray(o.effects)) errors.push(`${ow}: effetti mancanti`);
    for (const e of o.effects ?? []) checkEffect(e, ow, errors, warnings, hasPlayerCondition);
  });
}

function checkCondition(c: Condition, where: string, errors: string[]): void {
  if (!CONDITION_TYPES.has(c.type)) errors.push(`${where}: condizione sconosciuta "${String(c.type)}"`);
}

function checkEffect(e: Effect, where: string, errors: string[], warnings: string[], hasPlayer: boolean): void {
  if (!EFFECT_TYPES.has(e.type)) {
    errors.push(`${where}: effetto sconosciuto "${String(e.type)}"`);
    return;
  }
  if (e.type === 'var' && Math.abs(e.delta) > LIMITS.maxVarDelta) warnings.push(`${where}: variazione di ${e.var} fuori scala (${e.delta})`);
  if (e.type === 'style' && Math.abs(e.delta) > LIMITS.maxStyleDelta) warnings.push(`${where}: spostamento di stile fuori scala (${e.delta})`);
  if (e.type === 'teamRating' && Math.abs(e.delta) > LIMITS.maxTeamDelta) warnings.push(`${where}: variazione di rating fuori scala (${e.delta})`);
  if (e.type === 'keyPlayer' && !hasPlayer) errors.push(`${where}: effetto su un giocatore senza condizione keyPlayer`);
}

function checkContradictions(ev: EventDef, where: string, errors: string[]): void {
  const roles = ev.conditions?.find((c) => c.type === 'role');
  const division = ev.conditions?.some((c) => c.type === 'division');
  if (roles && roles.type === 'role' && division && !roles.is.includes('first')) {
    errors.push(`${where}: condizione di divisione con ruolo solo Primavera (mai attivabile)`);
  }
  if (ev.moment === 'unemployed' && ev.conditions?.some((c) => ['role', 'tier', 'division', 'keyPlayer', 'seasonsInJob'].includes(c.type))) {
    errors.push(`${where}: evento da senza panchina con condizioni che richiedono un incarico`);
  }
}

function checkText(
  text: EventDef['title'] | undefined,
  where: string,
  errors: string[],
  warnings: string[],
  required: Lang[],
  hasPlayer: boolean,
): void {
  if (!text || typeof text.it !== 'string' || text.it.trim() === '') {
    errors.push(`${where}: testo italiano mancante`);
    return;
  }
  for (const lang of LANGS) {
    const value = text[lang];
    if (value === undefined) {
      if (required.includes(lang)) errors.push(`${where}: traduzione ${lang} mancante`);
      else warnings.push(`${where}: traduzione ${lang} mancante`);
      continue;
    }
    for (const m of value.matchAll(/\{(\w+)\}/g)) {
      const key = m[1] ?? '';
      if (!(TEMPLATE_VARS as readonly string[]).includes(key)) errors.push(`${where} (${lang}): segnaposto sconosciuto {${key}}`);
      if (key === 'giocatore' && !hasPlayer) errors.push(`${where} (${lang}): {giocatore} senza condizione keyPlayer`);
    }
  }
}
