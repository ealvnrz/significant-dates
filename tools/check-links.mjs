// Maintenance check for src/data/conferences.yaml, run weekly by .github/workflows/check.yml
// (or by hand with `npm run check:links`). For upcoming meetings it reports:
//   - `url` / `source` links that no longer answer,
//   - entries whose `checked` date is older than STALE_DAYS,
//   - deadlines in the next 14 days, as a reminder to confirm them.
// Prints Markdown. The final check exits 1 if any link is broken or unresolved.
// Collection mode saves preliminary results for the required final CI job.
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { loadEntries } from './data.mjs';
import { createLinkDispatcher } from './link-tls.mjs';
import { auditLinks, summarizeLinks } from './link-audit.mjs';
import { createLinkReport, resumeLinkReport } from './link-report.mjs';
import { calendarDay, daysBetween, REVIEW_POLICY, reviewDue } from '../src/lib/calendar.ts';

const { staleDays: STALE_DAYS, soonDays: SOON_DAYS, urgentReviewDays: URGENT_DAYS } = REVIEW_POLICY;
const { values: args } = parseArgs({ options: {
  offline: { type: 'boolean' },
  'collect-report': { type: 'string' },
  'resume-report': { type: 'string' },
} });
const offline = args.offline;
const collectPath = args['collect-report'];
const resumePath = args['resume-report'];
if ([offline, collectPath, resumePath].filter(Boolean).length > 1) throw new Error('Choose only one link-check mode.');
const revision = process.env.GITHUB_SHA ?? null;
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
    const urls = [...links.keys()];
    const options = { dispatcher, onProgress: message => console.error(message) };
    results = resumePath
      ? await resumeLinkReport(JSON.parse(await readFile(resumePath, 'utf8')), urls, revision, options)
      : await auditLinks(urls, { ...options, ...(collectPath ? { retryDelays: [30_000] } : {}) });
    if (collectPath) await writeFile(collectPath, JSON.stringify(createLinkReport(results, urls, revision)));
    results = results.map(result => ({ ...result, used: links.get(result.url) }));
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
  ...(!offline ? [collectPath
    ? 'Preliminary observations: one retry after 30 seconds. The required links job determines the final result, checking unresolved temporary failures from a second runner.'
    : `${resumePath ? 'Includes the primary runner results. Only unresolved temporary failures are checked again here. ' : ''}Temporary failures are retried after 30, 90 and 180 seconds, using GET. Retry-After is respected within a 12-minute budget per runner. Permanent and unresolved failures fail this check.`] : []),
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
// The collection job is not the success gate: the dependent links job validates
// every record and fails for permanent errors or failures on both runners.
process.exitCode = collectPath ? 0 : exitCode;
