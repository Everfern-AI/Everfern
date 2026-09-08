'use client';
import React from 'react';
import Image from 'next/image';
import { GlobeAltIcon, CheckIcon, KeyIcon, CpuChipIcon } from '@heroicons/react/24/outline';
import { SectionTitle, SectionSubtitle, Card, Label, Input, Select } from './ui';
import { getVisionDefaultModel, getVisionDefaultBaseUrl } from '@/lib/vision-defaults';

export const visionProviders = [
    { id: 'everfern', name: 'EverFern Cloud', Logo: ({ size = 18 }: any) => <Image unoptimized src="/images/logos/black-logo-withoutbg.png" alt="EverFern" width={size * 1.6} height={size * 1.6} className="dark:invert" /> },
    { id: 'openrouter', name: 'OpenRouter', Logo: ({ size = 18 }: any) => <Image unoptimized src="/images/ai-providers/openrouter.svg" alt="OpenRouter" width={size} height={size} className="dark:invert" /> },
    { id: 'gemini', name: 'Google Gemini', Logo: ({ size = 18 }: any) => <Image unoptimized src="/images/ai-providers/gemini.svg" alt="Google" width={size} height={size} /> },
    { id: 'minimax', name: 'MiniMax API', Logo: ({ size = 18 }: any) => <Image unoptimized src="/images/ai-providers/minimax.svg" alt="MiniMax" width={size} height={size} /> },
    { id: 'ollama', name: 'Ollama Compatible', Logo: ({ size = 18 }: any) => <Image unoptimized src="/images/ai-providers/ollama.svg" alt="Ollama" width={size} height={size} className="dark:invert" /> },
    { id: 'openai', name: 'OpenAI', Logo: ({ size = 18 }: any) => <Image unoptimized src="/images/ai-providers/openai.svg" alt="OpenAI" width={size} height={size} className="dark:invert" /> },
    { id: 'anthropic', name: 'Anthropic', Logo: ({ size = 18 }: any) => <Image unoptimized src="/images/ai-providers/claude.svg" alt="Anthropic" width={size} height={size} /> },
    { id: 'nvidia', name: 'NVIDIA NIM', Logo: ({ size = 18 }: any) => <Image unoptimized src="/images/ai-providers/nvidia.svg" alt="NVIDIA" width={size} height={size} /> },
];

export function VisionSection({
    settingsShowuiUrl, setSettingsShowuiUrl,
    settingsVlmMode, setSettingsVlmMode,
    settingsVlmCloudProvider, setSettingsVlmCloudProvider,
    settingsVlmCloudModel, setSettingsVlmCloudModel,
    settingsVlmCloudUrl, setSettingsVlmCloudUrl,
    settingsVlmCloudKey, setSettingsVlmCloudKey,
    handleVisionLocalSetup,
    checkEverFernLogin,
}: {
    settingsShowuiUrl: string;
    setSettingsShowuiUrl: (v: string) => void;
    settingsVlmMode: 'local' | 'cloud';
    setSettingsVlmMode: React.Dispatch<React.SetStateAction<'local' | 'cloud'>>;
    settingsVlmCloudProvider: string;
    setSettingsVlmCloudProvider: (v: string) => void;
    settingsVlmCloudModel: string;
    setSettingsVlmCloudModel: (v: string) => void;
    settingsVlmCloudUrl: string;
    setSettingsVlmCloudUrl: (v: string) => void;
    settingsVlmCloudKey: string;
    setSettingsVlmCloudKey: (v: string) => void;
    handleVisionLocalSetup: () => void;
    checkEverFernLogin: (providerId: string) => boolean;
}) {
    return (
        <div>
            <SectionTitle>Vision Grounding</SectionTitle>
            <SectionSubtitle>Connect a vision model to enable precise GUI automation and screen understanding.</SectionSubtitle>

            <Card>
                <Label>ShowUI Endpoint</Label>
                <div style={{ position: 'relative', marginBottom: 16 }}>
                    <GlobeAltIcon width={16} height={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)' }} />
                    <Input type="text" placeholder="http://127.0.0.1:7860" value={settingsShowuiUrl} onChange={e => setSettingsShowuiUrl(e.target.value)} style={{ paddingLeft: 40 }} />
                </div>
                <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', lineHeight: 1.5, marginBottom: 0 }}>
                    Start ShowUI with <code style={{ backgroundColor: 'var(--color-bg-subtle)', padding: '2px 6px', borderRadius: 6, fontSize: 11, color: 'var(--color-text-primary)' }}>python app.py</code> in your ShowUI directory.
                </p>
            </Card>

            <Card>
                <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)', margin: '0 0 16px' }}>Vision Model Source</h3>
                {/* Toggle */}
                <div style={{ display: 'flex', gap: 4, padding: 4, backgroundColor: 'var(--color-bg-subtle)', borderRadius: 12, border: '1px solid var(--color-border)', marginBottom: 20, width: 'fit-content' }}>
                    {(['local', 'cloud'] as const).map(mode => (
                        <button
                            key={mode}
                            onClick={() => setSettingsVlmMode(mode)}
                            style={{ padding: '8px 20px', borderRadius: 9, fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer', transition: 'all 0.2s', backgroundColor: settingsVlmMode === mode ? 'var(--color-text-primary)' : 'transparent', color: settingsVlmMode === mode ? 'var(--color-text-inverse)' : 'var(--color-text-tertiary)' }}
                        >
                            {mode === 'local' ? 'Local GPU' : 'Cloud Provider'}
                        </button>
                    ))}
                </div>

                {settingsVlmMode === 'local' && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div>
                            <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', margin: '0 0 4px' }}>Local Vision Model (Qwen3-VL 2B)</h4>
                            <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', margin: 0 }}>Requires Ollama to run on-device.</p>
                        </div>
                        <button
                            onClick={handleVisionLocalSetup}
                            style={{ padding: '10px 18px', backgroundColor: 'var(--color-text-primary)', color: 'var(--color-text-inverse)', borderRadius: 10, fontWeight: 600, fontSize: 13, border: 'none', cursor: 'pointer', transition: 'all 0.2s' }}
                        >
                            Install & Setup
                        </button>
                    </div>
                )}

                {settingsVlmMode === 'cloud' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                        <div>
                            <Label>Provider</Label>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 20, pointerEvents: 'auto' }}>
                                {visionProviders.map(({ id, name, Logo }) => {
                                    const isSel = settingsVlmCloudProvider === id;
                                    return (
                                        <div key={id}
                                            onClick={(e: React.MouseEvent<HTMLDivElement>) => {
                                                e.stopPropagation();
                                                if (id === 'everfern' && !checkEverFernLogin('everfern')) return;
                                                setSettingsVlmCloudProvider(id);
                                                setSettingsVlmCloudModel(getVisionDefaultModel(id));
                                                setSettingsVlmCloudUrl(getVisionDefaultBaseUrl(id));
                                                // Clear stale apiKey when switching to cloud-only providers
                                                if (id === 'everfern' || id === 'openrouter') {
                                                    setSettingsVlmCloudKey('');
                                                }
                                            }}
                                            style={{
                                                padding: '14px 12px',
                                                borderRadius: 12,
                                                border: `1.5px solid ${isSel ? 'var(--color-text-primary)' : 'var(--color-border)'}`,
                                                backgroundColor: isSel ? 'var(--color-bg-subtle)' : 'var(--color-bg-surface)',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                alignItems: 'center',
                                                gap: 8,
                                                transition: 'all 0.15s ease-out',
                                                position: 'relative',
                                                userSelect: 'none',
                                                outline: 'none'
                                            }}>
                                            <Logo size={20} />
                                            <span style={{ fontSize: 12, fontWeight: isSel ? 600 : 500, color: 'var(--color-text-primary)', textAlign: 'center' }}>{name}</span>
                                            {isSel && <div style={{ position: 'absolute', top: 8, right: 8, color: 'var(--color-text-primary)' }}><CheckIcon width={14} height={14} strokeWidth={2.5} /></div>}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                        {settingsVlmCloudProvider === 'everfern' && (
                            <div>
                                <Label>Accuracy & Cost Options</Label>
                                <Select
                                    value={(settingsVlmCloudModel === 'openai/gpt-5.4' || settingsVlmCloudModel === 'google/gemini-3-flash-preview') ? 'accurate' : 'affordable'}
                                    onChange={e => {
                                        const val = e.target.value;
                                        setSettingsVlmCloudModel(val === 'accurate' ? 'openai/gpt-5.4' : 'everfern-tars-v1');
                                    }}
                                >
                                    <option value="affordable">Affordable (Fast & Economical — Qwen 3 VL)</option>
                                    <option value="accurate">Accurate (High Precision — GPT-5.4)</option>
                                </Select>
                                <p style={{ fontSize: 11, color: 'var(--color-text-placeholder)', marginTop: 8 }}>
                                    Affordable uses Qwen 3 VL. Accurate uses GPT-5.4 via EverFern Cloud — token-optimized for low cost.
                                </p>
                            </div>
                        )}
                        {settingsVlmCloudProvider !== 'everfern' && (
                            <>
                                <div>
                                    <Label>Model Name</Label>
                                    <div style={{ position: 'relative' }}>
                                        {settingsVlmCloudProvider === 'ollama' ? (
                                            <Select value={settingsVlmCloudModel} onChange={e => setSettingsVlmCloudModel(e.target.value)}>
                                                <option value="qwen3-vl:235b-cloud">Qwen3 VL 235B (Default)</option>
                                                <option value="kimi-k2.6:cloud">Kimi K2.6 Cloud</option>
                                                <option value="glm-5.1:cloud">GLM 5.1 Cloud</option>
                                            </Select>
                                        ) : (
                                            <>
                                                <CpuChipIcon width={14} height={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)' }} />
                                                <Input type="text" placeholder={getVisionDefaultModel(settingsVlmCloudProvider)} value={settingsVlmCloudModel} onChange={e => setSettingsVlmCloudModel(e.target.value)} style={{ paddingLeft: 40, fontFamily: 'monospace' }} />
                                            </>
                                        )}
                                    </div>
                                </div>
                                {settingsVlmCloudProvider !== 'ollama' && (
                                    <div>
                                        <Label>Host URL (Optional)</Label>
                                        <div style={{ position: 'relative' }}>
                                            <GlobeAltIcon width={14} height={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)' }} />
                                            <Input type="text" placeholder="Optional custom base URL" value={settingsVlmCloudUrl} onChange={e => setSettingsVlmCloudUrl(e.target.value)} style={{ paddingLeft: 40, fontFamily: 'monospace' }} />
                                        </div>
                                    </div>
                                )}
                                <div>
                                    <Label>API Key</Label>
                                    <div style={{ position: 'relative' }}>
                                        <KeyIcon width={14} height={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)' }} />
                                        <Input type="password" placeholder="sk-..." value={settingsVlmCloudKey} onChange={e => setSettingsVlmCloudKey(e.target.value)} style={{ paddingLeft: 40, fontFamily: 'monospace' }} />
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                )}
            </Card>
        </div>
    );
}
