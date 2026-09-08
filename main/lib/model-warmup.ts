/**
 * LP-11 (audit §X.C HIGH): startup model warm-up.
 *
 * Ollama unloads models after ~5 min idle; the next turn then eats a
 * 10–60 s cold reload. ai-client.ts already sends options.keep_alive:'30m'
 * on BOTH ollama bodies (:3420/:3607), so this module's job is only the
 * STARTUP half of the fix: ping the local daemon once at app ready (and on
 * provider config change) so the model is resident before the first turn.
 *
 * Never throws, never blocks startup: all failures are logged and swallowed
 * (fire-and-forget; call sites use `void`).
 */

export interface WarmupConfig {
  provider: string;
  baseUrl?: string;
  model?: string;
}

const OLLAMA_DEFAULT_BASE = 'http://localhost:11434';
const LMSTUDIO_DEFAULT_BASE = 'http://localhost:1234/v1';
const WARMUP_TIMEOUT_MS = 10_000;

/** Base URL without a trailing slash (composability with /api/... paths). */
function trimBase(baseUrl?: string): string {
  return (baseUrl || '').replace(/\/+$/, '');
}

/**
 * LP-11: warm the local model at startup. NO THROW — every error path is
 * caught and logged; a warm-up can never take the app down or block boot.
 *
 * - ollama: POST {base}/api/generate {model, prompt:'.', keep_alive:'30m',
 *   options:{num_predict:1}} — loads the model resident with a 1-token
 *   generation (cheap), mirroring the keep_alive already in ai-client bodies.
 * - lmstudio: GET {base}/v1/models — reachability ping only: LM Studio keeps
 *   models resident server-side on its own (no keep_alive concept exists in
 *   its OpenAI-compatible API, so there is nothing to keep alive).
 * - other providers: no-op (cloud providers have no local residency issue).
 * - VITEST guard: skipped under vitest so tests never hit a real daemon and
 *   the guard itself is asserted by model-warmup.test.ts.
 */
export async function warmupLocalModel(config: WarmupConfig): Promise<void> {
  if (process.env.VITEST) return;
  const provider = String(config.provider || '');
  if (provider !== 'ollama' && provider !== 'lmstudio') return; // cloud/other: no-op

  const model = (config.model || '').trim();

  // Sentinel guard: lmstudio's default model id 'local-model' is a
  // placeholder the client resolves to a real model later; warming the
  // sentinel against ollama would 404 (no such model pulled) — skip instead.
  if (provider === 'ollama' && (!model || model === 'local-model')) {
    console.log('[Warmup] No concrete ollama model id configured — skipping warmup');
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WARMUP_TIMEOUT_MS);
  try {
    if (provider === 'ollama') {
      const base = trimBase(config.baseUrl) || OLLAMA_DEFAULT_BASE;
      const res = await fetch(`${base}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt: '.',
          keep_alive: '30m',
          options: { num_predict: 1 },
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        // LP-02-style actionable cause: status + likely reasons.
        console.warn(
          `[Warmup] Ollama warm-up failed: HTTP ${res.status} — check the daemon is running (\`ollama serve\`) and the model is pulled (\`ollama pull ${model}\`)`
        );
        return;
      }
      console.log(`[Warmup] model ${model} kept resident (keep_alive 30m)`);
    } else {
      // lmstudio: reachability ping only — models stay resident server-side.
      const base = trimBase(config.baseUrl) || LMSTUDIO_DEFAULT_BASE;
      const baseNoV1 = base.replace(/\/v1$/, '');
      const res = await fetch(`${baseNoV1}/v1/models`, { signal: controller.signal });
      if (!res.ok) {
        console.warn(
          `[Warmup] LM Studio reachability ping failed: HTTP ${res.status} — check the local server is running (Developer → Start Server)`
        );
        return;
      }
      console.log('[Warmup] LM Studio server reachable — models stay resident server-side');
    }
  } catch (err: any) {
    // LP-02-style cause text: ECONNREFUSED → daemon not running; AbortError → timeout.
    const cause = err?.name === 'AbortError'
      ? `timed out after ${WARMUP_TIMEOUT_MS / 1000}s`
      : (err?.cause?.code || err?.message || String(err));
    console.warn(
      `[Warmup] Local model warm-up failed (${provider}): ${cause} — non-blocking; first turn may pay a cold-load penalty`
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * LP-11 convenience: read the active provider config the canonical way
 * (acpManager.getActiveConfig(), same source as the AgentRunner's client)
 * and fire the warm-up. Returns the resolved config used (for tests/diag);
 * never throws.
 */
export async function warmupFromActiveConfig(
  getActiveConfig: () => { provider?: string; baseUrl?: string; model?: string; customModel?: string; vlm?: { provider?: string; engine?: string; model?: string; baseUrl?: string } } | null,
): Promise<void> {
  try {
    const active = getActiveConfig();
    if (!active?.provider) return;
    // vlm engine 'local' overrides the chat provider for vision residency —
    // but the chat model is what main turns use; warm the chat provider and,
    // if a LOCAL vlm is configured, warm it too (same daemon or lmstudio).
    await warmupLocalModel({
      provider: active.provider,
      baseUrl:  active.baseUrl,
      model:    active.model || active.customModel,
    });
    const vlm = active.vlm;
    if (vlm?.engine === 'local' && vlm.provider && vlm.model) {
      await warmupLocalModel({ provider: vlm.provider, baseUrl: vlm.baseUrl, model: vlm.model });
    }
  } catch (err) {
    console.warn('[Warmup] warmupFromActiveConfig failed (non-blocking):', err);
  }
}
