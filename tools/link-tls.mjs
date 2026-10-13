import { readFileSync } from 'node:fs';
import { rootCertificates } from 'node:tls';
import { Agent, Pool } from 'undici';

const certificate = (name) => readFileSync(new URL(`./certificates/${name}`, import.meta.url), 'utf8');
const geant = certificate('geant-tls-rsa-1.pem');
const sectigo = certificate('sectigo-ov-r36.pem');
const intermediates = new Map([
  ['itise.ugr.es', geant],
  ['www.causeweb.org', sectigo],
  ['causeweb.org', sectigo],
]);

export function linkTlsOptions(hostname) {
  const intermediate = intermediates.get(hostname);
  return {
    rejectUnauthorized: true,
    // Complete these servers' missing chains, but still require a trusted root.
    // Never trust an intermediate as a root or bypass hostname/expiry checks.
    allowPartialTrustChain: false,
    ...(intermediate ? { ca: [...rootCertificates, intermediate] } : {}),
  };
}

export function createLinkDispatcher() {
  return new Agent({
    // Choose TLS settings per destination, including after redirects.
    factory: (origin, options) => new Pool(origin, {
      ...options,
      connect: linkTlsOptions(new URL(origin).hostname),
    }),
  });
}
