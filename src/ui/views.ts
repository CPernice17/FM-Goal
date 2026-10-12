import { preseason } from '../engine/career';
import type { EventDef } from '../engine/events/schema';
import { renderText } from '../engine/events/runtime';
import type { CareerOption, Difficulty, GameState, KeyPlayer, Lang, Pending, SeasonReport, Style } from '../engine/types';
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

function seasonLabel(year: number): string {
  return `${year}/${String(year + 1).slice(2)}`;
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

export function renderHome(lang: Lang, hasSave: boolean, draft: Draft, countries: { id: string; name: string }[]): string {
  return `
  <main class="screen home">
    <header class="home-head">
      <h1 class="brand">${tt(lang, 'ui_title')}</h1>
      <p class="lede">${tt(lang, 'ui_tagline')}</p>
    </header>
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
    <h1 class="club">${esc(pre?.clubName ?? '')}</h1>
    <p class="league">${esc(pre?.leagueName ?? '')}</p>
    <section class="objective">
      <span class="objective-label">${tt(lang, 'ui_objective')}</span>
      <strong>${tt(lang, `objective_${pre?.objective ?? 'mid_table'}` as keyof Strings)}</strong>
      <span class="objective-note">${tt(lang, 'ui_expected', { pos: pre?.expectedPosition ?? '-', teams: pre?.teams ?? '-' })}</span>
    </section>
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
              <span class="p-meta">${tt(lang, `pos_${p.position}` as keyof Strings)}, ${tt(lang, 'ui_years', { n: p.age })}, ${tt(lang, `trait_${p.trait}` as keyof Strings)}. <em>${esc(mood(lang, p))}</em></span></li>`,
          )
          .join('')}
      </ul>
    </section>
    ${styleBlock(state)}
    ${actionBar(`<button class="btn btn-primary" data-action="play">${tt(lang, 'ui_play_season')}</button>`, t(lang, 'ui_quit_short'))}
  </main>`;
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

export function renderSidebar(state: GameState): string {
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
                <td>${i + 1}</td><td>${esc(r.name)}</td>
                ${hasPoints ? `<td>${r.diff !== null && r.diff > 0 ? '+' : ''}${r.diff ?? ''}</td><td>${r.points ?? ''}</td>` : ''}
              </tr>`,
            )
            .join('')}
        </tbody>
      </table>
      ${legend(lang, [...new Set(table.rows.map((_, i) => table.zones(i, n)).filter((z) => z !== ''))])}
    </section>`;
  }
  return `<aside class="sidebar" aria-label="${tt(lang, 'ui_side_label')}">${tableHtml}${historyBlock(state)}</aside>`;
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
      (r) => `<li><span>${seasonLabel(r.season)}</span><span>${esc(r.clubName)}${r.role === 'youth' ? ` (${tt(state.lang, 'ui_youth_short')})` : ''}</span><span>${r.firedAtMatchday !== null ? `<em>${tt(state.lang, 'ui_fired_short')}</em>` : `${r.position}°`}</span></li>`,
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
  const clubName = state.job ? state.world.clubs[state.job.clubId]?.name ?? '' : '';
  return `
  <main class="screen decision">
    <p class="decision-context">${esc(clubName)}</p>
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
        <span class="front-pos-note">${esc(r.clubName)}<br>${tt(lang, 'ui_position_of', { teams: r.teams, expected: r.expectedPosition })}<br>${tt(lang, 'ui_points', { points: r.points })}</span>
      </div>
      ${r.cup ? `<p class="front-cup">${tt(lang, 'ui_cup', { cup: state.world.countries[state.world.clubs[r.clubId]?.country ?? '']?.cupName ?? '', stage: t(lang, `stage_${r.cup.reached}` as keyof Strings) })}</p>` : ''}
      ${miniTable(lang, r)}
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

function miniTable(lang: Lang, r: SeasonReport): string {
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
      return `${gap}<tr class="${i === mine ? 'mine' : ''}"><td>${i + 1}</td><td>${esc(row.name)}</td><td>${row.points}</td></tr>`;
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
    const tier = t(lang, `tier_${div}_${tierInLeague(state.world, c.id)}` as keyof Strings);
    const meta =
      o.offer.role === 'youth'
        ? t(lang, 'ui_offer_youth_meta', { league, tier })
        : t(lang, o.offer.years === 1 ? 'ui_offer_meta_one' : 'ui_offer_meta', { league, tier, years: o.offer.years });
    return `
    <button class="offer" data-action="choose" data-index="${i}">
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
  const lines = [
    `${state.coach.name}: ${t(lang, `title_${s.title}` as keyof Strings)}`,
    `${t(lang, 'ui_seasons')}: ${s.seasons}. ${t(lang, 'ui_firings')}: ${s.firings}.`,
    `${t(lang, 'ui_clubs')}: ${s.clubs.join(', ')}`,
    `${t(lang, 'ui_trophies')}: ${s.trophies.length ? s.trophies.map((k) => trophyText(state, k)).join(', ') : '0'}`,
    'FM-Goal',
  ];
  return lines.join('\n');
}

export function renderFinal(state: GameState, copied: boolean): string {
  const lang = state.lang;
  const s = state.summary;
  if (!s) return '';
  return `
  <main class="screen final">
    <article class="paper">
      <p class="masthead">${tt(lang, 'ui_career_over')}. ${tt(lang, `end_${s.reason}` as keyof Strings)}</p>
      <h1 class="front-headline">${esc(state.coach.name)}</h1>
      <p class="front-sub final-title">${tt(lang, `title_${s.title}` as keyof Strings)}</p>
      <dl class="final-stats">
        <div><dt>${tt(lang, 'ui_seasons')}</dt><dd>${s.seasons}</dd></div>
        <div><dt>${tt(lang, 'ui_firings')}</dt><dd>${s.firings}</dd></div>
        <div><dt>${tt(lang, 'ui_peak_rep')}</dt><dd>${s.peakReputation}</dd></div>
        <div><dt>${tt(lang, 'ui_final_style')}</dt><dd>${esc(styleLabel(lang, s.finalStyle))}</dd></div>
      </dl>
      <h2>${tt(lang, 'ui_trophies')}</h2>
      ${s.trophies.length ? `<ul class="trophies">${s.trophies.map((k) => `<li>${esc(trophyText(state, k))}</li>`).join('')}</ul>` : `<p class="body">${tt(lang, 'ui_no_trophies')}</p>`}
      <h2>${tt(lang, 'ui_clubs')}</h2>
      <p class="body">${esc(s.clubs.join(', '))}</p>
    </article>
    ${actionBar(
      `<button class="btn btn-secondary" data-action="copy">${copied ? tt(lang, 'ui_copied') : tt(lang, 'ui_copy_summary')}</button>
       <button class="btn btn-primary" data-action="restart">${tt(lang, 'ui_new_career')}</button>`,
    )}
  </main>`;
}
