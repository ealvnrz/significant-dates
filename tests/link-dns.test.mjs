import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createLinkLookup, requestPublicDns } from '../tools/link-dns.mjs';
import { createLinkDispatcher } from '../tools/link-tls.mjs';
import { checkLink } from '../tools/link-request.mjs';
import { summarizeLinks } from '../tools/link-audit.mjs';

const failure = code => Object.assign(new Error(code), { code });
const failedLookup = (_host, _options, callback) => callback(failure('EAI_AGAIN'));
const answer = (type = 1, data = '127.0.0.1') => Response.json({ Status: 0, Answer: [{ type, data }] });
const resolve = (lookup, options = { family: 4, all: true }) => new Promise((resolve, reject) => {
  lookup('conference.example', options, (error, address, family) => error ? reject(error) : resolve({ address, family }));
});

test('healthy system DNS never contacts the fallback resolver', async () => {
  const expected = [{ address: '192.0.2.1', family: 4 }];
  const lookup = createLinkLookup({
    lookup: (_host, options, callback) => { assert.equal(options.all, true); callback(null, expected); },
    request: () => assert.fail('do not query public DNS when local DNS works'),
  });
  assert.deepEqual((await resolve(lookup)).address, expected);
});

test('failed system DNS recovers IPv4 and IPv6 without changing the requested hostname', async () => {
  const recovered = [];
  const lookup = createLinkLookup({
    lookup: failedLookup,
    onFallback: (...args) => recovered.push(args),
    request: async (url, options) => {
      assert.equal(url.origin, 'https://dns.google');
      assert.equal(url.searchParams.get('name'), 'conference.example');
      assert.equal(url.searchParams.get('edns_client_subnet'), '0.0.0.0/0');
      assert.equal(url.searchParams.has('cd'), false, 'retain DNSSEC validation');
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal instanceof AbortSignal);
      return url.searchParams.get('type') === '28' ? answer(28, '2001:db8::1') : answer(1, '192.0.2.1');
    },
  });
  assert.deepEqual((await resolve(lookup, { all: true, order: 'ipv6first' })).address, [
    { address: '2001:db8::1', family: 6 }, { address: '192.0.2.1', family: 4 },
  ]);
  assert.deepEqual(await resolve(lookup, 6), { address: '2001:db8::1', family: 6 });
  assert.deepEqual(recovered[0], ['conference.example', 'EAI_AGAIN']);
});

test('a stalled system lookup has a bound and its late callback cannot replace the fallback', async () => {
  let lateCallback;
  let calls = 0;
  const lookup = createLinkLookup({
    lookup: (_host, _options, callback) => { lateCallback = callback; },
    systemTimeoutMs: 5,
    request: async () => answer(),
  });
  await new Promise((resolve, reject) => lookup('conference.example', { family: 4 }, (error, address) => {
    calls++;
    if (error) reject(error); else { assert.equal(address, '127.0.0.1'); resolve(); }
  }));
  lateCallback(null, [{ address: '192.0.2.1', family: 4 }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
});

test('NXDOMAIN, empty, malformed and unavailable DNS responses never count as recovery', async () => {
  for (const [reply, code] of [
    [{ Status: 3 }, 'ENOTFOUND'], [{ Status: 0 }, 'ENOTFOUND'],
    [{ Status: 2 }, 'EAI_AGAIN'], [{ Status: 0, TC: true }, 'EAI_AGAIN'],
    [{ Status: 0, Answer: [{ type: 1, data: 'not-an-address' }] }, 'EAI_AGAIN'],
    [{ Status: 0, Answer: [{ type: 1, data: '2001:db8::1' }] }, 'EAI_AGAIN'],
  ]) {
    const lookup = createLinkLookup({ lookup: failedLookup, request: async () => Response.json(reply),
      onFallback: () => assert.fail('no verified address'),
    });
    await assert.rejects(resolve(lookup), { code });
  }
  for (const request of [async () => new Response(null, { status: 503 }), async () => { throw failure('ECONNRESET'); }]) {
    await assert.rejects(resolve(createLinkLookup({ lookup: failedLookup, request })), { code: 'EAI_AGAIN' });
  }
});

test('non-DNS system errors are preserved and fallback requests have a finite timeout', async () => {
  const invalid = createLinkLookup({
    lookup: (_host, _options, callback) => callback(failure('EINVAL')),
    request: () => assert.fail('invalid arguments must not trigger a fallback'),
  });
  await assert.rejects(resolve(invalid), { code: 'EINVAL' });
  const stalled = createLinkLookup({ lookup: failedLookup, fallbackTimeoutMs: 5,
    request: async (_url, { signal }) => new Promise((_, reject) => {
      const keepAlive = setTimeout(() => reject(new Error('fallback timeout was not enforced')), 1000);
      signal.addEventListener('abort', () => { clearTimeout(keepAlive); reject(signal.reason); }, { once: true });
    }),
  });
  await assert.rejects(resolve(stalled), { code: 'EAI_AGAIN' });
});

test('DNS recovery cannot turn a real HTTP 404 or 503 into a successful link', async () => {
  const server = createServer((request, response) => {
    response.statusCode = request.url === '/missing' ? 404 : 503;
    response.end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const dispatcher = createLinkDispatcher({ lookup: createLinkLookup({ lookup: failedLookup, request: async () => answer() }) });
  try {
    for (const [path, status] of [['missing', 404], ['unavailable', 503]]) {
      const result = await checkLink(`http://conference.example:${server.address().port}/${path}`, { dispatcher });
      assert.equal(result.status, status);
      assert.equal(summarizeLinks([result]).exitCode, 1);
    }
  } finally {
    await dispatcher.destroy();
    await new Promise(resolve => server.close(resolve));
  }
});

test('fallback transport resolves independently of OS lookup and releases connections on success and timeout', async () => {
  const server = createServer((request, response) => {
    if (request.url === '/hung') return;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: '192.0.2.1' }] }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let cancelled = 0;
  const resolver = {
    resolve4: async hostname => { assert.equal(hostname, 'resolver.example'); return ['127.0.0.1']; },
    cancel: () => { cancelled++; },
  };
  const base = `http://resolver.example:${server.address().port}`;
  try {
    const response = await requestPublicDns(base, { signal: AbortSignal.timeout(1000) }, { resolver });
    assert.equal((await response.json()).Answer[0].data, '192.0.2.1');
    await assert.rejects(requestPublicDns(`${base}/hung`, { signal: AbortSignal.timeout(20) }, { resolver }));
    assert.equal(cancelled, 2);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
