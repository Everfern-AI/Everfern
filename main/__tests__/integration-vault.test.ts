/**
 * MP-SEC-11 A2 — integration config vault encryption + redaction.
 *
 * save-config must never persist plaintext bot tokens to
 * integration-config.json (disk gets botToken:'' + botTokenEnc payload),
 * get-config must return {configured,last4} SecretViews, view echoes must
 * not clobber stored tokens, integration:set-token is the narrow
 * write-only channel, and legacy plaintext configs still load (migration
 * happens on next save).
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

// Heavy main-process deps: minimal stubs. The handlers under test only
// consult integrationService.getService (no bot manager wired in tests);
// platforms / MessageHandler are never constructed on these paths.
vi.mock('../integrations/integration-service', () => ({
  integrationService: {
    getService: () => undefined,
    getServiceStatus: () => ({}),
    getSystemStatus: () => ({
      initialized: false,
      started: false,
      servicesRunning: 0,
      servicesTotal: 0,
      errors: [],
    }),
  },
}));
vi.mock('../integrations/discord-platform', () => ({ DiscordPlatform: class {} }));
vi.mock('../integrations/telegram-platform', () => ({ TelegramPlatform: class {} }));
vi.mock('../integrations/message-handler', () => ({
  MessageHandler: class {
    async shutdown() {}
  },
}));

import { ipcMain } from 'electron';
import {
  registerIntegrationHandlers,
  loadIntegrationConfig,
  saveIntegrationConfig,
  getIntegrationConfig,
} from '../ipc/integration-handlers';
import {
  setHomeDirForTests,
  setSafeStorageForTests,
  setVaultPathForTests,
  resetVaultCacheForTests,
} from '../lib/key-vault';

const handleMock = vi.mocked(ipcMain.handle) as unknown as ReturnType<typeof vi.fn>;

function getHandler(channel: string): (...args: any[]) => any {
  const call = handleMock.mock.calls.find((c: any[]) => c[0] === channel);
  if (!call) throw new Error(`handler not registered: ${channel}`);
  return call[1] as (...args: any[]) => any;
}

// HERMETIC HOME (pattern from secret-redaction.test.ts): every os.homedir()
// call — integration-handlers, config-handlers, key-vault — resolves to a
// throwaway fixture. Never patch os.homedir by assignment; a leaked homedir
// once overwrote the developer's real ~/.everfern config files.
const fixtureHome = vi.hoisted(() => ({ home: null as string | null }));

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  const fsMod = await import('fs');
  const pathMod = await import('path');
  const raw = fsMod.mkdtempSync(pathMod.join(actual.tmpdir(), 'everfern-intvault-'));
  fixtureHome.home = fsMod.realpathSync(raw);
  return { ...actual, homedir: () => fixtureHome.home as string };
});

const configDir = () => path.join(fixtureHome.home!, '.everfern');
const integrationConfigPath = () => path.join(configDir(), 'integration-config.json');
const saveConfig = (...args: any[]) => getHandler('integration:save-config')(...args);
const getConfig = () => getHandler('integration:get-config')();

// Fake safeStorage (pattern from key-vault.test.ts) to exercise the truly
// encrypted at-rest path; base64('E(token)') never contains the raw token.
const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (p: string) => Buffer.from(`E(${p})`),
  decryptString: (b: Buffer) => b.toString().replace(/^E\(|\)$/g, ''),
};

describe('integration config vault encryption + redaction (MP-SEC-11 A2)', () => {
  beforeEach(() => {
    handleMock.mockClear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    // Vault: plaintext-fallback mode, redirected at the temp home.
    setSafeStorageForTests(null);
    setHomeDirForTests(fixtureHome.home!);
    setVaultPathForTests(path.join(configDir(), 'vault.json'));
    resetVaultCacheForTests();
    // Fresh slate between tests.
    if (fs.existsSync(integrationConfigPath())) fs.rmSync(integrationConfigPath());
    registerIntegrationHandlers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setHomeDirForTests(null);
    setVaultPathForTests(null);
    setSafeStorageForTests(null);
    resetVaultCacheForTests();
  });

  it('save-config persists encrypted — disk never holds the raw token', async () => {
    await saveConfig(null, {
      telegram: { enabled: true, botToken: '111222333:AAHrawDisk-9999', connected: false },
      discord: { enabled: false, botToken: 'MTIz.rawdiscord-7777', applicationId: '', connected: false },
    });

    const raw = fs.readFileSync(integrationConfigPath(), 'utf8');
    // Plaintext-fallback mode: the secret lives in botTokenEnc behind the
    // self-describing "plain:" marker; the botToken field itself is ''.
    expect(raw).not.toMatch(/"botToken"\s*:\s*"111222333:AAHrawDisk-9999"/);
    expect(raw).not.toMatch(/"botToken"\s*:\s*"MTIz\.rawdiscord-7777"/);
    const parsed = JSON.parse(raw);
    expect(parsed.telegram.botToken).toBe('');
    expect(parsed.discord.botToken).toBe('');
    expect(typeof parsed.telegram.botTokenEnc).toBe('string');
    expect(parsed.telegram.botTokenEnc.length).toBeGreaterThan(0);
    expect(typeof parsed.discord.botTokenEnc).toBe('string');
    expect(parsed.discord.botTokenEnc.length).toBeGreaterThan(0);

    // In-memory config keeps RAW tokens for main-process consumers.
    expect(getIntegrationConfig().telegram.botToken).toBe('111222333:AAHrawDisk-9999');
    expect(getIntegrationConfig().discord.botToken).toBe('MTIz.rawdiscord-7777');
  });

  it('save-config with safeStorage available — whole disk file holds no raw token', async () => {
    // Re-register with a fake safeStorage so vaultEncryptString actually
    // encrypts: botTokenEnc becomes base64("E(token)") — nothing readable.
    setSafeStorageForTests(fakeSafeStorage);
    resetVaultCacheForTests();
    registerIntegrationHandlers();

    await saveConfig(null, {
      telegram: { enabled: true, botToken: '999:encmode-4321', connected: false },
      discord: { enabled: false, botToken: 'MTIz.encmode-8888', applicationId: '', connected: false },
    });

    const raw = fs.readFileSync(integrationConfigPath(), 'utf8');
    expect(raw).not.toContain('encmode-4321');
    expect(raw).not.toContain('encmode-8888');
    const parsed = JSON.parse(raw);
    expect(parsed.telegram.botToken).toBe('');
    expect(parsed.telegram.botTokenEnc).toMatch(/^enc:/);
    expect(parsed.discord.botTokenEnc).toMatch(/^enc:/);

    // Round-trip: fresh load decrypts back to the raw token in memory.
    expect(loadIntegrationConfig().telegram.botToken).toBe('999:encmode-4321');
    expect(getIntegrationConfig().discord.botToken).toBe('MTIz.encmode-8888');
  });

  it('get-config returns {configured,last4} views, never raw tokens', async () => {
    await saveConfig(null, {
      telegram: { enabled: true, botToken: '444:viewTest-5678', connected: false },
      discord: { enabled: false, botToken: '', applicationId: 'app-123', connected: false },
    });

    const cfg = await getConfig();
    expect(cfg.telegram.botToken).toEqual({ configured: true, last4: '5678' });
    expect(cfg.discord.botToken).toEqual({ configured: false });
    expect(cfg.discord.applicationId).toBe('app-123');
    expect(JSON.stringify(cfg)).not.toContain('viewTest-5678');
  });

  it('SecretView echo round-trip keeps the stored token', async () => {
    await saveConfig(null, {
      telegram: { enabled: true, botToken: '1234:echokeep9999', connected: false },
      discord: { enabled: false, botToken: '', applicationId: '', connected: false },
    });
    const loaded = await getConfig();
    expect(loaded.telegram.botToken).toEqual({ configured: true, last4: '9999' });

    // Renderer saves the redacted views back unchanged — must not clobber.
    await saveConfig(null, {
      telegram: { ...loaded.telegram, botToken: loaded.telegram.botToken },
      discord: { ...loaded.discord, botToken: loaded.discord.botToken },
    });

    // Simulate app restart: re-load the config from disk.
    registerIntegrationHandlers();
    const reloaded = await getConfig();
    expect(reloaded.telegram.botToken).toEqual({ configured: true, last4: '9999' });
    expect(getIntegrationConfig().telegram.botToken).toBe('1234:echokeep9999');
    // botToken field on disk stays empty; the secret lives only in botTokenEnc.
    const parsedDisk = JSON.parse(fs.readFileSync(integrationConfigPath(), 'utf8'));
    expect(parsedDisk.telegram.botToken).toBe('');
    expect(typeof parsedDisk.telegram.botTokenEnc).toBe('string');
  });

  it("plain string '' clears the stored token", async () => {
    await saveConfig(null, {
      telegram: { enabled: true, botToken: '777:clearme0001', connected: false },
      discord: { enabled: false, botToken: '', applicationId: '', connected: false },
    });
    await saveConfig(null, { telegram: { botToken: '' }, discord: {} });

    const cfg = await getConfig();
    expect(cfg.telegram.botToken).toEqual({ configured: false });
    expect(getIntegrationConfig().telegram.botToken).toBe('');
    const parsedDisk = JSON.parse(fs.readFileSync(integrationConfigPath(), 'utf8'));
    expect(parsedDisk.telegram.botToken).toBe('');
    expect(parsedDisk.telegram.botTokenEnc).toBe('plain:');
  });

  it('integration:set-token sets, verifies, clears, and validates', async () => {
    const setToken = getHandler('integration:set-token');

    const ok = await setToken(null, 'telegram', '  555:settok-view-4321  ');
    expect(ok).toEqual({ success: true });
    const cfg = await getConfig();
    expect(cfg.telegram.botToken).toEqual({ configured: true, last4: '4321' });
    expect(getIntegrationConfig().telegram.botToken).toBe('555:settok-view-4321');
    // Disk: botToken field empty, secret only behind botTokenEnc.
    const parsedDisk = JSON.parse(fs.readFileSync(integrationConfigPath(), 'utf8'));
    expect(parsedDisk.telegram.botToken).toBe('');
    expect(typeof parsedDisk.telegram.botTokenEnc).toBe('string');

    // '' clears.
    expect(await setToken(null, 'telegram', '')).toEqual({ success: true });
    expect((await getConfig()).telegram.botToken).toEqual({ configured: false });
    expect(getIntegrationConfig().telegram.botToken).toBe('');

    // Invalid platform.
    expect(await setToken(null, 'slack', 'x')).toEqual({ success: false, error: 'Invalid platform' });
    // Non-string token.
    expect(await setToken(null, 'telegram', 12345)).toEqual({ success: false, error: 'Invalid token' });
    // Over-length token.
    expect(await setToken(null, 'telegram', 'x'.repeat(513))).toEqual({ success: false, error: 'Invalid token' });
  });

  it('legacy plaintext botToken loads raw into memory and migrates on save', () => {
    fs.mkdirSync(configDir(), { recursive: true });
    fs.writeFileSync(
      integrationConfigPath(),
      JSON.stringify(
        {
          telegram: { enabled: true, botToken: '888:legacy-plain-77aa', connected: false },
          discord: { enabled: false, botToken: '', applicationId: '', connected: false },
        },
        null,
        2
      )
    );

    const cfg = loadIntegrationConfig();
    expect(cfg.telegram.botToken).toBe('888:legacy-plain-77aa');
    expect(cfg.discord.botToken).toBe('');

    // Saving completes the migration: the botToken FIELD leaves the disk
    // file (becomes ''), the secret moves behind botTokenEnc.
    saveIntegrationConfig(cfg);
    const raw = fs.readFileSync(integrationConfigPath(), 'utf8');
    expect(raw).not.toMatch(/"botToken"\s*:\s*"888:legacy-plain-77aa"/);
    const parsed = JSON.parse(raw);
    expect(parsed.telegram.botToken).toBe('');
    expect(typeof parsed.telegram.botTokenEnc).toBe('string');
    expect(parsed.telegram.botTokenEnc.length).toBeGreaterThan(0);

    // And it round-trips back through load.
    expect(loadIntegrationConfig().telegram.botToken).toBe('888:legacy-plain-77aa');
  });
});

afterAll(() => {
  if (fixtureHome.home) fs.rmSync(fixtureHome.home, { recursive: true, force: true });
});
