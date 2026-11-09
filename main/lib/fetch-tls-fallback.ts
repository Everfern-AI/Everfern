/**
 * Electron's Node runtime uses BoringSSL, which rejects some valid certificate chains
 * (for example Let's Encrypt's newer "Root YE" chain served by api.everfern.app) with
 * CERT_HAS_EXPIRED, while Chromium's own network stack accepts them.
 *
 * Wrap the global fetch so a certificate failure is retried once over Electron's
 * net.fetch (Chromium stack, OS certificate verification). A TLS failure happens
 * before the request is sent, so the retry cannot duplicate a POST.
 *
 * Import this before anything that captures globalThis.fetch.
 */
import { net } from 'electron';

const CERT_ERROR = /CERT|SSL|TLS|UNABLE_TO_VERIFY|SELF_SIGNED/i;

function certFailure(err: any) {
  const code = String(err?.cause?.code ?? err?.code ?? '');
  const msg = String(err?.cause?.message ?? '');
  return CERT_ERROR.test(code) || CERT_ERROR.test(msg);
}

const nodeFetch: typeof fetch | undefined = globalThis.fetch?.bind(globalThis);

if (nodeFetch && !(globalThis as any).__efFetchPatched) {
  (globalThis as any).__efFetchPatched = true;
  // Hosts whose chain Node rejected once go straight to net.fetch afterwards.
  const viaNet = new Set<string>();
  const hostOf = (input: any) => {
    try { return new URL(typeof input === 'string' ? input : input?.url ?? String(input)).host; } catch { return ''; }
  };
  const chromium = (input: any, init?: any) => {
    // net.fetch rejects the Node-only keepalive/dispatcher options, so pass the standard ones.
    const { keepalive, dispatcher, ...rest } = init ?? {};
    return net.fetch(input, rest);
  };
  globalThis.fetch = (async (input: any, init?: any) => {
    const host = hostOf(input);
    if (host && viaNet.has(host)) return chromium(input, init);
    try {
      return await nodeFetch(input, init);
    } catch (err) {
      if (!certFailure(err)) throw err;
      const url = typeof input === 'string' ? input : input?.url ?? String(input);
      console.warn(`[fetch] Node TLS rejected ${url.split('?')[0]} (${(err as any)?.cause?.code}); retrying over Chromium net`);
      if (host) viaNet.add(host);
      return chromium(input, init);
    }
  }) as typeof fetch;
}
