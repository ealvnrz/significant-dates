import test from 'node:test';
import assert from 'node:assert/strict';
import { auditLinks, summarizeLinks } from '../tools/link-audit.mjs';
import { createLinkReport, resumeLinkReport, validateLinkReport } from '../tools/link-report.mjs';

const urls = ['https://example.org/', 'https://other.example/'];
const revision = 'test-revision';
const noPause = async () => {};
const collect = async request => createLinkReport(await auditLinks(urls, {
  request, retryDelays: [],
}), urls, revision);

test('a second runner checks only transient failures and preserves the complete history', async () => {
  const primary = await collect(async target => {
    if (target === urls[0]) throw new DOMException('Timed out', 'TimeoutError');
    return new Response(null, { status: 200 });
  });
  const requests = [];
  const results = await resumeLinkReport(primary, urls, revision, {
    request: async (target, { method }) => {
      requests.push([target, method]);
      return new Response(null, { status: 200 });
    },
  });
  assert.deepEqual(requests, [[urls[0], 'GET']]);
  assert.deepEqual(results[0].history, ['TimeoutError', 200]);
  assert.equal(results[0].attempts, 2);
  assert.equal(summarizeLinks(results).exitCode, 0);
  assert.equal(summarizeLinks(results).recovered.length, 1);
  assert.equal(primary.results[0].status, 0, 'the original evidence remains unchanged');
});

test('permanent HTTP and TLS failures cannot be replaced by a second runner success', async () => {
  const primary = await collect(async target => {
    if (target === urls[1]) throw new TypeError('fetch failed', { cause: { code: 'CERT_HAS_EXPIRED' } });
    return new Response(null, { status: 404 });
  });
  const results = await resumeLinkReport(primary, urls, revision, {
    request: async () => assert.fail('confirmed permanent failures must be retained'),
  });
  assert.equal(summarizeLinks(results).failed.length, 2);
  assert.equal(summarizeLinks(results).exitCode, 1);
});

test('exhausting retries on the second runner still fails the final check', async () => {
  const primary = await collect(async () => new Response(null, { status: 503 }));
  const results = await resumeLinkReport(primary, urls, revision, {
    request: async () => new Response(null, { status: 503 }), pause: noPause,
  });
  assert.equal(results.every(r => r.attempts === 5 && r.history.length === 5), true);
  assert.equal(summarizeLinks(results).exitCode, 1);
});

test('complete healthy results do not cause another network check', async () => {
  const primary = await collect(async () => new Response(null, { status: 200 }));
  const results = await resumeLinkReport(primary, urls, revision, {
    request: async () => assert.fail('healthy links have already been checked'),
  });
  assert.equal(summarizeLinks(results).exitCode, 0);
  assert.equal(results.length, urls.length);
});

test('missing, duplicate, malformed and mismatched reports fail closed', async () => {
  const primary = await collect(async () => new Response(null, { status: 200 }));
  const invalid = [null, {}, { ...primary, version: 2 }, { ...primary, revision: 'different-revision' },
    { ...primary, results: primary.results.slice(1) },
    { ...primary, results: [primary.results[0], primary.results[0]] },
    { ...primary, results: [primary.results[0], { ...primary.results[1], url: 'https://unknown.example/' }] },
    { ...primary, results: [primary.results[0], { ...primary.results[1], attempts: 0 }] },
    { ...primary, results: [primary.results[0], { ...primary.results[1], status: 0, error: undefined }] },
  ];
  for (const report of invalid) {
    assert.throws(() => validateLinkReport(report, urls, revision), /Invalid link report/);
    await assert.rejects(() => resumeLinkReport(report, urls, revision, {
      request: async () => assert.fail('invalid reports cannot reach the network'),
    }), /Invalid link report/);
  }
});

test('Retry-After remains binding across runners, including unvisited URLs on that origin', async () => {
  const sameOrigin = [urls[0], `${urls[0]}other`];
  const results = await auditLinks(sameOrigin, {
    now: () => 0, timeoutMs: 60_000, retryDelays: [],
    request: async () => new Response(null, { status: 429, headers: { 'Retry-After': '3600' } }),
  });
  const primary = createLinkReport(results, sameOrigin, revision);
  const final = await resumeLinkReport(primary, sameOrigin, revision, {
    now: () => 60_000, timeoutMs: 60_000, retryDelays: [],
    request: async () => assert.fail('moving runners must not bypass Retry-After'),
  });
  assert.equal(final[0].status, 429);
  assert.equal(final[1].attempts, 0);
  assert.equal(summarizeLinks(final).failed.length, 2);
});

test('URLs unvisited within the primary budget must be checked by the final job', async () => {
  const primary = createLinkReport(await auditLinks(urls, { timeoutMs: 0 }), urls, revision);
  const results = await resumeLinkReport(primary, urls, revision, {
    request: async target => new Response(null, { status: target === urls[0] ? 200 : 410 }),
  });
  assert.equal(results.length, urls.length);
  assert.equal(results.every(r => r.attempts === 1), true);
  assert.equal(summarizeLinks(results).failed[0].status, 410);
});
