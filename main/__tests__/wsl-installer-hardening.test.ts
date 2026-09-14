/**
 * MP-SEC-14 + MP-SEC-20 — argv-form WSL invocation & pinned installers.
 *
 * Source-level verification: the WSL clone paths must use execFile argv form
 * (no bash -c string interpolation), and the Ollama install flow must verify a
 * pinned SHA256 before executing anything.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const windowFs = fs.readFileSync(
  path.join(__dirname, '../ipc/system/window-fs-handlers.ts'),
  'utf-8'
);
const ocrDoc = fs.readFileSync(
  path.join(__dirname, '../ipc/system/ocr-doc-handlers.ts'),
  'utf-8'
);
const ollamaAudio = fs.readFileSync(
  path.join(__dirname, '../ipc/system/ollama-audio-handlers.ts'),
  'utf-8'
);
const preload = fs.readFileSync(
  path.join(__dirname, '../../preload/preload.ts'),
  'utf-8'
);

describe('MP-SEC-14 WSL clone quoting', () => {
  it('window-fs-handlers uses execFile argv form for the WSL clone', () => {
    expect(windowFs).toContain("execFileAsync(wslCmd, ['--exec', 'mkdir', '-p', wslAttachmentsDir]");
    expect(windowFs).toContain("execFileAsync(wslCmd, ['--exec', 'cp', wslSourcePath,");
  });

  it('window-fs-handlers no longer interpolates paths into bash -c', () => {
    expect(windowFs).not.toMatch(/bash -c "mkdir -p \$\{wslAttachmentsDir\}/);
  });

  it('ocr-doc-handlers uses execFile argv form', () => {
    expect(ocrDoc).toContain("execFileAsync('wsl.exe', ['--exec', 'mkdir', '-p', wslAttachmentsDir]");
    expect(ocrDoc).toContain("execFileAsync('wsl.exe', ['--exec', 'cp', wslSourcePath,");
    expect(ocrDoc).not.toMatch(/bash -c "mkdir -p \$\{wslAttachmentsDir\}/);
  });
});

describe('MP-SEC-20 pinned Ollama installer', () => {
  it('system:ollama-install verifies a pinned SHA256 before execution', () => {
    expect(ollamaAudio).toContain('expectedSha256');
    expect(ollamaAudio).toMatch(/crypto\.createHash\('sha256'\)/);
    expect(ollamaAudio).toContain('Checksum mismatch');
  });

  it('downloads to a temp file and executes the verified file (no pipe-to-shell)', () => {
    expect(ollamaAudio).not.toContain('curl -fsSL https://ollama.com/install.sh | sh');
    expect(ollamaAudio).not.toContain('irm https://ollama.com/install.ps1 | Invoke-Expression');
    expect(ollamaAudio).toContain('everfern-ollama-install.sh');
  });

  it('exposes an install plan channel for the consent step', () => {
    expect(ollamaAudio).toContain('system:ollama-install-plan');
    expect(preload).toContain('ollamaInstallPlan');
  });

  it('terminal installer flow also verifies the checksum', () => {
    expect(ollamaAudio).toMatch(/sha256sum -c -/);
    expect(ollamaAudio).toMatch(/Get-FileHash .*SHA256/);
  });
});
