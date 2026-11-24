import Image from "next/image";

// Single-color marks drawn with the current text color, so they read in light and dark themes.
const MonoLogo = ({ src, label, size }: { src: string; label: string; size: number }) => (
    <span role="img" aria-label={label} style={{ display: "inline-block", width: size, height: size, flex: "none", backgroundColor: "currentColor", opacity: 0.9, WebkitMask: `url(${src}) center / contain no-repeat`, mask: `url(${src}) center / contain no-repeat` }} />
);

// ── Provider Logos ──────────────────────────────────────────────────────────

const OpenAILogo = ({ size = 16 }: { size?: number }) => (
    <MonoLogo src="/images/ai-providers/openai.svg" label="OpenAI" size={size} />
);

const AnthropicLogo = ({ size = 16 }: { size?: number }) => (
    <Image unoptimized src="/images/ai-providers/claude.svg" alt="Anthropic Logo" width={size} height={size} className="grayscale opacity-90" />
);

const DeepSeekLogo = ({ size = 16 }: { size?: number }) => (
    <Image unoptimized src="/images/ai-providers/deepseek.svg" alt="DeepSeek Logo" width={size} height={size} className="grayscale opacity-90" />
);

const GeminiLogo = ({ size = 20 }: { size?: number }) => (
    <Image unoptimized src="/images/ai-providers/gemini.svg" alt="Gemini Logo" width={size} height={size} className="grayscale opacity-80" />
);

const NvidiaLogo = ({ size = 16 }: { size?: number }) => (
    <Image unoptimized src="/images/ai-providers/nvidia.svg" alt="Nvidia Logo" width={size} height={size} className="grayscale opacity-90" />
);

const OpenRouterLogo = ({ size = 16 }: { size?: number }) => (
    <Image unoptimized src="/images/ai-providers/openrouter.svg" alt="OpenRouter Logo" width={size} height={size} className="grayscale opacity-90" />
);

const OllamaLogo = ({ size = 16 }: { size?: number }) => (
    <MonoLogo src="/images/ai-providers/ollama.svg" label="Ollama" size={size} />
);

const LMStudioLogo = ({ size = 16 }: { size?: number }) => (
    <Image unoptimized src="/images/ai-providers/lm-studio.png" alt="LM Studio Logo" width={size} height={size} className="grayscale opacity-80" />
);

const HuggingFaceLogo = ({ size = 16 }: { size?: number }) => (
    <Image unoptimized src="/images/ai-providers/hf-logo.svg" alt="HuggingFace Logo" width={size} height={size} className="grayscale opacity-90" />
);

const EverFernBglessLogo = ({ size = 16 }: { size?: number }) => (
    <Image unoptimized src="/images/logos/black-logo-withoutbg.png" alt="" width={size} height={size} />
);

const MiniMaxLogo = ({ size = 16 }: { size?: number }) => (
    <Image unoptimized src="/images/ai-providers/minimax.svg" alt="MiniMax Logo" width={size} height={size} className="grayscale opacity-90" />
);

export {
    OpenAILogo,
    AnthropicLogo,
    DeepSeekLogo,
    GeminiLogo,
    NvidiaLogo,
    OpenRouterLogo,
    OllamaLogo,
    LMStudioLogo,
    HuggingFaceLogo,
    EverFernBglessLogo,
    MiniMaxLogo
};
