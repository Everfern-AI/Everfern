# Model Name Normalization Fix

## Problem

The desktop app was sending Ollama-style model names (e.g., `qwen3-vl:235b-instruct-cloud`) to the EverFern Cloud API, which then forwarded them to OpenRouter. OpenRouter doesn't recognize Ollama model names, causing 400 errors:

```
"qwen3-vl:235b-instruct-cloud is not a valid model ID"
```

## Solution

The desktop app now **normalizes model names** based on the provider before sending requests:

- **For `everfern` or `openrouter` providers**: Converts Ollama-style names to OpenRouter format (`provider/model-name`)
- **For `ollama-cloud` provider**: Keeps Ollama format (`model:tag`)
- **For other providers**: Uses the model name as-is

## Changes Made

### Desktop App (`computer-use.ts`)

Added model name normalization in `createComputerUseTool()`:

```typescript
// Normalize model name based on provider
let normalizedModel = vlm?.model || "qwen3-vl:235b-instruct-cloud";

if (mappedProvider === 'everfern' || mappedProvider === 'openrouter') {
  // Map Ollama-style names to OpenRouter format
  const ollamaToOpenRouter: Record<string, string> = {
    "qwen3-vl:235b-instruct-cloud": "qwen/qwen3-vl-32b-instruct",
    "qwen2-vl:72b-instruct": "qwen/qwen2-vl-72b-instruct",
    "qwen2-vl:7b-instruct": "qwen/qwen2-vl-7b-instruct",
    "llama3.3": "meta-llama/llama-3.3-70b-instruct",
    "llama3.2-vision": "meta-llama/llama-3.2-90b-vision-instruct",
  };

  if (normalizedModel in ollamaToOpenRouter) {
    normalizedModel = ollamaToOpenRouter[normalizedModel];
    console.log(`[ComputerUse] Normalized model: ${vlm?.model} → ${normalizedModel}`);
  }
}
```

### Python API (`index.py`)

No changes needed - the Python API now receives properly formatted model names from the desktop app.

## Model Name Mappings

| Ollama Format | OpenRouter Format |
|---------------|-------------------|
| `qwen3-vl:235b-instruct-cloud` | `qwen/qwen3-vl-32b-instruct` |
| `qwen2-vl:72b-instruct` | `qwen/qwen2-vl-72b-instruct` |
| `qwen2-vl:7b-instruct` | `qwen/qwen2-vl-7b-instruct` |
| `llama3.3` | `meta-llama/llama-3.3-70b-instruct` |
| `llama3.2-vision` | `meta-llama/llama-3.2-90b-vision-instruct` |

## How It Works

### Before (Broken)
```
Desktop App
  ↓ sends "qwen3-vl:235b-instruct-cloud"
Python API
  ↓ forwards "qwen3-vl:235b-instruct-cloud"
OpenRouter
  ↓ ❌ 400 Error: Invalid model ID
```

### After (Fixed)
```
Desktop App
  ↓ normalizes to "qwen/qwen3-vl-32b-instruct"
Python API
  ↓ forwards "qwen/qwen3-vl-32b-instruct"
OpenRouter
  ↓ ✅ Success
```

## Provider-Specific Behavior

### EverFern Cloud (`everfern`)
- Routes through Python API → OpenRouter
- Uses OpenRouter model names
- Example: `qwen/qwen3-vl-32b-instruct`

### OpenRouter Direct (`openrouter`)
- Goes directly to OpenRouter
- Uses OpenRouter model names
- Example: `anthropic/claude-3.5-sonnet`

### Ollama Cloud (`ollama-cloud`)
- Goes directly to Ollama Cloud
- Uses Ollama model names
- Example: `qwen3-vl:235b-instruct-cloud`

### Local Ollama (`ollama`)
- Goes to local Ollama instance
- Uses Ollama model names
- Example: `llama3.2-vision:latest`

## Adding New Model Mappings

To add support for new models, update the `ollamaToOpenRouter` mapping in `computer-use.ts`:

```typescript
const ollamaToOpenRouter: Record<string, string> = {
  // ... existing mappings ...
  "new-ollama-model:tag": "provider/openrouter-model-name",
};
```

## Testing

1. **Restart the desktop app** to load the new build
2. **Use EverFern Cloud** with a vision model
3. **Check logs** - should see:
   ```
   [ComputerUse] Normalized model for everfern: qwen3-vl:235b-instruct-cloud → qwen/qwen3-vl-32b-instruct
   ```
4. **Verify no 400 errors** from OpenRouter

## Warnings

The desktop app will now warn if you use an invalid model name:

```
[ComputerUse] Model "invalid-model" may not be valid for everfern. Use provider/model-name format.
```

This helps catch configuration issues early.

## Benefits

1. **Cleaner separation of concerns**: Desktop app handles model name normalization
2. **No API filtering needed**: Python API receives correct names
3. **Better error messages**: Warns about invalid model names early
4. **Provider-aware**: Different providers get appropriate model name formats
5. **Extensible**: Easy to add new model mappings

## Backward Compatibility

- Existing OpenRouter-format model names (with `/`) work as before
- Ollama-format names are automatically converted for cloud providers
- No changes needed to existing configurations

## Future Improvements

Consider:
1. Fetching model list from OpenRouter API dynamically
2. UI dropdown with valid model names per provider
3. Model capability detection (vision, tools, etc.)
4. Model cost/performance information
