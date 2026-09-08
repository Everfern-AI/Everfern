'use client';
import { motion } from 'framer-motion';
import { SectionTitle, SectionSubtitle, Card } from './ui';

/** Edit SOUL.md (personality core) and agents.md (routing rules), with an
 *  optional global-vs-workspace scope switch shown only when a project is
 *  active. Saving is delegated to the parent's handleSaveOpenClaw. */
export function OpenClawSection({
    activeProjectId,
    soul, setSoul,
    agents, setAgents,
    isSavingOpenClaw,
    openClawScope, setOpenClawScope,
    handleSaveOpenClaw,
}: {
    activeProjectId?: string;
    soul: string;
    setSoul: React.Dispatch<React.SetStateAction<string>>;
    agents: string;
    setAgents: React.Dispatch<React.SetStateAction<string>>;
    isSavingOpenClaw: boolean;
    openClawScope: 'global' | 'workspace';
    setOpenClawScope: React.Dispatch<React.SetStateAction<'global' | 'workspace'>>;
    handleSaveOpenClaw: () => void;
}) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
        >
            <SectionTitle>Personality & Agent Customization</SectionTitle>
            <SectionSubtitle>Configure the behavior core (SOUL.md) and agent routing rules (agents.md) using custom behavior rules.</SectionSubtitle>

            {activeProjectId && (
                <Card style={{ marginBottom: 20, padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 2 }}>Configuration Scope</div>
                        <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>Edit configurations globally or for the current active project.</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                        <button
                            onClick={() => setOpenClawScope('global')}
                            style={{
                                padding: '6px 12px', borderRadius: 8, border: '1px solid var(--color-border)', fontSize: 13,
                                backgroundColor: openClawScope === 'global' ? 'var(--color-text-primary)' : 'var(--color-bg-surface)',
                                color: openClawScope === 'global' ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)',
                                cursor: 'pointer', fontWeight: openClawScope === 'global' ? 600 : 400
                            }}
                        >
                            Global
                        </button>
                        <button
                            onClick={() => setOpenClawScope('workspace')}
                            style={{
                                padding: '6px 12px', borderRadius: 8, border: '1px solid var(--color-border)', fontSize: 13,
                                backgroundColor: openClawScope === 'workspace' ? 'var(--color-text-primary)' : 'var(--color-bg-surface)',
                                color: openClawScope === 'workspace' ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)',
                                cursor: 'pointer', fontWeight: openClawScope === 'workspace' ? 600 : 400
                            }}
                        >
                            Project Workspace
                        </button>
                    </div>
                </Card>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <Card style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div>
                        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 4 }}>SOUL.md (Personality Core)</div>
                        <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>Defines how the AI speaks, acts, and behaves. You can make it AGI-like, direct, concise, or give it a custom persona.</div>
                    </div>
                    <textarea
                        value={soul}
                        onChange={(e) => setSoul(e.target.value)}
                        style={{
                            width: '100%', height: 260, fontFamily: 'monospace', fontSize: 13, padding: 12,
                            border: '1px solid var(--color-border)', borderRadius: 8, backgroundColor: 'var(--color-bg-subtle)', color: 'var(--color-text-primary)', resize: 'vertical'
                        }}
                        placeholder="Enter SOUL.md content..."
                    />
                </Card>

                <Card style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div>
                        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 4 }}>agents.md (Routing Protocol)</div>
                        <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>Outlines the roles and operational rules for routing tasks to specialized sub-agents.</div>
                    </div>
                    <textarea
                        value={agents}
                        onChange={(e) => setAgents(e.target.value)}
                        style={{
                            width: '100%', height: 260, fontFamily: 'monospace', fontSize: 13, padding: 12,
                            border: '1px solid var(--color-border)', borderRadius: 8, backgroundColor: 'var(--color-bg-subtle)', color: 'var(--color-text-primary)', resize: 'vertical'
                        }}
                        placeholder="Enter agents.md content..."
                    />
                </Card>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                    <button
                        onClick={handleSaveOpenClaw}
                        disabled={isSavingOpenClaw}
                        style={{
                            padding: '10px 20px', borderRadius: 10, border: 'none',
                            backgroundColor: 'var(--color-text-primary)', color: 'var(--color-text-inverse)', fontSize: 14, fontWeight: 600,
                            cursor: isSavingOpenClaw ? 'not-allowed' : 'pointer', opacity: isSavingOpenClaw ? 0.7 : 1,
                            boxShadow: '0 2px 8px rgba(0,0,0,0.1)', transition: 'all 0.2s'
                        }}
                        onMouseEnter={e => { if(!isSavingOpenClaw) e.currentTarget.style.backgroundColor = 'var(--color-text-secondary)'; }}
                        onMouseLeave={e => { if(!isSavingOpenClaw) e.currentTarget.style.backgroundColor = 'var(--color-text-primary)'; }}
                    >
                        {isSavingOpenClaw ? 'Saving...' : 'Save Configuration'}
                    </button>
                </div>
            </div>
        </motion.div>
    );
}
