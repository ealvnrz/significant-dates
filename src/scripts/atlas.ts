import type { MapPoint, createMap } from './map';
import { createTimeline } from './timeline';
import { $, $$, copyText, flashLabel } from './dom';
import {
  calendarDay, daysBetween, isUpcoming, openDeadlines, deadlineSummary, deadlineCountdown,
  deadlineState, matchingMonths, matchesMonths, monthsBetween, reviewDue, DEADLINE_TYPES,
  type Deadline, type DeadlineStatus, type DeadlineType, type MonthRange, type MonthMode,
} from '../lib/calendar';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const dateFormat = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const monthFormat = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const upcomingList = $('#upcoming-list')!;
const pastList = $('#past-list')!;
const rows = $$('.row').sort((a, b) => a.dataset.start!.localeCompare(b.dataset.start!));
const rowId = (row: HTMLElement) => row.dataset.id!;
const deadlines = new Map(rows.map(row => [rowId(row), JSON.parse(row.dataset.deadlines!) as Deadline[]]));
const searchText = new Map(rows.map(row => [rowId(row), fold(row.dataset.search!)]));
const areas = new Map(rows.map(row => [rowId(row), row.dataset.areas!.split(' ')]));
let today = '';
let byDate: HTMLElement[] = [];
let visible = new Set<string>();
let timeline: ReturnType<typeof createTimeline> | undefined;

const state = {
  area: '', q: '', region: '', format: '', open: false, type: '' as DeadlineType | '',
  months: null as MonthRange, monthMode: 'conference' as MonthMode, sort: 'date',
};
const search = $<HTMLInputElement>('#f-search')!;
const region = $<HTMLSelectElement>('#f-region')!;
const format = $<HTMLSelectElement>('#f-format')!;
const openOnly = $<HTMLInputElement>('#f-open')!;
const deadlineType = $<HTMLSelectElement>('#f-deadline-type')!;
const monthMode = $<HTMLSelectElement>('#f-month-mode')!;
const tabs = $$<HTMLButtonElement>('.area-tab');
const sortBtns = $$<HTMLButtonElement>('[data-sort]');

function openFor(row: HTMLElement, withinRange = false) {
  const ds = openDeadlines(deadlines.get(rowId(row))!, today, state.type);
  return withinRange && state.monthMode === 'deadline' && state.months
    ? ds.filter(d => matchesMonths([d.date.slice(0, 7)], state.months)) : ds;
}
const monthsOf = (row: HTMLElement) => matchingMonths(row.dataset.start!, row.dataset.end!, deadlines.get(rowId(row))!, today, state.monthMode, state.type);
const isFiltered = () => !!(state.area || state.q.trim() || state.region || state.format || state.type || state.open || state.months);

function matches(row: HTMLElement, skip?: 'area' | 'months') {
  const id = rowId(row);
  return (skip === 'area' || !state.area || areas.get(id)!.includes(state.area))
    && (!state.q.trim() || searchText.get(id)!.includes(fold(state.q.trim())))
    && (!state.region || row.dataset.region === state.region)
    && (!state.format || row.dataset.format === state.format)
    && (!state.type || deadlines.get(id)!.some(d => d.types.includes(state.type as DeadlineType)))
    && (!state.open || openFor(row).length > 0)
    && (skip === 'months' || matchesMonths(monthsOf(row), state.months));
}

function renderDeadline(row: HTMLElement) {
  const cell = $('[data-next-deadline]', row)!;
  const next = openFor(row, true)[0];
  const label = document.createElement('span');
  cell.replaceChildren(label);
  if (!next) {
    label.className = 'r-sub';
    label.textContent = deadlineSummary(deadlines.get(rowId(row))!, row.dataset.deadlineStatus as DeadlineStatus, today, state.type);
    return;
  }
  label.className = 'nd-label';
  label.textContent = next.label;
  const meta = document.createElement('span');
  meta.className = 'nd-meta';
  meta.dataset.state = deadlineState(next.date, today);
  meta.textContent = `${dateFormat.format(new Date(next.date))} · ${deadlineCountdown(next.date, today)}${next.tentative ? ' · TBC' : ''}`;
  cell.append(meta);
}

// The map is optional. Its code, styles and tiles load only when requested.
const mapCard = $('#map-card')!;
const mapToggle = $<HTMLButtonElement>('[data-map-toggle]')!;
const mapStatus = $('[data-map-status]')!;
const mapRetry = $<HTMLButtonElement>('[data-map-retry]')!;
const points: MapPoint[] = JSON.parse($('#map-data')!.textContent || '[]');
let map: ReturnType<typeof createMap> | undefined;
let loading: Promise<void> | undefined;
async function ensureMap() {
  if (map) return map;
  if (!loading) {
    mapStatus.textContent = 'Loading map…';
    mapRetry.hidden = true;
    loading = import('./map').then(module => {
      map = module.createMap($('#map')!, points, focusRow, () => {
        mapStatus.textContent = 'Map tiles are unavailable. Conference pins and the list are still usable.';
      });
      map.setVisible(visible);
      mapStatus.textContent = '';
      if (!mapCard.hidden) map.fit();
    }).catch(() => {
      mapStatus.textContent = 'The map could not load. The conference list and filters are still available.';
      mapRetry.hidden = false;
    }).finally(() => { loading = undefined; });
  }
  await loading;
  return map;
}
function setMapShown(shown: boolean) {
  mapCard.hidden = !shown;
  mapToggle.setAttribute('aria-expanded', String(shown));
  $('span', mapToggle)!.textContent = shown ? 'Hide map' : 'Show map';
  try { localStorage.setItem('map', shown ? 'shown' : 'hidden'); } catch {}
  if (shown) void ensureMap().then(m => { if (!mapCard.hidden) m?.fit(); });
}
mapToggle.addEventListener('click', () => setMapShown(!!mapCard.hidden));
mapRetry.addEventListener('click', () => location.reload());
let fitTimer = 0;

function apply() {
  visible = new Set();
  for (const row of byDate) {
    row.hidden = !matches(row);
    if (!row.hidden) visible.add(rowId(row));
    renderDeadline(row);
  }
  $$('.month', upcomingList).forEach(el => el.remove());
  const nextDate = (row: HTMLElement) => openFor(row, true)[0]?.date ?? '9999';
  const ordered = state.sort === 'deadline' ? [...byDate].sort((a, b) => nextDate(a).localeCompare(nextDate(b)) || a.dataset.start!.localeCompare(b.dataset.start!)) : byDate;
  upcomingList.append(...ordered);
  let previous = '';
  for (const row of ordered) {
    if (row.hidden) continue;
    const month = (state.sort === 'deadline' ? openFor(row, true)[0]?.date : row.dataset.start)?.slice(0, 7);
    const title = month ? `${state.sort === 'deadline' ? 'Deadlines in ' : ''}${monthFormat.format(new Date(`${month}-01`))}` : 'No recorded open deadlines';
    if (title === previous) continue;
    previous = title;
    const li = document.createElement('li');
    li.className = 'month';
    li.textContent = title;
    row.before(li);
  }
  for (const tab of tabs) {
    const area = tab.dataset.area!;
    tab.hidden = !!area && !byDate.some(row => areas.get(rowId(row))!.includes(area));
    $('.count', tab)!.textContent = String(byDate.filter(row => matches(row, 'area') && (!area || areas.get(rowId(row))!.includes(area))).length);
  }
  const counts = new Map<string, number>();
  const totals = new Map<string, number>();
  for (const row of byDate) for (const month of monthsOf(row)) {
    totals.set(month, (totals.get(month) ?? 0) + 1);
    if (matches(row, 'months')) counts.set(month, (counts.get(month) ?? 0) + 1);
  }
  timeline?.update(counts, totals);
  $('[data-result-count]')!.textContent = isFiltered() ? `Showing ${visible.size} of ${byDate.length} upcoming conferences` : plural(byDate.length, 'upcoming conference');
  $('[data-reset]')!.hidden = !isFiltered();
  $('[data-empty]')!.hidden = visible.size > 0;
  $('[data-map-count]')!.textContent = `${plural(points.filter(p => visible.has(p.id)).length, 'conference')} on the map`;
  map?.setVisible(visible);
  clearTimeout(fitTimer);
  fitTimer = window.setTimeout(() => { if (!mapCard.hidden) map?.fit(); }, 120);
  renderControls();
  writeUrl();
}

function renderControls() {
  search.value = state.q;
  region.value = state.region;
  format.value = state.format;
  openOnly.checked = state.open;
  deadlineType.value = state.type;
  monthMode.value = state.monthMode;
  for (const tab of tabs) {
    const selected = tab.dataset.area === state.area;
    tab.setAttribute('aria-checked', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  for (const button of sortBtns) {
    const selected = button.dataset.sort === state.sort;
    button.setAttribute('aria-checked', String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
  for (const button of $$('[data-opportunity]')) button.setAttribute('aria-pressed', String(state.open && state.type === button.dataset.opportunity));
  $('[data-month-help]')!.textContent = state.monthMode === 'conference'
    ? 'Includes every month the conference takes place in. A conference may count in more than one month.'
    : 'Counts conferences with open deadlines of the selected type in each month. Sorting remains a separate choice.';
  timeline?.set(state.months);
}

// Re-evaluate every row in both directions, at startup and after a UTC day changes.
function refreshDate(force = false) {
  const nextToday = calendarDay();
  if (!force && nextToday === today) return;
  today = nextToday;
  byDate = rows.filter(row => isUpcoming(row.dataset.end!, today));
  const past = rows.filter(row => !isUpcoming(row.dataset.end!, today)).reverse();
  for (const row of rows) {
    row.hidden = false;
    const start = daysBetween(today, row.dataset.start!);
    const end = daysBetween(today, row.dataset.end!);
    const label = $('[data-when]', row)!;
    label.textContent = end < 0 ? `${plural(-end, 'day')} ago` : start <= 0 ? 'Happening now' : start === 1 ? 'Tomorrow' : `In ${plural(start, 'day')}`;
    label.dataset.state = end >= 0 && start <= 0 ? 'now' : start > 0 && start <= 21 ? 'soon' : '';
    for (const li of $$('.r-deadlines li', row)) {
      li.dataset.state = deadlineState(li.dataset.date!, today);
      $('[data-status]', li)!.textContent = deadlineCountdown(li.dataset.date!, today);
    }
    const checked = $<HTMLTimeElement>('time[data-checked]', row);
    if (checked) {
      const due = reviewDue(checked.dateTime, deadlines.get(rowId(row))!, today);
      checked.classList.toggle('is-stale', due);
      checked.title = due ? 'Review due: the recorded dates may have changed' : 'Last editorial check of the official source';
      $('[data-review-note]', row)!.hidden = !due;
    }
  }
  upcomingList.append(...byDate);
  pastList.append(...past);
  $('[data-past-section]')!.hidden = !past.length;
  $('[data-past-count]')!.textContent = String(past.length);
  if (state.area && !byDate.some(row => areas.get(rowId(row))!.includes(state.area))) state.area = '';
  $('[data-stat="upcoming"]')!.textContent = String(byDate.length);
  $('[data-stat="countries"]')!.textContent = String(new Set(byDate.map(row => row.dataset.country).filter(Boolean)).size);
  $('[data-stat="open-deadlines"]')!.textContent = String(byDate.reduce((n, row) => n + openDeadlines(deadlines.get(rowId(row))!, today).length, 0));
  const stamp = $<HTMLTimeElement>('[data-status-day]')!;
  stamp.dateTime = today;
  stamp.textContent = today;
  const thisMonth = today.slice(0, 7);
  const [year, month] = thisMonth.split('-').map(Number);
  const yearAhead = month === 1 ? `${year}-12` : `${year + 1}-${String(month - 1).padStart(2, '0')}`;
  const lastMonth = byDate.map(row => row.dataset.end!.slice(0, 7)).sort().at(-1) ?? thisMonth;
  timeline?.destroy();
  timeline = createTimeline($('#timeline')!, monthsBetween(thisMonth, lastMonth > yearAhead ? lastMonth : yearAhead), range => { state.months = range; apply(); });
  apply();
}

function readUrl() {
  const p = new URLSearchParams(location.search);
  const pick = (value: string | null, allowed: readonly string[]) => value && allowed.includes(value) ? value : '';
  state.area = pick(p.get('area'), tabs.map(t => t.dataset.area!));
  state.q = p.get('q') ?? '';
  state.region = pick(p.get('region'), [...region.options].map(o => o.value));
  state.format = pick(p.get('format'), [...format.options].map(o => o.value));
  state.type = pick(p.get('deadline'), DEADLINE_TYPES) as DeadlineType | '';
  state.open = p.get('open') === '1';
  state.monthMode = p.get('month') === 'deadline' ? 'deadline' : 'conference';
  const from = p.get('from');
  const to = p.get('to') ?? from;
  const valid = (s: string | null): s is string => !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s) && s.slice(0, 4) >= '1000';
  state.months = valid(from) && valid(to) ? from <= to ? { from, to } : { from: to, to: from } : null;
  state.sort = p.get('sort') === 'deadline' ? 'deadline' : 'date';
}
function writeUrl() {
  const p = new URLSearchParams();
  for (const key of ['area', 'q', 'region', 'format'] as const) if (state[key].trim()) p.set(key, state[key].trim());
  if (state.type) p.set('deadline', state.type);
  if (state.open) p.set('open', '1');
  if (state.monthMode === 'deadline') p.set('month', 'deadline');
  if (state.months) {
    p.set('from', state.months.from);
    if (state.months.to !== state.months.from) p.set('to', state.months.to);
  }
  if (state.sort !== 'date') p.set('sort', state.sort);
  const query = p.toString();
  const url = `${location.pathname}${query ? `?${query}` : ''}${location.hash}`;
  if (url !== `${location.pathname}${location.search}${location.hash}`) history.replaceState(history.state, '', url);
}
function resetFilters() {
  Object.assign(state, { area: '', q: '', region: '', format: '', type: '', open: false, months: null, monthMode: 'conference' });
  apply();
}

search.addEventListener('input', () => { state.q = search.value; apply(); });
region.addEventListener('change', () => { state.region = region.value; apply(); });
format.addEventListener('change', () => { state.format = format.value; apply(); });
openOnly.addEventListener('change', () => { state.open = openOnly.checked; apply(); });
deadlineType.addEventListener('change', () => { state.type = deadlineType.value as DeadlineType | ''; apply(); });
monthMode.addEventListener('change', () => { state.monthMode = monthMode.value as MonthMode; apply(); });
$$('[data-opportunity]').forEach(button => button.addEventListener('click', () => {
  state.type = button.dataset.opportunity as DeadlineType;
  state.open = true;
  apply();
}));
tabs.forEach(tab => tab.addEventListener('click', () => { state.area = tab.dataset.area!; apply(); }));
sortBtns.forEach(button => button.addEventListener('click', () => { state.sort = button.dataset.sort!; apply(); }));
for (const group of $$<HTMLElement>('[role="radiogroup"]')) group.addEventListener('keydown', e => {
  if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
  const buttons = $$<HTMLButtonElement>('[role="radio"]', group).filter(b => !b.hidden);
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (index < 0) return;
  e.preventDefault();
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
  buttons[next].focus();
  buttons[next].click();
});
$('[data-reset]')!.addEventListener('click', resetFilters);
$('[data-reset-inline]')!.addEventListener('click', resetFilters);
document.addEventListener('keydown', e => {
  if (e.key === '/' && !(e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]') && !e.metaKey && !e.ctrlKey) {
    e.preventDefault(); search.focus(); search.select();
  }
});
search.addEventListener('keydown', e => { if (e.key === 'Escape') { state.q = ''; apply(); } });

const scrollTo = (el: HTMLElement) => el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' });
function focusRow(id: string) {
  const row = document.getElementById(`conf-${id}`);
  if (!row) return;
  if (row.hidden) resetFilters();
  const parent = row.closest('details');
  if (parent) parent.open = true;
  $<HTMLDetailsElement>('.r-details', row)!.open = true;
  scrollTo(row);
}
for (const row of rows) {
  const details = $<HTMLDetailsElement>('.r-details', row)!;
  details.addEventListener('toggle', () => row.classList.toggle('is-open', details.open));
  row.addEventListener('mouseenter', () => map?.highlight(rowId(row), true));
  row.addEventListener('mouseleave', () => map?.highlight(rowId(row), false));
}
document.addEventListener('click', e => {
  const target = e.target as HTMLElement;
  const row = target.closest<HTMLElement>('.row');
  if (!row) return;
  if (target.closest('[data-locate]')) {
    setMapShown(true);
    void ensureMap().then(m => { if (!mapCard.hidden) { m?.locate(rowId(row)); scrollTo(mapCard); } });
    return;
  }
  const copy = target.closest<HTMLButtonElement>('[data-copy-link]');
  if (copy) {
    const url = new URL(`${location.pathname}#conf-${rowId(row)}`, location.href).href;
    void copyText(url).then(ok => flashLabel($('span', copy)!, ok ? 'Link copied' : 'Copy failed'));
    return;
  }
  if (!target.closest('a, button, details') && !getSelection()?.toString()) {
    const details = $<HTMLDetailsElement>('.r-details', row)!;
    details.open = !details.open;
  }
});
const openFromHash = () => {
  if (!location.hash.startsWith('#conf-')) return;
  try { focusRow(decodeURIComponent(location.hash.slice(6))); } catch { /* Ignore malformed links. */ }
};
readUrl();
refreshDate(true);
$$('[data-enhanced]').forEach(el => { el.hidden = false; });
// Re-apply tab availability after exposing the enhanced controls.
apply();
try { if (localStorage.getItem('map') === 'shown') setMapShown(true); } catch {}
window.addEventListener('hashchange', openFromHash);
window.addEventListener('popstate', () => { readUrl(); apply(); openFromHash(); });
window.addEventListener('focus', () => refreshDate());
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshDate(); });
window.setInterval(() => refreshDate(), 30_000);
requestAnimationFrame(openFromHash);
