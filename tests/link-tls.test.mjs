import test from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { rootCertificates } from 'node:tls';
import { linkTlsOptions } from '../tools/link-tls.mjs';

const roots = rootCertificates.map(pem => new X509Certificate(pem));

test('supplemental certificates are valid intermediates signed by existing public roots', () => {
  for (const host of ['itise.ugr.es', 'www.causeweb.org', 'causeweb.org']) {
    const options = linkTlsOptions(host);
    const intermediate = new X509Certificate(options.ca.at(-1));
    assert.deepEqual(options.ca.slice(0, -1), rootCertificates, 'do not add new trust anchors');
    assert.ok(intermediate.ca);
    assert.notEqual(intermediate.subject, intermediate.issuer, 'do not trust a new self-signed root');
    assert.ok(roots.some(root => intermediate.checkIssued(root) && intermediate.verify(root.publicKey)), host);
    assert.ok(Date.parse(intermediate.validFrom) <= Date.now());
    assert.ok(Date.parse(intermediate.validTo) > Date.now(), `${host}: intermediate has expired`);
    assert.equal(options.rejectUnauthorized, true);
    assert.equal(options.allowPartialTrustChain, false);
    assert.equal(options.checkServerIdentity, undefined, 'keep the default hostname verification');
  }
});

test('unrelated hosts and lookalike domains retain the default trust store', () => {
  for (const host of ['example.org', 'itise.ugr.es.example.org', 'www.causeweb.org.example.org']) {
    assert.deepEqual(linkTlsOptions(host), { rejectUnauthorized: true, allowPartialTrustChain: false });
  }
});
