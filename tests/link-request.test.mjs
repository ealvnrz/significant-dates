import test from 'node:test';
import assert from 'node:assert/strict';
import { checkLink } from '../tools/link-request.mjs';

function requests(...responses) {
  const methods = [];
  return {
    methods,
    request: async (_url, options) => {
      methods.push(options.method);
      const next = responses.shift();
      if (next instanceof Error) throw next;
      assert.equal(typeof next, 'number', 'unexpected extra request');
      return new Response(null, { status: next });
    },
  };
}
const failure = code => new TypeError('fetch failed', { cause: { code } });
const url = 'https://example.org/';

test('successful HEAD needs only one request', async () => {
  const client = requests(200);
  assert.deepEqual(await checkLink(url, client), { status: 200, attempts: 1 });
  assert.deepEqual(client.methods, ['HEAD']);
});

test('servers rejecting HEAD are checked with GET', async () => {
  const client = requests(405, 200);
  assert.deepEqual(await checkLink(url, client), { status: 200, attempts: 1 });
  assert.deepEqual(client.methods, ['HEAD', 'GET']);
});

test('a temporary connection timeout can recover on one delayed retry', async () => {
  const client = requests(failure('UND_ERR_CONNECT_TIMEOUT'), 200);
  const delays = [];
  const result = await checkLink(url, { ...client, pause: async ms => { delays.push(ms); } });
  assert.deepEqual(result, { status: 200, attempts: 2 });
  assert.deepEqual(client.methods, ['HEAD', 'HEAD']);
  assert.deepEqual(delays, [1000]);
});

test('persistent timeouts still fail after the retry limit', async () => {
  const client = requests(failure('UND_ERR_CONNECT_TIMEOUT'), failure('UND_ERR_CONNECT_TIMEOUT'));
  assert.deepEqual(await checkLink(url, { ...client, pause: async () => {} }),
    { status: 0, error: 'UND_ERR_CONNECT_TIMEOUT', attempts: 2 });
  assert.equal(client.methods.length, 2);
});

test('TLS failures are preserved without retrying or relaxing verification', async () => {
  for (const code of ['CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE']) {
    const client = requests(failure(code));
    assert.deepEqual(await checkLink(url, client), { status: 0, error: code, attempts: 1 });
    assert.equal(client.methods.length, 1);
  }
});

test('HTTP errors remain failures after GET confirms them', async () => {
  const client = requests(404, 404);
  assert.deepEqual(await checkLink(url, client), { status: 404, attempts: 1 });
  assert.deepEqual(client.methods, ['HEAD', 'GET']);
});
