// Maintenance check for src/data/conferences.yaml, run weekly by .github/workflows/check.yml
// (or by hand with `npm run check:links`). For upcoming meetings it reports:
//   - `url` / `source` links that no longer answer,
//   - entries whose `checked` date is older than STALE_DAYS,
//   - deadlines in the next 14 days, as a reminder to confirm them.
// Prints Markdown (it ends up in the GitHub job summary). Exits 1 if any link is broken.
import { readFile } from 'node:fs/promises';
import yaml from 'js-yaml';

const STALE_DAYS = 120; // keep in step with SITE.staleAfterDays in src/site.config.ts
const SOON_DAYS = 14;
const CONCURRENCY = 6;

const DAY = 86_400_000;
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d));
const today = new Date().toISOString().slice(0, 10);
const daysFrom = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

const entries = yaml.load(await readFile(new URL('../src/data/conferences.yaml', import.meta.url), 'utf8'));
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
    signal: AbortSignal.timeout(20_000),
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; SignificantDatesLinkCheck/1.0)', accept: 'text/html,*/*;q=0.8' },
  };
  try {
    let res = await fetch(url, { ...init, method: 'HEAD' });
    // Plenty of servers reject HEAD; ask again with GET before calling it broken.
    if (res.status >= 400) res = await fetch(url, { ...init, method: 'GET' });
    return { status: res.status };
  } catch (err) {
    return { status: 0, error: err.cause?.code ?? err.name };
  }
}

const results = [];
const queue = [...links.keys()];
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
  .filter((e) => !e.checked || daysFrom(iso(e.checked), today) > STALE_DAYS)
  .map((e) => `- ${title(e)}: ${e.checked ? `last checked ${iso(e.checked)}` : 'never checked'}`);

const soon = upcoming
  .flatMap((e) => (e.deadlines ?? []).map((d) => ({ e, d, days: daysFrom(today, iso(d.date)) })))
  .filter(({ days }) => days >= 0 && days <= SOON_DAYS)
  .sort((a, b) => a.days - b.days)
  .map(({ e, d, days }) => `- ${iso(d.date)} (${days === 0 ? 'today' : `in ${days} days`}): ${title(e)}, ${d.label}${d.tentative ? ' (date TBC)' : ''}`);

const row = (r) => `| ${r.used.join(', ')} | ${r.url} | ${r.status || r.error} |`;
const out = [
  `## Conference data check, ${today}`,
  '',
  `Checked ${results.length} links for ${upcoming.length} upcoming meetings.`,
  '',
  `### Broken links (${broken.length})`,
  ...(broken.length ? ['', '| Meeting | Link | Status |', '| --- | --- | --- |', ...broken.map(row)] : ['', 'None.']),
  '',
  `### Links that refuse automated checks (${blocked.length})`,
  'Open these by hand; they usually work in a browser.',
  ...(blocked.length ? ['', '| Meeting | Link | Status |', '| --- | --- | --- |', ...blocked.map(row)] : ['', 'None.']),
  '',
  `### Not re-checked in ${STALE_DAYS}+ days (${stale.length})`,
  '',
  ...(stale.length ? stale : ['None.']),
  '',
  `### Deadlines in the next ${SOON_DAYS} days (${soon.length})`,
  '',
  ...(soon.length ? soon : ['None.']),
  '',
];
console.log(out.join('\n'));
process.exitCode = broken.length ? 1 : 0;
