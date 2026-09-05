/**
 * WAVE-5R — SSRF + open-path guards for system:fetch-metadata / system:open-external.
 *
 * Pins the pure validators exported from window-fs-handlers:
 * - parseIpAddress expands literal-IP shorthand (decimal/hex/octal integers,
 *   IPv4-mapped IPv6) so isPrivateAddress can catch hosts like 2130706433
 *   or ::ffff:169.254.169.254 that the old string-prefix screen let through.
 * - assertPublicHost rejects when DNS resolution lands in private/reserved
 *   space (post-resolution check; the example.com case is network-dependent
 *   and self-skips if DNS is unavailable).
 * - isSafeLocalOpenPath denies executable payloads (.exe & co — openPath goes
 *   through ShellExecute/LaunchServices and would LAUNCH them) plus the macOS
 *   /private/etc and /private/var/root aliases of sensitive dirs.
 */

import { describe, it, expect, vi, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as dns from 'dns';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  dialog: {},
  shell: {},
  app: {},
}));
vi.mock('../agent/tools/memory-save', () => ({ memorySaveTool: {} }));

import {
  parseIpAddress,
  isPrivateAddress,
  assertPublicHost,
  isSafeLocalOpenPath,
} from '../ipc/system/window-fs-handlers';

describe('WAVE-5R literal-host expansion (parseIpAddress / isPrivateAddress)', () => {
  it('decimal integer v4 maps to loopback (2130706433)', () => {
    expect(parseIpAddress('2130706433')).toEqual([127, 0, 0, 1]);
    expect(isPrivateAddress(parseIpAddress('2130706433'))).toBe(true);
  });

  it('hex integer v4 maps to loopback (0x7f000001)', () => {
    expect(parseIpAddress('0x7f000001')).toEqual([127, 0, 0, 1]);
    expect(isPrivateAddress(parseIpAddress('0x7f000001'))).toBe(true);
  });

  it('IPv4-mapped IPv6 link-local is rejected (::ffff:169.254.169.254)', () => {
    expect(isPrivateAddress(parseIpAddress('::ffff:169.254.169.254'))).toBe(true);
  });

  it('public v4 passes (8.8.8.8)', () => {
    expect(isPrivateAddress(parseIpAddress('8.8.8.8'))).toBe(false);
  });

  it('reserved ranges are rejected', () => {
    for (const addr of ['10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254',
      '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1']) {
      expect(isPrivateAddress(parseIpAddress(addr))).toBe(true);
    }
  });

  it('non-literal hostnames do not parse as addresses', () => {
    expect(parseIpAddress('example.com')).toBeNull();
    expect(isPrivateAddress(null)).toBe(true);
  });
});

describe('WAVE-5R post-resolution guard (assertPublicHost)', () => {
  it('link-local literal is rejected without network', async () => {
    await expect(assertPublicHost('169.254.169.254')).rejects.toThrow();
  });

  it('loopback literal is rejected', async () => {
    await expect(assertPublicHost('127.0.0.1')).rejects.toThrow();
  });

  it('example.com resolves public (network-dependent)', async (ctx) => {
    let records;
    try {
      records = await dns.promises.lookup('example.com', { all: true, verbatim: true });
    } catch {
      return ctx.skip();
    }
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect(isPrivateAddress(parseIpAddress(record.address))).toBe(false);
    }
  });
});

describe('WAVE-5R open-path validator (isSafeLocalOpenPath)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'everfern-metadata-guard-'));

  it('rejects executable payloads regardless of extension casing', () => {
    const p = path.join(tmp, 'payload.EXE');
    fs.writeFileSync(p, 'MZ');
    expect(isSafeLocalOpenPath(p)).toBe(false);
  });

  it('rejects script/installer formats (.bat .ps1 .app .deb)', () => {
    for (const ext of ['.bat', '.ps1', '.app', '.deb']) {
      const p = path.join(tmp, `payload${ext}`);
      fs.writeFileSync(p, '');
      expect(isSafeLocalOpenPath(p)).toBe(false);
    }
  });

  it('denies /private/etc and /private/var/root (macOS aliases)', () => {
    expect(isSafeLocalOpenPath('/etc/hosts')).toBe(false);
    expect(isSafeLocalOpenPath('/private/etc/hosts')).toBe(false);
    expect(isSafeLocalOpenPath('/private/var/root/secret.txt')).toBe(false);
  });

  it('admits benign existing files', () => {
    const p = path.join(tmp, 'notes.txt');
    fs.writeFileSync(p, 'hello');
    expect(isSafeLocalOpenPath(p)).toBe(true);
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
