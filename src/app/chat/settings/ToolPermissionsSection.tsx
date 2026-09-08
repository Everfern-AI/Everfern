'use client';
import React, { useState, useEffect } from 'react';
import { ShieldCheckIcon, TrashIcon, PlusIcon, XMarkIcon, PencilIcon } from '@heroicons/react/24/outline';
import { SectionTitle, SectionSubtitle, Card, Label, Input } from './ui';
/**
 * Tool permission manager: lists the auto-approval policies the user granted
 * via "Always Allow" prompts (exact or prefix match on tool/command names).
 * Supports adding, editing, and revoking individual rules or clearing all.
 */
export const ToolPermissionsSection = () => {
    const [policies, setPolicies] = useState<Array<{ id: string; type: 'exact' | 'prefix'; toolName: string; pattern: string; createdAt: string }>>([]);
    const [isLoading, setIsLoading] = useState(true);
    // Single-row edit tracking: only the policy whose id matches editingId
    // shows its edit form. The draft (editType/editPattern) is kept separate
    // from the saved list so canceling discards changes cleanly.
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editType, setEditType] = useState<'exact' | 'prefix'>('exact');
    const [editPattern, setEditPattern] = useState('');
    
    // Form for adding a new policy
    const [showAddForm, setShowAddForm] = useState(false);
    const [newToolName, setNewToolName] = useState('navis');
    const [newType, setNewType] = useState<'exact' | 'prefix'>('exact');
    const [newPattern, setNewPattern] = useState('navis');

    const loadPolicies = async (isInitial = false) => {
        // Only the initial mount shows the loading state; subsequent reloads
        // after add/edit/delete keep the current list visible (no flash) —
        // setPolicies swaps in the fresh data atomically when it arrives.
        if (isInitial) setIsLoading(true);
        try {
            // electronAPI is only injected by the Electron preload; guard every
            // access so the section still renders (just empty) in plain browsers.
            const api = (window as any).electronAPI?.toolApprovals;
            if (api?.getPolicies) {
                const list = await api.getPolicies();
                setPolicies(list || []);
            }
        } catch (err) {
            console.error('Failed to load tool approval policies:', err);
        } finally {
            if (isInitial) setIsLoading(false);
        }
    };

    useEffect(() => {
        loadPolicies(true);
    }, []);

    const handleStartEdit = (policy: any) => {
        setEditingId(policy.id);
        setEditType(policy.type);
        setEditPattern(policy.pattern);
    };

    // All mutations (save/delete/add/clear) follow the same pattern: call the
    // IPC API, then reload the full list — no optimistic local patching, so
    // the persisted store stays the single source of truth.
    const handleSaveEdit = async (id: string) => {
        try {
            const api = (window as any).electronAPI?.toolApprovals;
            if (api?.updatePolicy) {
                await api.updatePolicy(id, { type: editType, pattern: editPattern });
                setEditingId(null);
                await loadPolicies(false);
            }
        } catch (err) {
            console.error('Failed to update policy:', err);
        }
    };

    const handleDelete = async (id: string) => {
        try {
            const api = (window as any).electronAPI?.toolApprovals;
            if (api?.deletePolicy) {
                await api.deletePolicy(id);
                await loadPolicies(false);
            }
        } catch (err) {
            console.error('Failed to delete policy:', err);
        }
    };

    const handleClearAll = async () => {
        // Safety gate: bulk revoke is destructive, so demand an explicit
        // confirm before wiping every saved rule.
        if (!confirm('Are you sure you want to revoke all saved auto-approval permissions? You will be prompted for security verification again on future tool executions.')) return;
        try {
            const api = (window as any).electronAPI?.toolApprovals;
            if (api?.clearAll) {
                await api.clearAll();
                await loadPolicies(false);
            }
        } catch (err) {
            console.error('Failed to clear policies:', err);
        }
    };

    const handleAddPolicy = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newToolName.trim() || !newPattern.trim()) return;
        try {
            const api = (window as any).electronAPI?.toolApprovals;
            if (api?.addPolicy) {
                await api.addPolicy({
                    toolName: newToolName.trim(),
                    type: newType,
                    pattern: newPattern.trim()
                });
                // Reset to the default 'navis' seed values so the next add
                // starts from the common case, and close the form.
                setShowAddForm(false);
                setNewToolName('navis');
                setNewPattern('navis');
                await loadPolicies(false);
            }
        } catch (err) {
            console.error('Failed to add policy:', err);
        }
    };

    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <SectionTitle>Tool Permissions (Always Allow)</SectionTitle>
                {policies.length > 0 && (
                    <button
                        onClick={handleClearAll}
                        style={{
                            padding: '6px 12px', borderRadius: 8, border: '1px solid var(--color-border)',
                            backgroundColor: 'var(--color-bg-subtle)', color: '#ef4444',
                            fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s'
                        }}
                        onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'}
                        onMouseLeave={e => e.currentTarget.style.backgroundColor = 'var(--color-bg-subtle)'}
                    >
                        Revoke All
                    </button>
                )}
            </div>
            <SectionSubtitle>
                View and edit permissions granted when selecting "Always Allow". You can edit approval match rules or revoke permissions anytime.
            </SectionSubtitle>

            {/* Add Policy Toggle Button */}
            <div style={{ marginBottom: 20 }}>
                {!showAddForm ? (
                    <button
                        onClick={() => setShowAddForm(true)}
                        style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6,
                            padding: '8px 14px', borderRadius: 10,
                            backgroundColor: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)',
                            color: 'var(--color-text-primary)', fontSize: 13, fontWeight: 600,
                            cursor: 'pointer', transition: 'all 0.15s'
                        }}
                        onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)'}
                        onMouseLeave={e => e.currentTarget.style.backgroundColor = 'var(--color-bg-subtle)'}
                    >
                        <PlusIcon width={14} height={14} />
                        Add New Auto-Approval Rule
                    </button>
                ) : (
                    <Card style={{ padding: 20, marginBottom: 20 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>New Auto-Approval Rule</span>
                            <button
                                onClick={() => setShowAddForm(false)}
                                style={{ background: 'none', border: 'none', color: 'var(--color-text-tertiary)', cursor: 'pointer' }}
                            >
                                <XMarkIcon width={16} height={16} />
                            </button>
                        </div>
                        <form onSubmit={handleAddPolicy} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <div style={{ display: 'flex', gap: 12 }}>
                                <div style={{ flex: 1 }}>
                                    <Label>Tool Name</Label>
                                    <Input
                                        placeholder="e.g. navis, run_command, browser_subagent"
                                        value={newToolName}
                                        onChange={e => setNewToolName(e.target.value)}
                                        required
                                    />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <Label>Match Type</Label>
                                    <select
                                        value={newType}
                                        onChange={e => setNewType(e.target.value as any)}
                                        style={{
                                            width: '100%', padding: '12px 16px', backgroundColor: 'var(--color-bg-subtle)',
                                            border: '1px solid var(--color-border)', borderRadius: 12, color: 'var(--color-text-primary)',
                                            fontSize: 14, outline: 'none', fontFamily: 'var(--font-sans)'
                                        }}
                                    >
                                        <option value="exact">Exact Tool/Command Name</option>
                                        <option value="prefix">Prefix Match (e.g. npm, git)</option>
                                    </select>
                                </div>
                            </div>
                            <div>
                                <Label>Pattern / Command Base</Label>
                                <Input
                                    placeholder="e.g. navis or npm"
                                    value={newPattern}
                                    onChange={e => setNewPattern(e.target.value)}
                                    required
                                />
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                                <button
                                    type="button"
                                    onClick={() => setShowAddForm(false)}
                                    style={{
                                        padding: '8px 16px', borderRadius: 10, border: '1px solid var(--color-border)',
                                        backgroundColor: 'transparent', color: 'var(--color-text-secondary)',
                                        fontSize: 13, fontWeight: 500, cursor: 'pointer'
                                    }}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    style={{
                                        padding: '8px 16px', borderRadius: 10, border: 'none',
                                        backgroundColor: 'var(--color-text-primary)', color: 'var(--color-bg-surface)',
                                        fontSize: 13, fontWeight: 600, cursor: 'pointer'
                                    }}
                                >
                                    Save Rule
                                </button>
                            </div>
                        </form>
                    </Card>
                )}
            </div>

            {/* List of active policies */}
            {isLoading ? (
                <div style={{ padding: '30px 0', textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: 13 }}>
                    Loading permissions...
                </div>
            ) : policies.length === 0 ? (
                <Card style={{ textAlign: 'center', padding: '36px 20px' }}>
                    <ShieldCheckIcon width={32} height={32} style={{ color: 'var(--color-text-tertiary)', margin: '0 auto 12px' }} />
                    <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 6 }}>
                        No Saved Auto-Approvals
                    </div>
                    <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)', margin: 0, maxWidth: 420, marginInline: 'auto', lineHeight: 1.5 }}>
                        When you authorize actions with "Always Allow" during security prompts, your granted permissions will be listed here for you to view, edit, or revoke.
                    </p>
                </Card>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {policies.map(policy => {
                        const isEditing = editingId === policy.id;
                        return (
                            <Card key={policy.id} style={{ marginBottom: 0, padding: 18 }}>
                                {isEditing ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                                                Editing Permission for {policy.toolName}
                                            </span>
                                            <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>ID: {policy.id}</span>
                                        </div>
                                        <div style={{ display: 'flex', gap: 12 }}>
                                            <div style={{ flex: 1 }}>
                                                <Label>Match Type</Label>
                                                <select
                                                    value={editType}
                                                    onChange={e => setEditType(e.target.value as any)}
                                                    style={{
                                                        width: '100%', padding: '10px 14px', backgroundColor: 'var(--color-bg-subtle)',
                                                        border: '1px solid var(--color-border)', borderRadius: 10, color: 'var(--color-text-primary)',
                                                        fontSize: 13, outline: 'none', fontFamily: 'var(--font-sans)'
                                                    }}
                                                >
                                                    <option value="exact">Exact Match</option>
                                                    <option value="prefix">Prefix Match</option>
                                                </select>
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                <Label>Pattern</Label>
                                                <Input
                                                    value={editPattern}
                                                    onChange={e => setEditPattern(e.target.value)}
                                                    style={{ padding: '8px 12px', fontSize: 13 }}
                                                />
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                                            <button
                                                onClick={() => setEditingId(null)}
                                                style={{
                                                    padding: '6px 12px', borderRadius: 8, border: '1px solid var(--color-border)',
                                                    backgroundColor: 'transparent', color: 'var(--color-text-secondary)',
                                                    fontSize: 12, fontWeight: 500, cursor: 'pointer'
                                                }}
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                onClick={() => handleSaveEdit(policy.id)}
                                                style={{
                                                    padding: '6px 12px', borderRadius: 8, border: 'none',
                                                    backgroundColor: 'var(--color-text-primary)', color: 'var(--color-bg-surface)',
                                                    fontSize: 12, fontWeight: 600, cursor: 'pointer'
                                                }}
                                            >
                                                Save
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                                            <div style={{
                                                width: 38, height: 38, borderRadius: 10,
                                                backgroundColor: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#10b981', flexShrink: 0
                                            }}>
                                                <ShieldCheckIcon width={20} height={20} />
                                            </div>
                                            <div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                                                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                                                        {policy.toolName}
                                                    </span>
                                                    <span style={{
                                                        fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                                                        backgroundColor: policy.type === 'exact' ? 'var(--color-bg-subtle)' : 'rgba(59, 130, 246, 0.1)',
                                                        color: policy.type === 'exact' ? 'var(--color-text-secondary)' : '#3b82f6',
                                                        border: policy.type === 'exact' ? '1px solid var(--color-border)' : '1px solid rgba(59, 130, 246, 0.2)',
                                                        textTransform: 'uppercase', letterSpacing: '0.04em'
                                                    }}>
                                                        {policy.type} match
                                                    </span>
                                                </div>
                                                <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', fontFamily: 'monospace' }}>
                                                    Pattern: <span style={{ color: 'var(--color-text-secondary)' }}>{policy.pattern}</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <button
                                                onClick={() => handleStartEdit(policy)}
                                                style={{
                                                    padding: '6px 10px', borderRadius: 8, border: '1px solid var(--color-border)',
                                                    backgroundColor: 'var(--color-bg-subtle)', color: 'var(--color-text-secondary)',
                                                    fontSize: 12, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
                                                    transition: 'all 0.15s'
                                                }}
                                                onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)'}
                                                onMouseLeave={e => e.currentTarget.style.backgroundColor = 'var(--color-bg-subtle)'}
                                            >
                                                <PencilIcon width={13} height={13} />
                                                Edit
                                            </button>
                                            <button
                                                onClick={() => handleDelete(policy.id)}
                                                style={{
                                                    padding: '6px 10px', borderRadius: 8, border: '1px solid var(--color-border)',
                                                    backgroundColor: 'transparent', color: '#ef4444',
                                                    fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
                                                    transition: 'all 0.15s'
                                                }}
                                                onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'}
                                                onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                                            >
                                                <TrashIcon width={13} height={13} />
                                                Revoke
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </Card>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
