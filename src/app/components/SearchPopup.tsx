'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { XMarkIcon } from '@heroicons/react/24/outline';

interface ConversationSummary {
    id: string;
    title: string;
    provider: string;
    updatedAt: string;
}

export default function SearchPopup({
    isOpen,
    onClose,
    history,
    onSelectConversation,
    activeConversationId
}: {
    isOpen: boolean;
    onClose: () => void;
    history: ConversationSummary[];
    onSelectConversation: (id: string) => void;
    activeConversationId: string | null;
}) {
    const [searchValue, setSearchValue] = useState('');
    const [vectorResults, setVectorResults] = useState<ConversationSummary[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [mounted, setMounted] = useState(false);
    const searchInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        if (isOpen) {
            setTimeout(() => searchInputRef.current?.focus(), 80);
        } else {
            setSearchValue('');
        }
    }, [isOpen]);

    // Close on Escape key
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    // Group conversations by date
    const groupByDate = (convs: ConversationSummary[]) => {
        const now = new Date();
        const groups: { label: string; items: ConversationSummary[] }[] = [];

        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        const last7Days = convs.filter(c => new Date(c.updatedAt) >= sevenDaysAgo);
        const last30Days = convs.filter(c => new Date(c.updatedAt) >= thirtyDaysAgo && new Date(c.updatedAt) < sevenDaysAgo);
        const older = convs.filter(c => new Date(c.updatedAt) < thirtyDaysAgo);

        if (last7Days.length > 0) groups.push({ label: 'Previous 7 Days', items: last7Days });
        if (last30Days.length > 0) groups.push({ label: 'Previous 30 Days', items: last30Days });
        if (older.length > 0) groups.push({ label: 'Older', items: older });

        return groups;
    };

    useEffect(() => {
        if (!searchValue || searchValue.trim().length < 2) {
            setVectorResults([]);
            setIsSearching(false);
            return;
        }

        setIsSearching(true);
        const timer = setTimeout(async () => {
            try {
                if (typeof (window as any).electronAPI?.history?.search === 'function') {
                    const results = await (window as any).electronAPI.history.search(searchValue, 10);
                    setVectorResults(results || []);
                }
            } catch (err) {
                console.error('Vector search failed:', err);
            } finally {
                setIsSearching(false);
            }
        }, 400);

        return () => clearTimeout(timer);
    }, [searchValue]);

    // Filter and group conversations
    const localFiltered = history.filter(c => {
        const title = c.title || 'Untitled Chat';
        return title.toLowerCase().includes(searchValue.toLowerCase());
    });

    const combinedResults = [...localFiltered];
    if (searchValue.length > 0) {
        vectorResults.forEach(vr => {
            if (!combinedResults.some(cr => cr.id === vr.id)) {
                combinedResults.push(vr);
            }
        });
    }

    const groupedChats = groupByDate(combinedResults);

    const handleSelectChat = (id: string) => {
        onSelectConversation(id);
        onClose();
        setSearchValue('');
    };

    if (!mounted) return null;

    return createPortal(
        <AnimatePresence>
            {isOpen && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 99999, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '10vh' }}>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        style={{
                            position: 'fixed',
                            inset: 0,
                            backgroundColor: 'rgba(0, 0, 0, 0.45)',
                            backdropFilter: 'blur(8px)',
                            WebkitBackdropFilter: 'blur(8px)',
                            zIndex: 99998,
                        }}
                    />

                    {/* Popup */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.96, y: -10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96, y: -10 }}
                        transition={{ type: 'spring', damping: 24, stiffness: 320 }}
                        onClick={(e: React.MouseEvent) => e.stopPropagation()}
                        style={{
                            position: 'relative',
                            backgroundColor: 'var(--color-bg-surface, #ffffff)',
                            borderRadius: 16,
                            border: '1px solid var(--color-border)',
                            boxShadow: '0 25px 60px -12px rgba(0, 0, 0, 0.35)',
                            zIndex: 99999,
                            width: '90%',
                            maxWidth: 540,
                            maxHeight: '68vh',
                            display: 'flex',
                            flexDirection: 'column',
                            overflow: 'hidden',
                        }}
                    >
                        {/* Header with search input */}
                        <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--color-border-subtle, var(--color-border))' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                <div style={{ flex: 1, position: 'relative' }}>
                                    <svg
                                        style={{
                                            position: 'absolute',
                                            left: 12,
                                            top: '50%',
                                            transform: 'translateY(-50%)',
                                            color: 'var(--color-text-tertiary)',
                                        }}
                                        width={18}
                                        height={18}
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth={2}
                                    >
                                        <circle cx={11} cy={11} r={8} />
                                        <path d="m21 21-4.35-4.35" />
                                    </svg>
                                    <input
                                        ref={searchInputRef}
                                        type="text"
                                        placeholder="Search chats..."
                                        value={searchValue}
                                        onChange={(e) => setSearchValue(e.target.value)}
                                        style={{
                                            width: '100%',
                                            height: 42,
                                            paddingLeft: 38,
                                            paddingRight: 12,
                                            borderRadius: 10,
                                            border: '1px solid var(--color-border)',
                                            backgroundColor: 'var(--color-bg-subtle)',
                                            fontSize: 14,
                                            color: 'var(--color-text-primary)',
                                            outline: 'none',
                                            transition: 'border-color 0.2s',
                                        }}
                                        onFocus={(e) => ((e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border-strong, #3b82f6)')}
                                        onBlur={(e) => ((e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border)')}
                                    />
                                </div>
                                <button
                                    onClick={onClose}
                                    style={{
                                        width: 32,
                                        height: 32,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        backgroundColor: 'transparent',
                                        border: 'none',
                                        borderRadius: 8,
                                        cursor: 'pointer',
                                        color: 'var(--color-text-secondary)',
                                        transition: 'all 0.15s',
                                    }}
                                    onMouseEnter={(e: React.MouseEvent) => {
                                        (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg-hover, rgba(0,0,0,0.06))';
                                        (e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)';
                                    }}
                                    onMouseLeave={(e: React.MouseEvent) => {
                                        (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                                        (e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)';
                                    }}
                                >
                                    <XMarkIcon width={18} height={18} />
                                </button>
                            </div>
                            
                            {/* Search indicator */}
                            {isSearching && (
                                <div style={{ 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    justifyContent: 'center', 
                                    marginTop: 8,
                                    fontSize: 12,
                                    color: 'var(--color-text-tertiary)'
                                }}>
                                    <svg className="animate-spin" style={{ marginRight: 6, height: 12, width: 12 }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    Scanning vector memory...
                                </div>
                            )}
                        </div>

                        {/* Chat List */}
                        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
                            {groupedChats.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '36px 0', color: 'var(--color-text-tertiary)' }}>
                                    <p style={{ fontSize: 13.5, margin: 0 }}>
                                        {searchValue ? 'No chats found' : 'No chats yet'}
                                    </p>
                                </div>
                            ) : (
                                groupedChats.map((group) => (
                                    <div key={group.label} style={{ marginBottom: 14 }}>
                                        {/* Group Label */}
                                        <div
                                            style={{
                                                fontSize: 11,
                                                fontWeight: 600,
                                                color: 'var(--color-text-tertiary)',
                                                textTransform: 'uppercase',
                                                letterSpacing: '0.06em',
                                                marginBottom: 6,
                                                paddingLeft: 6,
                                            }}
                                        >
                                            {group.label}
                                        </div>

                                        {/* Chats in Group */}
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                            {group.items.map((chat) => {
                                                const isSelected = activeConversationId === chat.id;
                                                return (
                                                    <button
                                                        key={chat.id}
                                                        onClick={() => handleSelectChat(chat.id)}
                                                        style={{
                                                            width: '100%',
                                                            padding: '9px 12px',
                                                            borderRadius: 10,
                                                            border: 'none',
                                                            backgroundColor: isSelected
                                                                ? 'var(--color-bg-selected, rgba(0,0,0,0.06))'
                                                                : 'transparent',
                                                            cursor: 'pointer',
                                                            textAlign: 'left',
                                                            transition: 'background-color 0.15s ease',
                                                            display: 'flex',
                                                            flexDirection: 'column',
                                                            gap: 2,
                                                        }}
                                                        onMouseEnter={(e: React.MouseEvent) => {
                                                            (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg-hover, rgba(0,0,0,0.05))';
                                                        }}
                                                        onMouseLeave={(e: React.MouseEvent) => {
                                                            (e.currentTarget as HTMLElement).style.backgroundColor = isSelected
                                                                ? 'var(--color-bg-selected, rgba(0,0,0,0.06))'
                                                                : 'transparent';
                                                        }}
                                                    >
                                                        <div
                                                            style={{
                                                                fontSize: 13.5,
                                                                fontWeight: isSelected ? 600 : 500,
                                                                color: 'var(--color-text-primary)',
                                                                overflow: 'hidden',
                                                                textOverflow: 'ellipsis',
                                                                whiteSpace: 'nowrap',
                                                            }}
                                                        >
                                                            {chat.title || 'Untitled Chat'}
                                                        </div>
                                                        <div
                                                            style={{
                                                                fontSize: 11.5,
                                                                color: 'var(--color-text-tertiary)',
                                                                overflow: 'hidden',
                                                                textOverflow: 'ellipsis',
                                                                whiteSpace: 'nowrap',
                                                            }}
                                                        >
                                                            {chat.provider}
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>,
        document.body
    );
}
