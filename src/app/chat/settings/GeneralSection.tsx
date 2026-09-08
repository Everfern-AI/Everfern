'use client';
import { useTheme } from '@/components/common/ThemeProvider';
import { SectionTitle, SectionSubtitle, Card, Label, Select } from './ui';

export function GeneralSection() {
    const { theme, setTheme } = useTheme();
    return (
        <div>
            <SectionTitle>General</SectionTitle>
            <SectionSubtitle>Manage how EverFern behaves globally.</SectionSubtitle>

            <Card>
                <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)', margin: '0 0 16px' }}>Interface</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div>
                        <Label>App Theme</Label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 8, marginBottom: 12 }}>
                            {/* Light Mode Selector Card */}
                            <div
                                onClick={() => setTheme('light')}
                                style={{
                                    border: `2px solid ${theme === 'light' ? 'var(--color-accent)' : 'var(--color-border)'}`,
                                    borderRadius: 16,
                                    padding: 16,
                                    cursor: 'pointer',
                                    backgroundColor: 'var(--color-bg-surface)',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 12,
                                    transition: 'all 0.2s ease',
                                    boxShadow: theme === 'light' ? '0 4px 12px rgba(20, 184, 166, 0.1)' : 'none'
                                }}
                            >
                                {/* Mini Window Mockup */}
                                <div style={{
                                    backgroundColor: '#f5f4f0',
                                    border: '1px solid #e8e6d9',
                                    borderRadius: 8,
                                    height: 100,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    overflow: 'hidden',
                                    userSelect: 'none'
                                }}>
                                    {/* Mock Title Bar */}
                                    <div style={{ display: 'flex', gap: 4, padding: '6px 8px', borderBottom: '1px solid #e8e6d9', backgroundColor: '#fcfcfb' }}>
                                        <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#ff5f56' }} />
                                        <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#ffbd2e' }} />
                                        <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#27c93f' }} />
                                    </div>
                                    {/* Mock Layout */}
                                    <div style={{ display: 'flex', flex: 1 }}>
                                        {/* Mock Sidebar */}
                                        <div style={{ width: '25%', borderRight: '1px solid #e8e6d9', backgroundColor: '#f5f4f0', padding: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                            <div style={{ width: '100%', height: 6, backgroundColor: '#e8e6d9', borderRadius: 2 }} />
                                            <div style={{ width: '80%', height: 4, backgroundColor: '#e8e6d9', borderRadius: 2 }} />
                                            <div style={{ width: '90%', height: 4, backgroundColor: '#e8e6d9', borderRadius: 2 }} />
                                        </div>
                                        {/* Mock Content / Chat */}
                                        <div style={{ flex: 1, backgroundColor: '#ffffff', padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                                            <div style={{ alignSelf: 'flex-end', backgroundColor: '#edeacc', border: '1px solid #e0ddbc', borderRadius: 6, padding: '3px 6px', width: '60%' }}>
                                                <div style={{ width: '100%', height: 3, backgroundColor: '#4a4846', borderRadius: 1 }} />
                                            </div>
                                            <div style={{ alignSelf: 'flex-start', backgroundColor: '#ffffff', border: '1px solid #e8e6d9', borderRadius: 6, padding: '3px 6px', width: '70%' }}>
                                                <div style={{ width: '100%', height: 3, backgroundColor: '#8a8886', borderRadius: 1 }} />
                                                <div style={{ width: '60%', height: 3, backgroundColor: '#8a8886', borderRadius: 1, marginTop: 2 }} />
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Radio Button Selector */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <div style={{
                                        width: 18,
                                        height: 18,
                                        borderRadius: '50%',
                                        border: `2px solid ${theme === 'light' ? 'var(--color-accent)' : 'var(--color-border-strong)'}`,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        transition: 'all 0.2s'
                                    }}>
                                        {theme === 'light' && (
                                            <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: 'var(--color-accent)' }} />
                                        )}
                                    </div>
                                    <span style={{ fontSize: 13, fontWeight: theme === 'light' ? 600 : 500, color: 'var(--color-text-primary)' }}>Light (Beach)</span>
                                </div>
                            </div>

                            {/* Dark Mode Selector Card */}
                            <div
                                onClick={() => setTheme('dark')}
                                style={{
                                    border: `2px solid ${theme === 'dark' ? 'var(--color-accent)' : 'var(--color-border)'}`,
                                    borderRadius: 16,
                                    padding: 16,
                                    cursor: 'pointer',
                                    backgroundColor: 'var(--color-bg-surface)',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 12,
                                    transition: 'all 0.2s ease',
                                    boxShadow: theme === 'dark' ? '0 4px 12px var(--color-accent-dim)' : 'none'
                                }}
                            >
                                {/* Mini Window Mockup */}
                                <div style={{
                                    backgroundColor: '#22201b',
                                    border: '1px solid #333029',
                                    borderRadius: 8,
                                    height: 100,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    overflow: 'hidden',
                                    userSelect: 'none'
                                }}>
                                    {/* Mock Title Bar */}
                                    <div style={{ display: 'flex', gap: 4, padding: '6px 8px', borderBottom: '1px solid #333029', backgroundColor: '#181714' }}>
                                        <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#ff5f56' }} />
                                        <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#ffbd2e' }} />
                                        <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#27c93f' }} />
                                    </div>
                                    {/* Mock Layout */}
                                    <div style={{ display: 'flex', flex: 1 }}>
                                        {/* Mock Sidebar */}
                                        <div style={{ width: '25%', borderRight: '1px solid #333029', backgroundColor: '#22201b', padding: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                            <div style={{ width: '100%', height: 6, backgroundColor: '#333029', borderRadius: 2 }} />
                                            <div style={{ width: '80%', height: 4, backgroundColor: '#333029', borderRadius: 2 }} />
                                            <div style={{ width: '90%', height: 4, backgroundColor: '#333029', borderRadius: 2 }} />
                                        </div>
                                        {/* Mock Content / Chat */}
                                        <div style={{ flex: 1, backgroundColor: '#181714', padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                                            <div style={{ alignSelf: 'flex-end', backgroundColor: '#2d2a20', border: '1px solid #3e3a2c', borderRadius: 6, padding: '3px 6px', width: '60%' }}>
                                                <div style={{ width: '100%', height: 3, backgroundColor: '#c2c0b8', borderRadius: 1 }} />
                                            </div>
                                            <div style={{ alignSelf: 'flex-start', backgroundColor: '#181714', border: '1px solid #333029', borderRadius: 6, padding: '3px 6px', width: '70%' }}>
                                                <div style={{ width: '100%', height: 3, backgroundColor: '#96948d', borderRadius: 1 }} />
                                                <div style={{ width: '60%', height: 3, backgroundColor: '#96948d', borderRadius: 1, marginTop: 2 }} />
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Radio Button Selector */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <div style={{
                                        width: 18,
                                        height: 18,
                                        borderRadius: '50%',
                                        border: `2px solid ${theme === 'dark' ? 'var(--color-accent)' : 'var(--color-border-strong)'}`,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        transition: 'all 0.2s'
                                    }}>
                                        {theme === 'dark' && (
                                            <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: 'var(--color-accent)' }} />
                                        )}
                                    </div>
                                    <span style={{ fontSize: 13, fontWeight: theme === 'dark' ? 600 : 500, color: 'var(--color-text-primary)' }}>Dark (Charcoal)</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div>
                        <Label>Language</Label>
                        <Select defaultValue="en">
                            <option value="en">English</option>
                        </Select>
                    </div>
                </div>
            </Card>

            <Card>
                <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)', margin: '0 0 16px' }}>Defaults</h3>
                <div>
                    <Label>Default Home View</Label>
                    <Select defaultValue="chat">
                        <option value="chat">Chat</option>
                        <option value="projects">Projects</option>
                    </Select>
                </div>
            </Card>
        </div>
    );
}
