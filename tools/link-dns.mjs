import { lookup as systemLookup } from 'node:dns';
import { isIP } from 'node:net';

const retryable = new Set(['EAI_AGAIN', 'ENOTFOUND', 'ETIMEOUT']);
const dnsError = (code, hostname) => Object.assign(new Error(`${code}: DNS lookup for ${hostname}`), { code, hostname });

export function createLinkLookup({
  lookup = systemLookup, request = fetch, systemTimeoutMs = 3_000, fallbackTimeoutMs = 5_000,
  onFallback = () => {},
} = {}) {
  async function resolve(hostname, options) {
    let timer;
    let originalError;
    try {
      return await Promise.race([
        new Promise((resolve, reject) => lookup(hostname, { ...options, all: true }, (error, addresses) => {
          if (error) reject(error); else resolve(addresses);
        })),
        new Promise((_, reject) => { timer = setTimeout(() => reject(dnsError('ETIMEOUT', hostname)), systemTimeoutMs); }),
      ]);
    } catch (error) {
      if (!retryable.has(error.code)) throw error;
      originalError = error;
    } finally {
      clearTimeout(timer);
    }

    // Only retry name resolution. The original URL, HTTP status and TLS identity
    // are still checked normally; an address alone never establishes link health.
    const families = options.family ? [options.family] : [4, 6];
    const outcomes = await Promise.allSettled(families.map(async family => {
      const type = family === 6 ? 28 : 1;
      const query = new URL('https://dns.google/resolve');
      query.search = new URLSearchParams({ name: hostname, type: String(type), edns_client_subnet: '0.0.0.0/0' });
      const response = await request(query, { signal: AbortSignal.timeout(fallbackTimeoutMs), redirect: 'error' });
      try {
        if (!response.ok) throw dnsError('EAI_AGAIN', hostname);
        const data = await response.json();
        if (data.Status === 3) return []; // The public resolver also reports NXDOMAIN.
        if (data.Status !== 0 || data.TC) throw dnsError('EAI_AGAIN', hostname);
        const addresses = (data.Answer ?? []).filter(record => record.type === type);
        if (addresses.some(record => isIP(record.data) !== family)) throw dnsError('EAI_AGAIN', hostname);
        return addresses.map(record => ({ address: record.data, family }));
      } finally {
        await response.body?.cancel().catch(() => {});
      }
    }));
    const addresses = outcomes.filter(result => result.status === 'fulfilled').flatMap(result => result.value);
    if (!addresses.length) {
      throw dnsError(outcomes.some(result => result.status === 'rejected') ? 'EAI_AGAIN' : 'ENOTFOUND', hostname);
    }
    if (options.order === 'ipv6first') addresses.sort((a, b) => b.family - a.family);
    onFallback(hostname, originalError.code);
    return addresses;
  }

  return (hostname, options, callback) => {
    const settings = typeof options === 'number' ? { family: options } : (options ?? {});
    resolve(hostname, settings).then(addresses => {
      if (settings.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    }, callback);
  };
}
