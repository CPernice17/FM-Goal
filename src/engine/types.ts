/** Tipi condivisi da motore, contenuti e interfaccia. */

export type Lang = 'it' | 'en' | 'es';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type Localized = Partial<Record<Lang, string>> & { it: string };

/** Stile su due assi, ciascuno da -100 a +100. */
export interface Style {
  /** -100 = verticalità, +100 = possesso */
  build: number;
  /** -100 = blocco basso, +100 = pressing alto */
  press: number;
}

export type License = 'B' | 'A' | 'PRO';
export const LICENSE_ORDER: readonly License[] = ['B', 'A', 'PRO'];

export type Role = 'youth' | 'first';

// ---------------------------------------------------------------------------
// Dati statici (file JSON per paese)
// ---------------------------------------------------------------------------

export interface ClubData {
  id: string;
  name: string;
  rating: number;
  profile: Style;
}

export interface LeagueConfig {
  id: string;
  name: string;
  division: number;
  /** Peso della reputazione guadagnata in questo campionato. */
  prestige: number;
  /** Retrocesse dirette verso la divisione inferiore (o verso i club esterni). */
  relegated: number;
  /** Promosse dirette (solo divisioni con una divisione superiore). */
  promotedDirect: number;
  /** Playoff promozione: posizioni da `from` a `to`, una promossa. */
  playoff?: { from: number; to: number };
  /** Gironi: 2 = andata e ritorno (predefinito), 1 = sola andata. */
  rounds?: 1 | 2;
  /** Titolo assegnato da un playoff tra le prime N in classifica (es. MLS). */
  championPlayoff?: number;
  /** Lega superiore e inferiore collegate; assente = club esterni. */
  up?: string;
  down?: string;
}

export interface CountryData {
  id: string;
  name: string;
  cupName: string;
  youthLeagueName: string;
  leagues: LeagueConfig[];
  clubs: Record<string, ClubData[]>;
  /** Club esterni: niente campionato simulato, servono per promozioni e coppe. */
  external: ClubData[];
}

/** Formati reali 2026/27, senza i turni preliminari. */
export type CompFormat =
  /** Fase campionato (Champions, Europa, Conference League): classifica unica, playoff, eliminazione diretta. */
  | { type: 'league'; teams: number; matches: number; direct: number; playoffTo: number }
  /** Gironi da quattro (Libertadores, Sudamericana, ACL Two, Mondiale per club). */
  | {
      type: 'groups';
      groups: number;
      advance: 1 | 2;
      /** Le seconde affrontano ai playoff le terze dei gironi di un'altra coppa (Sudamericana). */
      playoffWithThirdsOf?: string;
      /** Metà gironi per regione (Asia). */
      regional?: boolean;
      /** Gironi a sola andata e partite secche (Mondiale per club). */
      singleLeg?: boolean;
    }
  /** Fase campionato divisa per regione (AFC Champions League Elite). */
  | { type: 'regionalLeague'; teamsPerRegion: number; matches: number; advance: number }
  /** Sola eliminazione diretta con ammesse direttamente agli ottavi (CONCACAF). */
  | { type: 'knockout'; teams: number; byes: number };

export interface ContinentalComp {
  id: string;
  name: string;
  tier: number;
  format: CompFormat;
  /** Posti per paese simulato; il resto va ai club esterni. */
  slots: Record<string, number>;
}

export interface Confederation {
  id: string;
  name: string;
  countries: string[];
  /** Regioni (Asia): paesi simulati di ciascuna regione. */
  regions?: Record<string, string[]>;
  competitions: ContinentalComp[];
  supercup?: { id: string; name: string; from: [string, string] };
}

export interface ContinentalData {
  confederations: Confederation[];
  intercontinental: { id: string; name: string };
  clubWorldCup: { id: string; name: string; every: number; firstYear: number; quotas: Record<string, number> };
  /** Club esterni dei paesi non simulati: giocano solo le coppe continentali. */
  pool: { id: string; name: string; country: string; confed: string; region?: string; rating: number }[];
}

// ---------------------------------------------------------------------------
// Stato del mondo
// ---------------------------------------------------------------------------

export interface Club {
  id: string;
  name: string;
  country: string;
  /** null = club esterno */
  leagueId: string | null;
  rating: number;
  /** Livello verso cui il rating tende nel tempo. */
  anchor: number;
  profile: Style;
}

export interface LeagueState {
  config: LeagueConfig;
  country: string;
  clubIds: string[];
  /** Classifica dell'ultima stagione giocata (id in ordine). */
  lastTable: string[];
  /** Classifica completa dell'ultima stagione, per l'interfaccia. */
  standings: { id: string; points: number; gf: number; ga: number }[];
}

export interface WorldState {
  /** Anno di inizio della stagione corrente, es. 2026 per la 2026/27. */
  season: number;
  clubs: Record<string, Club>;
  leagues: Record<string, LeagueState>;
  countries: Record<string, { name: string; cupName: string; youthLeagueName: string; leagueIds: string[] }>;
  /** Rating delle Primavera, rigenerati a ogni stagione. */
  youthRatings: Record<string, number>;
  /** Coppe continentali: definizioni, qualificate alla prossima stagione, ultimi vincitori. */
  continental?: {
    defs: Omit<ContinentalData, 'pool'>;
    /** Confederazione e regione di ogni club esterno del pool. */
    poolConfed: Record<string, string>;
    poolRegion: Record<string, string>;
    qualified: Record<string, string[]>;
    lastWinners: Record<string, string>;
  };
}

// ---------------------------------------------------------------------------
// Carriera
// ---------------------------------------------------------------------------

export type Trait = 'ambitious' | 'leader' | 'fragile' | 'rebel';
export type Position = 'GK' | 'DF' | 'MF' | 'FW';

export interface KeyPlayer {
  id: string;
  name: string;
  position: Position;
  age: number;
  trait: Trait;
  satisfaction: number;
  /** Punti di rating che il giocatore porta alla squadra. */
  contribution: number;
}

export type ObjectiveId =
  | 'title'
  | 'europe'
  | 'top_half'
  | 'mid_table'
  | 'survival'
  | 'promotion'
  | 'playoff'
  | 'youth_growth'
  | 'playoffs'
  | 'rebuild';

export interface Job {
  clubId: string;
  role: Role;
  contractYears: number;
  seasons: number;
  board: number;
  dressing: number;
  environment: number;
  keyPlayers: KeyPlayer[];
  /** Bonus o malus di rating dovuto agli eventi, si azzera a fine stagione. */
  seasonBoost: number;
}

export interface Coach {
  name: string;
  nationality: string;
  age: number;
  style: Style;
  license: License;
  reputation: number;
  peakReputation: number;
}

export interface Offer {
  clubId: string;
  role: Role;
  years: number;
  challenge: boolean;
}

export type CareerOption =
  | { kind: 'accept'; offer: Offer }
  | { kind: 'renew'; years: number }
  | { kind: 'stay' }
  | { kind: 'leave' }
  | { kind: 'wait' }
  | { kind: 'study' }
  | { kind: 'retire' }
  | { kind: 'continue' };

export type Pending =
  | { kind: 'event'; eventId: string; bindings: Bindings }
  | { kind: 'career'; options: CareerOption[]; context: CareerContext };

export type EndStep = 'retirement' | 'career_event' | 'career_decision' | 'management_event';

export type CareerContext = 'contract_running' | 'contract_ended' | 'renewal' | 'unemployed' | 'fired' | 'retirement' | 'first_job';

export interface Bindings {
  playerId?: string;
  rivalId?: string;
}

export type HeadlineId =
  | 'champion'
  | 'promoted'
  | 'relegated'
  | 'cup_winner'
  | 'cup_penalties_out'
  | 'win_streak'
  | 'second_half_collapse'
  | 'second_half_surge'
  | 'best_defence'
  | 'best_attack'
  | 'above_expectations'
  | 'below_expectations'
  | 'fired'
  | 'top_scorer'
  | 'continental_winner'
  | 'continental_final'
  | 'continental_semi';

export interface Headline {
  id: HeadlineId;
  /** Valori da inserire nel testo, es. lunghezza della serie. */
  values?: Record<string, string | number>;
}

export interface SeasonReport {
  season: number;
  clubId: string;
  clubName: string;
  role: Role;
  leagueName: string;
  position: number;
  teams: number;
  expectedPosition: number;
  objective: ObjectiveId;
  points: number;
  table: { clubId: string; name: string; points: number; gf: number; ga: number }[];
  cup: { reached: string; won: boolean } | null;
  /** Coppe continentali e mondiali giocate in stagione. */
  continental: { id: string; name: string; reached: string; won: boolean }[];
  headlines: Headline[];
  firedAtMatchday: number | null;
  matchdays: number;
  trophies: string[];
  deltas: { board: number; dressing: number; environment: number; reputation: number };
}

export type Phase =
  | 'first_job'
  | 'preseason'
  | 'start_decision'
  | 'ready'
  | 'report'
  | 'end_decision'
  | 'season_over'
  | 'finished';

export type EndReason = 'age' | 'unemployed' | 'voluntary';

export interface CareerSummary {
  reason: EndReason;
  seasons: number;
  clubs: string[];
  trophies: string[];
  peakReputation: number;
  finalStyle: Style;
  firings: number;
  title: string;
}

export interface GameState {
  version: number;
  lang: Lang;
  /** Assente nei salvataggi precedenti: vale come 'normal'. */
  difficulty?: Difficulty;
  rng: number;
  turn: number;
  world: WorldState;
  coach: Coach;
  job: Job | null;
  /** Club dell'incarico appena perso, per i testi del turno senza panchina. */
  lastClubId: string | null;
  unemployedTurns: number;
  flags: Record<string, true>;
  scheduled: { eventId: string; turn: number }[];
  /** Ultimo turno in cui ogni evento è stato mostrato. */
  eventLog: Record<string, number>;
  phase: Phase;
  pending: Pending | null;
  /** Passi di fine stagione ancora da risolvere, costruiti uno alla volta. */
  endQueue: EndStep[];
  /** Vero se in questa fine stagione è già stata mostrata una decisione di carriera. */
  careerShown: boolean;
  skipOffers: boolean;
  retireRequested: boolean;
  lastReport: SeasonReport | null;
  history: SeasonReport[];
  firings: number;
  trophies: string[];
  clubsCoached: string[];
  summary: CareerSummary | null;
  /** Numero di decisioni prese, utile per il bilanciamento. */
  decisions: number;
}
