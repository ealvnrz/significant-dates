// Maintenance check for src/data/conferences.yaml, run weekly by .github/workflows/check.yml
// (or by hand with `npm run check:links`). For upcoming meetings it reports:
//   - `url` / `source` links that no longer answer,
//   - entries whose `checked` date is older than STALE_DAYS,
//   - deadlines in the next 14 days, as a reminder to confirm them.
// Prints Markdown (it ends up in the GitHub job summary). Exits 1 if any link is broken.
import { loadEntries } from './data.mjs';
import { calendarDay, daysBetween, REVIEW_POLICY, reviewDue } from '../src/lib/calendar.ts';

const { staleDays: STALE_DAYS, soonDays: SOON_DAYS, urgentReviewDays: URGENT_DAYS } = REVIEW_POLICY;
const CONCURRENCY = 6;
const offline = process.argv.includes('--offline');

const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d));
const today = calendarDay();
const daysFrom = daysBetween;

const entries = await loadEntries();
const upcoming = entries.filter((e) => iso(e.end) >= today);
const title = (e) => e.acronym ?? e.name;

// url -> meetings that use it
const links = new Map();
for (const e of upcoming) {
  for (const url of new Set([e.url, e.source].filter(Boolean))) links.set(url, [...(links.get(url) ?? []), title(e)]);
}

async function check(url) {
  const init = {
    redirect: 'follow',
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; SignificantDatesLinkCheck/1.0)', accept: 'text/html,*/*;q=0.8' },
  };
  try {
    let res = await fetch(url, { ...init, method: 'HEAD', signal: AbortSignal.timeout(20_000) });
    // Plenty of servers reject HEAD; ask again with GET before calling it broken.
    if (res.status >= 400) {
      await res.body?.cancel();
      res = await fetch(url, { ...init, method: 'GET', signal: AbortSignal.timeout(20_000) });
    }
    await res.body?.cancel();
    return { status: res.status };
  } catch (err) {
    return { status: 0, error: err.cause?.code ?? err.name };
  }
}

const results = [];
const queue = offline ? [] : [...links.keys()];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const url = queue.shift();
      results.push({ url, used: links.get(url), ...(await check(url)) });
    }
  }),
);

// 401/403/429 usually mean "no bots", not "gone": list them separately, don't fail on them.
const blocked = results.filter((r) => [401, 403, 429].includes(r.status));
const broken = results.filter((r) => (r.status === 0 || r.status >= 400) && !blocked.includes(r));

const stale = upcoming
  .filter((e) => reviewDue(e.checked && iso(e.checked), e.deadlines.map(d => ({ ...d, date: iso(d.date) })), today))
  .map((e) => `- ${title(e)}: ${e.checked ? `last checked ${iso(e.checked)}` : 'never checked'}`);

const soon = upcoming
  .flatMap((e) => (e.deadlines ?? []).map((d) => ({ e, d, days: daysFrom(today, iso(d.date)) })))
  .filter(({ days }) => days >= 0 && days <= SOON_DAYS)
  .sort((a, b) => a.days - b.days)
  .map(({ e, d, days }) => `- ${iso(d.date)} (${days === 0 ? 'today' : `in ${days} ${days === 1 ? 'day' : 'days'}`}): ${title(e)}, ${d.label} [${d.types.join(', ')}]${d.tentative ? ' (date TBC)' : ''}`);

const row = (r) => `| ${r.used.join(', ')} | ${r.url} | ${r.status || r.error} |`;
const out = [
  `## Conference data check, ${today}`,
  '',
  offline ? `Offline editorial review report for ${upcoming.length} upcoming meetings. Links were not checked.` : `Checked ${results.length} links for ${upcoming.length} upcoming meetings.`,
  'HTTP availability does not verify the dates on a page. Review the official sources before changing checked dates.',
  '',
  offline ? '### Link availability' : `### Broken links or failed requests (${broken.length})`,
  ...(offline ? ['', 'Not checked in offline mode.'] : broken.length ? ['', '| Meeting | Link | Status |', '| --- | --- | --- |', ...broken.map(row)] : ['', 'None.']),
  '',
  ...(!offline ? [`### Links that refuse automated checks (${blocked.length})`,
    'Open these by hand; they usually work in a browser.',
    ...(blocked.length ? ['', '| Meeting | Link | Status |', '| --- | --- | --- |', ...blocked.map(row)] : ['', 'None.'])] : []),
  '',
  `### Editorial review due (${stale.length})`,
  `Review after ${STALE_DAYS} days, or ${URGENT_DAYS} days when a deadline is within ${SOON_DAYS} days.`,
  '',
  ...(stale.length ? stale : ['None.']),
  '',
  `### Deadlines in the next ${SOON_DAYS} days (${soon.length})`,
  '',
  ...(soon.length ? soon : ['None.']),
  '',
  `### No deadline information recorded (${upcoming.filter(e => e.deadlineStatus === 'unknown').length})`,
  'These entries need an editorial check; missing data does not imply that submissions are closed.',
  ...upcoming.filter(e => e.deadlineStatus === 'unknown').map(e => `- ${title(e)}: ${e.source}`),
  '',
];
console.log(out.join('\n'));
process.exitCode = broken.length ? 1 : 0;
