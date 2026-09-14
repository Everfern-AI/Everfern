'use client';
import React from 'react';
import Image from 'next/image';
import { CheckIcon, KeyIcon } from '@heroicons/react/24/outline';
import { SectionTitle, SectionSubtitle, Card, Label, Input, Select } from './ui';

// Embedding model options per provider
const EMBEDDING_PROVIDERS = [
    { id: 'everfern',   name: 'EverFern Cloud',  Logo: ({ size = 18 }: any) => <Image unoptimized src="/images/logos/black-logo-withoutbg.png" alt="EverFern" width={size * 1.6} height={size * 1.6} className="dark:invert" />, models: ['qwen/qwen3-embedding-8b'], supportsEmbed: true },
    { id: 'openai',     name: 'OpenAI',          Logo: ({ size = 18 }: any) => <Image unoptimized src="/images/ai-providers/openai.svg" alt="OpenAI" width={size} height={size} className="dark:invert" />, models: ['text-embedding-3-large', 'text-embedding-3-small', 'text-embedding-ada-002'], supportsEmbed: true },
    { id: 'gemini',     name: 'Google Gemini',   Logo: ({ size = 18 }: any) => <Image unoptimized src="/images/ai-providers/gemini.svg" alt="Google" width={size} height={size} />, models: ['gemini-embedding-2', 'gemini-embedding-001'], supportsEmbed: true },
    { id: 'minimax',    name: 'MiniMax',         Logo: ({ size = 18 }: any) => <Image unoptimized src="/images/ai-providers/minimax.svg" alt="MiniMax" width={size} height={size} />, models: ['embo-01'], supportsEmbed: true },
    { id: 'nvidia',     name: 'NVIDIA NIM',      Logo: ({ size = 18 }: any) => <Image unoptimized src="/images/ai-providers/nvidia.svg" alt="NVIDIA" width={size} height={size} />, models: ['nv-embedqa-e5-v5', 'llama-3.2-nv-embedqa-1b-v2'], supportsEmbed: true },
    { id: 'openrouter', name: 'OpenRouter',      Logo: ({ size = 18 }: any) => <Image unoptimized src="/images/ai-providers/openrouter.svg" alt="OpenRouter" width={size} height={size} className="dark:invert" />, models: ['qwen/qwen3-embedding-8b', 'openai/text-embedding-3-large'], supportsEmbed: true },
    { id: 'ollama',     name: 'Ollama (Local)',  Logo: ({ size = 18 }: any) => <Image unoptimized src="/images/ai-providers/ollama.svg" alt="Ollama" width={size} height={size} className="dark:invert" />, models: ['qwen3-embedding:latest', 'qwen3-embedding:8b', 'qwen3-embedding:4b', 'qwen3-embedding:0.6b'], supportsEmbed: true },
    { id: 'anthropic',  name: 'Anthropic',       Logo: ({ size = 18 }: any) => <Image unoptimized src="/images/ai-providers/claude.svg" alt="Anthropic" width={size} height={size} />, models: [], supportsEmbed: false },
    { id: 'deepseek',   name: 'DeepSeek',        Logo: ({ size = 18 }: any) => <Image unoptimized src="/images/ai-providers/deepseek.svg" alt="DeepSeek" width={size} height={size} />, models: [], supportsEmbed: false },
    { id: 'ollama-cloud', name: 'Ollama Cloud',  Logo: ({ size = 18 }: any) => <Image unoptimized src="/images/ai-providers/ollama.svg" alt="Ollama" width={size} height={size} />, models: [], supportsEmbed: false },
];

/** Provider grid + model/key form for the embedding backend used by vector
 *  search, memory, and RAG. Providers without embedding support render
 *  disabled; selecting a provider resets the model to its first entry. */
export function EmbeddingsSection({
    embeddingProvider, setEmbeddingProvider,
    embeddingModel, setEmbeddingModel,
    embeddingApiKey, setEmbeddingApiKey,
    checkEverFernLogin,
}: {
    embeddingProvider: string;
    setEmbeddingProvider: (v: string) => void;
    embeddingModel: string;
    setEmbeddingModel: (v: string) => void;
    embeddingApiKey: string;
    setEmbeddingApiKey: (v: string) => void;
    checkEverFernLogin: (providerId: string) => boolean;
}) {
    const selectedProvider = EMBEDDING_PROVIDERS.find(p => p.id === embeddingProvider);
    return (
        <div>
            <SectionTitle>Embeddings</SectionTitle>
            <SectionSubtitle>Configure the embedding model used for vector search, memory, and semantic retrieval.</SectionSubtitle>

            {/* Provider Grid */}
            <Card>
                <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)', margin: '0 0 16px' }}>Embedding Provider</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 8 }}>
                    {EMBEDDING_PROVIDERS.map(({ id, name, Logo, supportsEmbed }) => {
                        const isSel = embeddingProvider === id;
                        return (
                            <div
                                key={id}
                                onClick={() => {
                                    // Double gate: unsupported providers are
                                    // un-clickable, and EverFern still requires
                                    // a cloud login before it can be selected.
                                    if (!supportsEmbed) return;
                                    if (id === 'everfern' && !checkEverFernLogin('everfern')) return;
                                    setEmbeddingProvider(id);
                                    // The old provider's model id is invalid for the
                                    // new provider, so reset to its first entry.
                                    const prov = EMBEDDING_PROVIDERS.find(p => p.id === id);
                                    if (prov && prov.models.length > 0) setEmbeddingModel(prov.models[0]);
                                }}
                                style={{
                                    padding: '14px 12px',
                                    borderRadius: 12,
                                    border: `1.5px solid ${isSel ? 'var(--color-border-focus)' : 'var(--color-border)'}`,
                                    backgroundColor: isSel ? 'var(--color-bg-hover)' : supportsEmbed ? 'var(--color-bg-surface)' : 'var(--color-bg-subtle)',
                                    cursor: supportsEmbed ? 'pointer' : 'not-allowed',
                                    opacity: supportsEmbed ? 1 : 0.45,
                                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                                    transition: 'all 0.15s ease-out', position: 'relative', userSelect: 'none',
                                }}
                            >
                                {isSel && <div style={{ position: 'absolute', top: 8, right: 8, color: 'var(--color-text-primary)' }}><CheckIcon width={14} height={14} strokeWidth={2.5} /></div>}
                                <div style={{ height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <Logo size={24} />
                                </div>
                                <span style={{ fontSize: 12, fontWeight: isSel ? 600 : 500, color: 'var(--color-text-primary)', textAlign: 'center', lineHeight: 1.3 }}>{name}</span>
                                {!supportsEmbed && <span style={{ fontSize: 10, color: 'var(--color-text-placeholder)', fontWeight: 500 }}>No embedding model</span>}
                            </div>
                        );
                    })}
                </div>
            </Card>

            {/* Model Selection — only show if provider supports embeddings */}
            {selectedProvider?.supportsEmbed && selectedProvider.models.length > 0 && (
                <Card>
                    {/* The <option> list is derived from the same static table
                        as the grid, so switching providers never leaves the
                        select showing a model the provider doesn't offer. */}
                    <Label>Embedding Model</Label>
                    <Select
                        value={embeddingModel}
                        onChange={e => setEmbeddingModel(e.target.value)}
                    >
                        {selectedProvider.models.map(m => (
                            <option key={m} value={m}>{m}</option>
                        ))}
                    </Select>
                    {embeddingProvider === 'ollama' && (
                        <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 10, lineHeight: 1.6 }}>
                            <strong>Hardware guide:</strong> Use <code style={{ backgroundColor: 'var(--color-bg-subtle)', color: 'var(--color-text-primary)', padding: '1px 5px', borderRadius: 4, fontSize: 11 }}>qwen3-embedding:0.6b</code> (639MB) for low-RAM systems,{' '}
                            <code style={{ backgroundColor: 'var(--color-bg-subtle)', color: 'var(--color-text-primary)', padding: '1px 5px', borderRadius: 4, fontSize: 11 }}>qwen3-embedding:4b</code> (2.5GB) for mid-range,{' '}
                            <code style={{ backgroundColor: 'var(--color-bg-subtle)', color: 'var(--color-text-primary)', padding: '1px 5px', borderRadius: 4, fontSize: 11 }}>qwen3-embedding:latest</code> (4.7GB, 40K context) for best quality.
                        </p>
                    )}
                    {embeddingProvider === 'everfern' && (
                        <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 10, lineHeight: 1.6 }}>
                            EverFern Cloud uses <code style={{ backgroundColor: 'var(--color-bg-subtle)', color: 'var(--color-text-primary)', padding: '1px 5px', borderRadius: 4, fontSize: 11 }}>qwen/qwen3-embedding-8b</code> via OpenRouter on our backend. No API key needed if you're logged into EverFern Cloud.
                        </p>
                    )}
                    {embeddingProvider !== 'everfern' && embeddingProvider !== 'ollama' && (
                        <div style={{ marginTop: 16 }}>
                            {/* API key is only collected for third-party cloud
                                providers — EverFern authenticates via the
                                logged-in session and Ollama runs locally. */}
                            <Label>API Key</Label>
                            <div style={{ position: 'relative' }}>
                                <KeyIcon width={14} height={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)', pointerEvents: 'none' }} />
                                <Input type="password" placeholder="sk-..." value={embeddingApiKey} onChange={e => setEmbeddingApiKey(e.target.value)} style={{ paddingLeft: 40, fontFamily: 'monospace' }} />
                            </div>
                            <p style={{ fontSize: 11, color: 'var(--color-text-placeholder)', marginTop: 4 }}>Required for {selectedProvider?.name || 'this provider'}.</p>
                        </div>
                    )}
                </Card>
            )}

            {/* Info card */}
            <Card style={{ backgroundColor: 'var(--color-bg-subtle)' }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', margin: '0 0 8px' }}>How embeddings are used</h3>
                <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: 0, lineHeight: 1.7 }}>
                    Embeddings convert text into vectors for semantic search — used for memory recall, document retrieval, and RAG (retrieval-augmented generation). The selected model runs every time EverFern stores or searches through memory.
                </p>
                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {/* Known "dead end" providers are called out up front so
                        users understand why those cards stay disabled. */}
                    {[
                        { provider: 'Anthropic', note: 'No embedding model available. Use OpenRouter or OpenAI instead.' },
                        { provider: 'DeepSeek', note: 'No embedding model available. Use OpenRouter or OpenAI instead.' },
                        { provider: 'Ollama Cloud', note: 'Embedding models only available for local Ollama, not Ollama Cloud.' },
                    ].map(({ provider, note }) => (
                        <div key={provider} style={{ padding: '8px 12px', backgroundColor: 'var(--color-warning-dim)', border: '1px solid var(--color-warning-light)', borderRadius: 10, fontSize: 12, color: 'var(--color-warning)' }}>
                            <strong>{provider}:</strong> {note}
                        </div>
                    ))}
                </div>
            </Card>
        </div>
    );
}
