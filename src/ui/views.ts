import { preseason } from '../engine/career';
import type { EventDef } from '../engine/events/schema';
import { renderText } from '../engine/events/runtime';
import type { CareerOption, Difficulty, GameState, KeyPlayer, Lang, OutcomeLine, Pending, SeasonReport, Style } from '../engine/types';
import { compInfo, confedOf } from '../engine/continental';
import { divisionOf, tierInLeague, topLeagueId } from '../engine/world';
import { headlineText, styleLabel, t, trophyText } from '../i18n/index';
import type { Strings } from '../i18n/it';

/** Escape per tutto il testo inserito nell'HTML. */
export function esc(value: string | number): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const tt = (lang: Lang, key: keyof Strings, vars?: Record<string, string | number>) => esc(t(lang, key, vars));

/** Aggettivo delle coppe continentali del club: "europee", "sudamericane", … */
function areaOf(state: GameState, clubId: string): string {
  const confed = confedOf(state.world, clubId);
  return t(state.lang, `area_${confed ?? 'other'}` as keyof Strings);
}

function seasonLabel(year: number): string {
  return `${year}/${String(year + 1).slice(2)}`;
}

const NO_COLORS: [string, string] = ['#8d9093', '#ffffff'];

function clubColors(state: GameState, clubId: string): [string, string] {
  return state.world.clubs[clubId]?.colors ?? NO_COLORS;
}

/** Riquadro con i colori sociali, accanto al nome del club. */
function kit(state: GameState, clubId: string): string {
  const [k1, k2] = clubColors(state, clubId);
  return `<span class="kit" style="--k1:${esc(k1)};--k2:${esc(k2)}" aria-hidden="true"></span>`;
}

/** Sciarpa a strisce con i colori sociali, sotto il nome del club. */
function scarf(state: GameState, clubId: string): string {
  const [k1, k2] = clubColors(state, clubId);
  return `<span class="scarf" style="--k1:${esc(k1)};--k2:${esc(k2)}" aria-hidden="true">${'<span></span>'.repeat(6)}</span>`;
}

export type ThemeChoice = 'auto' | 'light' | 'dark';

export function themeToggle(lang: Lang, theme: ThemeChoice): string {
  return `<button class="theme-toggle" data-action="theme">${tt(lang, `ui_theme_${theme}` as keyof Strings)}</button>`;
}

// ---------------------------------------------------------------------------
// Conseguenze dell'ultima scelta
// ---------------------------------------------------------------------------

function signed(n: number): string {
  const r = Math.round(n * 10) / 10;
  return `${r > 0 ? '+' : ''}${r}`;
}

function outcomeLine(state: GameState, l: OutcomeLine): string {
  const lang = state.lang;
  const delta = (n: number) => `<span class="${n > 0 ? 'up' : 'down'}">${esc(signed(n))}</span>`;
  switch (l.kind) {
    case 'var':
      return l.delta === 0 ? '' : `${tt(lang, `var_${l.var}` as keyof Strings)} ${delta(l.delta)}`;
    case 'style':
      return tt(lang, `outcome_style_${l.axis}_${l.delta > 0 ? 'up' : 'down'}` as keyof Strings);
    case 'team':
      return `${tt(lang, l.secondHalf ? 'outcome_team_second' : 'outcome_team')} ${delta(l.delta)}`;
    case 'playerLeft':
      return tt(lang, 'outcome_player_left', { name: l.name });
    case 'playerJoined':
      return tt(lang, `outcome_player_joined_${l.profile}` as keyof Strings, { name: l.name, age: l.age });
    case 'satisfaction':
      return `${tt(lang, 'outcome_satisfaction', { name: l.name })} ${delta(l.delta)}`;
    case 'license':
      return tt(lang, 'outcome_license', { license: l.license === 'PRO' ? 'UEFA Pro' : `UEFA ${l.license}` });
    case 'job': {
      const name = state.world.clubs[l.clubId]?.name ?? '';
      const key = l.role === 'youth' ? 'outcome_job_youth' : l.years === 1 ? 'outcome_job_one' : 'outcome_job';
      return `${kit(state, l.clubId)}${tt(lang, key as keyof Strings, { club: name, years: l.years })}`;
    }
    case 'renew':
      return tt(lang, l.years === 1 ? 'outcome_renew_one' : 'outcome_renew', { years: l.years });
    default:
      return tt(lang, `outcome_${l.kind}` as keyof Strings);
  }
}

/** Riquadro con la scelta appena fatta e le sue conseguenze. */
export function renderOutcome(state: GameState, choice: string, lines: OutcomeLine[]): string {
  const items = lines.map((l) => outcomeLine(state, l)).filter((x) => x !== '');
  if (items.length === 0) return '';
  return `
  <aside class="outcome" role="status">
    <p class="outcome-choice">${tt(state.lang, 'ui_outcome_choice')} <q>${esc(choice)}</q></p>
    <ul>${items.map((x) => `<li>${x}</li>`).join('')}</ul>
  </aside>`;
}

// ---------------------------------------------------------------------------
// Stile: quadrato con il punto dell'allenatore
// ---------------------------------------------------------------------------

export function styleSquare(lang: Lang, style: Style, interactive: boolean): string {
  // build: -100 sinistra, +100 destra; press: +100 in alto.
  const x = 100 + style.build * 0.9;
  const y = 100 - style.press * 0.9;
  return `
  <svg class="style-square${interactive ? ' is-interactive' : ''}" viewBox="0 0 200 200" role="img"
       aria-label="${esc(styleLabel(lang, style))}" ${interactive ? 'data-action="pick-style" tabindex="0"' : ''}>
    <rect x="1" y="1" width="198" height="198" class="sq-frame"/>
    <line x1="100" y1="1" x2="100" y2="199" class="sq-axis"/>
    <line x1="1" y1="100" x2="199" y2="100" class="sq-axis"/>
    ${
      interactive
        ? `<text x="50" y="46" class="sq-label">${tt(lang, 'style_pressing_ripartenza_1')}<tspan x="50" dy="15">${tt(lang, 'style_pressing_ripartenza_2')}</tspan></text>
    <text x="150" y="52" class="sq-label">${tt(lang, 'style_dominio')}</text>
    <text x="50" y="152" class="sq-label">${tt(lang, 'style_contropiede')}</text>
    <text x="150" y="152" class="sq-label">${tt(lang, 'style_controllo')}</text>`
        : ''
    }
    <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9" class="sq-dot"/>
  </svg>`;
}

// ---------------------------------------------------------------------------
// Home e creazione
// ---------------------------------------------------------------------------

export interface Draft {
  name: string;
  nationality: string;
  style: Style;
  difficulty: Difficulty;
  error: string | null;
}

const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];

function difficultyField(lang: Lang, current: Difficulty): string {
  return `
  <fieldset class="field difficulty">
    <legend class="field-label">${tt(lang, 'ui_difficulty')}</legend>
    ${DIFFICULTIES.map(
      (d) => `
      <label class="difficulty-option">
        <input type="radio" name="difficulty" value="${d}" ${d === current ? 'checked' : ''} />
        <span class="difficulty-name">${tt(lang, `difficulty_${d}` as keyof Strings)}</span>
        <span class="difficulty-note">${tt(lang, `difficulty_${d}_note` as keyof Strings)}</span>
      </label>`,
    ).join('')}
  </fieldset>`;
}

export function renderHome(
  lang: Lang,
  hasSave: boolean,
  draft: Draft,
  countries: { id: string; name: string }[],
  theme: ThemeChoice,
): string {
  return `
  <main class="screen home">
    <header class="home-head">
      <h1 class="brand">${tt(lang, 'ui_title')}</h1>
      <p class="lede">${tt(lang, 'ui_tagline')}</p>
    </header>
    ${themeToggle(lang, theme)}
    ${hasSave ? `<button class="btn btn-primary" data-action="continue">${tt(lang, 'ui_continue')}</button>` : ''}
    <form class="create" data-form="create" novalidate>
      <label class="field">
        <span class="field-label">${tt(lang, 'ui_name')}</span>
        <input name="name" autocomplete="off" maxlength="32" value="${esc(draft.name)}"
               placeholder="${tt(lang, 'ui_name_placeholder')}" />
      </label>
      <label class="field">
        <span class="field-label">${tt(lang, 'ui_nationality')}</span>
        <span class="hint">${tt(lang, 'ui_nationality_hint')}</span>
        <select name="nationality">
          ${countries.map((c) => `<option value="${esc(c.id)}" ${c.id === draft.nationality ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          <option value="other" ${draft.nationality === 'other' ? 'selected' : ''}>${tt(lang, 'ui_nationality_other')}</option>
        </select>
      </label>
      <div class="field">
        <span class="field-label">${tt(lang, 'ui_style')}</span>
        <p class="hint">${tt(lang, 'ui_style_hint')}</p>
        ${styleSquare(lang, draft.style, true)}
        <p class="style-name">${esc(styleLabel(lang, draft.style))}</p>
      </div>
      ${difficultyField(lang, draft.difficulty)}
      ${draft.error ? `<p class="error" role="alert">${esc(draft.error)}</p>` : ''}
      <button class="btn ${hasSave ? 'btn-secondary' : 'btn-primary'}" type="submit">${tt(lang, 'ui_start')}</button>
    </form>
  </main>`;
}

// ---------------------------------------------------------------------------
// Scheda incarico
// ---------------------------------------------------------------------------

function meter(lang: Lang, key: keyof Strings, value: number, delta?: number): string {
  const v = Math.round(value);
  const d = delta === undefined || Math.round(delta) === 0 ? '' : `<span class="delta ${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '+' : ''}${Math.round(delta)}</span>`;
  return `
  <div class="meter">
    <span class="meter-label">${tt(lang, key)}</span>
    <span class="meter-bar" aria-hidden="true"><span style="width:${v}%"></span></span>
    <span class="meter-value">${v}${d}</span>
  </div>`;
}

function mood(lang: Lang, p: KeyPlayer): string {
  return p.satisfaction >= 65 ? t(lang, 'mood_happy') : p.satisfaction >= 40 ? t(lang, 'mood_calm') : t(lang, 'mood_unhappy');
}

function coachLine(state: GameState): string {
  const lang = state.lang;
  return `<p class="coach-line">${esc(state.coach.name)}, ${tt(lang, 'ui_age', { age: state.coach.age })}. ${tt(lang, 'ui_license', { license: state.coach.license === 'PRO' ? 'UEFA Pro' : `UEFA ${state.coach.license}` })}. ${tt(lang, 'ui_season', { season: seasonLabel(state.world.season) })}.</p>`;
}

export function renderSheet(state: GameState): string {
  const lang = state.lang;
  const job = state.job;
  if (!job) {
    const last = state.lastClubId ? state.world.clubs[state.lastClubId]?.name ?? '' : '';
    return `
    <main class="screen sheet">
      ${coachLine(state)}
      <h1 class="club">${tt(lang, 'ui_unemployed_title')}</h1>
      <p class="body">${tt(lang, 'ui_unemployed_body', { club: last })}</p>
      <section class="meters">${meter(lang, 'var_reputation', state.coach.reputation)}</section>
      ${styleBlock(state)}
      ${actionBar(`<button class="btn btn-primary" data-action="play">${tt(lang, 'ui_unemployed_play')}</button>`, t(lang, 'ui_quit_short'))}
    </main>`;
  }
  const pre = preseason(state);
  const roleKey = job.role === 'youth' ? 'role_youth' : 'role_first';
  return `
  <main class="screen sheet">
    ${coachLine(state)}
    <p class="role">${tt(lang, roleKey)}</p>
    <h1 class="club">${esc(pre?.clubName ?? '')}${scarf(state, job.clubId)}</h1>
    <p class="league">${esc(pre?.leagueName ?? '')}</p>
    <section class="objective">
      <span class="objective-label">${tt(lang, 'ui_objective')}</span>
      <strong>${tt(lang, `objective_${pre?.objective ?? 'mid_table'}` as keyof Strings, { area: areaOf(state, job.clubId) })}</strong>
      <span class="objective-note">${tt(lang, 'ui_expected', { pos: pre?.expectedPosition ?? '-', teams: pre?.teams ?? '-' })}</span>
    </section>
    ${competitionsBlock(state)}
    <section class="meters">
      ${meter(lang, 'var_board', job.board)}
      ${meter(lang, 'var_dressing', job.dressing)}
      ${meter(lang, 'var_environment', job.environment)}
      ${meter(lang, 'var_reputation', state.coach.reputation)}
    </section>
    <section class="players">
      <h2>${tt(lang, 'ui_key_players')}</h2>
      <ul>
        ${job.keyPlayers
          .map(
            (p) => `<li><span class="p-name">${esc(p.name)}</span>
              <span class="p-meta">${tt(lang, `pos_${p.position}` as keyof Strings)}, ${tt(lang, 'ui_years', { n: p.age })}, ${tt(lang, `trait_${p.trait}` as keyof Strings)}${p.profile ? `, ${tt(lang, `profile_${p.profile}` as keyof Strings)}` : ''}. <em>${esc(mood(lang, p))}</em></span></li>`,
          )
          .join('')}
      </ul>
    </section>
    ${styleBlock(state)}
    ${actionBar(`<button class="btn btn-primary" data-action="play">${tt(lang, 'ui_play_season')}</button>`, t(lang, 'ui_quit_short'))}
  </main>`;
}

/** Coppe internazionali a cui il club allenato è qualificato in questa stagione. */
function competitionsBlock(state: GameState): string {
  const job = state.job;
  const cont = state.world.continental;
  if (!job || job.role !== 'first' || !cont) return '';
  const names = Object.entries(cont.qualified)
    .filter(([, ids]) => ids.includes(job.clubId))
    .map(([id]) => compInfo(state.world, id)?.name)
    .filter((n): n is string => !!n);
  if (names.length === 0) return '';
  return `<p class="competitions"><span>${tt(state.lang, 'ui_competitions')}:</span> ${esc(names.join(', '))}</p>`;
}

function styleBlock(state: GameState): string {
  const lang = state.lang;
  return `
  <section class="style-block">
    <h2>${tt(lang, 'ui_style')}: ${esc(styleLabel(lang, state.coach.style))}</h2>
    ${styleSquare(lang, state.coach.style, false)}
  </section>`;
}

// ---------------------------------------------------------------------------
// Colonna laterale: classifica dell'ultima stagione e carriera
// ---------------------------------------------------------------------------

interface SideRow {
  id: string;
  name: string;
  points: number | null;
  diff: number | null;
}

/** Campionato da mostrare: quello del club allenato, altrimenti la massima serie. */
/** Paese di riferimento quando non si allena: ultimo club, altrimenti la nazionalità. */
function homeCountry(state: GameState): string {
  const clubId = state.job?.clubId ?? state.lastClubId;
  const fromClub = clubId ? state.world.clubs[clubId]?.country : undefined;
  if (fromClub) return fromClub;
  return state.world.countries[state.coach.nationality] ? state.coach.nationality : Object.keys(state.world.countries)[0] ?? 'ita';
}

function sideTable(state: GameState): { title: string; rows: SideRow[]; zones: (i: number, n: number) => string; mine: string | null } | null {
  const lang = state.lang;
  const world = state.world;
  const job = state.job;
  const last = state.lastReport;
  const lastSeason = seasonLabel(world.season - 1);

  // In Primavera la classifica viene dall'ultimo resoconto, se c'è.
  if (job?.role === 'youth' || (!job && last?.role === 'youth')) {
    if (last && last.role === 'youth') {
      return {
        title: t(lang, 'ui_side_table', { league: last.leagueName, season: seasonLabel(last.season) }),
        rows: last.table.map((r) => ({ id: r.clubId, name: r.name, points: r.points, diff: r.gf - r.ga })),
        zones: () => '',
        mine: last.clubId,
      };
    }
  }

  const clubId = job?.role === 'first' ? job.clubId : null;
  const leagueId = clubId ? world.clubs[clubId]?.leagueId : topLeagueId(world, homeCountry(state));
  const league = leagueId ? world.leagues[leagueId] : undefined;
  if (!league) return null;
  const cfg = league.config;
  const zones = (i: number, n: number) => {
    if (cfg.relegated > 0 && i >= n - cfg.relegated) return 'zone-down';
    if (cfg.championPlayoff && i < cfg.championPlayoff) return 'zone-playoff';
    if (cfg.promotedDirect > 0 && i < cfg.promotedDirect) return 'zone-up';
    if (cfg.playoff && i + 1 >= cfg.playoff.from && i + 1 <= cfg.playoff.to) return 'zone-playoff';
    return '';
  };

  if (league.standings.length > 0) {
    return {
      title: t(lang, 'ui_side_table', { league: cfg.name, season: lastSeason }),
      rows: league.standings.map((r) => ({ id: r.id, name: world.clubs[r.id]?.name ?? r.id, points: r.points, diff: r.gf - r.ga })),
      zones,
      mine: clubId,
    };
  }
  // Prima stagione: ancora nessuna classifica, si mostrano le squadre per forza.
  const byRating = [...league.clubIds].sort((a, b) => (world.clubs[b]?.rating ?? 0) - (world.clubs[a]?.rating ?? 0));
  return {
    title: t(lang, 'ui_side_forecast', { league: cfg.name }),
    rows: byRating.map((id) => ({ id, name: world.clubs[id]?.name ?? id, points: null, diff: null })),
    zones,
    mine: clubId,
  };
}

export function renderSidebar(state: GameState, theme: ThemeChoice): string {
  const lang = state.lang;
  const table = sideTable(state);
  let tableHtml = '';
  if (table) {
    const n = table.rows.length;
    const hasPoints = table.rows.some((r) => r.points !== null);
    tableHtml = `
    <section class="side-section">
      <h2>${esc(table.title)}</h2>
      <table class="standings">
        ${hasPoints ? `<thead><tr><th scope="col"><span class="sr-only">Posizione</span></th><th scope="col">${tt(lang, 'ui_side_club')}</th><th scope="col">${tt(lang, 'ui_side_diff')}</th><th scope="col">${tt(lang, 'ui_side_points')}</th></tr></thead>` : ''}
        <tbody>
          ${table.rows
            .map(
              (r, i) => `<tr class="${[table.zones(i, n), r.id === table.mine ? 'mine' : ''].join(' ').trim()}">
                <td>${i + 1}</td><td>${kit(state, r.id)}${esc(r.name)}</td>
                ${hasPoints ? `<td>${r.diff !== null && r.diff > 0 ? '+' : ''}${r.diff ?? ''}</td><td>${r.points ?? ''}</td>` : ''}
              </tr>`,
            )
            .join('')}
        </tbody>
      </table>
      ${legend(lang, [...new Set(table.rows.map((_, i) => table.zones(i, n)).filter((z) => z !== ''))])}
    </section>`;
  }
  return `<aside class="sidebar" aria-label="${tt(lang, 'ui_side_label')}">${tableHtml}${historyBlock(state)}${themeToggle(lang, theme)}</aside>`;
}

function legend(lang: Lang, zones: string[]): string {
  if (zones.length === 0) return '';
  const item = (zone: string, key: string, label: keyof Strings) =>
    zones.includes(zone) ? `<span class="key ${key}"></span>${tt(lang, label)} ` : '';
  return `<p class="legend">${item('zone-up', 'key-up', 'ui_side_up')}${item('zone-playoff', 'key-playoff', 'ui_side_playoff')}${item('zone-down', 'key-down', 'ui_side_down')}</p>`;
}

function historyBlock(state: GameState): string {
  if (state.history.length === 0) return '';
  const rows = [...state.history]
    .reverse()
    .map(
      (r) => `<li><span>${seasonLabel(r.season)}</span><span>${kit(state, r.clubId)}${esc(r.clubName)}${r.role === 'youth' ? ` (${tt(state.lang, 'ui_youth_short')})` : ''}</span><span>${r.firedAtMatchday !== null ? `<em>${tt(state.lang, 'ui_fired_short')}</em>` : `${r.position}°`}</span></li>`,
    )
    .join('');
  return `<section class="history"><h2>${tt(state.lang, 'ui_history')}</h2><ul>${rows}</ul></section>`;
}

function actionBar(inner: string, quitLabel?: string): string {
  return `<div class="action-bar">${inner}${quitLabel ? `<button class="btn-link" data-action="quit">${esc(quitLabel)}</button>` : ''}</div>`;
}

// ---------------------------------------------------------------------------
// Evento
// ---------------------------------------------------------------------------

export function renderEvent(state: GameState, ev: EventDef, pending: Extract<Pending, { kind: 'event' }>): string {
  const lang = state.lang;
  const clubId = state.job?.clubId;
  const clubName = clubId ? state.world.clubs[clubId]?.name ?? '' : '';
  const moment = t(lang, `ui_moment_${state.phase}` as keyof Strings);
  return `
  <main class="screen decision">
    <p class="decision-context">${clubId ? kit(state, clubId) : ''}${esc([clubName, moment].filter(Boolean).join(', '))}</p>
    <h1 class="decision-title">${esc(renderText(state, ev.title, pending.bindings))}</h1>
    <p class="decision-body">${esc(renderText(state, ev.body, pending.bindings))}</p>
    <div class="choices">
      ${ev.options
        .map((o, i) => `<button class="choice" data-action="choose" data-index="${i}">${esc(renderText(state, o.text, pending.bindings))}</button>`)
        .join('')}
    </div>
  </main>`;
}

// ---------------------------------------------------------------------------
// Resoconto: la prima pagina rosa
// ---------------------------------------------------------------------------

export function renderReport(state: GameState): string {
  const lang = state.lang;
  const r = state.lastReport;
  if (!r) {
    const top = state.world.leagues[topLeagueId(state.world, homeCountry(state))];
    const champ = top?.lastTable[0] ? state.world.clubs[top.lastTable[0]]?.name ?? '' : '';
    return `
    <main class="screen report">
      <div class="paper">
        <p class="masthead">${tt(lang, 'ui_season', { season: seasonLabel(state.world.season - 1) })}</p>
        <h1 class="front-headline">${tt(lang, 'ui_spectator_title')}</h1>
        <p class="front-sub">${tt(lang, 'ui_spectator_body', { club: champ, league: top?.config.name ?? '' })}</p>
      </div>
      ${actionBar(`<button class="btn btn-primary" data-action="next">${tt(lang, 'ui_next')}</button>`)}
    </main>`;
  }
  const [main, ...rest] = r.headlines;
  const headline = main ? headlineText(lang, main) : r.clubName;
  return `
  <main class="screen report">
    <article class="paper">
      <p class="masthead">${tt(lang, 'ui_season', { season: seasonLabel(r.season) })}. ${esc(r.leagueName)}</p>
      <h1 class="front-headline">${esc(headline)}</h1>
      ${rest.map((h) => `<p class="front-sub">${esc(headlineText(lang, h))}</p>`).join('')}
      <div class="front-result">
        <span class="front-pos">${tt(lang, 'ui_position', { pos: r.position })}</span>
        <span class="front-pos-note">${kit(state, r.clubId)}${esc(r.clubName)}<br>${tt(lang, 'ui_position_of', { teams: r.teams, expected: r.expectedPosition })}<br>${tt(lang, 'ui_points', { points: r.points })}</span>
      </div>
      ${r.cup ? `<p class="front-cup">${tt(lang, 'ui_cup', { cup: state.world.countries[state.world.clubs[r.clubId]?.country ?? '']?.cupName ?? '', stage: t(lang, `stage_${r.cup.reached}` as keyof Strings) })}</p>` : ''}
      ${r.continental
        .map((c) => `<p class="front-cup">${tt(lang, 'ui_cup', { cup: c.name, stage: t(lang, `stage_${c.reached}` as keyof Strings) })}</p>`)
        .join('')}
      ${miniTable(state, r)}
    </article>
    <section class="meters">
      ${state.job ? meter(lang, 'var_board', state.job.board, r.deltas.board) : ''}
      ${state.job ? meter(lang, 'var_dressing', state.job.dressing, r.deltas.dressing) : ''}
      ${state.job ? meter(lang, 'var_environment', state.job.environment, r.deltas.environment) : ''}
      ${meter(lang, 'var_reputation', state.coach.reputation, r.deltas.reputation)}
    </section>
    ${actionBar(`<button class="btn btn-primary" data-action="next">${tt(lang, 'ui_next')}</button>`)}
  </main>`;
}

function miniTable(state: GameState, r: SeasonReport): string {
  const lang = state.lang;
  const mine = r.table.findIndex((x) => x.clubId === r.clubId);
  const show = new Set<number>([0, 1, 2, 3, 4, mine - 1, mine, mine + 1, r.table.length - 1].filter((i) => i >= 0 && i < r.table.length));
  const idx = [...show].sort((a, b) => a - b);
  let prev = -1;
  const rows = idx
    .map((i) => {
      const row = r.table[i];
      if (!row) return '';
      const gap = i > prev + 1 ? '<tr class="gap"><td colspan="3"></td></tr>' : '';
      prev = i;
      return `${gap}<tr class="${i === mine ? 'mine' : ''}"><td>${i + 1}</td><td>${kit(state, row.clubId)}${esc(row.name)}</td><td>${row.points}</td></tr>`;
    })
    .join('');
  return `<table class="mini-table"><caption>${tt(lang, 'ui_table')}</caption><tbody>${rows}</tbody></table>`;
}

// ---------------------------------------------------------------------------
// Decisione di carriera
// ---------------------------------------------------------------------------

function optionHtml(state: GameState, o: CareerOption, i: number): string {
  const lang = state.lang;
  if (o.kind === 'accept') {
    const c = state.world.clubs[o.offer.clubId];
    if (!c) return '';
    const league = c.leagueId ? state.world.leagues[c.leagueId]?.config.name ?? '' : '';
    const cfg = c.leagueId ? state.world.leagues[c.leagueId]?.config : undefined;
    const div = cfg?.championPlayoff ? 'po' : divisionOf(state.world, c.id) === 1 ? 'd1' : 'd2';
    const tier = t(lang, `tier_${div}_${tierInLeague(state.world, c.id)}` as keyof Strings, { area: areaOf(state, c.id) });
    const meta =
      o.offer.role === 'youth'
        ? t(lang, 'ui_offer_youth_meta', { league, tier })
        : t(lang, o.offer.years === 1 ? 'ui_offer_meta_one' : 'ui_offer_meta', { league, tier, years: o.offer.years });
    return `
    <button class="offer" data-action="choose" data-index="${i}" style="--k1:${esc(clubColors(state, c.id)[0])}">
      ${o.offer.challenge ? `<span class="offer-flag">${tt(lang, 'ui_challenge')}</span>` : ''}
      <span class="offer-club">${esc(c.name)}</span>
      <span class="offer-meta">${esc(meta)}</span>
    </button>`;
  }
  const label =
    o.kind === 'renew'
      ? t(lang, 'option_renew', { years: o.years })
      : t(lang, `option_${o.kind}` as keyof Strings);
  return `<button class="choice" data-action="choose" data-index="${i}">${esc(label)}</button>`;
}

export function renderCareerDecision(state: GameState, pending: Extract<Pending, { kind: 'career' }>): string {
  const lang = state.lang;
  return `
  <main class="screen decision">
    <p class="decision-context">${tt(lang, 'ui_season', { season: seasonLabel(pending.context === 'first_job' ? state.world.season : state.world.season - 1) })}</p>
    <h1 class="decision-title">${tt(lang, `context_${pending.context}` as keyof Strings)}</h1>
    <div class="choices">${pending.options.map((o, i) => optionHtml(state, o, i)).join('')}</div>
  </main>`;
}

// ---------------------------------------------------------------------------
// Fine carriera
// ---------------------------------------------------------------------------

export function summaryText(state: GameState): string {
  const s = state.summary;
  if (!s) return '';
  const lang = state.lang;
  // Ogni trofeo con la squadra con cui è stato vinto.
  const trophies = state.history.flatMap((r) => r.trophies.map((k) => `${trophyText(state, k)} (${r.clubName})`));
  const lines = [
    `${state.coach.name}: ${t(lang, `title_${s.title}` as keyof Strings)}`,
    `${t(lang, 'ui_seasons')}: ${s.seasons}. ${t(lang, 'ui_firings')}: ${s.firings}.`,
    `${t(lang, 'ui_clubs')}: ${s.clubs.join(', ')}`,
    `${t(lang, 'ui_trophies')}: ${trophies.length ? trophies.join(', ') : '0'}`,
    'FM-Goal',
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Fine carriera: bacheca per club (consegna "trophy cabinet", mockup 3c / 4a)
// ---------------------------------------------------------------------------

/**
 * Nome della competizione da una chiave di trofeo: usa trophyText e toglie
 * l'eventuale stagione finale ("Campionato 2038/39" -> "Campionato"), così
 * i trofei uguali si raggruppano. Se trophyText include anche il club, toglierlo qui.
 */
function competitionName(state: GameState, key: string): string {
  return trophyText(state, key).replace(/[\s,·(-]*\d{4}(\/\d{2,4})?\)?\s*$/, '').trim();
}

interface Stint {
  club: string;
  youth: boolean;
  from: number;
  to: number;
  seasons: number;
  best: number | null;
  fired: boolean;
  trophies: { competition: string; seasons: number[] }[];
}

function careerStints(state: GameState): Stint[] {
  const out: Stint[] = [];
  for (const r of state.history) {
    const last = out[out.length - 1];
    const youth = r.role === 'youth';
    if (last && last.club === r.clubName && last.youth === youth && !last.fired) {
      last.to = r.season;
      last.seasons++;
    } else {
      out.push({ club: r.clubName, youth, from: r.season, to: r.season, seasons: 1, best: null, fired: false, trophies: [] });
    }
    const cur = out[out.length - 1]!;
    if (r.firedAtMatchday !== null) cur.fired = true;
    else cur.best = cur.best === null ? r.position : Math.min(cur.best, r.position);
    // Ogni resoconto sa già stagione e club dei trofei vinti in quell'anno.
    for (const key of r.trophies) {
      const name = competitionName(state, key);
      const g = cur.trophies.find((x) => x.competition === name);
      if (g) g.seasons.push(r.season);
      else cur.trophies.push({ competition: name, seasons: [r.season] });
    }
  }
  return out;
}

const STINT_COLORS = ['var(--rosa-rule)', 'var(--ink)', 'var(--red)', 'var(--green)'];

export function renderFinal(state: GameState, copied: boolean): string {
  const lang = state.lang;
  const s = state.summary;
  if (!s) return '';
  const stints = careerStints(state);
  const first = stints[0]?.from ?? state.world.season;
  // Anni dal primo all'ultimo incarico; gli anni senza panchina restano vuoti nella barra.
  const total = Math.max(1, (stints[stints.length - 1]?.to ?? first) - first + 1);
  const color = (i: number) => STINT_COLORS[i % STINT_COLORS.length];

  const diamonds = stints
    .flatMap((x) => x.trophies.flatMap((g) => g.seasons.map((y) => ({ y, name: g.competition, club: x.club }))))
    .map(
      ({ y, name, club }) =>
        `<span class="tl-trophy" tabindex="0" role="img" aria-label="${esc(`${name} ${seasonLabel(y)}, ${club}`)}" style="left:${(((y - first + 0.5) / total) * 100).toFixed(1)}%">
          <span class="tl-tip" aria-hidden="true"><strong>${esc(name)}</strong><span>${esc(seasonLabel(y))} · ${esc(club)}</span></span>
        </span>`,
    )
    .join('');

  const bar = stints
    .map((x, i) => {
      const gap = i > 0 ? x.from - (stints[i - 1]!.to + 1) : 0;
      const spacer = gap > 0 ? `<span class="tl-gap" style="flex:${gap}"></span>` : '';
      const ink = i % STINT_COLORS.length === 0 ? ';color:var(--ink)' : '';
      return `${spacer}<span class="tl-seg" style="flex:${x.to - x.from + 1};background:${color(i)}"><span style="${ink.slice(1)}">${x.to - x.from >= 2 ? esc(x.club) : ''}</span></span>`;
    })
    .join('');

  const rows = stints
    .map((x, i) => {
      const years = x.from === x.to ? `${x.from}` : `${x.from}–${String(x.to + 1).slice(2)}`;
      const meta = [years, x.youth ? t(lang, 'ui_youth_short') : '', t(lang, x.seasons === 1 ? 'ui_n_seasons_one' : 'ui_n_seasons', { n: x.seasons }), x.fired ? t(lang, 'ui_fired_short') : '']
        .filter(Boolean)
        .join(' · ');
      const trophies = x.trophies.length
        ? `<ul class="cab-trophies">${x.trophies
            .map(
              (g) => `<li><strong>${esc(g.competition)}${g.seasons.length > 1 ? ` ×${g.seasons.length}` : ''}</strong>
                <span>${g.seasons.sort((a, b) => a - b).map((y) => esc(seasonLabel(y))).join(' · ')}</span></li>`,
            )
            .join('')}</ul>`
        : `<p class="cab-none">${tt(lang, 'ui_no_trophies')}</p>`;
      return `
      <li class="cab-row" style="--stint:${color(i)}">
        <div class="cab-club"><span class="cab-name">${esc(x.club)}</span><span class="cab-meta">${esc(meta)}</span></div>
        ${trophies}
        <span class="cab-best" aria-label="${tt(lang, 'ui_best')}">${x.best === null ? '—' : `${x.best}°`}</span>
      </li>`;
    })
    .join('');

  return `
  <main class="screen final">
    <article class="paper">
      <p class="masthead"><span>${tt(lang, 'ui_career_over')}</span><span>${tt(lang, `end_${s.reason}` as keyof Strings)}</span></p>
      <header class="final-head">
        <div>
          <h1 class="front-headline">${esc(state.coach.name)}</h1>
          <p class="final-title">${tt(lang, `title_${s.title}` as keyof Strings)}</p>
        </div>
        <dl class="final-stats">
          <div><dt>${tt(lang, 'ui_seasons')}</dt><dd>${s.seasons}</dd></div>
          <div><dt>${tt(lang, 'ui_clubs')}</dt><dd>${stints.length}</dd></div>
          <div><dt>${tt(lang, 'ui_firings')}</dt><dd>${s.firings}</dd></div>
          <div><dt>${tt(lang, 'ui_trophies')}</dt><dd>${s.trophies.length}</dd></div>
        </dl>
      </header>
      <section class="timeline">
        <h2>${tt(lang, 'ui_career')}</h2>
        <div class="tl-marks">${diamonds}</div>
        <div class="tl-bar" aria-hidden="true">${bar}</div>
      </section>
      <ol class="cabinet">${rows}</ol>
    </article>
    ${actionBar(
      `<button class="btn btn-secondary" data-action="copy">${copied ? tt(lang, 'ui_copied') : tt(lang, 'ui_copy_summary')}</button>
       <button class="btn btn-primary" data-action="restart">${tt(lang, 'ui_new_career')}</button>`,
    )}
  </main>`;
}
