export const REQUEST_TIMEOUT_MS = 20_000;
const transientErrors = new Set([
  'TimeoutError', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND',
  'EHOSTUNREACH', 'ENETUNREACH',
]);
const transientStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);

export const isTransientResult = result => transientStatuses.has(result.status)
  || (result.status === 0 && transientErrors.has(result.error));

function retryAfterMs(value, now) {
  if (!value) return 0;
  const delay = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) ? Math.max(0, delay) : 0;
}

export async function checkLink(url, { dispatcher, request = fetch, method = 'HEAD', signal, now = Date.now } = {}) {
  const init = {
    dispatcher,
    redirect: 'follow',
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; SignificantDates/1.0)', accept: 'text/html,*/*;q=0.8' },
  };
  const send = async verb => {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const res = await request(url, { ...init, method: verb, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    const result = { status: res.status, method: verb };
    if (transientStatuses.has(res.status)) result.retryAfterMs = retryAfterMs(res.headers.get('retry-after'), now());
    await res.body?.cancel();
    return result;
  };
  try {
    let result = await send(method);
    // Confirm apparent failures with GET. Temporary errors wait for the next round,
    // rather than immediately repeating a request against an overloaded server.
    if (method === 'HEAD' && result.status >= 400 && !isTransientResult(result)) {
      method = 'GET';
      result = await send(method);
    }
    return result;
  } catch (err) {
    return { status: 0, error: err.cause?.code ?? err.name, method };
  }
}
