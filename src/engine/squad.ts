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
};

function playerName(rng: Rng, country: string): string {
  const pool = country === 'ita' && rng.chance(0.7) ? names.ita : names.foreign;
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
  /** Somma dei contributi persi dalla prima squadra (0 per la Primavera). */
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

    const graduates = job.role === 'youth' && p.age >= SQUAD.youthGraduationAge;
    const retires = job.role === 'first' && p.age >= SQUAD.retireAge && rng.chance(0.5);
    const unhappy = p.satisfaction < SQUAD.leaveThreshold;
    if (graduates || retires || unhappy) {
      left.push(p);
      if (job.role === 'first' && unhappy) ratingLoss += p.contribution * 0.5;
    }
  }
  job.keyPlayers = job.keyPlayers.filter((p) => !left.includes(p));
  return { left, ratingLoss };
}

export function averageSatisfaction(job: Job): number {
  if (job.keyPlayers.length === 0) return 50;
  return job.keyPlayers.reduce((s, p) => s + p.satisfaction, 0) / job.keyPlayers.length;
}
