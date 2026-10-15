import { CONTINENTAL, COUNTRIES, EVENTS } from '../content/index';
import { choose, createCareer, nextSeason, playSeason, prepareEnd, startSeason } from '../engine/career';
import type { Difficulty, GameState, Lang, OutcomeLine } from '../engine/types';
import { t } from '../i18n/index';
import { clearGame, loadGame, loadTheme, saveGame, saveTheme } from './storage';
import {
  renderCareerDecision,
  renderEvent,
  renderFinal,
  renderHome,
  renderOutcome,
  renderReport,
  renderSheet,
  renderSidebar,
  summaryText,
  type Draft,
  type ThemeChoice,
} from './views';
import './style.css';

const LANG: Lang = 'it';
const COUNTRY_LIST = COUNTRIES.map((c) => ({ id: c.id, name: c.name }));
const root = document.getElementById('app') as HTMLElement;

let state: GameState | null = null;
let draft: Draft = { name: '', style: { build: 30, press: 40 }, difficulty: 'normal', nationality: 'ita', error: null };
let copied = false;
/** Ultima scelta e sue conseguenze, mostrate nella schermata successiva. */
let outcome: { choice: string; lines: OutcomeLine[] } | null = null;
let theme: ThemeChoice = loadTheme();

const THEMES: ThemeChoice[] = ['auto', 'light', 'dark'];

function applyTheme(): void {
  const html = document.documentElement;
  if (theme === 'auto') delete html.dataset.theme;
  else html.dataset.theme = theme;
  const dark = theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#16141d' : '#fbf7f4');
}

/** Salvataggi precedenti ai colori sociali: li recupera dai file dati. */
function withClubColors(s: GameState): GameState {
  const colors = new Map<string, [string, string]>();
  for (const c of COUNTRIES) {
    for (const list of Object.values(c.clubs)) for (const club of list) if (club.colors) colors.set(club.id, club.colors);
    for (const club of c.external) if (club.colors) colors.set(club.id, club.colors);
  }
  for (const club of CONTINENTAL.pool) if (club.colors) colors.set(club.id, club.colors);
  for (const club of Object.values(s.world.clubs)) if (!club.colors) club.colors = colors.get(club.id);
  return s;
}

/** Avanza da sola le fasi senza schermata (simulazione e passaggio di stagione). */
function settle(s: GameState): GameState {
  for (;;) {
    if (s.phase === 'ready') s = playSeason(s);
    else if (s.phase === 'season_over') s = nextSeason(s);
    else return s;
  }
}

function commit(next: GameState): void {
  state = settle(next);
  saveGame(state);
  render(true);
}

function render(newScreen = false): void {
  if (!state) {
    root.className = 'is-home';
    root.innerHTML = renderHome(LANG, loadGame() !== null, draft, COUNTRY_LIST, theme);
  } else {
    let main = '';
    switch (state.phase) {
      case 'preseason':
        main = renderSheet(state);
        break;
      case 'first_job':
      case 'start_decision':
      case 'mid_decision':
      case 'end_decision': {
        const p = state.pending;
        if (p?.kind === 'event') {
          const ev = EVENTS.find((e) => e.id === p.eventId);
          main = ev ? renderEvent(state, ev, p) : '';
        } else if (p?.kind === 'career') {
          main = renderCareerDecision(state, p);
        }
        break;
      }
      case 'report':
        main = renderReport(state);
        break;
      case 'finished':
        main = renderFinal(state, copied);
        break;
    }
    // Le conseguenze dell'ultima scelta compaiono in cima alla schermata successiva.
    if (outcome) main = main.replace(/(<main[^>]*>)/, `$1${renderOutcome(state, outcome.choice, outcome.lines)}`);
    root.className = 'is-game';
    // La bacheca di fine carriera occupa tutta la larghezza, senza colonna laterale.
    root.innerHTML =
      state.phase === 'finished' ? main : `<div class="layout phase-${state.phase}">${main}${renderSidebar(state, theme)}</div>`;
  }
  if (newScreen) {
    window.scrollTo({ top: 0 });
    // Il focus va al titolo della nuova schermata, utile con tastiera e lettori di schermo.
    const h = root.querySelector<HTMLElement>('h1');
    if (h) {
      h.tabIndex = -1;
      h.focus({ preventScroll: true });
    }
  }
}

root.addEventListener('click', (e) => {
  const target = (e.target as Element).closest<HTMLElement | SVGElement>('[data-action]');
  if (!target) return;
  const action = target.getAttribute('data-action');
  // Le conseguenze restano visibili fino all'azione successiva.
  if (action !== 'choose' && action !== 'theme' && action !== 'copy') outcome = null;

  switch (action) {
    case 'theme':
      theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length] ?? 'auto';
      saveTheme(theme);
      applyTheme();
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme());
applyTheme();
render();
      break;
    case 'pick-style': {
      const rect = target.getBoundingClientRect();
      const me = e as MouseEvent;
      const fx = (me.clientX - rect.left) / rect.width;
      const fy = (me.clientY - rect.top) / rect.height;
      const clampAxis = (v: number) => Math.max(-100, Math.min(100, Math.round(v / 10) * 10));
      draft = { ...draft, name: currentName(), style: { build: clampAxis((fx - 0.5) * 222), press: clampAxis((0.5 - fy) * 222) } };
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme());
applyTheme();
render();
      break;
    }
    case 'continue':
      state = loadGame();
      if (state) state = settle(withClubColors(state));
      render(true);
      break;
    case 'play':
      if (!state) return;
      commit(startSeason(state, EVENTS));
      break;
    case 'choose': {
      if (!state) return;
      const index = Number(target.getAttribute('data-index'));
      const label = (target.querySelector('.offer-club')?.textContent ?? target.textContent ?? '').trim();
      const next = choose(state, index, EVENTS);
      outcome = next.lastOutcome?.length ? { choice: label, lines: next.lastOutcome } : null;
      commit(next);
      break;
    }
    case 'next':
      if (!state) return;
      commit(prepareEnd(state, EVENTS));
      break;
    case 'copy':
      if (!state) return;
      navigator.clipboard?.writeText(summaryText(state)).then(
        () => {
          copied = true;
          window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme());
applyTheme();
render();
        },
        () => undefined,
      );
      break;
    case 'restart':
      clearGame();
      state = null;
      copied = false;
      draft = { name: '', style: { build: 30, press: 40 }, difficulty: draft.difficulty, nationality: draft.nationality, error: null };
      render(true);
      break;
    case 'quit':
      if (window.confirm(t(LANG, 'ui_quit_confirm'))) {
        clearGame();
        state = null;
        render(true);
      }
      break;
  }
});

function currentName(): string {
  return root.querySelector<HTMLInputElement>('input[name="name"]')?.value ?? draft.name;
}

root.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = currentName().trim();
  if (!name) {
    draft = { ...draft, name, error: t(LANG, 'ui_name_missing') };
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme());
applyTheme();
render();
    root.querySelector<HTMLInputElement>('input[name="name"]')?.focus();
    return;
  }
  const seed = Math.floor(Math.random() * 2 ** 31);
  copied = false;
  commit(createCareer({ name, nationality: draft.nationality, style: draft.style, difficulty: draft.difficulty, seed, lang: LANG, countries: COUNTRIES, continental: CONTINENTAL }));
});

// La difficoltà scelta resta nella bozza, così sopravvive ai ridisegni.
root.addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  if (input.name === 'difficulty') draft = { ...draft, name: currentName(), difficulty: input.value as Difficulty };
  if (input.name === 'nationality') draft = { ...draft, name: currentName(), nationality: input.value };
});

// Tastiera sul quadrato dello stile: frecce per spostare il punto.
root.addEventListener('keydown', (e) => {
  const target = e.target as Element;
  if (!target.closest('[data-action="pick-style"]')) return;
  const step: Record<string, [number, number]> = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, 10], ArrowDown: [0, -10] };
  const d = step[e.key];
  if (!d) return;
  e.preventDefault();
  const clampAxis = (v: number) => Math.max(-100, Math.min(100, v));
  draft = { ...draft, name: currentName(), style: { build: clampAxis(draft.style.build + d[0]), press: clampAxis(draft.style.press + d[1]) } };
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme());
applyTheme();
render();
  root.querySelector<SVGElement>('[data-action="pick-style"]')?.focus();
});

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme());
applyTheme();
render();
