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

const THEME_KEY = 'fm-goal:theme';

/** Tema scelto: automatico (segue il sistema), chiaro o scuro. */
export function loadTheme(): 'auto' | 'light' | 'dark' {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function saveTheme(theme: 'auto' | 'light' | 'dark'): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Archiviazione non disponibile: il tema vale solo per questa sessione.
  }
}
