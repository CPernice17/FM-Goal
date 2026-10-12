import type { GameState, Headline, Lang, Style } from '../engine/types';
import { it, type Strings } from './it';

/**
 * Testi dell'interfaccia. Inglese e spagnolo arriveranno con la fase
 * multilingua: fino ad allora si ricade sull'italiano.
 */
const DICTS: Partial<Record<Lang, Partial<Strings>>> = { it };

export function t(lang: Lang, key: keyof Strings, vars: Record<string, string | number> = {}): string {
  const raw = DICTS[lang]?.[key] ?? it[key];
  return raw.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] !== undefined ? String(vars[k]) : m));
}

export function headlineText(lang: Lang, h: Headline): string {
  const vars: Record<string, string | number> = { ...(h.values ?? {}) };
  if (typeof vars.stage === 'string') vars.stage = t(lang, `stage_${vars.stage}` as keyof Strings);
  return t(lang, `headline_${h.id}` as keyof Strings, vars);
}

/** Etichetta del quadrante di stile. */
export function styleLabel(lang: Lang, style: Style): string {
  const key = style.press >= 0 ? (style.build >= 0 ? 'style_dominio' : 'style_pressing_ripartenza') : style.build >= 0 ? 'style_controllo' : 'style_contropiede';
  return t(lang, key);
}

/** Trofeo leggibile da una chiave come "league:ita1:2026". */
export function trophyText(state: GameState, key: string): string {
  const [kind, ref, year] = key.split(':');
  const season = `${year}/${String(Number(year) + 1).slice(2)}`;
  const lang = state.lang;
  if (kind === 'league') return t(lang, 'trophy_league', { name: state.world.leagues[ref ?? '']?.config.name ?? ref ?? '', season });
  if (kind === 'cup') return t(lang, 'trophy_cup', { name: state.world.countries[ref ?? '']?.cupName ?? '', season });
  if (kind === 'youth') return t(lang, 'trophy_youth', { name: state.world.countries[ref ?? '']?.youthLeagueName ?? '', season });
  if (kind === 'promotion') return t(lang, 'trophy_promotion', { name: state.world.leagues[ref ?? '']?.config.name ?? '', season });
  return key;
}
