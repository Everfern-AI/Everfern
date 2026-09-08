/**
 * MP-SEC-11 — secret redaction for IPC responses.
 *
 * load-config / integration:get-config / tool-settings:get must never return
 * raw secrets: string secret fields become {configured,last4} views, the keys
 * map becomes views, and round-tripping views back through save-config /
 * tool-settings:set must not clobber or persist the stored raw values.
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

import { toSecretView, redactConfigSecrets } from '../lib/secret-redaction';
import { setHomeDirForTests, setSafeStorageForTests, setVaultPathForTests, resetVaultCacheForTests } from '../lib/key-vault';
import { registerConfigHandlers } from '../ipc/config-handlers';
import * as acpManagerMod from '../acp/manager';
import { ipcMain } from 'electron';

vi.spyOn(acpManagerMod.acpManager, 'setProvider').mockImplementation(() => ({ ok: true }));

const handleMock = vi.mocked(ipcMain.handle) as unknown as ReturnType<typeof vi.fn>;

function getHandler(channel: string): (...args: any[]) => any {
  const call = handleMock.mock.calls.find((c: any[]) => c[0] === channel);
  if (!call) throw new Error(`handler not registered: ${channel}`);
  return call[1] as (...args: any[]) => any;
}

// HERMETIC HOME (vi.mock pattern from path-guard.test.ts): every os.homedir()
// call — in this file, config-handlers, vlm-config, key-vault — resolves to a
// throwaway fixture. A leaked homedir here once overwrote the developer's real
// ~/.everfern/config.json; never again.
const fixtureHome = vi.hoisted(() => ({ home: null as string | null }));

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  const fsMod = await import('fs');
  const pathMod = await import('path');
  const raw = fsMod.mkdtempSync(pathMod.join(actual.tmpdir(), 'everfern-redact-'));
  fixtureHome.home = fsMod.realpathSync(raw);
  return { ...actual, homedir: () => fixtureHome.home as string };
});

describe('toSecretView', () => {
  it('returns configured+last4 for a real key', () => {
    expect(toSecretView('sk-proj-abcdef1234')).toEqual({ configured: true, last4: '1234' });
  });
  it('returns NO_SECRET for empty/whitespace/non-string', () => {
    expect(toSecretView('')).toEqual({ configured: false });
    expect(toSecretView('   ')).toEqual({ configured: false });
    expect(toSecretView(undefined)).toEqual({ configured: false });
    expect(toSecretView(42)).toEqual({ configured: false });
  });
});

describe('redactConfigSecrets', () => {
  it('redacts the keys map into SecretViews', () => {
    const out = redactConfigSecrets({
      provider: 'openai',
      apiKey: 'sk-verysecret-key-9876',
      keys: { openai: 'sk-aaaaaaaa1111', 'vlm-ollama': 'qq-bbbb2222' },
    }) as any;
    expect(out.apiKey).toEqual({ configured: true, last4: '9876' });
    expect(out.keys.openai).toEqual({ configured: true, last4: '1111' });
    expect(out.keys['vlm-ollama']).toEqual({ configured: true, last4: '2222' });
    expect(JSON.stringify(out)).not.toContain('sk-verysecret');
    expect(JSON.stringify(out)).not.toContain('sk-aaaaaaaa');
  });

  it('redacts nested vlm/voice/embedding/botToken secrets but preserves plain fields', () => {
    const out = redactConfigSecrets({
      model: 'gpt-5.5',
      baseUrl: 'https://api.openai.com/v1',
      vlm: { engine: 'cloud', apiKey: 'qq-nested9999' },
      voice: { provider: 'deepgram', deepgramKey: 'dg-key-7777' },
      telegram: { enabled: true, botToken: '111:AAAABBBB' },
    }) as any;
    expect(out.model).toBe('gpt-5.5');
    expect(out.baseUrl).toBe('https://api.openai.com/v1');
    expect(out.vlm.apiKey).toEqual({ configured: true, last4: '9999' });
    expect(out.voice.deepgramKey).toEqual({ configured: true, last4: '7777' });
    expect(out.telegram.botToken).toEqual({ configured: true, last4: 'BBBB' });
    expect(JSON.stringify(out)).not.toContain('qq-nested');
    expect(JSON.stringify(out)).not.toContain('AAAABBBB');
  });

  it('does not mutate the input object (main keeps raw values)', () => {
    const input = { apiKey: 'sk-live-xyz04' };
    redactConfigSecrets(input);
    expect(input.apiKey).toBe('sk-live-xyz04');
  });

  it('deep-copies — nested mutation does not leak', () => {
    const input = { vlm: { apiKey: 'qq-a1b2c3' } };
    const out = redactConfigSecrets(input) as any;
    out.vlm.last4 = 'zzzz';
    expect(input.vlm.apiKey).toBe('qq-a1b2c3');
  });
});

const configDir = () => path.join(fixtureHome.home!, '.everfern');
const keysDir = () => path.join(configDir(), 'keys');

describe('save-config round-trip with redacted views (integration-level)', () => {
  let saveConfig: (...args: any[]) => any;
  let loadConfig: (...args: any[]) => any;

  beforeEach(() => {
    handleMock.mockClear();
    // Vault: plaintext-fallback mode, redirected at the temp home.
    setSafeStorageForTests(null);
    setHomeDirForTests(fixtureHome.home!);
    setVaultPathForTests(path.join(configDir(), 'vault.json'));
    resetVaultCacheForTests();
    registerConfigHandlers();
    saveConfig = getHandler('save-config');
    loadConfig = getHandler('load-config');
  });

  afterEach(() => {
    setHomeDirForTests(null);
    setVaultPathForTests(null);
    setSafeStorageForTests(null);
    resetVaultCacheForTests();
  });

  it('a redacted apiKey view in the payload does not clobber the stored key', async () => {
    // First save with a raw key (fresh onboarding path).
    const res0 = await saveConfig(null, { provider: 'openai', engine: 'online', apiKey: 'sk-roundtrip-4242' }) as any;
    expect(res0.success).toBe(true);
    // Plaintext fallback: vault exists, 0600, and never inside config.json.
    const vaultFile = path.join(configDir(), 'vault.json');
    expect(fs.existsSync(vaultFile)).toBe(true);
    if (process.platform !== 'win32') {
      expect(fs.statSync(vaultFile).mode & 0o777).toBe(0o600);
    }

    // Renderer saves back what it loaded — including the SecretView object.
    const loaded = await loadConfig() as any;
    expect(loaded.config.apiKey).toEqual({ configured: true, last4: '4242' });

    const res = await saveConfig(null, { ...loaded.config, engine: 'online', apiKey: loaded.config.apiKey }) as any;
    expect(res.success).toBe(true);
    // SecretView echo must NOT clear the stored secret.
    const reloaded = await loadConfig() as any;
    expect(reloaded.config.apiKey).toEqual({ configured: true, last4: '4242' });
    // config.json contains no raw key.
    const onDisk = fs.readFileSync(path.join(configDir(), 'config.json'), 'utf8');
    expect(onDisk).not.toContain('sk-roundtrip');
  });

  it('keys map is never persisted to config.json even if sent back', async () => {
    await saveConfig(null, {
      provider: 'openai',
      engine: 'online',
      apiKey: 'sk-persistme-9999',
      keys: { openai: 'sk-persistme-9999', rogue: 'should-not-write' },
    }) as any;
    const onDisk = fs.readFileSync(path.join(configDir(), 'config.json'), 'utf8');
    expect(onDisk).not.toContain('persistme');
    expect(onDisk).not.toContain('rogue');
    expect(fs.existsSync(path.join(keysDir(), 'rogue.key'))).toBe(false);
  });

  it('omitted voice config in a partial save keeps the persisted voice block', async () => {
    await saveConfig(null, {
      provider: 'openai',
      engine: 'online',
      apiKey: 'sk-voice-keep-0001',
      voice: { provider: 'deepgram', deepgramKey: 'dg-keep-1111' },
    }) as any;
    // Partial save without voice: stored deepgram key survives via merge.
    await saveConfig(null, { provider: 'openai', engine: 'online' }) as any;
    const loaded = await loadConfig() as any;
    expect(loaded.config.voice.provider).toBe('deepgram');
    expect(loaded.config.voice.deepgramKey).toEqual({ configured: true, last4: '1111' });
  });

  it('config:set-key writes one slot without full config round-trip', async () => {
    registerConfigHandlers();
    const setKey = getHandler('config:set-key');
    const bad = await setKey(null, '../evil', 'x') as any;
    expect(bad.success).toBe(false);
    const ok = await setKey(null, 'openai', 'sk-setkey-7777') as any;
    expect(ok.success).toBe(true);
    const loaded = await loadConfig() as any;
    expect(loaded.config.keys.openai).toEqual({ configured: true, last4: '7777' });
    expect(JSON.stringify(loaded)).not.toContain('sk-setkey');
  });
});

afterAll(() => {
  if (fixtureHome.home) fs.rmSync(fixtureHome.home, { recursive: true, force: true });
});
