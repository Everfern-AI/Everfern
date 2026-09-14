'use client';
import React, { useState, useEffect } from 'react';
import { ServerIcon } from '@heroicons/react/24/outline';
import { Card } from './ui';
export const RegisteredToolsList = () => {
    const [tools, setTools] = useState<{ name: string; description: string }[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const loadTools = async () => {
            try {
                const res = await (window as any).electronAPI?.acp?.listTools?.();
                if (res?.success) {
                    setTools(res.tools || []);
                }
            } catch (e) {
                console.error('Failed to load tools:', e);
            }
            setIsLoading(false);
        };
        loadTools();
    }, []);

    if (isLoading) return <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-tertiary)' }}>Loading tools...</div>;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {tools.length === 0 ? (
                <Card>
                    <p style={{ textAlign: 'center', fontSize: 14, color: 'var(--color-text-tertiary)', margin: 0 }}>No tools registered</p>
                </Card>
            ) : (
                tools.map(tool => (
                    <Card key={tool.name} style={{ padding: '16px 20px' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                            <div style={{ padding: '8px', backgroundColor: 'var(--color-bg-subtle)', borderRadius: 10, color: 'var(--color-text-primary)' }}>
                                <ServerIcon width={18} height={18} />
                            </div>
                            <div style={{ flex: 1 }}>
                                <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', margin: '0 0 4px', fontFamily: 'monospace' }}>{tool.name}</h4>
                                <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)', margin: 0, lineHeight: 1.4 }}>{tool.description}</p>
                            </div>
                        </div>
                    </Card>
                ))
            )}
        </div>
    );
};
