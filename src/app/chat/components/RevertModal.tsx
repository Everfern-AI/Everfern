import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    XMarkIcon,
    ArrowPathIcon,
    DocumentTextIcon,
    TrashIcon,
    CommandLineIcon,
    PencilIcon,
    FolderIcon,
    ExclamationTriangleIcon,
    ChevronDownIcon,
    ChevronRightIcon,
    EyeIcon,
    ShieldExclamationIcon,
    ClockIcon,
    DocumentIcon
} from '@heroicons/react/24/outline';

interface PreviewFile {
    filePath: string;
    operation: 'create' | 'modify' | 'delete';
    contentSizeBytes: number;
    willRestore: boolean;
    warning?: string;
    lastModified?: string;
    snapshotId?: string;
}

interface PreviewCommand {
    command: string;
    reversible: boolean;
    rollbackCommand?: string;
    linkedSnapshots: number;
}

interface RollbackPreview {
    stepNumber: number;
    files: PreviewFile[];
    commands: PreviewCommand[];
    totalFilesToRestore: number;
    totalSizeBytes: number;
    hasIrreversibleCommands: boolean;
    hasUnrestorableFiles: boolean;
    riskLevel: 'low' | 'medium' | 'high';
}

interface RevertModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    conversationId: string | null;
    targetTimestamp: number | null;
}

const OPERATION_META: Record<string, { icon: typeof DocumentTextIcon; label: string; color: string }> = {
    create: { icon: DocumentTextIcon, label: 'Created', color: 'var(--color-success)' },
    modify: { icon: PencilIcon, label: 'Modified', color: 'var(--color-warning)' },
    delete: { icon: TrashIcon, label: 'Deleted', color: 'var(--color-error)' },
};

const RISK_COLORS: Record<string, { bg: string; border: string; text: string; label: string }> = {
    low: { bg: 'var(--color-info-dim)', border: 'var(--color-info)', text: 'var(--color-info)', label: 'Low Risk' },
    medium: { bg: 'var(--color-warning-dim)', border: 'var(--color-warning)', text: 'var(--color-warning)', label: 'Medium Risk' },
    high: { bg: 'var(--color-error-dim)', border: 'var(--color-error)', text: 'var(--color-error)', label: 'High Risk' },
};

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function truncatePath(p: string, maxLen = 60): string {
    if (p.length <= maxLen) return p;
    const parts = p.split(/[/\\]/);
    let result = parts.pop() || '';
    let remaining = maxLen - result.length - 3;
    for (let i = parts.length - 1; i >= 0 && remaining > 0; i--) {
        const part = parts[i];
        if (part.length + 1 <= remaining) {
            result = part + '/' + result;
            remaining -= part.length + 1;
        } else {
            result = '…/' + result;
            break;
        }
    }
    return result;
}

export default function RevertModal({ isOpen, onClose, onConfirm, conversationId, targetTimestamp }: RevertModalProps) {
    const [preview, setPreview] = useState<RollbackPreview | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
    const [fileDiffs, setFileDiffs] = useState<Record<string, { contentBefore: string; contentAfter: string } | null>>({});
    const [loadingDiffs, setLoadingDiffs] = useState<Set<string>>(new Set());

    useEffect(() => {
        if (!isOpen || !conversationId || !targetTimestamp) {
            setPreview(null);
            setLoading(true);
            setError(null);
            setExpandedFiles(new Set());
            setFileDiffs({});
            return;
        }

        const fetchPreview = async () => {
            setLoading(true);
            setError(null);
            setExpandedFiles(new Set());
            setFileDiffs({});

            try {
                const result: RollbackPreview | null = await (window as any).electronAPI?.acp?.getRollbackPreview?.(conversationId, targetTimestamp);
                if (result) {
                    setPreview(result);
                } else {
                    setPreview(null);
                }
            } catch (err) {
                setError('Failed to load rollback preview');
                console.error('Error fetching rollback preview:', err);
            } finally {
                setLoading(false);
            }
        };

        fetchPreview();
    }, [isOpen, conversationId, targetTimestamp]);

    const toggleFileExpanded = useCallback(async (filePath: string, snapshotId?: string) => {
        if (!snapshotId) return;

        setExpandedFiles(prev => {
            const next = new Set(prev);
            if (next.has(filePath)) {
                next.delete(filePath);
            } else {
                next.add(filePath);
            }
            return next;
        });

        if (!fileDiffs[filePath] && snapshotId) {
            setLoadingDiffs(prev => new Set(prev).add(filePath));
            try {
                const content = await (window as any).electronAPI?.acp?.getSnapshotContent?.(snapshotId);
                setFileDiffs(prev => ({ ...prev, [filePath]: content }));
            } catch (err) {
                console.error('Failed to load snapshot content:', err);
                setFileDiffs(prev => ({ ...prev, [filePath]: null }));
            } finally {
                setLoadingDiffs(prev => {
                    const next = new Set(prev);
                    next.delete(filePath);
                    return next;
                });
            }
        }
    }, [fileDiffs]);

    const handleConfirm = () => {
        onConfirm();
        onClose();
    };

    if (!isOpen) return null;

    const riskCfg = preview ? RISK_COLORS[preview.riskLevel] : RISK_COLORS.low;
    const fileEntries = preview?.files ?? [];
    const commandEntries = preview?.commands ?? [];
    const hasFiles = fileEntries.length > 0;
    const hasCommands = commandEntries.length > 0;

    return (
        <AnimatePresence>
            <div style={{
                position: 'fixed',
                inset: 0,
                backgroundColor: 'var(--color-bg-overlay)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1000,
                padding: '20px'
            }}>
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    style={{
                        backgroundColor: 'var(--color-bg-surface)',
                        borderRadius: '24px',
                        border: '1px solid var(--color-border)',
                        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                        width: '100%',
                        maxWidth: '680px',
                        maxHeight: '85vh',
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column'
                    }}
                >
                    {/* Header */}
                    <div style={{
                        padding: '24px 32px',
                        borderBottom: '1px solid var(--color-border-subtle)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div style={{
                                width: '40px',
                                height: '40px',
                                backgroundColor: 'var(--color-warning-dim)',
                                borderRadius: '12px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}>
                                <ArrowPathIcon style={{ width: '20px', height: '20px', color: 'var(--color-warning)' }} />
                            </div>
                            <div>
                                <h2 style={{
                                    fontSize: '20px',
                                    fontWeight: 600,
                                    color: 'var(--color-text-primary)',
                                    margin: 0,
                                    fontFamily: "'Figtree', system-ui, sans-serif"
                                }}>
                                    Rollback Preview
                                </h2>
                                <p style={{
                                    fontSize: '14px',
                                    color: 'var(--color-text-secondary)',
                                    margin: '4px 0 0',
                                    fontFamily: "'Figtree', system-ui, sans-serif"
                                }}>
                                    Review changes that will be undone
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            style={{
                                padding: '8px',
                                backgroundColor: 'transparent',
                                border: 'none',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                color: 'var(--color-text-tertiary)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}
                            onMouseEnter={e => {
                                e.currentTarget.style.backgroundColor = 'var(--color-bg-subtle)';
                                e.currentTarget.style.color = 'var(--color-text-secondary)';
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.backgroundColor = 'transparent';
                                e.currentTarget.style.color = 'var(--color-text-tertiary)';
                            }}
                        >
                            <XMarkIcon style={{ width: '20px', height: '20px' }} />
                        </button>
                    </div>

                    {/* Content */}
                    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                        {loading ? (
                            <div style={{
                                flex: 1,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: '40px'
                            }}>
                                <div style={{
                                    width: '32px',
                                    height: '32px',
                                    border: '3px solid var(--color-border-subtle)',
                                    borderTop: '3px solid var(--color-info)',
                                    borderRadius: '50%',
                                    animation: 'spin 1s linear infinite'
                                }} />
                                <p style={{
                                    marginLeft: '16px',
                                    color: 'var(--color-text-tertiary)',
                                    fontSize: '14px',
                                    fontFamily: "'Figtree', system-ui, sans-serif"
                                }}>
                                    Analyzing changes...
                                </p>
                            </div>
                        ) : error ? (
                            <div style={{
                                flex: 1,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: '40px',
                                flexDirection: 'column'
                            }}>
                                <ExclamationTriangleIcon style={{ width: '48px', height: '48px', color: 'var(--color-error)', marginBottom: '16px' }} />
                                <p style={{
                                    color: 'var(--color-error)',
                                    fontSize: '16px',
                                    fontWeight: 500,
                                    marginBottom: '8px',
                                    fontFamily: "'Figtree', system-ui, sans-serif"
                                }}>
                                    Error Loading Preview
                                </p>
                                <p style={{
                                    color: 'var(--color-text-secondary)',
                                    fontSize: '14px',
                                    textAlign: 'center',
                                    fontFamily: "'Figtree', system-ui, sans-serif"
                                }}>
                                    {error}
                                </p>
                            </div>
                        ) : !hasFiles && !hasCommands ? (
                            <div style={{
                                flex: 1,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: '40px',
                                flexDirection: 'column'
                            }}>
                                <ArrowPathIcon style={{ width: '48px', height: '48px', color: 'var(--color-text-placeholder)', marginBottom: '16px' }} />
                                <p style={{
                                    color: 'var(--color-text-secondary)',
                                    fontSize: '16px',
                                    fontWeight: 500,
                                    marginBottom: '8px',
                                    fontFamily: "'Figtree', system-ui, sans-serif"
                                }}>
                                    No Changes to Revert
                                </p>
                                <p style={{
                                    color: 'var(--color-text-tertiary)',
                                    fontSize: '14px',
                                    textAlign: 'center',
                                    fontFamily: "'Figtree', system-ui, sans-serif"
                                }}>
                                    There are no changes after this point in the conversation.
                                </p>
                            </div>
                        ) : (
                            <>
                                {/* Warning Banner */}
                                <div style={{
                                    margin: '24px 32px 12px',
                                    padding: '16px',
                                    backgroundColor: riskCfg.bg,
                                    border: `1px solid ${riskCfg.border}`,
                                    borderRadius: '12px',
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: '12px'
                                }}>
                                    <ShieldExclamationIcon style={{ width: '20px', height: '20px', color: riskCfg.text, flexShrink: 0, marginTop: '1px' }} />
                                    <div style={{ flex: 1 }}>
                                        <div style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            gap: '12px'
                                        }}>
                                            <p style={{
                                                fontSize: '14px',
                                                fontWeight: 600,
                                                color: riskCfg.text,
                                                margin: '0 0 4px',
                                                fontFamily: "'Figtree', system-ui, sans-serif"
                                            }}>
                                                {riskCfg.label} &middot; {preview!.totalFilesToRestore} file{preview!.totalFilesToRestore !== 1 ? 's' : ''} will be restored
                                            </p>
                                            <span style={{
                                                fontSize: '12px',
                                                color: 'var(--color-text-secondary)',
                                                fontFamily: "'JetBrains Mono', monospace",
                                                whiteSpace: 'nowrap'
                                            }}>
                                                {formatSize(preview!.totalSizeBytes)} total
                                            </span>
                                        </div>
                                        <p style={{
                                            fontSize: '13px',
                                            color: 'var(--color-text-secondary)',
                                            margin: '4px 0 0',
                                            lineHeight: '1.4',
                                            fontFamily: "'Figtree', system-ui, sans-serif"
                                        }}>
                                            {preview!.hasIrreversibleCommands
                                                ? 'Some commands cannot be automatically reversed. Manual intervention may be required.'
                                                : 'Reverting will restore files to their previous state and undo the listed commands.'}
                                            {preview!.hasUnrestorableFiles && ' Some files cannot be restored.'}
                                        </p>
                                    </div>
                                </div>

                                {/* Changes List */}
                                <div style={{
                                    flex: 1,
                                    overflowY: 'auto',
                                    padding: '0 32px',
                                    marginBottom: '8px'
                                }}>
                                    {hasFiles && (
                                        <div style={{ marginBottom: '16px' }}>
                                            <h3 style={{
                                                fontSize: '14px',
                                                fontWeight: 600,
                                                color: 'var(--color-text-primary)',
                                                margin: '0 0 8px',
                                                fontFamily: "'Figtree', system-ui, sans-serif",
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '8px'
                                            }}>
                                                <DocumentTextIcon style={{ width: '16px', height: '16px', color: 'var(--color-text-tertiary)' }} />
                                                File Changes ({fileEntries.length})
                                            </h3>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                {fileEntries.map((file, index) => {
                                                    const meta = OPERATION_META[file.operation] || OPERATION_META.modify;
                                                    const Icon = meta.icon;
                                                    const isExpanded = expandedFiles.has(file.filePath);
                                                    const diff = fileDiffs[file.filePath];
                                                    const isLoadingDiff = loadingDiffs.has(file.filePath);

                                                    return (
                                                        <div key={index} style={{
                                                            borderRadius: '10px',
                                                            border: `1px solid ${file.warning ? 'var(--color-warning)' : 'var(--color-border-subtle)'}`,
                                                            overflow: 'hidden',
                                                            backgroundColor: file.warning ? 'var(--color-warning-dim)' : 'var(--color-bg-base)',
                                                        }}>
                                                            <button
                                                                onClick={() => toggleFileExpanded(file.filePath, file.snapshotId)}
                                                                disabled={!file.snapshotId}
                                                                style={{
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '10px',
                                                                    width: '100%',
                                                                    padding: '10px 12px',
                                                                    border: 'none',
                                                                    background: 'transparent',
                                                                    cursor: file.snapshotId ? 'pointer' : 'default',
                                                                    textAlign: 'left',
                                                                    color: 'var(--color-text-primary)',
                                                                }}
                                                            >
                                                                <div style={{
                                                                    width: '28px',
                                                                    height: '28px',
                                                                    backgroundColor: 'var(--color-bg-surface)',
                                                                    border: '1px solid var(--color-border)',
                                                                    borderRadius: '6px',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    justifyContent: 'center',
                                                                    color: meta.color,
                                                                    flexShrink: 0
                                                                }}>
                                                                    <Icon style={{ width: '14px', height: '14px' }} />
                                                                </div>
                                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                                    <div style={{
                                                                        fontSize: '13px',
                                                                        fontWeight: 500,
                                                                        color: 'var(--color-text-primary)',
                                                                        fontFamily: "'JetBrains Mono', monospace",
                                                                        overflow: 'hidden',
                                                                        textOverflow: 'ellipsis',
                                                                        whiteSpace: 'nowrap'
                                                                    }}>
                                                                        {truncatePath(file.filePath)}
                                                                    </div>
                                                                    <div style={{
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        gap: '8px',
                                                                        marginTop: '2px'
                                                                    }}>
                                                                        <span style={{
                                                                            fontSize: '11px',
                                                                            fontWeight: 600,
                                                                            color: meta.color,
                                                                            fontFamily: "'Figtree', system-ui, sans-serif"
                                                                        }}>
                                                                            {meta.label}
                                                                        </span>
                                                                        <span style={{
                                                                            fontSize: '11px',
                                                                            color: 'var(--color-text-tertiary)',
                                                                            fontFamily: "'Figtree', system-ui, sans-serif"
                                                                        }}>
                                                                            {formatSize(file.contentSizeBytes)}
                                                                        </span>
                                                                        {file.warning && (
                                                                            <span style={{
                                                                                display: 'flex',
                                                                                alignItems: 'center',
                                                                                gap: '3px',
                                                                                fontSize: '11px',
                                                                                color: 'var(--color-warning)',
                                                                            }}>
                                                                                <ExclamationTriangleIcon style={{ width: '11px', height: '11px' }} />
                                                                                Warning
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                                {file.snapshotId && (
                                                                    <div style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }}>
                                                                        {isLoadingDiff ? (
                                                                            <div style={{
                                                                                width: '14px',
                                                                                height: '14px',
                                                                                border: '2px solid var(--color-border-subtle)',
                                                                                borderTop: '2px solid var(--color-info)',
                                                                                borderRadius: '50%',
                                                                                animation: 'spin 1s linear infinite'
                                                                            }} />
                                                                        ) : isExpanded ? (
                                                                            <ChevronDownIcon style={{ width: '14px', height: '14px' }} />
                                                                        ) : (
                                                                            <EyeIcon style={{ width: '14px', height: '14px' }} />
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </button>
                                                            {isExpanded && (
                                                                <div style={{
                                                                    borderTop: '1px solid var(--color-border-subtle)',
                                                                    padding: '12px'
                                                                }}>
                                                                    {diff ? (
                                                                        <FileDiffViewer
                                                                            contentBefore={diff.contentBefore}
                                                                            contentAfter={diff.contentAfter}
                                                                            fileName={file.filePath.split(/[/\\]/).pop() || ''}
                                                                        />
                                                                    ) : diff === null ? (
                                                                        <p style={{
                                                                            fontSize: '12px',
                                                                            color: 'var(--color-text-tertiary)',
                                                                            fontFamily: "'Figtree', system-ui, sans-serif",
                                                                            textAlign: 'center',
                                                                            padding: '16px'
                                                                        }}>
                                                                            Could not load file content
                                                                        </p>
                                                                    ) : (
                                                                        <p style={{
                                                                            fontSize: '12px',
                                                                            color: 'var(--color-text-tertiary)',
                                                                            fontFamily: "'Figtree', system-ui, sans-serif",
                                                                            textAlign: 'center',
                                                                            padding: '16px'
                                                                        }}>
                                                                            No snapshot content available
                                                                        </p>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {hasCommands && (
                                        <div style={{ marginBottom: '16px' }}>
                                            <h3 style={{
                                                fontSize: '14px',
                                                fontWeight: 600,
                                                color: 'var(--color-text-primary)',
                                                margin: '0 0 8px',
                                                fontFamily: "'Figtree', system-ui, sans-serif",
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '8px'
                                            }}>
                                                <CommandLineIcon style={{ width: '16px', height: '16px', color: 'var(--color-text-tertiary)' }} />
                                                Commands ({commandEntries.length})
                                            </h3>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                {commandEntries.map((cmd, index) => (
                                                    <div
                                                        key={index}
                                                        style={{
                                                            padding: '10px 12px',
                                                            backgroundColor: 'var(--color-bg-base)',
                                                            border: '1px solid var(--color-border-subtle)',
                                                            borderRadius: '10px'
                                                        }}
                                                    >
                                                        <div style={{
                                                            fontSize: '12px',
                                                            fontFamily: "'JetBrains Mono', monospace",
                                                            color: 'var(--color-text-primary)',
                                                            wordBreak: 'break-all',
                                                            marginBottom: '4px'
                                                        }}>
                                                            {cmd.command}
                                                        </div>
                                                        <div style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '8px',
                                                            fontSize: '11px',
                                                            color: 'var(--color-text-tertiary)',
                                                            fontFamily: "'Figtree', system-ui, sans-serif"
                                                        }}>
                                                            {cmd.reversible ? (
                                                                <span style={{ color: 'var(--color-success)' }}>
                                                                    Reversible
                                                                </span>
                                                            ) : (
                                                                <span style={{ color: 'var(--color-error)' }}>
                                                                    <ExclamationTriangleIcon style={{ width: '11px', height: '11px', display: 'inline', marginRight: '3px', verticalAlign: 'middle' }} />
                                                                    Not reversible
                                                                </span>
                                                            )}
                                                            {cmd.linkedSnapshots > 0 && (
                                                                <span>
                                                                    {cmd.linkedSnapshots} file snapshot{cmd.linkedSnapshots !== 1 ? 's' : ''}
                                                                </span>
                                                            )}
                                                            {cmd.rollbackCommand && cmd.reversible && (
                                                                <span style={{ color: 'var(--color-info)' }}>
                                                                    Rollback: {cmd.rollbackCommand}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </>
                        )}
                    </div>

                    {/* Footer */}
                    <div style={{
                        padding: '20px 32px',
                        borderTop: '1px solid var(--color-border)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '12px'
                    }}>
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '16px',
                            fontSize: '12px',
                            color: 'var(--color-text-tertiary)',
                            fontFamily: "'Figtree', system-ui, sans-serif"
                        }}>
                            {preview && (
                                <>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <DocumentIcon style={{ width: '14px', height: '14px' }} />
                                        {preview.totalFilesToRestore} file{preview.totalFilesToRestore !== 1 ? 's' : ''}
                                    </span>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <ClockIcon style={{ width: '14px', height: '14px' }} />
                                        {formatSize(preview.totalSizeBytes)}
                                    </span>
                                </>
                            )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <button
                                onClick={onClose}
                                style={{
                                    padding: '12px 20px',
                                    backgroundColor: 'transparent',
                                    border: '1px solid var(--color-border)',
                                    borderRadius: '12px',
                                    cursor: 'pointer',
                                    fontSize: '14px',
                                    fontWeight: 500,
                                    color: 'var(--color-text-secondary)',
                                    fontFamily: "'Figtree', system-ui, sans-serif"
                                }}
                                onMouseEnter={e => {
                                    e.currentTarget.style.backgroundColor = 'var(--color-bg-subtle)';
                                    e.currentTarget.style.borderColor = 'var(--color-border-strong)';
                                }}
                                onMouseLeave={e => {
                                    e.currentTarget.style.backgroundColor = 'transparent';
                                    e.currentTarget.style.borderColor = 'var(--color-border)';
                                }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleConfirm}
                                disabled={loading || error !== null}
                                style={{
                                    padding: '12px 20px',
                                    backgroundColor: loading || error !== null ? 'var(--color-bg-subtle)' : 'var(--color-error)',
                                    border: 'none',
                                    borderRadius: '12px',
                                    cursor: loading || error !== null ? 'not-allowed' : 'pointer',
                                    fontSize: '14px',
                                    fontWeight: 600,
                                    color: loading || error !== null ? 'var(--color-text-placeholder)' : 'var(--color-text-inverse)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    fontFamily: "'Figtree', system-ui, sans-serif"
                                }}
                                onMouseEnter={e => {
                                    if (!loading && error === null) {
                                        e.currentTarget.style.opacity = '0.9';
                                    }
                                }}
                                onMouseLeave={e => {
                                    if (!loading && error === null) {
                                        e.currentTarget.style.opacity = '1.0';
                                    }
                                }}
                            >
                                <ArrowPathIcon style={{ width: '16px', height: '16px' }} />
                                {preview && preview.totalFilesToRestore > 0
                                    ? `Rollback ${preview.totalFilesToRestore} File${preview.totalFilesToRestore !== 1 ? 's' : ''}`
                                    : 'Revert Conversation'}
                            </button>
                        </div>
                    </div>
                </motion.div>

                <style>{`
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                `}</style>
            </div>
        </AnimatePresence>
    );
}

function FileDiffViewer({ contentBefore, contentAfter, fileName }: { contentBefore: string; contentAfter: string; fileName: string }) {
    const isBinary = contentBefore === '[Binary content]' || contentAfter === '[Binary content]';

    if (isBinary) {
        return (
            <div style={{
                padding: '16px',
                textAlign: 'center',
                fontSize: '12px',
                color: 'var(--color-text-tertiary)',
                fontFamily: "'Figtree', system-ui, sans-serif"
            }}>
                Binary file — diff not available
            </div>
        );
    }

    // Simple unified diff rendering using inline styles (no external dep needed)
    const beforeLines = (contentBefore || '').split('\n');
    const afterLines = (contentAfter || '').split('\n');
    const maxLen = Math.max(beforeLines.length, afterLines.length);

    return (
        <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '11px',
            lineHeight: '1.5',
            maxHeight: '300px',
            overflow: 'auto',
            borderRadius: '8px',
            border: '1px solid var(--color-border-subtle)',
        }}>
            <div style={{
                padding: '6px 10px',
                backgroundColor: 'var(--color-bg-surface)',
                borderBottom: '1px solid var(--color-border-subtle)',
                fontSize: '11px',
                fontWeight: 600,
                color: 'var(--color-text-secondary)',
                fontFamily: "'Figtree', system-ui, sans-serif",
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                position: 'sticky',
                top: 0,
                zIndex: 1
            }}>
                <span>{fileName}</span>
                <span style={{ color: 'var(--color-success)', fontWeight: 500 }}>
                    +{countChanges('add', beforeLines, afterLines)}
                </span>
                <span style={{ color: 'var(--color-error)', fontWeight: 500 }}>
                    -{countChanges('del', beforeLines, afterLines)}
                </span>
            </div>
            <div style={{ padding: '4px 0' }}>
                {renderUnifiedDiff(beforeLines, afterLines)}
            </div>
        </div>
    );
}

function countChanges(type: 'add' | 'del', before: string[], after: string[]): number {
    if (type === 'add') {
        return after.filter((_, i) => i >= before.length || before[i] !== after[i]).length;
    }
    return before.filter((_, i) => i >= after.length || before[i] !== after[i]).length;
}

function renderUnifiedDiff(before: string[], after: string[]): React.ReactNode[] {
    const maxLen = Math.max(before.length, after.length);
    const result: React.ReactNode[] = [];

    for (let i = 0; i < maxLen; i++) {
        const bLine = i < before.length ? before[i] : undefined;
        const aLine = i < after.length ? after[i] : undefined;

        if (bLine === aLine) {
            result.push(
                <div key={i} style={{
                    padding: '0 10px',
                    color: 'var(--color-text-tertiary)',
                    backgroundColor: 'transparent',
                    display: 'flex',
                }}>
                    <span style={{ width: '24px', flexShrink: 0, textAlign: 'right', marginRight: '8px', color: 'var(--color-text-placeholder)', userSelect: 'none' }}>{i + 1}</span>
                    <span style={{ width: '12px', flexShrink: 0, textAlign: 'center', userSelect: 'none' }}> </span>
                    <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{bLine}</span>
                </div>
            );
        } else {
            if (bLine !== undefined) {
                result.push(
                    <div key={`del-${i}`} style={{
                        padding: '0 10px',
                        color: 'var(--color-error)',
                        backgroundColor: 'rgba(248,81,73,0.1)',
                        display: 'flex',
                    }}>
                        <span style={{ width: '24px', flexShrink: 0, textAlign: 'right', marginRight: '8px', color: 'var(--color-text-placeholder)', userSelect: 'none' }}>{i + 1}</span>
                        <span style={{ width: '12px', flexShrink: 0, textAlign: 'center', userSelect: 'none' }}>-</span>
                        <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{bLine}</span>
                    </div>
                );
            }
            if (aLine !== undefined) {
                result.push(
                    <div key={`add-${i}`} style={{
                        padding: '0 10px',
                        color: 'var(--color-success)',
                        backgroundColor: 'rgba(46,160,67,0.1)',
                        display: 'flex',
                    }}>
                        <span style={{ width: '24px', flexShrink: 0, textAlign: 'right', marginRight: '8px', color: 'var(--color-text-placeholder)', userSelect: 'none' }}>{i + 1}</span>
                        <span style={{ width: '12px', flexShrink: 0, textAlign: 'center', userSelect: 'none' }}>+</span>
                        <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{aLine}</span>
                    </div>
                );
            }
        }
    }
    return result;
}
