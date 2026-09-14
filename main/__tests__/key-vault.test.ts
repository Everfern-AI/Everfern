/**
 * MP-SEC-11 tests — key vault: encrypted storage, atomic writes,
 * legacy keys/*.key migration, plaintext fallback, slot validation,
 * and the in-file encrypt/decrypt helpers used by integration config.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SLOT_RE,
  clearVaultSecret,
  getVaultSecret,
  hasVaultSecret,
  hydrateVaultGenericSlots,
  listVaultSlots,
  overlayVaultKeys,
  resetVaultCacheForTests,
  setHomeDirForTests,
  setSafeStorageForTests,
  setVaultPathForTests,
  setVaultSecret,
  vaultDecryptString,
  vaultEncryptString,
} from '../lib/key-vault';

const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (p: string) => Buffer.from(`E(${p})`),
  decryptString: (b: Buffer) => b.toString().replace(/^E\(|\)$/g, ''),
};

let tmpHome: string;
let vaultFile: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'everfern-vault-'));
  vaultFile = path.join(tmpHome, 'vault.json');
  resetVaultCacheForTests();
  setVaultPathForTests(vaultFile);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  setSafeStorageForTests(null);
  setVaultPathForTests(null);
  resetVaultCacheForTests();
});

describe('key-vault slot validation', () => {
  it('rejects invalid slot names', () => {
    expect(() => setVaultSecret('../../etc/evil', 'x')).toThrow(/Invalid vault slot/);
    expect(() => setVaultSecret('a'.repeat(65), 'x')).toThrow(/Invalid vault slot/);
    expect(() => setVaultSecret('bad slot!', 'x')).toThrow(/Invalid vault slot/);
    expect(getVaultSecret('../../etc/evil')).toBeNull();
  });

  it('accepts dotted and vlm- slot names', () => {
    setSafeStorageForTests(fakeSafeStorage);
    setVaultSecret('embedding.apiKey', 'sk-abc');
    setVaultSecret('vlm-openai', 'sk-def');
    setVaultSecret('openai', 'sk-ghi');
    expect(getVaultSecret('embedding.apiKey')).toBe('sk-abc');
    expect(getVaultSecret('vlm-openai')).toBe('sk-def');
    expect(getVaultSecret('openai')).toBe('sk-ghi');
    expect(SLOT_RE.test('vlm-ollama-cloud')).toBe(true);
  });
});

describe('key-vault encrypted storage', () => {
  it('encrypts via safeStorage and persists encrypted', () => {
    setSafeStorageForTests(fakeSafeStorage);
    setVaultSecret('openai', 'sk-live-secret');
    const raw = fs.readFileSync(vaultFile, 'utf8');
    expect(raw).not.toContain('sk-live-secret');
    // Fresh read from disk (cache dropped) still decrypts.
    resetVaultCacheForTests();
    expect(getVaultSecret('openai')).toBe('sk-live-secret');
  });

  it('falls back to plaintext with 0600 and warns once', () => {
    setSafeStorageForTests(null);
    setVaultSecret('openai', 'sk-plain-a');
    setVaultSecret('everfern', 'sk-plain-b');
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(getVaultSecret('openai')).toBe('sk-plain-a');
    resetVaultCacheForTests();
    expect(getVaultSecret('everfern')).toBe('sk-plain-b');
    if (process.platform !== 'win32') {
      expect(fs.statSync(vaultFile).mode & 0o777).toBe(0o600);
    }
  });

  it('empty value clears the slot', () => {
    setSafeStorageForTests(fakeSafeStorage);
    setVaultSecret('openai', 'k');
    expect(hasVaultSecret('openai')).toBe(true);
    clearVaultSecret('openai');
    expect(hasVaultSecret('openai')).toBe(false);
    expect(listVaultSlots()).toEqual([]);
  });
});

describe('key-vault legacy migration', () => {
  it('removes legacy keys/<slot>.key after vaulting', () => {
    setHomeDirForTests(tmpHome);
    // Legacy layout: ~/.everfern/keys/<slot>.key
    const keysDir = path.join(tmpHome, '.everfern', 'keys');
    fs.mkdirSync(keysDir, { recursive: true });
    const legacyFile = path.join(keysDir, 'openai.key');
    fs.writeFileSync(legacyFile, 'legacy-plaintext-key');

    setVaultSecret('openai', 'vault-secret');
    expect(fs.existsSync(legacyFile)).toBe(false);
    expect(getVaultSecret('openai')).toBe('vault-secret');
    setHomeDirForTests(null);
  });
});

describe('vaultEncryptString / vaultDecryptString', () => {
  it('round-trips enc: markers', () => {
    setSafeStorageForTests(fakeSafeStorage);
    const payload = vaultEncryptString('bot-token-123');
    expect(payload.startsWith('enc:')).toBe(true);
    expect(payload).not.toContain('bot-token-123');
    expect(vaultDecryptString(payload)).toBe('bot-token-123');
  });

  it('round-trips plaintext fallback markers', () => {
    setSafeStorageForTests(null);
    const payload = vaultEncryptString('tok');
    expect(payload).toBe('plain:tok');
    expect(vaultDecryptString(payload)).toBe('tok');
  });

  it('treats marker-less legacy values as plaintext', () => {
    expect(vaultDecryptString('legacy-raw')).toBe('legacy-raw');
    expect(vaultDecryptString('')).toBeNull();
  });
});

describe('overlayVaultKeys / hydrateVaultGenericSlots', () => {
  it('vault entries win over legacy keys map', () => {
    setSafeStorageForTests(fakeSafeStorage);
    setVaultSecret('openai', 'vault-openai');
    const merged = overlayVaultKeys({ openai: 'legacy', anthropic: 'keep' });
    expect(merged).toEqual({ openai: 'vault-openai', anthropic: 'keep' });
  });

  it('hydrates dotted slots into config objects', () => {
    setSafeStorageForTests(fakeSafeStorage);
    setVaultSecret('embedding.apiKey', 'emb-key');
    setVaultSecret('voice.deepgramKey', 'dg-key');

    const config: Record<string, any> = { embedding: { model: 'm' }, voice: {} };
    hydrateVaultGenericSlots(config);
    expect(config.embedding.apiKey).toBe('emb-key');
    expect(config.embedding.model).toBe('m');
    expect(config.voice.deepgramKey).toBe('dg-key');
  });
});
