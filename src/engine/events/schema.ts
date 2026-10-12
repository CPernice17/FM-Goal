import type { HeadlineId, License, Localized, Role, Trait } from '../types';

/**
 * Formato degli eventi. Tutto è dichiarativo: niente espressioni da eseguire,
 * solo operatori predefiniti, così lo script di controllo può validare i pacchetti.
 */

export type Moment = 'start' | 'end' | 'unemployed';
export type Comparator = '<' | '<=' | '>' | '>=' | '==';
export type StateVar = 'board' | 'dressing' | 'environment' | 'reputation';

export type Condition =
  | { type: 'var'; var: StateVar; op: Comparator; value: number }
  | { type: 'role'; is: Role[] }
  | { type: 'tier'; op: Comparator; value: number }
  | { type: 'division'; is: number[] }
  | { type: 'style'; axis: 'build' | 'press'; op: Comparator; value: number }
  | { type: 'flag'; has?: string; missing?: string }
  | { type: 'headline'; is: HeadlineId }
  | { type: 'keyPlayer'; trait?: Trait; satisfaction?: { op: Comparator; value: number } }
  | { type: 'seasonsInJob'; op: Comparator; value: number }
  | { type: 'license'; is: License[] }
  | { type: 'age'; op: Comparator; value: number };

export type Effect =
  | { type: 'var'; var: StateVar; delta: number }
  | { type: 'flag'; set?: string; clear?: string }
  | { type: 'style'; axis: 'build' | 'press'; delta: number }
  | { type: 'keyPlayer'; satisfaction?: number; leave?: boolean }
  | { type: 'teamRating'; delta: number }
  | { type: 'schedule'; event: string; inTurns: number }
  | { type: 'license'; upgrade: true }
  | { type: 'skipOffers' }
  | { type: 'endJob'; reason: 'resign' }
  | { type: 'retire' };

export interface EventOption {
  text: Localized;
  effects: Effect[];
}

export interface EventDef {
  id: string;
  moment: Moment;
  /** Gli eventi di carriera hanno la precedenza su quelli di gestione. */
  category: 'management' | 'career';
  conditions: Condition[];
  weight: number;
  /** Turni prima che l'evento possa ripresentarsi, oppure 'once'. */
  cooldown: number | 'once';
  /** Solo come seguito programmato da un altro evento. */
  followUpOnly?: boolean;
  title: Localized;
  body: Localized;
  options: EventOption[];
}

export interface EventPack {
  pack: string;
  events: EventDef[];
}

/** Segnaposto ammessi nei testi. */
export const TEMPLATE_VARS = ['club', 'giocatore', 'rivale', 'campionato', 'coppa'] as const;
