import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AIClient } from '../ai-client';
import { hydrateConfigWithIsolatedKeys, hydrateVlmApiKey } from '../vlm-config';

function withTempConfigDir(fn: (dir: string) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'everfern-vlm-config-'));
  try {
    fs.mkdirSync(path.join(dir, 'keys'), { recursive: true });
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('VLM config key hydration', () => {
  it('hydrates MiniMax vision API keys from vlm-minimax.key', () => {
    withTempConfigDir((dir) => {
      fs.writeFileSync(path.join(dir, 'keys', 'vlm-minimax.key'), 'mini-vlm-secret\n');

      const config = hydrateConfigWithIsolatedKeys({
        provider: 'openrouter',
        vlm: {
          engine: 'cloud',
          provider: 'minimax',
          model: 'MiniMax-M3',
          baseUrl: 'https://api.minimax.io/v1',
        },
      }, dir);

      expect(config.keys?.['vlm-minimax']).toBe('mini-vlm-secret');
      expect(config.vlm?.apiKey).toBe('mini-vlm-secret');
    });
  });

  it('falls back to a provider key when a dedicated VLM key is absent', () => {
    withTempConfigDir((dir) => {
      fs.writeFileSync(path.join(dir, 'keys', 'minimax.key'), 'mini-provider-secret\n');

      const config = hydrateConfigWithIsolatedKeys({
        provider: 'openai',
        vlm: {
          engine: 'cloud',
          provider: 'minimax',
          model: 'MiniMax-M3',
        },
      }, dir);

      expect(config.vlm?.apiKey).toBe('mini-provider-secret');
    });
  });

  it('keeps cloud Ollama/Ollama Cloud VLM key aliases compatible', () => {
    withTempConfigDir((dir) => {
      fs.writeFileSync(path.join(dir, 'keys', 'vlm-ollama.key'), 'ollama-cloud-secret\n');

      const config = hydrateVlmApiKey({
        provider: 'openai',
        keys: {},
        vlm: {
          engine: 'cloud',
          provider: 'ollama-cloud',
          model: 'qwen3-vl:235b-cloud',
        },
      }, dir);

      expect(config.vlm?.apiKey).toBe('ollama-cloud-secret');
    });
  });
});

describe('MiniMax auth guard', () => {
  it('fails before the OpenAI SDK call when MiniMax has no API key', async () => {
    const client = new AIClient({
      provider: 'minimax',
      model: 'MiniMax-M3',
      baseUrl: 'https://api.minimax.io/v1',
      apiKey: '',
    });

    await expect(client.chat({
      messages: [{ role: 'user', content: 'hello' }],
    })).rejects.toThrow(/MiniMax API key is missing/);
  });
});
