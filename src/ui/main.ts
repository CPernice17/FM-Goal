import { CONTINENTAL, COUNTRIES, EVENTS } from '../content/index';
import { choose, createCareer, nextSeason, playSeason, prepareEnd, startSeason } from '../engine/career';
import type { Difficulty, GameState, Lang } from '../engine/types';
import { t } from '../i18n/index';
import { clearGame, loadGame, saveGame } from './storage';
import {
  renderCareerDecision,
  renderEvent,
  renderFinal,
  renderHome,
  renderReport,
  renderSheet,
  renderSidebar,
  summaryText,
  type Draft,
} from './views';
import './style.css';

const LANG: Lang = 'it';
const COUNTRY_LIST = COUNTRIES.map((c) => ({ id: c.id, name: c.name }));
const root = document.getElementById('app') as HTMLElement;

let state: GameState | null = null;
let draft: Draft = { name: '', style: { build: 30, press: 40 }, difficulty: 'normal', nationality: 'ita', error: null };
let copied = false;

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
    root.innerHTML = renderHome(LANG, loadGame() !== null, draft, COUNTRY_LIST);
  } else {
    let main = '';
    switch (state.phase) {
      case 'preseason':
        main = renderSheet(state);
        break;
      case 'first_job':
      case 'start_decision':
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
    root.className = 'is-game';
    root.innerHTML = `<div class="layout phase-${state.phase}">${main}${renderSidebar(state)}</div>`;
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

  switch (action) {
    case 'pick-style': {
      const rect = target.getBoundingClientRect();
      const me = e as MouseEvent;
      const fx = (me.clientX - rect.left) / rect.width;
      const fy = (me.clientY - rect.top) / rect.height;
      const clampAxis = (v: number) => Math.max(-100, Math.min(100, Math.round(v / 10) * 10));
      draft = { ...draft, name: currentName(), style: { build: clampAxis((fx - 0.5) * 222), press: clampAxis((0.5 - fy) * 222) } };
      render();
      break;
    }
    case 'continue':
      state = loadGame();
      if (state) state = settle(state);
      render(true);
      break;
    case 'play':
      if (!state) return;
      commit(startSeason(state, EVENTS));
      break;
    case 'choose': {
      if (!state) return;
      const index = Number(target.getAttribute('data-index'));
      commit(choose(state, index, EVENTS));
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
  render();
  root.querySelector<SVGElement>('[data-action="pick-style"]')?.focus();
});

render();
