/**
 * MP-SEC-11 — secret redaction helpers for IPC responses.
 *
 * The renderer never needs raw secrets: it displays masked values and sends
 * new/updated secrets through narrow write-only channels. These helpers
 * convert raw secret strings into safe view objects.
 */

/**
 * Masked projection of a stored secret. Only enough information to
 * render "configured ••••abcd" in the renderer — the raw value never
 * crosses the IPC boundary through this type.
 */
export interface SecretView {
  /** True when a secret exists for this slot. */
  configured: boolean;
  /** Last 4 characters of the stored secret, for masked display. */
  last4?: string;
}

/** Marker string returned when no secret is stored. */
export const NO_SECRET: SecretView = { configured: false };

/**
 * Convert a raw secret into a redacted view. Never returns the raw value.
 * Non-string/empty values collapse to NO_SECRET.
 */
export function toSecretView(secret: unknown): SecretView {
  if (typeof secret !== 'string' || secret.trim().length === 0) {
    // Copy the sentinel: a fresh object per call so no caller can mutate
    // the shared NO_SECRET constant and poison every other view.
    return { ...NO_SECRET };
  }
  const trimmed = secret.trim();
  return { configured: true, last4: trimmed.slice(-4) };
}

/**
 * Replace every secret-shaped string value in a config tree with its redacted
 * view. Keys considered secret-bearing are matched by name (case-sensitive
 * substrings: apiKey, botToken, deepgramKey, elevenlabsKey, exaApiKey,
 * firecrawlApiKey, token, secret, password) or by a `keys` record whose values
 * are raw provider secrets.
 *
 * The input object is deep-copied first — the original (with raw secrets)
 * stays usable by main-process callers.
 *
 * Fail-safe by construction: on any structural surprise (arrays, nulls,
 * non-objects) the value is either recursed into or passed through, and
 * only string values at secret-named keys are ever converted.
 */
// Suffix-anchored: matches only keys ENDING in these words (optionally
// prefixed by _ or word start), so fields like "secretsPolicy" or
// "tokenCount" are NOT redacted. No false negatives: keys that literally
// end in token/secret/apiKey/etc. are always treated as secrets.
const SECRET_KEY_RE = /(?:^|_)(?:apiKey|botToken|deepgramKey|elevenlabsKey|exaApiKey|firecrawlApiKey|token|secret|password)$/i;

/**
 * Deep-clone `config`, redacting all secret values along the way.
 * @param config  Arbitrary config tree (typically config.json as loaded).
 * @returns A structurally parallel tree where secret strings are replaced
 *          by SecretView objects; non-secret leaves pass through intact.
 * Never returns (or retains) raw secret values for matched keys, so the
 * result is safe to hand to the renderer over IPC.
 */
export function redactConfigSecrets<T>(config: T): T {
  if (config === null || typeof config !== 'object') return config;

  if (Array.isArray(config)) {
    return config.map((v) => redactConfigSecrets(v)) as unknown as T;
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config as Record<string, unknown>)) {
    if (key === 'keys' && value && typeof value === 'object' && !Array.isArray(value)) {
      // Provider key store: value map of raw secrets. Every value is
      // treated as secret regardless of the provider name, since this
      // record exists solely to hold raw provider keys.
      const redactedKeys: Record<string, SecretView> = {};
      for (const [provider, secret] of Object.entries(value as Record<string, unknown>)) {
        redactedKeys[provider] = toSecretView(secret);
      }
      out[key] = redactedKeys;
      continue;
    }
    if (typeof value === 'string' && SECRET_KEY_RE.test(key)) {
      // Secret-named string: redact in place, keep only last4.
      out[key] = toSecretView(value);
      continue;
    }
    if (value && typeof value === 'object') {
      // Non-secret-bearing object/array: recurse so nested secrets
      // (e.g. integrations[i].botToken) are still caught.
      out[key] = redactConfigSecrets(value);
      continue;
    }
    out[key] = value;
  }
  return out as T;
}

// ── MP-SEC-11: free-text secret scrubbing ──────────────────────────────────
//
// redactConfigSecrets covers secret-NAMED keys, but free-text fields
// (feedback reasons, pasted conversation text) can carry token-shaped
// secrets in prose. redactSecretText replaces those substrings so a pasted
// key never reaches disk in a feedback entry.

/** Token-shaped secrets that can appear inside free text. */
const SECRET_TOKEN_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,                      // OpenAI / OpenRouter style keys
  /\bnvapi-[A-Za-z0-9_-]{8,}\b/g,                   // NVIDIA style keys
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,  // GitHub PATs
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,              // GitHub fine-grained PATs
  /\bAIza[0-9A-Za-z_-]{20,}\b/g,                    // Google API keys
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,              // Slack tokens
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,           // Authorization header values
];

/**
 * Replace every token-shaped secret substring in free text with
 * '[REDACTED]'. Non-string/empty inputs pass through unchanged.
 */
export function redactSecretText(text: string): string {
  if (typeof text !== 'string' || text.length === 0) return text;
  let out = text;
  for (const pattern of SECRET_TOKEN_PATTERNS) {
    out = out.replace(pattern, '[REDACTED]');
  }
  return out;
}
