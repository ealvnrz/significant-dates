import { auditLinks } from './link-audit.mjs';
import { isTransientResult } from './link-request.mjs';

export function validateLinkReport(report, urls, revision) {
  const expected = new Set(urls);
  const seen = new Set();
  if (report?.version !== 1 || report.revision !== revision || !Array.isArray(report.results)
    || report.results.length !== expected.size) throw new Error('Invalid link report: revision or catalogue mismatch.');
  for (const result of report.results) {
    if (!result || !expected.has(result.url) || seen.has(result.url)
      || !Number.isInteger(result.status) || (result.status !== 0 && (result.status < 200 || result.status > 599))
      || (result.status === 0 && (typeof result.error !== 'string' || !result.error))
      || !Number.isInteger(result.attempts) || result.attempts < 0
      || !Array.isArray(result.history) || result.history.length !== result.attempts
      || (result.attempts === 0 && (result.status !== 0 || result.error !== 'NotCheckedWithinBudget'))
      || (result.attempts > 0 && (!['HEAD', 'GET'].includes(result.method)
        || result.history.at(-1) !== (result.status || result.error)))
      || (result.retryNotBefore !== undefined && (!Number.isFinite(result.retryNotBefore) || result.retryNotBefore < 0))) {
      throw new Error('Invalid link report: missing, duplicate or malformed result.');
    }
    seen.add(result.url);
  }
  return report.results;
}

export function createLinkReport(results, urls, revision) {
  const report = { version: 1, revision, results };
  validateLinkReport(report, urls, revision);
  return report;
}

export async function resumeLinkReport(report, urls, revision, options = {}) {
  const previous = validateLinkReport(report, urls, revision);
  const pending = previous.filter(r => isTransientResult(r) || r.error === 'NotCheckedWithinBudget');
  if (!pending.length) return previous;
  options.onProgress?.(`Checking ${pending.length} unresolved links from a second runner; confirmed permanent failures remain failures.`);
  const notBefore = new Map();
  for (const result of previous) {
    const origin = new URL(result.url).origin;
    if (result.retryNotBefore) notBefore.set(origin, Math.max(notBefore.get(origin) ?? 0, result.retryNotBefore));
  }
  const fresh = new Map((await auditLinks(pending.map(r => r.url), {
    ...options, initialMethod: 'GET', notBefore,
  })).map(r => [r.url, r]));
  return previous.map(old => {
    const next = fresh.get(old.url);
    if (!next) return old;
    if (!next.attempts) return { ...old, note: next.note };
    return { ...next, attempts: old.attempts + next.attempts, history: [...old.history, ...next.history] };
  });
}
