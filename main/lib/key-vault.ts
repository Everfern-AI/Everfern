/**
 * MP-SEC-11 — encrypted-at-rest key vault.
 *
 * Secrets live in ~/.everfern/vault.json, encrypted with Electron
 * safeStorage (Keychain / DPAPI / libsecret). When safeStorage is
 * unavailable (plain Linux without a keyring, or unit tests running
 * outside Electron), the vault falls back to plaintext entries written
 * with 0600 permissions and warns once.
 *
 * Slot naming:
 *  - provider key slots: the provider name, e.g. "openai" (legacy
 *    ~/.everfern/keys/<slot>.key files are migrated into the vault on
 *    first write and the legacy file is removed).
 *  - VLM provider slots: "vlm-<provider>", mirroring the legacy key
 *    file naming.
 *  - generic path slots: dotted paths into config.json, e.g.
 *    "embedding.apiKey", "voice.deepgramKey", "voice.elevenlabsKey".
 *
 * The module never imports electron at top level (lazy require) so it
 * stays loadable in vitest without an Electron runtime.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * On-disk vault schema (vault.json). `version` gates future format
 * migrations; entries are keyed by slot name.
 */
interface KeyVault {
  version: number;
  entries: Record<string, VaultEntry>;
}

/**
 * One stored secret. Invariant: exactly one of `enc` (written via
 * safeStorage) or `plain` (fallback) is set — never both, never neither.
 */
interface VaultEntry {
  /** safeStorage-encrypted payload, base64. */
  enc?: string;
  /** Plaintext fallback (used when safeStorage unavailable). */
  plain?: string;
  /** True once migrated from a legacy keys/<slot>.key file. */
  migrated?: boolean;
}

/**
 * Structural slice of Electron's safeStorage API — duck-typed so this
 * module (and tests) never needs electron's typings at load time.
 */
interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

// Tri-state probe result: undefined = not probed yet, null = probed and
// unavailable (no Electron / no keyring backend), object = live API.
let safeStorageCache: SafeStorageLike | null | undefined;

/**
 * Resolve Electron's safeStorage exactly once per process. Returns null
 * outside Electron (e.g. vitest) — every caller must treat null as
 * "use the plaintext fallback".
 */
function getSafeStorage(): SafeStorageLike | null {
  if (safeStorageCache !== undefined) return safeStorageCache;
  try {
    // Lazy require: keeps vitest (no Electron) working.
    const electron = require('electron');
    safeStorageCache = (electron.safeStorage as SafeStorageLike) ?? null;
  } catch {
    safeStorageCache = null;
  }
  return safeStorageCache;
}

/** Test hook: force the plaintext fallback path. */
export function setSafeStorageForTests(fake: SafeStorageLike | null): void {
  safeStorageCache = fake;
}

// ── Vault file location ───────────────────────────────────────────

/**
 * Resolve the ~/.everfern directory. Honors the test override first so
 * tests can point the vault (and legacy key migration) at a sandbox.
 */
function vaultDir(): string {
  return path.join(homeDirOverride ?? os.homedir(), '.everfern');
}

let homeDirOverride: string | null = null;

/**
 * Test hook: redirect ~/.everfern resolution. Also drops the vault
 * cache so subsequent loads read from the redirected location.
 */
export function setHomeDirForTests(p: string | null): void {
  homeDirOverride = p;
  cache = null;
}

function vaultPath(): string {
  return path.join(vaultDir(), 'vault.json');
}

let vaultPathOverride: string | null = null;

/**
 * Test hook: redirect the vault file. Any redirect also drops the vault
 * cache so the next read sees the new file, not a stale in-memory copy.
 */
export function setVaultPathForTests(p: string | null): void {
  vaultPathOverride = p;
  cache = null;
}

/**
 * Final vault.json location: explicit override wins over the default
 * ~/.everfern/vault.json so tests never touch the real vault.
 */
function resolvedVaultPath(): string {
  return vaultPathOverride ?? vaultPath();
}

/**
 * Pre-vault storage layout: ~/.everfern/keys/<slot>.key. setVaultSecret
 * deletes these after a successful vault write to complete migration.
 */
function legacyKeyPath(slot: string): string {
  return path.join(vaultDir(), 'keys', `${slot}.key`);
}

// ── Load / save (atomic) ──────────────────────────────────────────

// In-memory vault mirror. Only entry metadata (ciphertext or plaintext
// fallback) is cached — secrets are decrypted per read, never held in
// this cache in raw form beyond what the file itself contains.
let cache: KeyVault | null = null;
// Guards the one-time plaintext-fallback console warning so we don't
// spam the log on every write when safeStorage is unavailable.
let warnedPlaintextFallback = false;

/**
 * Slots must be provider names, "vlm-<provider>", or dotted config
 * paths (e.g. "embedding.apiKey"). The strict charset also makes the
 * slot safe to interpolate into the legacy keys/<slot>.key filename.
 */
export const SLOT_RE = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Load (and memoize) the vault. A corrupt or unreadable vault is
 * deliberately replaced with an empty one rather than crashing the
 * app — losing keys is recoverable; a bricked boot loop is not.
 * The empty cache also means the next write overwrites the bad file.
 */
function loadVault(): KeyVault {
  if (cache) return cache;
  const p = resolvedVaultPath();
  try {
    if (fs.existsSync(p)) {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
      cache = { version: 1, entries: parsed?.entries ?? {} };
    } else {
      cache = { version: 1, entries: {} };
    }
  } catch (err) {
    console.error('[Vault] Failed to read vault — starting empty:', err);
    cache = { version: 1, entries: {} };
  }
  return cache;
}

/**
 * Persist the vault atomically: write to a pid+timestamp-unique temp
 * file (mode 0600 so the plaintext fallback is never world-readable),
 * then rename over the target. Rename is atomic on POSIX/Win32, so a
 * crash mid-write can never leave a truncated or missing vault.
 */
function saveVault(vault: KeyVault): void {
  const p = resolvedVaultPath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // Unique temp name avoids collisions between concurrent writers.
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(vault, null, 2), { mode: 0o600 });
  try {
    fs.renameSync(tmp, p);
    try {
      // Re-assert 0600: rename can inherit the old file's (looser) mode.
      fs.chmodSync(p, 0o600);
    } catch {
      /* best effort (platform-dependent) */
    }
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw err;
  }
}

// ── Encrypt / decrypt ─────────────────────────────────────────────

/**
 * Warn once (per process) that secrets land on disk as plaintext.
 * Acceptable only because the fallback also enforces 0600 perms.
 */
function warnPlaintextFallbackOnce(): void {
  if (warnedPlaintextFallback) return;
  warnedPlaintextFallback = true;
  console.warn(
    '[Vault] safeStorage unavailable — storing secrets as plaintext with 0600 permissions.'
  );
}

/**
 * Encrypt via safeStorage (Keychain/DPAPI/libsecret) when available.
 * Any failure — missing backend or a thrown encryptString — degrades
 * to a `plain` entry rather than losing the secret entirely.
 */
function encryptEntry(plain: string): VaultEntry {
  const ss = getSafeStorage();
  if (ss && ss.isEncryptionAvailable()) {
    try {
      return { enc: ss.encryptString(plain).toString('base64') };
    } catch (err) {
      console.error('[Vault] encryptString failed — falling back to plaintext:', err);
      warnPlaintextFallbackOnce();
      return { plain };
    }
  }
  warnPlaintextFallbackOnce();
  return { plain };
}

/**
 * Decrypt an entry. Returns null (never throws) when an encrypted
 * entry can't be decrypted — e.g. the OS keyring changed or we're in
 * a non-Electron runtime — so callers treat it as "secret missing".
 */
function decryptEntry(entry: VaultEntry): string | null {
  if (typeof entry.enc === 'string') {
    const ss = getSafeStorage();
    if (!ss) {
      // Ciphertext written under a different runtime (e.g. real app,
      // now under vitest): impossible to decrypt without the backend.
      console.error('[Vault] Encrypted entry but safeStorage unavailable — cannot decrypt.');
      return null;
    }
    try {
      return ss.decryptString(Buffer.from(entry.enc, 'base64'));
    } catch (err) {
      console.error('[Vault] decryptString failed:', err);
      return null;
    }
  }
  if (typeof entry.plain === 'string') return entry.plain;
  // Neither field set: corrupt entry — treat as absent.
  return null;
}

/**
 * Encrypt a secret for storage inside a THIRD-party file (e.g.
 * integration-config.json botTokenEnc fields, tool-settings.json).
 * Returns "enc:<base64>" or "plain:<value>" so callers can keep the
 * value inside their own JSON with a self-describing marker.
 */
export function vaultEncryptString(plain: string): string {
  const entry = encryptEntry(plain);
  return entry.enc !== undefined ? `enc:${entry.enc}` : `plain:${entry.plain}`;
}

/** Inverse of vaultEncryptString; null when undecryptable. */
export function vaultDecryptString(payload: string): string | null {
  if (typeof payload !== 'string' || payload.length === 0) return null;
  if (payload.startsWith('enc:')) {
    return decryptEntry({ enc: payload.slice(4) });
  }
  if (payload.startsWith('plain:')) {
    return payload.slice(6);
  }
  // Legacy plaintext value without marker — return as-is (migrate on write).
  // Safe because even undecryptable payloads surface only through the
  // same trusted main-process paths that handled them pre-vault.
  return payload;
}

// ── Public vault API ──────────────────────────────────────────────

/**
 * Store (or clear) a secret for a slot, persisting the vault atomically.
 * @param slot  Slot name matching SLOT_RE — invalid names throw before
 *              any disk write, so a bad slot can never corrupt the vault
 *              or probe unexpected legacy paths.
 * @param value Secret; empty/whitespace-only deletes the slot.
 * Side-effects: writes vault.json; deletes a legacy keys/<slot>.key file
 * (even when clearing — the file must not resurrect a cleared secret).
 */
export function setVaultSecret(slot: string, value: string): void {
  if (!SLOT_RE.test(slot)) {
    throw new Error(`Invalid vault slot: ${slot}`);
  }
  const vault = loadVault();
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed.length === 0) {
    if (vault.entries[slot]) {
      delete vault.entries[slot];
      saveVault(vault);
    }
  } else {
    vault.entries[slot] = encryptEntry(trimmed);
    saveVault(vault);
  }
  // Legacy migration: remove the plaintext key file once vaulted.
  // Runs even on the clear-path so a stale file can't shadow the clear.
  const legacy = legacyKeyPath(slot);
  try {
    if (fs.existsSync(legacy)) fs.unlinkSync(legacy);
  } catch (err) {
    console.warn(`[Vault] Failed to remove legacy key file for ${slot}:`, err);
  }
}

/**
 * Read a secret from the vault. Null for a missing slot, an invalid
 * slot name, or an entry that can no longer be decrypted — callers
 * must handle null as "not configured" rather than erroring.
 */
export function getVaultSecret(slot: string): string | null {
  if (!SLOT_RE.test(slot)) return null;
  const entry = loadVault().entries[slot];
  if (!entry) return null;
  return decryptEntry(entry);
}

/** True when the vault holds a (decryptable) secret for the slot. */
export function hasVaultSecret(slot: string): boolean {
  return getVaultSecret(slot) !== null;
}

/** Remove a slot from the vault (and its legacy key file). */
export function clearVaultSecret(slot: string): void {
  setVaultSecret(slot, '');
}

/**
 * Overlay vault provider slots onto a legacy keys record. Vault entries
 * take precedence; undecryptable entries are skipped so an unreadable
 * vault can't wipe out still-valid legacy keys. The input is not mutated.
 */
export function overlayVaultKeys(keys: Record<string, string>): Record<string, string> {
  const vault = loadVault();
  const out: Record<string, string> = { ...keys };
  for (const slot of Object.keys(vault.entries)) {
    const value = decryptEntry(vault.entries[slot]);
    if (value !== null) out[slot] = value;
  }
  return out;
}

/**
 * Hydrate generic dotted-path slots (e.g. embedding.apiKey,
 * voice.deepgramKey) from the vault into a config object, in place.
 * Main-process consumers keep seeing raw hydrated configs.
 */
export function hydrateVaultGenericSlots(config: Record<string, any>): void {
  if (!config || typeof config !== 'object') return;
  const vault = loadVault();
  for (const slot of Object.keys(vault.entries)) {
    // Dotted slots are the generic-path namespace; non-dotted slots
    // (provider keys) are handled by overlayVaultKeys instead.
    if (!slot.includes('.')) continue;
    const value = decryptEntry(vault.entries[slot]);
    // Skip undecryptable entries rather than overwriting the config
    // value with undefined — a bad keyring must not blank config keys.
    if (value === null) continue;
    const parts = slot.split('.');
    let node: Record<string, any> = config;
    // Walk to the parent of the leaf key, creating intermediate
    // objects as needed (e.g. voice.deepgramKey implies config.voice).
    let ok = true;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      if (!node[seg] || typeof node[seg] !== 'object') {
        node[seg] = {};
      }
      node = node[seg];
    }
    if (ok) node[parts[parts.length - 1]] = value;
  }
}

/** Slots currently holding secrets (for diagnostics/tests). */
export function listVaultSlots(): string[] {
  return Object.keys(loadVault().entries);
}

/** Test hook: drop the in-memory cache. */
export function resetVaultCacheForTests(): void {
  cache = null;
  warnedPlaintextFallback = false;
}
