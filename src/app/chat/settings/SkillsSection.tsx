'use client';
import React, { useState, useEffect } from 'react';
import { SectionTitle, SectionSubtitle, Card, Label, Input } from './ui';

export function SkillsSection() {
    const [customSkills, setCustomSkills] = useState<{ name: string; description: string }[]>([]);
    const [newSkillName, setNewSkillName] = useState('');
    const [newSkillDesc, setNewSkillDesc] = useState('');
    const [newSkillContent, setNewSkillContent] = useState('');
    const [isAdding, setIsAdding] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [saveResult, setSaveResult] = useState<{ success?: boolean; error?: string } | null>(null);

    useEffect(() => {
        const loadSkills = async () => {
            try {
                const skills = await (window as any).electronAPI?.skills?.listCustom?.();
                setCustomSkills(skills || []);
            } catch (e) { console.error('Failed to load custom skills:', e); }
            setIsLoading(false);
        };
        loadSkills();
    }, []);

    const handleAddSkill = async () => {
        if (!newSkillName.trim() || !newSkillDesc.trim()) return;
        setIsSaving(true);
        setSaveResult(null);
        try {
            const result = await (window as any).electronAPI?.skills?.saveCustom?.({
                name: newSkillName.trim(),
                description: newSkillDesc.trim(),
                content: newSkillContent.trim()
            });
            if (result?.success) {
                setSaveResult({ success: true });
                setNewSkillName('');
                setNewSkillDesc('');
                setNewSkillContent('');
                const skills = await (window as any).electronAPI?.skills?.listCustom?.();
                setCustomSkills(skills || []);
                setTimeout(() => setIsAdding(false), 500);
            } else {
                setSaveResult({ error: result?.error || 'Failed to save skill' });
            }
        } catch (e) { setSaveResult({ error: String(e) }); }
        setIsSaving(false);
    };

    const handleDeleteSkill = async (name: string) => {
        try {
            await (window as any).electronAPI?.skills?.deleteCustom?.(name);
            setCustomSkills(prev => prev.filter(s => s.name !== name));
        } catch (e) { console.error('Failed to delete skill:', e); }
    };

    const openCustomFolder = () => {
        (window as any).electronAPI?.skills?.getCustomPath?.().then((path: string) => {
            (window as any).electronAPI?.system?.openFolder?.(path);
        });
    };

    return (
        <div>
            <SectionTitle>Custom Skills</SectionTitle>
            <SectionSubtitle>Create and manage your own custom skills.</SectionSubtitle>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <span style={{ fontSize: 13, color: 'var(--color-text-tertiary)' }}>{customSkills.length} custom skill{customSkills.length !== 1 ? 's' : ''}</span>
                <button
                    onClick={() => { setIsAdding(true); setSaveResult(null); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', backgroundColor: 'var(--color-text-primary)', color: 'var(--color-text-inverse)', borderRadius: 10, fontWeight: 600, fontSize: 13, border: 'none', cursor: 'pointer' }}
                >
                    <span style={{ fontSize: 16 }}>+</span> Add Skill
                </button>
            </div>

            {isAdding && (
                <Card>
                    <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)', margin: '0 0 16px' }}>Create New Skill</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <div>
                            <Label>Skill Name</Label>
                            <Input
                                placeholder="e.g., my-analysis-skill"
                                value={newSkillName}
                                onChange={e => setNewSkillName(e.target.value)}
                            />
                        </div>
                        <div>
                            <Label>Description</Label>
                            <Input
                                placeholder="e.g., Use this skill for analyzing sales data"
                                value={newSkillDesc}
                                onChange={e => setNewSkillDesc(e.target.value)}
                            />
                        </div>
                        <div>
                            <Label>SKILL.md Content (Optional)</Label>
                            <textarea
                                placeholder="# My Custom Skill&#10;&#10;Write your skill instructions here..."
                                value={newSkillContent}
                                onChange={e => setNewSkillContent(e.target.value)}
                                style={{ width: '100%', minHeight: 150, padding: 12, borderRadius: 10, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-subtle)', color: 'var(--color-text-primary)', fontSize: 13, fontFamily: 'monospace', resize: 'vertical' }}
                            />
                        </div>
                        {saveResult && (
                            <div style={{ padding: '10px 14px', borderRadius: 10, backgroundColor: saveResult.success ? 'var(--color-success-dim)' : 'var(--color-error-dim)', color: saveResult.success ? 'var(--color-success)' : 'var(--color-error)', border: `1px solid ${saveResult.success ? 'var(--color-success-dim)' : 'var(--color-error-dim)'}`, fontSize: 13 }}>
                                {saveResult.success ? '✓ Skill saved successfully!' : `✗ ${saveResult.error}`}
                            </div>
                        )}
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button
                                onClick={() => setIsAdding(false)}
                                style={{ flex: 1, padding: '10px 20px', backgroundColor: 'transparent', color: 'var(--color-text-secondary)', borderRadius: 10, fontWeight: 600, fontSize: 13, border: '1px solid var(--color-border)', cursor: 'pointer' }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleAddSkill}
                                disabled={isSaving || !newSkillName.trim() || !newSkillDesc.trim()}
                                style={{ flex: 1, padding: '10px 20px', backgroundColor: 'var(--color-text-primary)', color: 'var(--color-text-inverse)', borderRadius: 10, fontWeight: 600, fontSize: 13, border: 'none', cursor: isSaving ? 'not-allowed' : 'pointer', opacity: isSaving ? 0.6 : 1 }}
                            >
                                {isSaving ? 'Saving...' : 'Save Skill'}
                            </button>
                        </div>
                    </div>
                </Card>
            )}

            {isLoading ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-tertiary)' }}>Loading...</div>
            ) : customSkills.length === 0 && !isAdding ? (
                <Card>
                    <div style={{ textAlign: 'center', padding: 20 }}>
                        <p style={{ fontSize: 14, color: 'var(--color-text-tertiary)', marginBottom: 12 }}>No custom skills yet</p>
                        <p style={{ fontSize: 12, color: 'var(--color-text-placeholder)', marginBottom: 16 }}>Create your first skill to extend EverFern's capabilities</p>
                    </div>
                </Card>
            ) : (
                customSkills.map(skill => (
                    <Card key={skill.name}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div>
                                <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', margin: '0 0 4px' }}>{skill.name}</h4>
                                <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)', margin: 0 }}>{skill.description}</p>
                            </div>
                            <button
                                onClick={() => handleDeleteSkill(skill.name)}
                                style={{ padding: '6px 10px', backgroundColor: 'var(--color-error-dim)', color: 'var(--color-error)', borderRadius: 8, fontSize: 12, fontWeight: 600, border: '1px solid var(--color-error-dim)', cursor: 'pointer' }}
                            >
                                Delete
                            </button>
                        </div>
                    </Card>
                ))
            )}

            <Card style={{ marginTop: 16 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', margin: '0 0 8px' }}>Custom Skills Location</h3>
                <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', margin: '0 0 12px', lineHeight: 1.5 }}>
                    Custom skills are stored in <code style={{ backgroundColor: 'var(--color-bg-subtle)', color: 'var(--color-text-primary)', padding: '2px 6px', borderRadius: 6, fontSize: 11 }}>~/.everfern/custom_skills/</code>
                </p>
                <button
                    onClick={openCustomFolder}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', backgroundColor: 'var(--color-bg-subtle)', color: 'var(--color-text-primary)', borderRadius: 10, fontWeight: 600, fontSize: 12, border: '1px solid var(--color-border)', cursor: 'pointer' }}
                >
                    Open Folder
                </button>
            </Card>
        </div>
    );
}
