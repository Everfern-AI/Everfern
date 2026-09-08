'use client';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '@/components/common/ThemeProvider';
import { CheckIcon, KeyIcon } from '@heroicons/react/24/outline';
import { SectionTitle, SectionSubtitle, Card, Label, Input } from './ui';

/** Voice Mode settings: pick a speech provider (everfern/deepgram/elevenlabs/
 *  local) and supply its API key. Fully controlled by parent state. */
export function VoiceSection({
    voiceProvider, setVoiceProvider,
    voiceDeepgramKey, setVoiceDeepgramKey,
    voiceElevenlabsKey, setVoiceElevenlabsKey,
}: {
    voiceProvider: 'everfern' | 'deepgram' | 'elevenlabs' | 'local' | null;
    setVoiceProvider: (v: 'everfern' | 'deepgram' | 'elevenlabs' | 'local' | null) => void;
    voiceDeepgramKey: string;
    setVoiceDeepgramKey: (v: string) => void;
    voiceElevenlabsKey: string;
    setVoiceElevenlabsKey: (v: string) => void;
}) {
    const { theme } = useTheme();
    return (
        <div>
            <SectionTitle>Voice Mode</SectionTitle>
            <SectionSubtitle>Configure voice input and output for Jarvis-style interaction.</SectionSubtitle>

            <Card>
                    <Label>Voice Provider</Label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
                        {/* EverFern's own logo swaps per theme (black on light,
                            green on dark); third-party marks are single assets
                            that only need dark:invert. */}
                        {[
                        { id: 'everfern', name: 'EverFern Voice', icon: theme === 'light' ? '/images/logos/black-logo-withoutbg.png' : '/images/logos/everfern-withoutbg.png' },
                        { id: 'deepgram', name: 'Deepgram', icon: '/images/ai-providers/Deepgram.svg' },
                        { id: 'elevenlabs', name: 'ElevenLabs', icon: '/images/ai-providers/elevenlabs.svg' },
                        { id: 'local', name: 'Local (Ollama)', icon: '/images/ai-providers/ollama.svg' },
                    ].map(({ id, name, icon }) => {
                        const isSel = voiceProvider === id;
                        // Plain card click — no login gate here (unlike the
                        // model engine picker): EverFern voice is zero-config
                        // and the others only need their own API key.
                        return (
                            <div
                                key={id}
                                onClick={() => setVoiceProvider(id as 'everfern' | 'deepgram' | 'elevenlabs' | 'local')}
                                style={{
                                    padding: '16px 14px',
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
                                }}
                            >
                                <Image unoptimized src={icon} alt={name} width={24} height={24} className={id === 'everfern' ? '' : 'dark:invert'} />
                                <span style={{ fontSize: 12, fontWeight: isSel ? 600 : 500, color: 'var(--color-text-primary)', textAlign: 'center' }}>{name}</span>
                                {isSel && <div style={{ position: 'absolute', top: 8, right: 8, color: 'var(--color-text-primary)' }}><CheckIcon width={14} height={14} strokeWidth={2.5} /></div>}
                            </div>
                        );
                    })}
                </div>

                <AnimatePresence initial={false}>
                    {/* EverFern Cloud voice: managed Deepgram Nova-2 STT — no
                        key entry, the cloud session token authorizes usage. */}
                    {voiceProvider === 'everfern' && (
                        <motion.div key="everfern" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.2 }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 14px', borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-subtle)' }}>
                                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>🌿 EverFern Cloud Voice (Deepgram Nova-2)</span>
                                <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>
                                    Zero-configuration cloud speech-to-text powered by Deepgram Nova-2. Ready to use out-of-the-box.
                                </span>
                            </div>
                        </motion.div>
                    )}
                    {voiceProvider === 'deepgram' && (
                        <motion.div key="deepgram" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.2 }}>
                            {/* Optional key: blank deliberately falls back to the
                                shared EverFern Cloud Deepgram backend. */}
                            <Label>Deepgram API Key</Label>
                            <div style={{ position: 'relative', marginBottom: 8 }}>
                                <KeyIcon width={16} height={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)' }} />
                                <Input type="password" placeholder="Enter Deepgram API key (or leave empty for EverFern Cloud)" value={voiceDeepgramKey} onChange={e => setVoiceDeepgramKey(e.target.value)} style={{ paddingLeft: 40 }} />
                            </div>
                            <p style={{ fontSize: 11, color: 'var(--color-text-placeholder)', marginTop: 4 }}>Leave blank to use EverFern Cloud Deepgram, or enter your custom key from <a href="https://console.deepgram.com" target="_blank" rel="noopener" style={{ color: 'var(--color-text-primary)', textDecoration: 'underline' }}>Deepgram Console</a></p>
                        </motion.div>
                    )}
                    {voiceProvider === 'elevenlabs' && (
                        <motion.div key="elevenlabs" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.2 }}>
                            <Label>ElevenLabs API Key</Label>
                            <div style={{ position: 'relative', marginBottom: 8 }}>
                                <KeyIcon width={16} height={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)' }} />
                                <Input type="password" placeholder="sk_..." value={voiceElevenlabsKey} onChange={e => setVoiceElevenlabsKey(e.target.value)} style={{ paddingLeft: 40 }} />
                            </div>
                            <p style={{ fontSize: 11, color: 'var(--color-text-placeholder)', marginTop: 4 }}>Get your API key from <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noopener" style={{ color: 'var(--color-text-primary)', textDecoration: 'underline' }}>ElevenLabs Settings</a></p>
                        </motion.div>
                    )}
                    {voiceProvider === 'local' && (
                        <motion.div key="local" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.2 }}>
                            {/* No config surface on purpose: the app spawns the
                                RealtimeSTT FastAPI server itself on an
                                ephemeral port, so there is nothing to edit. */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 14px', borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-subtle)' }}>
                                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>🤖 Local RealtimeSTT ASR</span>
                                <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>
                                    Transcribes your voice locally on your computer. EverFern will automatically start your local <strong style={{ color: 'var(--color-text-primary)' }}>RealtimeSTT</strong> FastAPI server on a dynamically allocated port.
                                </span>
                                <span style={{ fontSize: 11, color: 'var(--color-text-placeholder)', marginTop: 4 }}>
                                    No manual server setup or port configuration required.
                                </span>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </Card>

            <Card>
                {/* Shortcut reference only — the chords themselves are
                    registered by the global voice overlay, not this section. */}
                <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)', margin: '0 0 12px' }}>Voice Mode Shortcuts</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                        <span style={{ color: 'var(--color-text-secondary)' }}>Hold to Speak (Voice Mode)</span>
                        <kbd style={{
                            backgroundColor: "var(--color-bg-surface)",
                            border: "1px solid var(--color-border)",
                            borderRadius: 6,
                            padding: "2px 8px",
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--color-text-primary)",
                            boxShadow: "0 1px 1px rgba(0,0,0,0.05)"
                        }}>Ctrl + Alt</kbd>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                        <span style={{ color: 'var(--color-text-secondary)' }}>Resume Chat in Voice Overlay</span>
                        <kbd style={{
                            backgroundColor: "var(--color-bg-surface)",
                            border: "1px solid var(--color-border)",
                            borderRadius: 6,
                            padding: "2px 8px",
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--color-text-primary)",
                            boxShadow: "0 1px 1px rgba(0,0,0,0.05)"
                        }}>Ctrl + Alt + B</kbd>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                        <span style={{ color: 'var(--color-text-secondary)' }}>Select Chat History in Voice Overlay</span>
                        <kbd style={{
                            backgroundColor: "var(--color-bg-surface)",
                            border: "1px solid var(--color-border)",
                            borderRadius: 6,
                            padding: "2px 8px",
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--color-text-primary)",
                            boxShadow: "0 1px 1px rgba(0,0,0,0.05)"
                        }}>Ctrl + Alt + H</kbd>
                    </div>
                </div>
            </Card>

            <Card>
                <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)', margin: '0 0 12px' }}>About Voice Mode</h3>
                <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.6, margin: 0 }}>Voice Mode enables natural conversation with Fern. Speak naturally, and Fern will understand context, execute tasks, and respond with both text and audio. Uses your configured AI model for reasoning.</p>
            </Card>
        </div>
    );
}
