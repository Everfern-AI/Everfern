'use client';

import React, { useState, useEffect, useRef } from 'react';
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
    const searchInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen) {
            setTimeout(() => searchInputRef.current?.focus(), 100);
        }
    }, [isOpen]);

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

    // Filter and group conversations
    const filtered = history.filter(c => {
        const title = c.title || 'Untitled Chat';
        return title.toLowerCase().includes(searchValue.toLowerCase());
    });

    const groupedChats = groupByDate(filtered);

    const handleSelectChat = (id: string) => {
        onSelectConversation(id);
        onClose();
        setSearchValue('');
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        style={{
                            position: 'fixed',
                            inset: 0,
                            backgroundColor: 'rgba(0, 0, 0, 0.5)',
                            zIndex: 999,
                        }}
                    />

                    {/* Popup */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ type: 'spring', damping: 20, stiffness: 300 }}
                        onClick={(e: React.MouseEvent) => e.stopPropagation()}
                        style={{
                            position: 'fixed',
                            inset: 0,
                            margin: 'auto',
                            backgroundColor: '#f5f4f0',
                            borderRadius: 16,
                            border: 'none',
                            boxShadow: '0 25px 50px rgba(0, 0, 0, 0.2)',
                            zIndex: 1000,
                            width: '90%',
                            maxWidth: 520,
                            maxHeight: '75vh',
                            height: 'fit-content',
                            display: 'flex',
                            flexDirection: 'column',
                            overflow: 'hidden',
                        }}
                    >
                        {/* Header with search input */}
                        <div style={{ padding: 20, paddingBottom: 12 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                <div style={{ flex: 1, position: 'relative' }}>
                                    <svg
                                        style={{
                                            position: 'absolute',
                                            left: 12,
                                            top: '50%',
                                            transform: 'translateY(-50%)',
                                            color: '#8a8886',
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
                                            height: 44,
                                            paddingLeft: 40,
                                            paddingRight: 12,
                                            borderRadius: 12,
                                            border: '1px solid #e8e6d9',
                                            backgroundColor: '#ffffff',
                                            fontSize: 15,
                                            color: '#111111',
                                            outline: 'none',
                                            transition: 'border-color 0.2s',
                                        }}
                                        onFocus={(e) => ((e.currentTarget as HTMLElement).style.borderColor = '#d4cfc3')}
                                        onBlur={(e) => ((e.currentTarget as HTMLElement).style.borderColor = '#e8e6d9')}
                                    />
                                </div>
                                <button
                                    onClick={onClose}
                                    style={{
                                        width: 36,
                                        height: 36,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        backgroundColor: 'transparent',
                                        border: 'none',
                                        borderRadius: 10,
                                        cursor: 'pointer',
                                        color: '#8a8886',
                                        transition: 'all 0.2s',
                                    }}
                                    onMouseEnter={(e: React.MouseEvent) => {
                                        (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(0, 0, 0, 0.04)';
                                        (e.currentTarget as HTMLElement).style.color = '#111111';
                                    }}
                                    onMouseLeave={(e: React.MouseEvent) => {
                                        (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                                        (e.currentTarget as HTMLElement).style.color = '#8a8886';
                                    }}
                                >
                                    <XMarkIcon width={18} height={18} />
                                </button>
                            </div>
                        </div>

                        {/* Chat List */}
                        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
                            {groupedChats.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: 40, color: '#8a8886' }}>
                                    <p style={{ fontSize: 14, margin: 0 }}>
                                        {searchValue ? 'No chats found' : 'No chats yet'}
                                    </p>
                                </div>
                            ) : (
                                groupedChats.map((group) => (
                                    <div key={group.label} style={{ marginBottom: 16 }}>
                                        {/* Group Label */}
                                        <div
                                            style={{
                                                fontSize: 11,
                                                fontWeight: 700,
                                                color: '#8a8886',
                                                textTransform: 'uppercase',
                                                letterSpacing: '0.05em',
                                                marginBottom: 8,
                                                paddingLeft: 4,
                                            }}
                                        >
                                            {group.label}
                                        </div>

                                        {/* Chats in Group */}
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                            {group.items.map((chat) => (
                                                <motion.button
                                                    key={chat.id}
                                                    whileHover={{ x: 4 }}
                                                    onClick={() => handleSelectChat(chat.id)}
                                                    style={{
                                                        width: '100%',
                                                        padding: 10,
                                                        borderRadius: 10,
                                                        border: 'none',
                                                        backgroundColor:
                                                            activeConversationId === chat.id
                                                                ? 'rgba(32, 30, 36, 0.08)'
                                                                : 'transparent',
                                                        cursor: 'pointer',
                                                        textAlign: 'left',
                                                        transition: 'all 0.2s',
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                        gap: 3,
                                                    }}
                                                    onMouseEnter={(e: React.MouseEvent) => {
                                                        (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(32, 30, 36, 0.06)';
                                                    }}
                                                    onMouseLeave={(e: React.MouseEvent) => {
                                                        if (activeConversationId !== chat.id) {
                                                            (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                                                        }
                                                    }}
                                                >
                                                    <div
                                                        style={{
                                                            fontSize: 14,
                                                            fontWeight: 500,
                                                            color: '#111111',
                                                            overflow: 'hidden',
                                                            textOverflow: 'ellipsis',
                                                            whiteSpace: 'nowrap',
                                                        }}
                                                    >
                                                        {chat.title || 'Untitled Chat'}
                                                    </div>
                                                    <div
                                                        style={{
                                                            fontSize: 12,
                                                            color: '#8a8886',
                                                            overflow: 'hidden',
                                                            textOverflow: 'ellipsis',
                                                            whiteSpace: 'nowrap',
                                                        }}
                                                    >
                                                        {chat.provider}
                                                    </div>
                                                </motion.button>
                                            ))}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
