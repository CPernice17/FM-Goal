import { deserialize, serialize } from '../engine/career';
import type { GameState } from '../engine/types';

const KEY = 'fm-goal:save';

/** Salvataggio locale. Se il browser non lo permette, il gioco funziona comunque. */
export function saveGame(state: GameState): void {
  try {
    localStorage.setItem(KEY, serialize(state));
  } catch {
    // Archiviazione non disponibile (navigazione privata, spazio pieno): si prosegue senza.
  }
}

export function loadGame(): GameState | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? deserialize(raw) : null;
  } catch {
    return null;
  }
}

export function clearGame(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // niente da fare
  }
}
