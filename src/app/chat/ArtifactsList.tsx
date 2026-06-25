'use client';

import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import Image from 'next/image';

interface Artifact {
    id: string;
    name: string;
    path: string;
    type: string;
    size?: number;
    created?: string;
}

export default function ArtifactsList({ chatId, onSelect }: { chatId: string; onSelect: (name: string) => void }) {
    const [artifacts, setArtifacts] = useState<Artifact[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadArtifacts = async () => {
            try {
                const result = await (window as any).electronAPI?.artifacts?.list?.(chatId);
                if (Array.isArray(result)) {
                    const mappedArtifacts = result.map((item: any) => {
                        const fileName = typeof item === 'string' ? item : item.name;
                        return {
                            id: fileName,
                            name: fileName,
                            path: `~/.everfern/artifacts/${chatId}/${fileName}`,
                            type: typeof fileName === 'string' ? fileName.split('.').pop()?.toLowerCase() || 'file' : 'file',
                            size: item.size
                        };
                    });
                    setArtifacts(mappedArtifacts);
                }
            } catch (err) {
                console.error('Failed to load artifacts:', err);
            } finally {
                setLoading(false);
            }
        };

        if (chatId) {
            loadArtifacts();
        }
    }, [chatId]);

    if (loading || artifacts.length === 0) {
        return null;
    }

    const getFileIcon = (type: string) => {
        if (type.includes('python') || type.includes('py')) return '🐍';
        if (type.includes('html') || type.includes('html')) return '🌐';
        if (type.includes('json')) return '{ }';
        if (type.includes('image')) return '🖼️';
        if (type.includes('pdf')) return '📄';
        if (type.includes('csv') || type.includes('data')) return '📊';
        return '📎';
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}
        >
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Generated Artifacts
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {artifacts.slice(0, 5).map((artifact) => (
                    <motion.button
                        key={artifact.id}
                        whileHover={{ x: 4 }}
                        onClick={() => onSelect(artifact.name)}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            padding: '12px 14px',
                            backgroundColor: 'var(--color-bg-base)',
                            border: '1px solid var(--color-border)',
                            borderRadius: 12,
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                            textAlign: 'left',
                            width: '100%',
                            boxSizing: 'border-box',
                        }}
                        onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
                            e.currentTarget.style.backgroundColor = 'var(--color-bg-surface)';
                            e.currentTarget.style.borderColor = 'var(--color-border-strong, var(--color-border))';
                        }}
                        onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
                            e.currentTarget.style.backgroundColor = 'var(--color-bg-base)';
                            e.currentTarget.style.borderColor = 'var(--color-border)';
                        }}
                    >
                        {/* Thumbnail / Icon - Left */}
                        <div
                            style={{
                                width: 44,
                                height: 44,
                                borderRadius: 8,
                                backgroundColor: 'var(--color-bg-surface)',
                                border: '1px solid var(--color-border)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                                fontSize: 20,
                            }}
                        >
                            {artifact.type.includes('image') && artifact.path ? (
                                <div
                                    style={{
                                        width: '100%',
                                        height: '100%',
                                        borderRadius: 8,
                                        backgroundImage: `url(${artifact.path})`,
                                        backgroundSize: 'cover',
                                        backgroundPosition: 'center',
                                    }}
                                />
                            ) : (
                                getFileIcon(artifact.type)
                            )}
                        </div>

                        {/* Details - Right */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {artifact.name}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', display: 'flex', gap: 8, alignItems: 'center' }}>
                                <span>{artifact.type}</span>
                                {artifact.size && <span>•</span>}
                                {artifact.size && <span>{(artifact.size / 1024).toFixed(1)} KB</span>}
                            </div>
                        </div>

                        {/* Arrow - Far Right */}
                        <div style={{ color: 'var(--color-text-secondary)', flexShrink: 0 }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="9 18 15 12 9 6"></polyline>
                            </svg>
                        </div>
                    </motion.button>
                ))}
            </div>
        </motion.div>
    );
}
