import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { auditLinks, summarizeLinks, RETRY_DELAYS_MS } from '../tools/link-audit.mjs';

const failure = code => new TypeError('fetch failed', { cause: { code } });
const url = 'https://example.org/';
const noPause = async () => {};

test('only transient failures are retried, with spaced GET attempts and visible history', async () => {
  const calls = [];
  const delays = [];
  let failures = 0;
  const results = await auditLinks([url, `${url}missing`, `${url}healthy`], {
    request: async (target, { method }) => {
      calls.push([target, method]);
      if (target === url && failures++ < 2) throw failure('UND_ERR_CONNECT_TIMEOUT');
      return new Response(null, { status: target.endsWith('missing') ? 404 : 200 });
    },
    pause: async ms => { delays.push(ms); },
  });
  assert.deepEqual(delays, RETRY_DELAYS_MS.slice(0, 2));
  assert.deepEqual(calls.filter(([target]) => target === url).map(([, method]) => method), ['HEAD', 'GET', 'GET']);
  assert.equal(calls.filter(([target]) => target.endsWith('healthy')).length, 1);
  assert.equal(calls.filter(([target]) => target.endsWith('missing')).length, 2);
  assert.deepEqual(results[0].history, ['UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_CONNECT_TIMEOUT', 200]);
  const summary = summarizeLinks(results);
  assert.equal(summary.recovered.length, 1);
  assert.equal(summary.failed[0].status, 404);
  assert.equal(summary.exitCode, 1, 'recovery must not hide a different broken link');
});

test('persistent network, DNS, HTTP 503 and rate-limit failures exhaust the bounded retries and still fail', async () => {
  for (const outcome of [failure('ETIMEDOUT'), failure('ENOTFOUND'), 503, 429]) {
    let calls = 0;
    const results = await auditLinks([url], {
      request: async () => { calls++; if (outcome instanceof Error) throw outcome; return new Response(null, { status: outcome }); },
      pause: noPause,
    });
    assert.equal(calls, RETRY_DELAYS_MS.length + 1);
    assert.equal(results[0].attempts, RETRY_DELAYS_MS.length + 1);
    assert.equal(summarizeLinks(results).exitCode, 1);
    assert.equal(summarizeLinks(results).blocked.length, 0);
  }
});

test('permanent 404, 410 and TLS failures are not retried in later rounds', async () => {
  for (const outcome of [404, 410, failure('CERT_HAS_EXPIRED')]) {
    let calls = 0;
    const results = await auditLinks([url], {
      request: async () => { calls++; if (outcome instanceof Error) throw outcome; return new Response(null, { status: outcome }); },
      pause: async () => assert.fail('permanent failures must not be retried'),
    });
    assert.equal(calls, outcome instanceof Error ? 1 : 2);
    assert.equal(results[0].attempts, 1);
    assert.equal(summarizeLinks(results).exitCode, 1);
  }
});

test('Retry-After also protects other URLs on the same origin while unrelated origins proceed', async () => {
  let time = Date.parse('2026-10-13T12:00:00Z');
  const started = [];
  let first = true;
  const results = await auditLinks([url, `${url}other`, 'https://other.example/'], {
    now: () => time,
    request: async (target) => {
      started.push([target, time]);
      if (target === url && first) {
        first = false;
        return new Response(null, { status: 429, headers: { 'Retry-After': '120' } });
      }
      return new Response(null, { status: 200 });
    },
    pause: async ms => { time += ms; },
  });
  assert.ok(started.find(([target]) => target === `${url}other`)[1] - started[0][1] >= 120_000);
  assert.ok(started.find(([target]) => target === 'https://other.example/')[1]
    < started.find(([target]) => target === `${url}other`)[1]);
  assert.equal(summarizeLinks(results).exitCode, 0);
  assert.deepEqual(results[0].history, [429, 200]);
});

test('requests are serial per origin but concurrent across origins', async () => {
  const active = new Set();
  let peak = 0;
  const results = await auditLinks([url, `${url}second`, 'https://other.example/', url], {
    concurrency: 2,
    request: async target => {
      const origin = new URL(target).origin;
      assert.equal(active.has(origin), false, 'do not overlap requests to one origin');
      active.add(origin);
      peak = Math.max(peak, active.size);
      await new Promise(resolve => setImmediate(resolve));
      active.delete(origin);
      return new Response(null, { status: 200 });
    },
  });
  assert.equal(peak, 2);
  assert.equal(results.length, 3, 'duplicate URLs should only be checked once');
  assert.equal(results.every(result => result.status === 200), true);
});

test('an excessive Retry-After remains a failure rather than bypassing the wait or the budget', async () => {
  let calls = 0;
  const results = await auditLinks([url, `${url}other`], {
    now: () => 0, timeoutMs: 60_000, retryDelays: [30_000], pause: noPause,
    request: async () => { calls++; return new Response(null, { status: 503, headers: { 'Retry-After': '3600' } }); },
  });
  assert.equal(calls, 1);
  assert.equal(results[0].status, 503);
  assert.equal(results[1].error, 'NotCheckedWithinBudget');
  assert.equal(summarizeLinks(results).failed.length, 2);
  assert.equal(summarizeLinks(results).exitCode, 1);
});

test('a spent budget leaves every unvisited URL visible as a failure', async () => {
  const results = await auditLinks([url, `${url}other`], {
    timeoutMs: 0, request: async () => assert.fail('the budget has expired'),
  });
  assert.equal(results.every(result => result.attempts === 0 && result.error === 'NotCheckedWithinBudget'), true);
  assert.equal(summarizeLinks(results).failed.length, 2);
});

test('401 and 403 remain visible as access restrictions, not recovered links', async () => {
  for (const status of [401, 403]) {
    const results = await auditLinks([url], { request: async () => new Response(null, { status }) });
    const summary = summarizeLinks(results);
    assert.equal(summary.blocked.length, 1);
    assert.equal(summary.recovered.length, 0);
    assert.equal(summary.exitCode, 0);
  }
});

test('real HTTP requests recover from 503, confirm 404 and abort a hung server within the budget', async () => {
  const server = createServer((req, res) => {
    if (req.url === '/hung') return;
    res.statusCode = req.url === '/missing' ? 404 : req.method === 'HEAD' ? 503 : 200;
    res.end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const results = await auditLinks([`${base}/temporary`, `${base}/missing`], { pause: noPause });
    assert.deepEqual(results[0].history, [503, 200]);
    assert.equal(summarizeLinks(results).failed[0].status, 404);
    const hung = await auditLinks([`${base}/hung`, `${base}/unvisited`], { timeoutMs: 100 });
    assert.equal(hung[0].status, 0);
    assert.equal(hung[1].error, 'NotCheckedWithinBudget');
    assert.equal(summarizeLinks(hung).exitCode, 1);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
