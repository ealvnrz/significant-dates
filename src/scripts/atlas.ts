import { createMap, type MapPoint } from './map';
import { createTimeline, monthsBetween, type MonthRange } from './timeline';
import { $, $$, copyText, flashLabel } from './dom';
import { SITE } from '../site.config';

// ---------------------------------------------------------------------------
// Dates: everything is compared as whole days in the visitor's local calendar.
// ---------------------------------------------------------------------------
const DAY = 86_400_000;
const now = new Date();
const TODAY = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
const TODAY_ISO = new Date(TODAY).toISOString().slice(0, 10);
const THIS_MONTH = TODAY_ISO.slice(0, 7);
const parse = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const daysUntil = (s: string) => Math.round((parse(s) - TODAY) / DAY);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const shortDate = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const monthYear = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

function ago(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 60) return `${days} days ago`;
  return `${plural(Math.round(days / 30.44), 'month')} ago`;
}

const upcomingList = $('#upcoming-list')!;
const pastList = $('#past-list')!;

// ---------------------------------------------------------------------------
// 1. Move conferences that ended since the last build into "Past".
// ---------------------------------------------------------------------------
for (const row of $$('.row', upcomingList)) {
  if (row.dataset.end! < TODAY_ISO) pastList.prepend(row);
}
{
  const n = $$('.row', pastList).length;
  $('[data-past-section]')!.hidden = n === 0;
  $('[data-past-count]')!.textContent = String(n);
}
/** Upcoming rows in date order (the build order). Sorting re-appends them; this stays fixed. */
const byDate = $$('.row', upcomingList);
const rowId = (row: HTMLElement) => row.dataset.id!;

// ---------------------------------------------------------------------------
// 2. Relative labels, deadline status, "checked" age.
// ---------------------------------------------------------------------------
function whenLabel(start: string, end: string): [string, string] {
  const s = daysUntil(start);
  const e = daysUntil(end);
  if (s <= 0 && e >= 0) return ['Happening now', 'now'];
  if (e < 0) return [-e < 60 ? `${plural(-e, 'day')} ago` : `${plural(Math.round(-e / 30.44), 'month')} ago`, ''];
  if (s === 1) return ['Tomorrow', 'soon'];
  if (s < 60) return [`In ${s} days`, s <= 21 ? 'soon' : ''];
  return [`In ${plural(Math.round(s / 30.44), 'month')}`, ''];
}

const statusText = (d: number) => (d < 0 ? 'Closed' : d === 0 ? 'Today' : `${plural(d, 'day')} left`);
const deadlineState = (d: number) => (d < 0 ? 'closed' : d <= 14 ? 'soon' : 'open');

for (const row of $$('.row')) {
  const el = $('[data-when]', row)!;
  const [text, state] = whenLabel(row.dataset.start!, row.dataset.end!);
  el.textContent = text;
  if (state) el.dataset.state = state;

  for (const li of $$('.r-deadlines li', row)) {
    const d = daysUntil(li.dataset.date!);
    li.dataset.state = deadlineState(d);
    $('[data-status]', li)!.textContent = statusText(d);
  }
}

for (const el of $$<HTMLTimeElement>('time[data-checked]')) {
  const age = -daysUntil(el.dateTime);
  el.textContent = `${el.textContent} (${ago(age)})`;
  if (age > SITE.staleAfterDays) {
    el.classList.add('is-stale');
    el.title = 'Checked a while ago: dates may have changed';
  }
}

const openDeadlines = new Map<string, string[]>(
  byDate.map((row) => [
    rowId(row),
    (row.dataset.deadlines || '')
      .split(',')
      .filter((d) => d && d >= TODAY_ISO)
      .sort(),
  ]),
);
const nextOpen = (row: HTMLElement) => openDeadlines.get(rowId(row))![0] ?? null;

// "Next deadline" column: the earliest deadline that is still open.
for (const row of byDate) {
  const next = $$('.r-deadlines li', row).find((li) => li.dataset.date! >= TODAY_ISO);
  if (!next) continue;
  const d = daysUntil(next.dataset.date!);
  const cell = $('[data-next-deadline]', row)!;
  cell.replaceChildren();
  const label = document.createElement('span');
  label.className = 'nd-label';
  label.textContent = $('.dl-label', next)!.firstChild!.textContent!.trim();
  const meta = document.createElement('span');
  meta.className = 'nd-meta';
  meta.dataset.state = deadlineState(d);
  meta.textContent = `${shortDate.format(parse(next.dataset.date!))} · ${statusText(d)}${next.hasAttribute('data-tentative') ? ' · TBC' : ''}`;
  cell.append(label, meta);
}

// ---------------------------------------------------------------------------
// 3. Hero stats.
// ---------------------------------------------------------------------------
{
  const countries = new Set(byDate.map((r) => r.dataset.country).filter(Boolean));
  const open = [...openDeadlines.values()].reduce((n, list) => n + list.length, 0);
  $('[data-stat="upcoming"]')!.textContent = String(byDate.length);
  $('[data-stat="countries"]')!.textContent = String(countries.size);
  $('[data-stat="open-deadlines"]')!.textContent = String(open);
}

// ---------------------------------------------------------------------------
// 4. Map: a full-width strip above the list, synced with the filters. Can be hidden.
// ---------------------------------------------------------------------------
const mapCard = $('#map-card')!;
const mapToggle = $<HTMLButtonElement>('[data-map-toggle]')!;
const points: MapPoint[] = JSON.parse($('#map-data')!.textContent || '[]');
const map = createMap($('#map')!, points, (id) => focusRow(id));
let visible = new Set<string>();

function setMapShown(shown: boolean) {
  mapCard.hidden = !shown;
  mapToggle.setAttribute('aria-expanded', String(shown));
  $('span', mapToggle)!.textContent = shown ? 'Hide map' : 'Show map';
  try {
    localStorage.setItem('map', shown ? 'shown' : 'hidden');
  } catch {}
  if (shown) map.fit();
}
mapToggle.addEventListener('click', () => setMapShown(mapCard.hidden));

let fitTimer = 0;
const fitSoon = () => {
  clearTimeout(fitTimer);
  fitTimer = window.setTimeout(() => !mapCard.hidden && map.fit(), 120);
};

// ---------------------------------------------------------------------------
// 5. Filters. State lives in one object and is mirrored in the URL, so any filtered view can
//    be bookmarked or shared (e.g. ?area=bayesian&region=Europe&from=2027-05&to=2027-07).
// ---------------------------------------------------------------------------
type Sort = 'date' | 'deadline';
const state = {
  area: '',
  q: '',
  region: '',
  format: '',
  open: false,
  months: null as MonthRange,
  sort: 'date' as Sort,
};

const search = $<HTMLInputElement>('#f-search')!;
const region = $<HTMLSelectElement>('#f-region')!;
const format = $<HTMLSelectElement>('#f-format')!;
const openOnly = $<HTMLInputElement>('#f-open')!;
const tabs = $$<HTMLButtonElement>('.area-tab');
const sortBtns = $$<HTMLButtonElement>('[data-sort]');
const resetBtn = $<HTMLButtonElement>('[data-reset]')!;

const searchText = new Map(byDate.map((r) => [rowId(r), fold(r.dataset.search!)]));
const areasOfRow = new Map(byDate.map((r) => [rowId(r), r.dataset.areas!.split(' ')]));
/** Month a conference is counted in: its start month, or this month if it's already under way. */
const bucket = (row: HTMLElement) => (row.dataset.start!.slice(0, 7) < THIS_MONTH ? THIS_MONTH : row.dataset.start!.slice(0, 7));

// Tabs with no upcoming conferences at all (some may have ended since the build) are hidden.
for (const tab of tabs) {
  const a = tab.dataset.area!;
  tab.hidden = !!a && !byDate.some((r) => areasOfRow.get(rowId(r))!.includes(a));
}

function matches(row: HTMLElement, skip?: 'area' | 'months') {
  const id = rowId(row);
  const d = row.dataset;
  const q = fold(state.q.trim());
  return (
    (skip === 'area' || !state.area || areasOfRow.get(id)!.includes(state.area)) &&
    (!q || searchText.get(id)!.includes(q)) &&
    (!state.region || d.region === state.region) &&
    (!state.format || d.format === state.format) &&
    (!state.open || nextOpen(row) !== null) &&
    (skip === 'months' || !state.months || (bucket(row) >= state.months.from && bucket(row) <= state.months.to))
  );
}

const isFiltered = () => !!(state.area || state.q.trim() || state.region || state.format || state.open || state.months);

// Month strip: from this month to the last month with a conference (at least a year ahead).
const lastMonth = byDate.map(bucket).sort().at(-1) ?? THIS_MONTH;
const yearAhead = (() => {
  const [y, m] = THIS_MONTH.split('-').map(Number);
  return m === 1 ? `${y}-12` : `${y + 1}-${String(m - 1).padStart(2, '0')}`;
})();
const timeline = createTimeline($('#timeline')!, monthsBetween(THIS_MONTH, lastMonth > yearAhead ? lastMonth : yearAhead), (r) => {
  state.months = r;
  apply();
});

const headingFor = (row: HTMLElement): [string, string] => {
  if (state.sort === 'date') {
    const m = row.dataset.start!.slice(0, 7);
    return [m, monthYear.format(parse(`${m}-01`))];
  }
  const next = nextOpen(row);
  if (!next) return ['none', 'No open deadlines'];
  const m = next.slice(0, 7);
  return [m, `Deadlines in ${monthYear.format(parse(`${m}-01`))}`];
};

const byNextDeadline = (a: HTMLElement, b: HTMLElement) => {
  const da = nextOpen(a) ?? '9999';
  const db = nextOpen(b) ?? '9999';
  return da === db ? a.dataset.start!.localeCompare(b.dataset.start!) : da.localeCompare(db);
};

function apply() {
  visible = new Set();
  for (const row of byDate) {
    const ok = matches(row);
    row.hidden = !ok;
    if (ok) visible.add(rowId(row));
  }

  // Order, then a heading before the first visible conference of each group.
  $$('.month', upcomingList).forEach((m) => m.remove());
  const ordered = state.sort === 'deadline' ? [...byDate].sort(byNextDeadline) : byDate;
  upcomingList.append(...ordered);
  let last = '';
  for (const row of ordered) {
    if (row.hidden) continue;
    const [key, text] = headingFor(row);
    if (key === last) continue;
    last = key;
    const li = document.createElement('li');
    li.className = 'month';
    li.textContent = text;
    row.before(li);
  }

  // Counts that react to the other filters: area tabs and the month strip.
  for (const tab of tabs) {
    const a = tab.dataset.area!;
    const n = byDate.filter((r) => matches(r, 'area') && (!a || areasOfRow.get(rowId(r))!.includes(a))).length;
    $('.count', tab)!.textContent = String(n);
  }
  const counts = new Map<string, number>();
  const totals = new Map<string, number>();
  for (const row of byDate) {
    const m = bucket(row);
    totals.set(m, (totals.get(m) ?? 0) + 1);
    if (matches(row, 'months')) counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  timeline.update(counts, totals);

  $('[data-result-count]')!.textContent = isFiltered()
    ? `Showing ${visible.size} of ${byDate.length} upcoming conferences`
    : `${plural(byDate.length, 'upcoming conference')}`;
  resetBtn.hidden = !isFiltered();
  $('[data-empty]')!.hidden = visible.size > 0;

  const onMap = map.setVisible(visible);
  $('[data-map-count]')!.textContent = `${plural(onMap, 'conference')} on the map`;
  fitSoon();
  writeUrl();
}

function renderControls() {
  search.value = state.q;
  region.value = state.region;
  format.value = state.format;
  openOnly.checked = state.open;
  tabs.forEach((t) => t.setAttribute('aria-checked', String(t.dataset.area === state.area)));
  sortBtns.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.sort === state.sort)));
  timeline.set(state.months);
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
function readUrl() {
  const p = new URLSearchParams(location.search);
  const pick = (value: string | null, allowed: string[]) => (value && allowed.includes(value) ? value : '');
  state.area = pick(p.get('area'), tabs.filter((t) => !t.hidden).map((t) => t.dataset.area!));
  state.q = p.get('q') ?? '';
  state.region = pick(p.get('region'), [...region.options].map((o) => o.value));
  state.format = pick(p.get('format'), [...format.options].map((o) => o.value));
  state.open = p.get('open') === '1';
  const from = p.get('from');
  const to = p.get('to') ?? from;
  state.months = from && to && MONTH_RE.test(from) && MONTH_RE.test(to) ? (from <= to ? { from, to } : { from: to, to: from }) : null;
  state.sort = p.get('sort') === 'deadline' ? 'deadline' : 'date';
}

function writeUrl() {
  const p = new URLSearchParams();
  if (state.area) p.set('area', state.area);
  if (state.q.trim()) p.set('q', state.q.trim());
  if (state.region) p.set('region', state.region);
  if (state.format) p.set('format', state.format);
  if (state.open) p.set('open', '1');
  if (state.months) {
    p.set('from', state.months.from);
    if (state.months.to !== state.months.from) p.set('to', state.months.to);
  }
  if (state.sort !== 'date') p.set('sort', state.sort);
  const qs = p.toString();
  const url = `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`;
  if (url !== `${location.pathname}${location.search}${location.hash}`) history.replaceState(history.state, '', url);
}

function resetFilters() {
  Object.assign(state, { area: '', q: '', region: '', format: '', open: false, months: null });
  renderControls();
  apply();
}

search.addEventListener('input', () => {
  state.q = search.value;
  apply();
});
region.addEventListener('change', () => {
  state.region = region.value;
  apply();
});
format.addEventListener('change', () => {
  state.format = format.value;
  apply();
});
openOnly.addEventListener('change', () => {
  state.open = openOnly.checked;
  apply();
});

function selectArea(next: string) {
  state.area = next;
  tabs.forEach((t) => t.setAttribute('aria-checked', String(t.dataset.area === state.area)));
  apply();
}
tabs.forEach((tab) => tab.addEventListener('click', () => selectArea(tab.dataset.area!)));
// Arrow keys move between area tabs, as in a radio group.
$('.area-tabs')!.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const shown = tabs.filter((t) => !t.hidden);
  const i = shown.findIndex((t) => t.dataset.area === state.area);
  const next = shown[(i + (e.key === 'ArrowRight' ? 1 : -1) + shown.length) % shown.length];
  next.focus();
  selectArea(next.dataset.area!);
});

sortBtns.forEach((b) =>
  b.addEventListener('click', () => {
    state.sort = b.dataset.sort as Sort;
    sortBtns.forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    apply();
  }),
);

resetBtn.addEventListener('click', resetFilters);
$('[data-reset-inline]')?.addEventListener('click', resetFilters);

// "/" jumps to the search box; Escape clears it.
document.addEventListener('keydown', (e) => {
  const typing = (e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]');
  if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    search.focus();
    search.select();
  }
});
search.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && search.value) {
    e.stopPropagation();
    search.value = '';
    state.q = '';
    apply();
  }
});

// ---------------------------------------------------------------------------
// 6. Row details, map links, in-page links, copy link.
// ---------------------------------------------------------------------------
function toggleRow(row: HTMLElement, open?: boolean) {
  const btn = $<HTMLButtonElement>('.r-toggle', row)!;
  const next = open ?? btn.getAttribute('aria-expanded') !== 'true';
  btn.setAttribute('aria-expanded', String(next));
  $('.r-details', row)!.hidden = !next;
  row.classList.toggle('is-open', next);
}

function focusRow(id: string) {
  const row = document.getElementById(`conf-${id}`);
  if (!row) return;
  if (row.hidden) resetFilters();
  const details = row.closest('details');
  if (details) details.open = true;
  toggleRow(row, true);
  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  row.classList.remove('flash');
  void row.offsetWidth; // restart the animation
  row.classList.add('flash');
}

document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;

  const anchor = target.closest<HTMLAnchorElement>('a[href^="#conf-"]');
  if (anchor) {
    e.preventDefault();
    history.replaceState(history.state, '', anchor.hash);
    return focusRow(anchor.hash.slice('#conf-'.length));
  }

  const row = target.closest<HTMLElement>('.row');
  if (!row) return;
  if (target.closest('[data-locate]')) {
    if (mapCard.hidden) setMapShown(true);
    map.locate(rowId(row));
    mapCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  const copyLink = target.closest<HTMLButtonElement>('[data-copy-link]');
  if (copyLink) {
    const url = new URL(`${location.pathname}#conf-${rowId(row)}`, location.href).href;
    void copyText(url).then((ok) => flashLabel($('span', copyLink)!, ok ? 'Link copied' : 'Copy failed'));
    return;
  }
  // Clicking anywhere on a row (except links, buttons and the open details) toggles it.
  if (target.closest('.r-toggle') || (!target.closest('a, button, .r-details') && !getSelection()?.toString())) {
    toggleRow(row);
  }
});

// Hovering a row highlights its pin.
for (const row of byDate) {
  row.addEventListener('mouseenter', () => map.highlight(rowId(row), true));
  row.addEventListener('mouseleave', () => map.highlight(rowId(row), false));
}

// ---------------------------------------------------------------------------
// 7. Start: filters from the URL, map visibility, and a #conf-… link if there is one.
// ---------------------------------------------------------------------------
readUrl();
renderControls();
apply();

let mapInitiallyShown = true;
try {
  mapInitiallyShown = localStorage.getItem('map') !== 'hidden';
} catch {}
setMapShown(mapInitiallyShown);

const openFromHash = () => {
  if (location.hash.startsWith('#conf-')) focusRow(decodeURIComponent(location.hash.slice('#conf-'.length)));
};
window.addEventListener('hashchange', openFromHash);
requestAnimationFrame(openFromHash);
