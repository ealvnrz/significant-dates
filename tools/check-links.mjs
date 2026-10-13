// Maintenance check for src/data/conferences.yaml, run weekly by .github/workflows/check.yml
// (or by hand with `npm run check:links`). For upcoming meetings it reports:
//   - `url` / `source` links that no longer answer,
//   - entries whose `checked` date is older than STALE_DAYS,
//   - deadlines in the next 14 days, as a reminder to confirm them.
// Prints Markdown (it ends up in the GitHub job summary). Exits 1 if any link is broken.
import { loadEntries } from './data.mjs';
import { createLinkDispatcher } from './link-tls.mjs';
import { auditLinks, summarizeLinks } from './link-audit.mjs';
import { calendarDay, daysBetween, REVIEW_POLICY, reviewDue } from '../src/lib/calendar.ts';

const { staleDays: STALE_DAYS, soonDays: SOON_DAYS, urgentReviewDays: URGENT_DAYS } = REVIEW_POLICY;
const offline = process.argv.includes('--offline');
const dispatcher = offline ? undefined : createLinkDispatcher();

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

let results = [];
try {
  if (!offline) {
    results = (await auditLinks([...links.keys()], {
      dispatcher, onProgress: message => console.error(message),
    })).map(result => ({ ...result, used: links.get(result.url) }));
  }
} finally {
  await dispatcher?.destroy();
}

const { blocked, failed: broken, recovered, exitCode } = summarizeLinks(results);

const stale = upcoming
  .filter((e) => reviewDue(e.checked && iso(e.checked), e.deadlines.map(d => ({ ...d, date: iso(d.date) })), today))
  .map((e) => `- ${title(e)}: ${e.checked ? `last checked ${iso(e.checked)}` : 'never checked'}`);

const soon = upcoming
  .flatMap((e) => (e.deadlines ?? []).map((d) => ({ e, d, days: daysFrom(today, iso(d.date)) })))
  .filter(({ days }) => days >= 0 && days <= SOON_DAYS)
  .sort((a, b) => a.days - b.days)
  .map(({ e, d, days }) => `- ${iso(d.date)} (${days === 0 ? 'today' : `in ${days} ${days === 1 ? 'day' : 'days'}`}): ${title(e)}, ${d.label} [${d.types.join(', ')}]${d.tentative ? ' (date TBC)' : ''}`);

const row = (r) => `| ${r.used.join(', ')} | ${r.url} | ${r.status || r.error} | ${r.attempts} | ${r.history.join(' → ')}${r.note ? `; ${r.note}` : ''} |`;
const tableHeader = ['| Meeting | Link | Status | Attempts | History |', '| --- | --- | --- | --- | --- |'];
const out = [
  `## Conference data check, ${today}`,
  '',
  offline ? `Offline editorial review report for ${upcoming.length} upcoming meetings. Links were not checked.` : `Checked ${results.filter(r => r.attempts > 0).length} of ${links.size} links for ${upcoming.length} upcoming meetings.`,
  ...(!offline ? ['Temporary failures are retried after 30, 90 and 180 seconds, using GET. Server Retry-After delays are respected within a 12-minute total budget. Unresolved failures still fail this check.'] : []),
  'HTTP availability does not verify the dates on a page. Review the official sources before changing checked dates.',
  '',
  offline ? '### Link availability' : `### Broken links or failed requests (${broken.length})`,
  ...(offline ? ['', 'Not checked in offline mode.'] : broken.length ? ['', ...tableHeader, ...broken.map(row)] : ['', 'None.']),
  ...(!offline ? ['', `### Links recovered automatically (${recovered.length})`,
    ...(recovered.length ? ['', ...tableHeader, ...recovered.map(row)] : ['', 'None.'])] : []),
  '',
  ...(!offline ? [`### Links that refuse automated checks (${blocked.length})`,
    'Open these by hand; they usually work in a browser.',
    ...(blocked.length ? ['', ...tableHeader, ...blocked.map(row)] : ['', 'None.'])] : []),
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
process.exitCode = exitCode;
