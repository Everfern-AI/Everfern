# Computer-Use Tool Simplification

## Changes Made

### Removed Hardcoded Model Names
- Removed `DEFAULT_MODEL = "qwen3-vl:30b-a3b-instruct-cloud"`
- Removed `DEFAULT_BASE_URL = "https://ollama.com/v1"`
- Removed all hardcoded fallback model names

### Removed Model Transformation Logic
- Removed `ollamaToOpenRouter` mapping dictionary
- Removed model name normalization for OpenRouter
- Removed conditional logic that transformed model names based on provider

### Simplified Function Structure
- Split `createComputerUseTool` into two functions:
  1. `createComputerUseTool()` - Handles VLM config and creates AIClient
  2. `createComputerUseToolWithClient()` - Returns the tool with the configured client

### How It Works Now

**Before (Complex):**
```typescript
let normalizedModel = vlm?.model || "qwen3-vl:235b-instruct-cloud";
if (mappedProvider === 'everfern' || mappedProvider === 'openrouter') {
  const ollamaToOpenRouter = { /* 8 mappings */ };
  if (normalizedModel in ollamaToOpenRouter) {
    normalizedModel = ollamaToOpenRouter[normalizedModel];
  }
}
```

**After (Simple):**
```typescript
// Use user's model directly - no transformation
const subAgentClient = new AIClient({
  provider: mappedProvider,
  apiKey: vlm.apiKey,
  baseUrl: vlm.baseUrl,
  model: vlm.model  // ← Use as-is
});
```

## Benefits

1. **No Stale Model Names** - Always uses what user configured
2. **Simpler Code** - Removed 50+ lines of mapping logic
3. **Easier Maintenance** - No need to update hardcoded lists
4. **Better Error Messages** - Shows actual model user configured
5. **Consistent Behavior** - Desktop app and Python API both use user's model

## User Settings Flow

1. User configures vision model in settings:
   - Provider: `ollama-cloud`
   - Model: `qwen3-vl:235b-instruct-cloud` (or any other model)
   - API Key: `sk-...`

2. Computer-use tool receives VLM config:
   ```typescript
   vlm = {
     engine: 'cloud',
     provider: 'ollama',
     model: 'qwen3-vl:235b-instruct-cloud',
     apiKey: 'sk-...',
     baseUrl: 'https://ollama.com/v1'
   }
   ```

3. Tool creates AIClient with exact user settings:
   ```typescript
   new AIClient({
     provider: 'ollama-cloud',
     model: 'qwen3-vl:235b-instruct-cloud',  // ← Exact user model
     apiKey: 'sk-...',
     baseUrl: 'https://ollama.com/v1'
   })
   ```

4. Model is sent to vision API as-is

## Files Modified

- `apps/desktop/main/agent/tools/computer-use.ts`
  - Removed hardcoded constants
  - Removed model transformation logic
  - Simplified function structure
  - Now uses user's model directly

## Testing

To verify the fix works:

1. Configure a vision model in settings (e.g., Ollama Cloud)
2. Start a computer-use task
3. Check logs for:
   ```
   [Sub-Agent] 🔧 Provider: ollama-cloud, Model: qwen3-vl:235b-instruct-cloud
   ```
4. Should show the exact model you configured, not a transformed one
5. Multi-step tasks should work without 500 errors

## Rollback

If needed, revert `apps/desktop/main/agent/tools/computer-use.ts` to restore the old logic.
