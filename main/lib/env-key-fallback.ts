/**
 * AI-KEYS-01 — centralised registry for env-var API-key fallbacks.
 *
 * Several main-process sites fall back to environment variables when no key
 * is stored in ~/.everfern (config.json / keys/). Those fallbacks were
 * previously undocumented and silent; this module makes the registry
 * explicit and provides a warn-once helper so operators can tell when an
 * env fallback is actually live (last4 only — never full key values).
 */

import { toSecretView } from './secret-redaction';

/** provider id → environment variable name providing its fallback key. */
export const ENV_KEY_PROVIDERS: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  groq: 'GROQ_API_KEY',
  gemini: 'GEMINI_API_KEY',
  everfern: 'EVERFERN_API_KEY',
  'embeddings-openai': 'OPENAI_API_KEY',
  deepgram: 'DEEPGRAM_API_KEY',
};

/** Snapshot of one live env fallback: provider, env var, and last4 only — never the full key. */
interface ActiveEnvKeyFallback {
  provider: string;
  envVar: string;
  last4: string;
}

/**
 * Providers whose env-var fallback is currently set AND non-empty.
 * last4 is derived via secret-redaction; the raw value never leaves here.
 */
export function getActiveEnvKeyFallbacks(): ActiveEnvKeyFallback[] {
  const active: ActiveEnvKeyFallback[] = [];
  for (const [provider, envVar] of Object.entries(ENV_KEY_PROVIDERS)) {
    const raw = process.env[envVar];
    if (typeof raw === 'string' && raw.trim().length > 0) {
      // Redact to last4 before anything leaves this module so the raw key
      // never reaches logs or callers.
      const view = toSecretView(raw);
      active.push({ provider, envVar, last4: view.last4 ?? '' });
    }
  }
  return active;
}

// Process-lifetime idempotency guard: startup probes fire repeatedly, but
// each provider should warn at most once per process run.
const warnedProviders = new Set<string>();

/**
 * Warn once per provider that its env-var fallback is active.
 * Idempotent per provider: subsequent calls for the same provider are no-ops.
 * Called with no provider, warns for every currently-active provider.
 */
export function warnOnceEnvKeyFallback(provider?: string): void {
  if (provider === undefined) {
    for (const { provider: p } of getActiveEnvKeyFallbacks()) {
      warnOnceEnvKeyFallback(p);
    }
    return;
  }
  const envVar = ENV_KEY_PROVIDERS[provider];
  if (!envVar || warnedProviders.has(provider)) return;
  const raw = process.env[envVar];
  if (typeof raw !== 'string' || raw.trim().length === 0) return;
  const view = toSecretView(raw);
  console.warn(
    `[Keys] Env-var fallback active: ${provider} (${envVar} …${view.last4 ?? ''}). ` +
    'File keys in ~/.everfern/keys take precedence when present.'
  );
  warnedProviders.add(provider);
}

/**
 * Warn once for every currently-active env fallback (all providers).
 * Delegates to warnOnceEnvKeyFallback so each provider warns at most once
 * per process regardless of which entry point fires first.
 */
export function warnOnceEnvKeyFallbacks(): void {
  for (const { provider } of getActiveEnvKeyFallbacks()) {
    warnOnceEnvKeyFallback(provider);
  }
}
