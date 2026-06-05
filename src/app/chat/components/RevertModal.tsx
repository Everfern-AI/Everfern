import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    XMarkIcon,
    ArrowPathIcon,
    DocumentTextIcon,
    TrashIcon,
    CommandLineIcon,
    PencilIcon,
    FolderIcon,
    ExclamationTriangleIcon
} from '@heroicons/react/24/outline';

interface RevertChange {
    type: 'file_write' | 'file_delete' | 'file_edit' | 'command' | 'folder_create';
    description: string;
    path?: string;
    details?: string;
    timestamp: number;
}

interface RevertModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    conversationId: string | null;
    targetTimestamp: number | null;
}

const getIconForChangeType = (type: RevertChange['type']) => {
    switch (type) {
        case 'file_write':
            return <DocumentTextIcon className="w-4 h-4" />;
        case 'file_delete':
            return <TrashIcon className="w-4 h-4" />;
        case 'file_edit':
            return <PencilIcon className="w-4 h-4" />;
        case 'command':
            return <CommandLineIcon className="w-4 h-4" />;
        case 'folder_create':
            return <FolderIcon className="w-4 h-4" />;
        default:
            return <DocumentTextIcon className="w-4 h-4" />;
    }
};

const getColorForChangeType = (type: RevertChange['type']) => {
    switch (type) {
        case 'file_write':
            return '#10b981'; // green
        case 'file_delete':
            return '#ef4444'; // red
        case 'file_edit':
            return '#f59e0b'; // amber
        case 'command':
            return '#3b82f6'; // blue
        case 'folder_create':
            return '#8b5cf6'; // purple
        default:
            return '#6b7280'; // gray
    }
};

export default function RevertModal({ isOpen, onClose, onConfirm, conversationId, targetTimestamp }: RevertModalProps) {
    const [changes, setChanges] = useState<RevertChange[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen || !conversationId || !targetTimestamp) {
            setChanges([]);
            setLoading(true);
            setError(null);
            return;
        }

        const fetchChangesToRevert = async () => {
            setLoading(true);
            setError(null);

            try {
                const result = await (window as any).electronAPI?.acp?.getRollbackChanges?.(conversationId, targetTimestamp);

                if (!result) {
                    setChanges([]);
                    return;
                }

                const mapped: RevertChange[] = [];

                // Map file snapshots
                for (const f of result.files ?? []) {
                    const op: string = (f.operation ?? '').toLowerCase();
                    let type: RevertChange['type'];
                    let description: string;

                    if (op === 'delete') {
                        type = 'file_delete';
                        description = 'File deleted';
                    } else if (op === 'create') {
                        type = 'file_write';
                        description = 'File created';
                    } else {
                        type = 'file_edit';
                        description = 'File modified';
                    }

                    mapped.push({ type, description, path: f.path, timestamp: f.timestamp });
                }

                // Map command history
                for (const c of result.commands ?? []) {
                    mapped.push({
                        type: 'command',
                        description: c.reversible ? 'Terminal command (reversible)' : 'Terminal command',
                        details: c.command,
                        timestamp: c.timestamp
                    });
                }

                // Sort chronologically newest-first
                mapped.sort((a, b) => b.timestamp - a.timestamp);
                setChanges(mapped);
            } catch (err) {
                setError('Failed to load changes to revert');
                console.error('Error fetching changes to revert:', err);
            } finally {
                setLoading(false);
            }
        };

        fetchChangesToRevert();
    }, [isOpen, conversationId, targetTimestamp]);

    const handleConfirm = () => {
        onConfirm();
        onClose();
    };

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <div style={{
                position: 'fixed',
                inset: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
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
                        backgroundColor: '#ffffff',
                        borderRadius: '24px',
                        border: '1px solid #e5e7eb',
                        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                        width: '100%',
                        maxWidth: '600px',
                        maxHeight: '80vh',
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column'
                    }}
                >
                    {/* Header */}
                    <div style={{
                        padding: '24px 32px',
                        borderBottom: '1px solid #f3f4f6',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div style={{
                                width: '40px',
                                height: '40px',
                                backgroundColor: '#fef3c7',
                                borderRadius: '12px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}>
                                <ArrowPathIcon style={{ width: '20px', height: '20px', color: '#d97706' }} />
                            </div>
                            <div>
                                <h2 style={{
                                    fontSize: '20px',
                                    fontWeight: 600,
                                    color: '#111827',
                                    margin: 0,
                                    fontFamily: "'Figtree', system-ui, sans-serif"
                                }}>
                                    Revert Changes
                                </h2>
                                <p style={{
                                    fontSize: '14px',
                                    color: '#6b7280',
                                    margin: '4px 0 0',
                                    fontFamily: "'Figtree', system-ui, sans-serif"
                                }}>
                                    Review what will be reverted
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
                                color: '#6b7280',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}
                            onMouseEnter={e => {
                                e.currentTarget.style.backgroundColor = '#f3f4f6';
                                e.currentTarget.style.color = '#374151';
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.backgroundColor = 'transparent';
                                e.currentTarget.style.color = '#6b7280';
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
                                    border: '3px solid #f3f4f6',
                                    borderTop: '3px solid #3b82f6',
                                    borderRadius: '50%',
                                    animation: 'spin 1s linear infinite'
                                }} />
                                <p style={{
                                    marginLeft: '16px',
                                    color: '#6b7280',
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
                                <ExclamationTriangleIcon style={{ width: '48px', height: '48px', color: '#ef4444', marginBottom: '16px' }} />
                                <p style={{
                                    color: '#ef4444',
                                    fontSize: '16px',
                                    fontWeight: 500,
                                    marginBottom: '8px',
                                    fontFamily: "'Figtree', system-ui, sans-serif"
                                }}>
                                    Error Loading Changes
                                </p>
                                <p style={{
                                    color: '#6b7280',
                                    fontSize: '14px',
                                    textAlign: 'center',
                                    fontFamily: "'Figtree', system-ui, sans-serif"
                                }}>
                                    {error}
                                </p>
                            </div>
                        ) : changes.length === 0 ? (
                            <div style={{
                                flex: 1,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: '40px',
                                flexDirection: 'column'
                            }}>
                                <ArrowPathIcon style={{ width: '48px', height: '48px', color: '#6b7280', marginBottom: '16px' }} />
                                <p style={{
                                    color: '#6b7280',
                                    fontSize: '16px',
                                    fontWeight: 500,
                                    marginBottom: '8px',
                                    fontFamily: "'Figtree', system-ui, sans-serif"
                                }}>
                                    No Changes to Revert
                                </p>
                                <p style={{
                                    color: '#9ca3af',
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
                                    margin: '24px 32px 16px',
                                    padding: '16px',
                                    backgroundColor: '#fef3c7',
                                    border: '1px solid #fcd34d',
                                    borderRadius: '12px',
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: '12px'
                                }}>
                                    <ExclamationTriangleIcon style={{ width: '20px', height: '20px', color: '#d97706', flexShrink: 0, marginTop: '1px' }} />
                                    <div>
                                        <p style={{
                                            fontSize: '14px',
                                            fontWeight: 600,
                                            color: '#92400e',
                                            margin: '0 0 4px',
                                            fontFamily: "'Figtree', system-ui, sans-serif"
                                        }}>
                                            This action cannot be undone
                                        </p>
                                        <p style={{
                                            fontSize: '13px',
                                            color: '#a16207',
                                            margin: 0,
                                            lineHeight: '1.4',
                                            fontFamily: "'Figtree', system-ui, sans-serif"
                                        }}>
                                            Reverting will undo {changes.length} change{changes.length !== 1 ? 's' : ''} made after the selected point. Files will be restored to their previous state.
                                        </p>
                                    </div>
                                </div>

                                {/* Changes List */}
                                <div style={{
                                    flex: 1,
                                    overflowY: 'auto',
                                    padding: '0 32px',
                                    marginBottom: '16px'
                                }}>
                                    <h3 style={{
                                        fontSize: '16px',
                                        fontWeight: 600,
                                        color: '#111827',
                                        margin: '0 0 16px',
                                        fontFamily: "'Figtree', system-ui, sans-serif"
                                    }}>
                                        Changes to be reverted:
                                    </h3>

                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        {changes.map((change, index) => (
                                            <div
                                                key={index}
                                                style={{
                                                    padding: '16px',
                                                    backgroundColor: '#f9fafb',
                                                    border: '1px solid #f3f4f6',
                                                    borderRadius: '12px',
                                                    display: 'flex',
                                                    alignItems: 'flex-start',
                                                    gap: '12px'
                                                }}
                                            >
                                                <div style={{
                                                    width: '32px',
                                                    height: '32px',
                                                    backgroundColor: 'white',
                                                    border: '1px solid #e5e7eb',
                                                    borderRadius: '8px',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    color: getColorForChangeType(change.type),
                                                    flexShrink: 0
                                                }}>
                                                    {getIconForChangeType(change.type)}
                                                </div>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{
                                                        fontSize: '14px',
                                                        fontWeight: 500,
                                                        color: '#111827',
                                                        marginBottom: '4px',
                                                        fontFamily: "'Figtree', system-ui, sans-serif"
                                                    }}>
                                                        {change.description}
                                                    </div>
                                                    {change.path && (
                                                        <div style={{
                                                            fontSize: '12px',
                                                            color: '#6b7280',
                                                            fontFamily: "'JetBrains Mono', monospace",
                                                            marginBottom: '4px',
                                                            wordBreak: 'break-all'
                                                        }}>
                                                            {change.path}
                                                        </div>
                                                    )}
                                                    {change.details && (
                                                        <div style={{
                                                            fontSize: '12px',
                                                            color: '#9ca3af',
                                                            fontFamily: "'Figtree', system-ui, sans-serif"
                                                        }}>
                                                            {change.details}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </>
                        )}
                    </div>

                    {/* Footer */}
                    <div style={{
                        padding: '24px 32px',
                        borderTop: '1px solid #f3f4f6',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'flex-end',
                        gap: '12px'
                    }}>
                        <button
                            onClick={onClose}
                            style={{
                                padding: '12px 20px',
                                backgroundColor: 'transparent',
                                border: '1px solid #d1d5db',
                                borderRadius: '12px',
                                cursor: 'pointer',
                                fontSize: '14px',
                                fontWeight: 500,
                                color: '#374151',
                                fontFamily: "'Figtree', system-ui, sans-serif"
                            }}
                            onMouseEnter={e => {
                                e.currentTarget.style.backgroundColor = '#f9fafb';
                                e.currentTarget.style.borderColor = '#9ca3af';
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.backgroundColor = 'transparent';
                                e.currentTarget.style.borderColor = '#d1d5db';
                            }}
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleConfirm}
                            disabled={loading || error !== null}
                            style={{
                                padding: '12px 20px',
                                backgroundColor: loading || error !== null ? '#f3f4f6' : '#ef4444',
                                border: 'none',
                                borderRadius: '12px',
                                cursor: loading || error !== null ? 'not-allowed' : 'pointer',
                                fontSize: '14px',
                                fontWeight: 600,
                                color: loading || error !== null ? '#9ca3af' : '#ffffff',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                fontFamily: "'Figtree', system-ui, sans-serif"
                            }}
                            onMouseEnter={e => {
                                if (!loading && error === null) {
                                    e.currentTarget.style.backgroundColor = '#dc2626';
                                }
                            }}
                            onMouseLeave={e => {
                                if (!loading && error === null) {
                                    e.currentTarget.style.backgroundColor = '#ef4444';
                                }
                            }}
                        >
                            <ArrowPathIcon style={{ width: '16px', height: '16px' }} />
                            {changes.length > 0 ? `Revert ${changes.length} Change${changes.length !== 1 ? 's' : ''}` : 'Revert Conversation'}
                        </button>
                    </div>
                </motion.div>

                {/* Spinner animation */}
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
