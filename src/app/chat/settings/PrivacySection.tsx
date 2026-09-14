'use client';
import React, { useEffect, useRef } from 'react';
import { TrashIcon } from '@heroicons/react/24/outline';
import { SectionTitle, SectionSubtitle, Card } from './ui';

// Must match main/ipc/system/window-fs-handlers WIPE_ACCOUNT_CONFIRM_PHRASE (renderer can't import main's constant).
const WIPE_CONFIRM_PHRASE = 'DELETE MY DATA';

export function PrivacySection({
    showVectorsModal, setShowVectorsModal,
    vectorsData, setVectorsData,
    loadingVectors, setLoadingVectors,
    showWipeConfirm, setShowWipeConfirm,
    wipePhrase, setWipePhrase,
}: {
    showVectorsModal: boolean;
    setShowVectorsModal: (v: boolean) => void;
    vectorsData: any[];
    setVectorsData: React.Dispatch<React.SetStateAction<any[]>>;
    loadingVectors: boolean;
    setLoadingVectors: (v: boolean) => void;
    showWipeConfirm: boolean;
    setShowWipeConfirm: React.Dispatch<React.SetStateAction<boolean>>;
    wipePhrase: string;
    setWipePhrase: React.Dispatch<React.SetStateAction<string>>;
}) {
    const modalRef = useRef<HTMLDivElement>(null);
    const previouslyFocusedRef = useRef<HTMLElement | null>(null);

    // Escape-to-close + focus trap + body scroll lock while the vectors modal is open
    useEffect(() => {
        if (!showVectorsModal) return;
        previouslyFocusedRef.current = document.activeElement as HTMLElement | null;

        const esc = (e: KeyboardEvent) => e.key === 'Escape' && setShowVectorsModal(false);
        document.addEventListener('keydown', esc as any);

        const trap = (e: KeyboardEvent) => {
            if (e.key !== 'Tab' || !modalRef.current) return;
            const focusables = modalRef.current.querySelectorAll<HTMLElement>(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            );
            if (focusables.length === 0) return;
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', trap);

        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        const closeBtn = modalRef.current?.querySelector<HTMLElement>('button');
        closeBtn?.focus();

        return () => {
            document.removeEventListener('keydown', esc as any);
            document.removeEventListener('keydown', trap);
            document.body.style.overflow = prevOverflow;
            previouslyFocusedRef.current?.focus?.();
        };
    }, [showVectorsModal, setShowVectorsModal]);

    return (
        <div>
            <SectionTitle>Privacy & Data</SectionTitle>
            <SectionSubtitle>Control your data and reset your account.</SectionSubtitle>

            <Card>
                <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)', margin: '0 0 8px' }}>Data Storage</h3>
                <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)', margin: '0 0 16px', lineHeight: 1.6 }}>
                    All conversation history, memory embeddings, screenshots, and configuration are stored completely locally on your device in <code style={{ backgroundColor: 'var(--color-bg-subtle)', color: 'var(--color-text-primary)', padding: '2px 6px', borderRadius: 6, fontSize: 11 }}>~/.everfern/</code>. Nothing is sent to EverFern servers.
                </p>
                <div style={{ backgroundColor: 'var(--color-bg-subtle)', borderRadius: 12, border: '1px solid var(--color-border)', overflow: 'hidden' }}>
                    {[
                        { label: 'Chat History (SQL)', path: '~/.everfern/sql/chat.sqlite' },
                        { label: 'AI Memory (Vectors)', path: '~/.everfern/sql/memory.sqlite' },
                        { label: 'Screenshots & Media', path: '~/.everfern/screenshots/' },
                        { label: 'Custom Skills', path: '~/.everfern/skills/' },
                        { label: 'Tool Settings & Search Keys', path: '~/.everfern/tool-settings.json' },
                        { label: 'Configuration', path: '~/.everfern/config.json' }
                    ].map((item, index, arr) => (
                        <div key={item.path} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', fontSize: 13, borderBottom: index < arr.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                            <span style={{ color: 'var(--color-text-secondary)' }}>{item.label}</span>
                            <code style={{ color: 'var(--color-text-primary)', fontSize: 12 }}>{item.path}</code>
                        </div>
                    ))}
                </div>

                <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--color-border)' }}>
                    <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', margin: '0 0 6px' }}>Vector Search Backfill</h4>
                    <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)', margin: '0 0 12px', lineHeight: 1.5 }}>
                        To enable semantic search for your older chats, you can manually generate their vector embeddings in the background. New chats are indexed automatically.
                    </p>
                    <button
                        onClick={async () => {
                            try {
                                const res = await (window as any).electronAPI.history.backfill();
                                if (res?.success) {
                                    alert('Backfill started in background! This may take a few minutes depending on your chat history size.');
                                }
                            } catch (err) {
                                console.error('Failed to start backfill', err);
                                alert('Failed to start backfill');
                            }
                        }}
                        style={{ padding: '8px 16px', backgroundColor: 'var(--color-bg-subtle)', color: 'var(--color-text-primary)', borderRadius: 8, fontSize: 13, fontWeight: 500, border: '1px solid var(--color-border)', cursor: 'pointer' }}
                    >
                        Backfill Missing Chats
                    </button>
                    <button
                        onClick={async () => {
                            setLoadingVectors(true);
                            setShowVectorsModal(true);
                            try {
                                const data = await (window as any).electronAPI.history.getVectors(100);
                                setVectorsData(data || []);
                            } catch (err) {
                                console.error('Failed to load vectors', err);
                            } finally {
                                setLoadingVectors(false);
                            }
                        }}
                        style={{ padding: '8px 16px', backgroundColor: 'var(--color-bg-subtle)', color: 'var(--color-text-primary)', borderRadius: 8, fontSize: 13, fontWeight: 500, border: '1px solid var(--color-border)', cursor: 'pointer', marginLeft: 8 }}
                    >
                        View Vector Data
                    </button>
                </div>
            </Card>

            {showVectorsModal && (
                <div style={{ position: 'fixed', inset: 0, backgroundColor: 'var(--color-bg-overlay)', backdropFilter: 'var(--backdrop-blur)', zIndex: 'var(--z-modal)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
                    <div ref={modalRef} role="dialog" aria-modal="true" aria-label="Raw Vector Database" style={{ backgroundColor: 'var(--color-bg-elevated)', borderRadius: 16, width: '100%', maxWidth: 900, maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-xl)', border: '1px solid var(--color-border)' }}>
                        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h2 style={{ margin: 0, fontSize: 18, color: 'var(--color-text-primary)' }}>Raw Vector Database (Top 100)</h2>
                            <button onClick={() => setShowVectorsModal(false)} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: 'var(--color-text-tertiary)' }}>&times;</button>
                        </div>
                        <div style={{ overflow: 'auto', flex: 1, padding: 24 }}>
                            {loadingVectors ? (
                                <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-tertiary)' }}>Loading vector rows...</div>
                            ) : vectorsData.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-tertiary)' }}>No vector data found.</div>
                            ) : (
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                    <thead>
                                        <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--color-border-strong)' }}>
                                            <th style={{ padding: '8px 4px', color: 'var(--color-text-primary)' }}>ID</th>
                                            <th style={{ padding: '8px 4px', color: 'var(--color-text-primary)' }}>Conversation</th>
                                            <th style={{ padding: '8px 4px', color: 'var(--color-text-primary)' }}>Role</th>
                                            <th style={{ padding: '8px 4px', color: 'var(--color-text-primary)' }}>Vector Size</th>
                                            <th style={{ padding: '8px 4px', color: 'var(--color-text-primary)' }}>Content Snippet</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {vectorsData.map((row: any) => (
                                            <tr key={row.id} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                                                <td style={{ padding: '8px 4px', color: 'var(--color-text-tertiary)' }}>{row.id.slice(0, 12)}...</td>
                                                <td style={{ padding: '8px 4px', color: 'var(--color-text-primary)' }}>{row.conversation_title || 'Unknown'}</td>
                                                <td style={{ padding: '8px 4px' }}><span style={{ padding: '2px 6px', borderRadius: 4, background: row.role === 'user' ? 'var(--color-info-dim)' : 'var(--color-navis-active-bg)', color: row.role === 'user' ? 'var(--color-info)' : 'var(--color-navis-active-text)', fontSize: 11 }}>{row.role}</span></td>
                                                <td style={{ padding: '8px 4px', color: 'var(--color-success)', fontFamily: 'monospace' }}>{row.embedding_bytes} bytes</td>
                                                <td style={{ padding: '8px 4px', color: 'var(--color-text-secondary)', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {typeof row.content === 'string' ? row.content : JSON.stringify(row.content)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                </div>
            )}

            <div style={{ backgroundColor: 'var(--color-error-dim)', border: '1px solid var(--color-error-dim)', borderRadius: 16, padding: 24 }}>
                <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-error)', margin: '0 0 8px' }}>Danger Zone</h3>
                <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)', margin: '0 0 16px', lineHeight: 1.6 }}>Wipe all local data, search API keys, tool configurations, and reset your account. This cannot be undone.</p>
                {!showWipeConfirm ? (
                    <button
                        onClick={() => setShowWipeConfirm(true)}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', backgroundColor: 'var(--color-error-dim)', color: 'var(--color-error)', borderRadius: 10, fontWeight: 600, fontSize: 13, border: '1px solid var(--color-error-dim)', cursor: 'pointer', transition: 'all 0.2s' }}
                    >
                        <TrashIcon width={16} height={16} />
                        Reset Account & Delete All Data
                    </button>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <input
                            type="text"
                            value={wipePhrase}
                            onChange={e => setWipePhrase(e.target.value)}
                            placeholder={`Type "${WIPE_CONFIRM_PHRASE}" to confirm`}
                            autoFocus
                            style={{ padding: '10px 14px', backgroundColor: 'var(--color-bg-elevated)', color: 'var(--color-text-primary)', borderRadius: 8, fontSize: 13, border: '1px solid var(--color-border)', outline: 'none', fontFamily: 'monospace' }}
                        />
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <button
                                disabled={wipePhrase.trim() !== WIPE_CONFIRM_PHRASE}
                                onClick={async () => {
                                    try {
                                        try {
                                            await (window as any).electronAPI?.toolSettings?.set?.({
                                                webSearch: { mode: 'local', provider: 'exa', headless: true, apiKey: '', exaApiKey: '', firecrawlApiKey: '' },
                                                webCrawl: { mode: 'local', headless: true, apiKey: '' },
                                                browserUse: { mode: 'local', headless: false, apiKey: '' },
                                                navis: { useVision: false, onlyVision: false, headless: false, maxSteps: 200, useChromeProfile: true, selectedBrowserId: 'chrome', useIsolatedBrowser: false, automationMode: 'extension-first' },
                                            });
                                        } catch (e) {
                                            console.warn('toolSettings reset error:', e);
                                        }
                                        const result = await (window as any).electronAPI?.system.wipeAccount(wipePhrase.trim());
                                        if (result?.success) {
                                            localStorage.clear();
                                            sessionStorage.clear();
                                            window.location.reload();
                                        } else {
                                            alert(`Reset failed: ${result?.error || 'Unknown error'}`);
                                        }
                                    } catch (err: any) {
                                        alert(`Reset failed: ${err?.message || 'Unknown error'}`);
                                    }
                                }}
                                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', backgroundColor: wipePhrase.trim() === WIPE_CONFIRM_PHRASE ? 'var(--color-error)' : 'var(--color-error-dim)', color: wipePhrase.trim() === WIPE_CONFIRM_PHRASE ? '#ffffff' : 'var(--color-error)', borderRadius: 10, fontWeight: 600, fontSize: 13, border: '1px solid var(--color-error)', cursor: wipePhrase.trim() === WIPE_CONFIRM_PHRASE ? 'pointer' : 'not-allowed', opacity: wipePhrase.trim() === WIPE_CONFIRM_PHRASE ? 1 : 0.6, transition: 'all 0.2s' }}
                            >
                                <TrashIcon width={16} height={16} />
                                Confirm Reset
                            </button>
                            <button
                                onClick={() => { setShowWipeConfirm(false); setWipePhrase(''); }}
                                style={{ padding: '10px 20px', backgroundColor: 'var(--color-bg-subtle)', color: 'var(--color-text-primary)', borderRadius: 10, fontWeight: 500, fontSize: 13, border: '1px solid var(--color-border)', cursor: 'pointer', transition: 'all 0.2s' }}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
