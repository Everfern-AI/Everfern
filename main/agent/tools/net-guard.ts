/**
 * Keeps worker web requests off this computer and its local network.
 * Workers read untrusted pages; web_fetch runs on the host, not in the worker's VM,
 * so without this a page could steer a worker at the router, a dev server or
 * the cloud metadata address.
 */
import { isIP } from 'net';
import { lookup } from 'dns/promises';

/** True for an IP address on this computer, a private or link-local network, or multicast. */
export function isPrivateAddress(ip: string): boolean {
  const host = ip.toLowerCase().replace(/^\[|\]$/g, '');
  const v = isIP(host);
  if (v === 4) {
    const [a, b] = host.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (v === 6) {
    const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return host === '::' || host === '::1' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith('ff');
  }
  return false;
}

/** True for a URL that names a local or private place (judged from the URL alone, no DNS). */
export function isPrivateUrl(raw: unknown): boolean {
  let url: URL;
  try { url = new URL(String(raw ?? '')); } catch { return false; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return true;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan') || host.endsWith('.home.arpa')) return true;
  if (isIP(host)) return isPrivateAddress(host);
  // A bare number is an IPv4 address in disguise (http://2130706433/ is 127.0.0.1).
  return /^(0x[0-9a-f]+|\d+)$/.test(host);
}

/** Throws when the URL, or any address its host name resolves to, is local or private. */
export async function assertPublicUrl(raw: string): Promise<void> {
  if (isPrivateUrl(raw)) throw new Error('Workers cannot fetch addresses on this computer or its local network.');
  const host = new URL(raw).hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return;
  let addrs: { address: string }[];
  try { addrs = await lookup(host, { all: true }); } catch { throw new Error(`Could not find ${host}.`); }
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new Error(`${host} points to an address on a local network, which workers cannot fetch.`);
}

/**
 * fetch() that checks every hop: redirects are followed by hand (at most 5) and each
 * target is checked before it is requested.
 */
export async function fetchPublicOnly(url: string, init: RequestInit = {}): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= 5; hop++) {
    await assertPublicUrl(current);
    const res = await fetch(current, { ...init, redirect: 'manual' });
    const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!loc) return res;
    current = new URL(loc, current).toString();
  }
  throw new Error('Too many redirects.');
}
