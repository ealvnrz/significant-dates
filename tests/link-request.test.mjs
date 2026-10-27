import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createLinkDispatcher } from '../tools/link-tls.mjs';
import { checkLink, isTransientResult } from '../tools/link-request.mjs';

function requests(...responses) {
  const methods = [];
  return {
    methods,
    request: async (_url, options) => {
      methods.push(options.method);
      assert.ok(options.signal instanceof AbortSignal);
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return typeof next === 'number' ? new Response(null, { status: next }) : next;
    },
  };
}
const failure = code => new TypeError('fetch failed', { cause: { code } });
const url = 'https://example.org/';

test('successful HEAD needs only one request', async () => {
  const client = requests(200);
  assert.deepEqual(await checkLink(url, client), { status: 200, method: 'HEAD' });
  assert.deepEqual(client.methods, ['HEAD']);
});

test('servers rejecting HEAD are checked with GET', async () => {
  const client = requests(405, 200);
  assert.deepEqual(await checkLink(url, client), { status: 200, method: 'GET' });
  assert.deepEqual(client.methods, ['HEAD', 'GET']);
});

test('404 and 410 must be confirmed by GET, rather than inferred from HEAD', async () => {
  for (const status of [404, 410]) {
    const client = requests(status, status);
    const result = await checkLink(url, client);
    assert.deepEqual(result, { status, method: 'GET' });
    assert.equal(isTransientResult(result), false);
    assert.deepEqual(client.methods, ['HEAD', 'GET']);
  }
  const client = requests(404, 200);
  assert.equal((await checkLink(url, client)).status, 200);
});

test('temporary errors are returned to the scheduler instead of retried immediately', async () => {
  for (const status of [408, 425, 429, 500, 502, 503, 504]) {
    const client = requests(status);
    const result = await checkLink(url, client);
    assert.equal(isTransientResult(result), true);
    assert.deepEqual(client.methods, ['HEAD']);
  }
  for (const code of ['UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET']) {
    const result = await checkLink(url, requests(failure(code)));
    assert.equal(result.error, code);
    assert.equal(isTransientResult(result), true);
  }
  assert.equal(isTransientResult(await checkLink(url, requests(new DOMException('Timed out', 'TimeoutError')))), true);
});

test('Retry-After accepts seconds and HTTP dates, including invalid and past values', async () => {
  const now = () => Date.parse('2026-10-13T12:00:00Z');
  for (const [value, delay] of [
    ['120', 120_000], ['Tue, 13 Oct 2026 12:01:00 GMT', 60_000],
    ['Tue, 13 Oct 2026 11:59:00 GMT', 0], ['invalid', 0],
  ]) {
    const client = requests(new Response(null, { status: 503, headers: { 'Retry-After': value } }));
    assert.equal((await checkLink(url, { ...client, now })).retryAfterMs, delay);
  }
});

test('TLS and unknown failures are never classified as temporary network errors', async () => {
  for (const code of ['CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNKNOWN_ERROR']) {
    const client = requests(failure(code));
    const result = await checkLink(url, client);
    assert.deepEqual(result, { status: 0, error: code, method: 'HEAD' });
    assert.equal(isTransientResult(result), false);
    assert.equal(client.methods.length, 1);
  }
});

test('response bodies are released before fallback and after GET', async () => {
  const cancelled = [];
  const response = status => ({ status, headers: new Headers(), body: { cancel: async () => cancelled.push(status) } });
  const client = requests(response(405), response(200));
  await checkLink(url, client);
  assert.deepEqual(cancelled, [405, 200]);
});

test('compatible client identification avoids connection resets without ignoring HTTP failures', async () => {
  const server = createServer((request, response) => {
    // Reproduce BDAI's connection reset for the old checker identifier.
    if (request.headers['user-agent']?.includes('LinkCheck')) return request.socket.destroy();
    response.statusCode = request.url === '/missing' ? 404 : 200;
    response.end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const dispatcher = createLinkDispatcher();
  try {
    await assert.rejects(fetch(base, { dispatcher, headers: { 'user-agent': 'Mozilla/5.0 (compatible; SignificantDatesLinkCheck/1.0)' } }));
    assert.equal((await checkLink(base, { dispatcher })).status, 200);
    assert.equal((await checkLink(`${base}/missing`, { dispatcher })).status, 404);
  } finally {
    await dispatcher.destroy();
    await new Promise(resolve => server.close(resolve));
  }
});
