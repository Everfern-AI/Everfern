export const VISION_EVERFERN_DEFAULT_MODEL = 'everfern-tars-v1';

export const getVisionDefaultModel = (provider: string) => {
    if (provider === 'openrouter') return 'openai/gpt-5.6-luna';
    if (provider === 'minimax') return 'MiniMax-M3';
    if (provider === 'ollama') return 'qwen3-vl:235b-cloud';
    if (provider === 'openai') return 'gpt-5.5';
    if (provider === 'anthropic') return 'claude-opus-4.6';
    if (provider === 'everfern') return VISION_EVERFERN_DEFAULT_MODEL;
    if (provider === 'gemini') return 'gemini-2.5-computer-use-preview-10-2025';
    return 'qwen3-vl:235b-cloud';
};

export const getVisionDefaultBaseUrl = (provider: string) => {
    if (provider === 'minimax') return 'https://api.minimax.io/v1';
    if (provider === 'ollama') return 'https://ollama.com';
    if (provider === 'openai') return 'https://api.openai.com/v1';
    if (provider === 'anthropic') return 'https://api.anthropic.com';
    if (provider === 'nvidia') return 'https://integrate.api.nvidia.com/v1';
    return '';
};
