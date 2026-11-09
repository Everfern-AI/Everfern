// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { normalizeConfig } from '../config-handlers';
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));
vi.mock('../../acp/manager', () => ({ acpManager: {} }));

describe('llama.cpp configuration', () => {
  it('preserves a custom local endpoint across provider changes', () => {
    const saved = normalizeConfig({ provider: 'llamacpp', baseUrl: 'http://localhost:9090/v1', baseUrls: { ollama: 'http://localhost:11434' } });
    const switched = normalizeConfig({ ...JSON.parse(JSON.stringify(saved)), provider: 'openai' });
    expect(switched.baseUrl).toBeUndefined();
    expect(switched.baseUrls.llamacpp).toBe('http://localhost:9090/v1');
    expect(switched.baseUrls.ollama).toBe('http://localhost:11434');
  });

  it('keeps llama.cpp vision endpoints intact', () => {
    const config = normalizeConfig({ provider: 'llamacpp', baseUrl: 'http://127.0.0.1:8080/v1', vlm: { provider: 'llamacpp', baseUrl: 'http://localhost:8081/v1', enabled: true } });
    expect(config.baseUrl).toBe('http://127.0.0.1:8080/v1');
    expect(config.vlm.baseUrl).toBe('http://localhost:8081/v1');
  });
});
