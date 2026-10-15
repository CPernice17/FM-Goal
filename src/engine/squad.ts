import names from '../data/names.json';
import { clamp, Rng } from './rng';
import type { Job, KeyPlayer, Position, Trait } from './types';

const POSITIONS: Position[] = ['GK', 'DF', 'MF', 'FW'];
const TRAITS: Trait[] = ['ambitious', 'leader', 'fragile', 'rebel'];

export const SQUAD = {
  minKeyPlayers: 3,
  maxKeyPlayers: 4,
  /** Sotto questa soddisfazione il giocatore chiede di andarsene e se ne va. */
  leaveThreshold: 20,
  retireAge: 35,
  youthGraduationAge: 20,
  /** Massimo di giocatori chiave dopo gli acquisti sul mercato. */
  maxAfterMarket: 5,
  /** Quota del contributo di un giocatore che pesa sul rating della prima squadra. */
  ratingShare: 0.5,
  /** Giovane preso sul mercato: contributo iniziale, crescita annua fino a 23 anni, tetto. */
  youngStart: 0.6,
  youngGrowth: 0.5,
  youngCap: 3,
  /** Veterano preso sul mercato: contributo iniziale, calo annuo dai 31 anni, minimo. */
  veteranStart: 2.6,
  veteranDecline: 0.6,
  veteranFloor: 0.4,
};

type NamePool = { first: string[]; last: string[] };
const NAMES = names as Record<string, NamePool>;

/** Nome di un giocatore: 70% del paese del club, il resto straniero. */
function playerName(rng: Rng, country: string): string {
  const local = NAMES[country];
  const pool = local && rng.chance(0.7) ? local : (NAMES.foreign as NamePool);
  return `${rng.pick(pool.first)} ${rng.pick(pool.last)}`;
}

export function newKeyPlayer(rng: Rng, country: string, youth: boolean): KeyPlayer {
  return {
    id: `p${rng.int(100000, 999999)}`,
    name: playerName(rng, country),
    position: rng.pick(POSITIONS),
    age: youth ? rng.int(16, 18) : rng.int(20, 32),
    trait: rng.pick(TRAITS),
    satisfaction: rng.int(55, 75),
    contribution: Math.round(rng.range(0.5, 2.5) * 10) / 10,
  };
}

/** Giocatore preso sul mercato: un giovane promettente o un veterano esperto. */
export function newMarketPlayer(rng: Rng, country: string, profile: 'young' | 'veteran'): KeyPlayer {
  const p = newKeyPlayer(rng, country, false);
  p.profile = profile;
  if (profile === 'young') {
    p.age = rng.int(18, 19);
    p.contribution = SQUAD.youngStart;
    p.trait = rng.chance(0.5) ? 'ambitious' : p.trait;
  } else {
    p.age = rng.int(32, 33);
    p.contribution = SQUAD.veteranStart;
    p.position = rng.chance(0.6) ? 'FW' : p.position;
    p.trait = rng.chance(0.4) ? 'leader' : p.trait;
  }
  p.satisfaction = rng.int(60, 75);
  return p;
}

/** Riporta la rosa al numero minimo di giocatori chiave. */
export function fillKeyPlayers(rng: Rng, job: Job, country: string): KeyPlayer[] {
  const added: KeyPlayer[] = [];
  const target = rng.int(SQUAD.minKeyPlayers, SQUAD.maxKeyPlayers);
  while (job.keyPlayers.length < target) {
    const p = newKeyPlayer(rng, country, job.role === 'youth');
    job.keyPlayers.push(p);
    added.push(p);
  }
  return added;
}

export interface SquadChanges {
  left: KeyPlayer[];
  /** Rating perso dalla prima squadra (negativo se i giovani crescono più di quanto si perde). */
  ratingLoss: number;
}

/**
 * Fine stagione per i giocatori chiave: invecchiano, la soddisfazione segue i
 * risultati, chi è scontento o a fine carriera se ne va.
 */
export function ageKeyPlayers(rng: Rng, job: Job, judgment: number): SquadChanges {
  const left: KeyPlayer[] = [];
  let ratingLoss = 0;
  for (const p of job.keyPlayers) {
    p.age += 1;
    let drift = judgment > 0 ? 4 : judgment < 0 ? -4 : 0;
    if (p.trait === 'ambitious') drift += judgment >= 3 ? 2 : -4;
    if (p.trait === 'rebel') drift += rng.int(-6, 4);
    p.satisfaction = clamp(p.satisfaction + drift, 0, 100);

    // Giocatori presi sul mercato: il giovane cresce fino a 23 anni, il veterano cala dai 31.
    const before = p.contribution;
    if (p.profile === 'young' && p.age <= 23) p.contribution = Math.min(SQUAD.youngCap, p.contribution + SQUAD.youngGrowth);
    if (p.profile === 'veteran' && p.age >= 31) p.contribution = Math.max(SQUAD.veteranFloor, p.contribution - SQUAD.veteranDecline);
    if (job.role === 'first' && p.profile) ratingLoss -= (p.contribution - before) * SQUAD.ratingShare;

    const graduates = job.role === 'youth' && p.age >= SQUAD.youthGraduationAge;
    const retires = job.role === 'first' && p.age >= SQUAD.retireAge && rng.chance(0.5);
    const unhappy = p.satisfaction < SQUAD.leaveThreshold;
    if (graduates || retires || unhappy) {
      left.push(p);
      // Il rating cala per chi se ne va scontento e per chi era stato preso sul mercato.
      if (job.role === 'first' && (unhappy || p.profile)) ratingLoss += p.contribution * SQUAD.ratingShare;
    }
  }
  job.keyPlayers = job.keyPlayers.filter((p) => !left.includes(p));
  return { left, ratingLoss };
}

export function averageSatisfaction(job: Job): number {
  if (job.keyPlayers.length === 0) return 50;
  return job.keyPlayers.reduce((s, p) => s + p.satisfaction, 0) / job.keyPlayers.length;
}
