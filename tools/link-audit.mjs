import { setTimeout as sleep } from 'node:timers/promises';
import { checkLink, isTransientResult } from './link-request.mjs';

export const RETRY_DELAYS_MS = [30_000, 90_000, 180_000];
export const AUDIT_TIMEOUT_MS = 12 * 60_000;

export function summarizeLinks(results) {
  // Access restrictions are visible but do not establish that a page is gone.
  // A persistent rate limit (429), unlike 401/403, remains an unresolved failure.
  const blocked = results.filter(r => [401, 403].includes(r.status));
  const failed = results.filter(r => (r.status === 0 || r.status >= 400) && !blocked.includes(r));
  const recovered = results.filter(r => r.attempts > 1 && r.status >= 200 && r.status < 400);
  return { blocked, failed, recovered, exitCode: failed.length ? 1 : 0 };
}

export async function auditLinks(urls, {
  dispatcher, request, pause = sleep, now = Date.now, onProgress = () => {},
  retryDelays = RETRY_DELAYS_MS, timeoutMs = AUDIT_TIMEOUT_MS, concurrency = 6,
} = {}) {
  const deadline = now() + timeoutMs;
  const signal = AbortSignal.timeout(timeoutMs);
  const records = [...new Set(urls)].map(url => ({ url, status: 0, error: 'NotChecked', attempts: 0, history: [] }));
  const originReadyAt = new Map();
  const remaining = () => Math.max(0, deadline - now());
  const wait = async ms => {
    if (signal.aborted || ms >= remaining()) return false;
    if (ms > 0) {
      try { await pause(ms, undefined, { signal }); }
      catch (error) { if (!signal.aborted) throw error; }
    }
    return !signal.aborted && remaining() > 0;
  };

  let pending = records;
  for (let round = 0; pending.length && round <= retryDelays.length; round++) {
    if (round) {
      onProgress(`Retry round ${round}: ${pending.length} unresolved links; waiting ${retryDelays[round - 1] / 1000}s.`);
      if (!await wait(retryDelays[round - 1])) break;
    }
    // One worker owns an origin for this round, so its requests are serial and
    // Retry-After also delays the other catalogue URLs served by that origin.
    const byOrigin = new Map();
    for (const record of pending) {
      const origin = new URL(record.url).origin;
      if (!byOrigin.has(origin)) byOrigin.set(origin, []);
      byOrigin.get(origin).push(record);
    }
    const groups = [...byOrigin.entries()];
    await Promise.all(Array.from({ length: Math.min(concurrency, groups.length) }, async () => {
      while (groups.length) {
        const [origin, group] = groups.shift();
        for (const record of group) {
          if (!await wait(Math.max(0, (originReadyAt.get(origin) ?? 0) - now()))) {
            record.note = 'Check budget exhausted or Retry-After exceeds the remaining budget.';
            continue;
          }
          const result = await checkLink(record.url, {
            dispatcher, request, signal, now, method: round ? 'GET' : 'HEAD',
          });
          record.attempts++;
          record.history.push(result.status || result.error);
          delete record.error;
          delete record.retryAfterMs;
          Object.assign(record, result);
          if (result.retryAfterMs) originReadyAt.set(origin, now() + result.retryAfterMs);
        }
      }
    }));
    pending = records.filter(isTransientResult);
  }
  for (const record of records) {
    if (!record.attempts) record.error = 'NotCheckedWithinBudget';
  }
  return records;
}
