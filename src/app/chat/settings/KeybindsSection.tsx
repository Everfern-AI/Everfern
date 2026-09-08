'use client';
import { SectionTitle, SectionSubtitle, Card } from './ui';

export function KeybindsSection() {
    const appShortcuts = [
        { id: 'open_settings', name: 'Open Settings', key: 'Ctrl+,' },
        { id: 'new_chat', name: 'New Chat Session', key: 'Ctrl+N' },
        { id: 'search_history', name: 'Global Command Palette / Search', key: 'Ctrl+K' },
        { id: 'toggle_sidebar', name: 'Toggle Left Sidebar', key: 'Ctrl+B' },
    ];

    const voiceShortcuts = [
        { id: 'hold_to_speak', name: 'Hold to Speak (Voice Mode)', key: 'Ctrl + Alt' },
        { id: 'resume_chat', name: 'Resume Chat in Voice Overlay', key: 'Ctrl + Alt + B' },
        { id: 'select_chat_history', name: 'Select Chat History in Voice Overlay', key: 'Ctrl + Alt + H' },
    ];

    return (
        <div>
            <SectionTitle>Keybindings & Shortcuts</SectionTitle>
            <SectionSubtitle>Overview of all application navigation, voice overlay, and global system keybindings.</SectionSubtitle>

            <Card>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', margin: '0 0 14px' }}>
                    Application Shortcuts
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {appShortcuts.map((kb) => (
                        <div key={kb.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', backgroundColor: 'var(--color-bg-subtle)', borderRadius: 12, border: '1px solid var(--color-border)' }}>
                            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text-primary)' }}>{kb.name}</span>
                            <kbd style={{ padding: '4px 10px', borderRadius: 6, backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', fontSize: 12, fontWeight: 700, fontFamily: 'monospace', color: 'var(--color-text-secondary)', boxShadow: '0 1px 2px rgba(0,0,0,0.1)' }}>
                                {kb.key}
                            </kbd>
                        </div>
                    ))}
                </div>
            </Card>

            <Card>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', margin: '0 0 14px' }}>
                    Voice Mode Shortcuts
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {voiceShortcuts.map((kb) => (
                        <div key={kb.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', backgroundColor: 'var(--color-bg-subtle)', borderRadius: 12, border: '1px solid var(--color-border)' }}>
                            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text-primary)' }}>{kb.name}</span>
                            <kbd style={{ padding: '4px 10px', borderRadius: 6, backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', fontSize: 12, fontWeight: 700, fontFamily: 'monospace', color: 'var(--color-text-secondary)', boxShadow: '0 1px 2px rgba(0,0,0,0.1)' }}>
                                {kb.key}
                            </kbd>
                        </div>
                    ))}
                </div>
            </Card>
        </div>
    );
}
