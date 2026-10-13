import { setTimeout as sleep } from 'node:timers/promises';

export const REQUEST_TIMEOUT_MS = 20_000;
const transientErrors = new Set(['TimeoutError', 'UND_ERR_CONNECT_TIMEOUT', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN']);

export async function checkLink(url, { dispatcher, request = fetch, pause = sleep } = {}) {
  const init = {
    dispatcher,
    redirect: 'follow',
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; SignificantDatesLinkCheck/1.0)', accept: 'text/html,*/*;q=0.8' },
  };
  for (let attempts = 1; attempts <= 2; attempts++) {
    try {
      let res = await request(url, { ...init, method: 'HEAD', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      // Plenty of servers reject HEAD; try GET before reporting a broken link.
      if (res.status >= 400) {
        await res.body?.cancel();
        res = await request(url, { ...init, method: 'GET', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      }
      await res.body?.cancel();
      return { status: res.status, attempts };
    } catch (err) {
      const error = err.cause?.code ?? err.name;
      if (attempts === 2 || !transientErrors.has(error)) return { status: 0, error, attempts };
      await pause(1_000);
    }
  }
}
