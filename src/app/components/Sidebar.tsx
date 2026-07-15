"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { PlusIcon, ChatBubbleLeftIcon, MagnifyingGlassIcon, Cog6ToothIcon, ChatBubbleLeftRightIcon, FolderIcon, SparklesIcon, CodeBracketIcon, EllipsisHorizontalIcon, TrashIcon, Bars3Icon, BriefcaseIcon, ArchiveBoxIcon, SquaresPlusIcon, UserCircleIcon, LinkIcon, ChartBarIcon } from "@heroicons/react/24/outline";
import SearchPopup from "./SearchPopup";
import { useTheme } from "@/components/ThemeProvider";

interface SidebarProps {
    isOpen: boolean;
    onToggle: () => void;
    activeConversationId: string | null;
    activeTaskIds: string[]; // Track which chats have active background tasks
    onSelectConversation: (id: string) => void;
    onNewChat: () => void;
    onSettingsClick?: () => void;
    onArtifactsClick?: () => void;
    onCustomizeClick?: () => void;
    onIntegrationClick?: () => void;
    onProjectsClick?: () => void;
    onAnalyticsClick?: () => void;
    titlebarInset?: number;
    showSearch?: boolean;
    onSearchClose?: () => void;
    onSearchOpen?: () => void;
}

interface ConversationSummary {
    id: string;
    title: string;
    provider: string;
    updatedAt: string;
    projectName?: string;
}

export default function Sidebar({ isOpen, onToggle, activeConversationId, activeTaskIds = [], onSelectConversation, onNewChat, onSettingsClick, onArtifactsClick, onCustomizeClick, onIntegrationClick, onProjectsClick, onAnalyticsClick, titlebarInset = 0, showSearch, onSearchClose, onSearchOpen }: SidebarProps) {
    const [isMac, setIsMac] = useState(false);
    const [showOptionsId, setShowOptionsId] = useState<string | null>(null);
    const [username, setUsername] = useState<string>("User");
    const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
    const [localShowSearch, setLocalShowSearch] = useState<boolean>(false);
    const isSearchOpen = showSearch !== undefined ? showSearch : localShowSearch;
    const triggerSearchOpen = onSearchOpen || (() => setLocalShowSearch(true));
    const triggerSearchClose = onSearchClose || (() => setLocalShowSearch(false));
    const [userPlan, setUserPlan] = useState<string>("free");
    const [dailyUsed, setDailyUsed] = useState<number | null>(null);
    const [dailyLimit, setDailyLimit] = useState<number | null>(null);
    const [dailyCostUsd, setDailyCostUsd] = useState<number | null>(null);
    const { theme } = useTheme();

    useEffect(() => {
        const detectPlatform = async () => {
            if ((window as any).electronAPI?.system?.getPlatform) {
                const platform = await (window as any).electronAPI.system.getPlatform();
                if (platform === 'darwin') {
                    setIsMac(true);
                }
            } else if (navigator.userAgent.includes('Mac')) {
                setIsMac(true);
            }
        };
        detectPlatform();
    }, []);

    useEffect(() => {
        const fetchUsername = async () => {
            try {
                let name = "User";
                let avatar = null;
                const sessionStr = localStorage.getItem('everfern_cloud_session');
                if (sessionStr) {
                    try {
                        const session = JSON.parse(sessionStr);
                        if (!session?.accessToken) return;
                        const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.everfern.app";
                        const userRes = await fetch(`${API_URL}/api/user/me`, {
                            headers: { Authorization: `Bearer ${session.accessToken}` }
                        });
                        if (userRes.ok) {
                            const userData = await userRes.json();
                            const userName = userData.displayName || userData.fullName || userData.name;
                            if (userName) name = userName;
                            else if (userData.email) name = userData.email.split('@')[0];

                            if (userData.avatarUrl || userData.avatar_url) avatar = userData.avatarUrl || userData.avatar_url;
                            if (userData.plan) setUserPlan(userData.plan);
                            if (userData.dailyUsed !== undefined) setDailyUsed(userData.dailyUsed);
                            if (userData.dailyLimit !== undefined) setDailyLimit(userData.dailyLimit);
                            if (userData.dailyCostUsd !== undefined) setDailyCostUsd(userData.dailyCostUsd);
                        }
                    } catch (e) {
                        console.error("Failed to fetch user from API", e);
                    }
                }
                if (name === "User" && (window as any).electronAPI?.loadConfig) {
                    const res = await (window as any).electronAPI.loadConfig();
                    if (res.success && res.config?.userName) {
                        name = res.config.userName;
                    } else if ((window as any).electronAPI?.system?.getUsername) {
                        name = await (window as any).electronAPI.system.getUsername();
                    }
                }
                setUsername(name.charAt(0).toUpperCase() + name.slice(1));
                setAvatarUrl(avatar);
            } catch { }
        };
        fetchUsername();

        const interval = setInterval(fetchUsername, 5000);
        return () => clearInterval(interval);
    }, []);
    const [history, setHistory] = useState<ConversationSummary[]>([]);

    useEffect(() => {
        const loadHistory = async () => {
            if ((window as any).electronAPI?.history?.list) {
                const list = await (window as any).electronAPI.history.list();
                setHistory(list);
            }
        };
        loadHistory();
        const interval = setInterval(loadHistory, 5000);

        // Listen for title updates from the backend to refresh immediately
        const handleTitleUpdate = (_: any, data: any) => {
            const conversationId = data?.conversationId;
            const title = data?.title;
            if (conversationId && title) {
                setHistory(prev => prev.map(conv =>
                    conv.id === conversationId ? { ...conv, title } : conv
                ));
            }
        };

        if ((window as any).electronAPI?.on) {
            (window as any).electronAPI.on('chat:title-updated', handleTitleUpdate);
        }

        return () => {
            clearInterval(interval);
            if ((window as any).electronAPI?.off) {
                (window as any).electronAPI.off('chat:title-updated', handleTitleUpdate);
            }
        };
    }, []);

    const handleDelete = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if ((window as any).electronAPI?.history?.delete) {
            await (window as any).electronAPI.history.delete(id);
            setHistory(prev => prev.filter(item => item.id !== id));
        }
    };

    const sidebarWidth = 260;
    const collapsedWidth = 68;

    return (
        <motion.div
            initial={false}
            animate={{ width: isOpen ? sidebarWidth : collapsedWidth }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            style={{
                position: "fixed",
                left: 0,
                top: 0,
                bottom: 0,
                backgroundColor: "var(--sidebar-bg)",
                borderRight: "1px solid var(--sidebar-border)",
                display: "flex",
                flexDirection: "column",
                zIndex: 50,
                overflow: "hidden"
            }}
        >
            {/* Top Control Bar - Toggle + Account */}
            <div style={{
                height: isMac ? (isOpen ? 48 + titlebarInset : 80 + titlebarInset) : 48 + titlebarInset,
                display: "flex",
                alignItems: isMac && !isOpen ? "flex-end" : "center",
                padding: isMac 
                    ? `${titlebarInset}px ${isOpen ? 16 : 16}px ${isMac && !isOpen ? 12 : 0}px ${isOpen ? 76 : 16}px`
                    : `${titlebarInset}px 16px 0`,
                justifyContent: isOpen ? "space-between" : "center",
                flexShrink: 0,
                WebkitAppRegion: "drag",
                backgroundColor: "var(--sidebar-bg)"
            } as any}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, WebkitAppRegion: "no-drag" } as any}>
                    <button
                        type="button"
                        onClick={onToggle}
                        style={{ background: "transparent", border: "none", color: "var(--sidebar-btn-color)", cursor: "pointer", display: "flex", alignItems: "center", padding: 0 }}
                        onMouseEnter={e => e.currentTarget.style.color = "var(--sidebar-btn-hover-color)"}
                        onMouseLeave={e => e.currentTarget.style.color = "var(--sidebar-btn-color)"}
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                            <line x1="9" y1="3" x2="9" y2="21" />
                        </svg>
                    </button>
                    {isOpen && (
                        <button
                            type="button"
                            style={{ background: "transparent", border: "none", color: "var(--sidebar-btn-color)", cursor: "pointer", display: "flex", alignItems: "center", padding: 0 }}
                            onMouseEnter={e => e.currentTarget.style.color = "var(--sidebar-btn-hover-color)"}
                            onMouseLeave={e => e.currentTarget.style.color = "var(--sidebar-btn-color)"}
                        >
                            <UserCircleIcon width={18} height={18} />
                        </button>
                    )}
                </div>
                {/* Right side of control bar can have other icons if needed */}
            </div>

            {/* Brand Area - EverFern Branding */}
            <div style={{
                height: 64,
                display: "flex",
                alignItems: "center",
                padding: "0 16px",
                justifyContent: "flex-start",
                flexShrink: 0,
                backgroundColor: "var(--sidebar-bg)"
            } as any}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <Image unoptimized src="/images/logos/black-logo-withoutbg.png" alt="EverFern" width={48} height={48} style={{ filter: theme === 'dark' ? 'invert(1) brightness(0.9)' : 'none' }} />
                    {isOpen && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.03em", color: "var(--sidebar-brand-text)", fontFamily: 'var(--font-sans)' }}>EverFern</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Scrollable Middle Area */}
            <div className="custom-scrollbar" style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", overflowX: "hidden" }}>

            {/* Primary actions */}
            <div style={{ padding: isOpen ? "10px 10px" : "10px 0", display: "flex", flexDirection: "column", gap: 2, alignItems: "center", flexShrink: 0 }}>
                <button
                    onClick={onNewChat}
                    style={{
                        width: isOpen ? "100%" : 44,
                        height: 36,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: isOpen ? "flex-start" : "center",
                        gap: 10,
                        padding: isOpen ? "0 12px" : 0,
                        backgroundColor: "transparent",
                        border: "none",
                        borderRadius: 12,
                        color: "var(--sidebar-text-primary)",
                        cursor: "pointer",
                        fontSize: 13,
                        fontWeight: 600,
                        transition: "background-color 0.15s",
                        lineHeight: 1
                    }}
                    onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
                        e.currentTarget.style.backgroundColor = "var(--sidebar-bg-hover)";
                    }}
                    onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
                        e.currentTarget.style.backgroundColor = "transparent";
                    }}
                >
                    <PlusIcon width={16} height={16} />
                    {isOpen && <span>New chat</span>}
                </button>

                <div style={{ width: "100%", paddingTop: 8, display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
                    {[
                        { icon: MagnifyingGlassIcon, label: "Search" },
                        { icon: BriefcaseIcon, label: "Customize" },
                        { icon: LinkIcon, label: "Integrations" },
                        { icon: ChatBubbleLeftRightIcon, label: "Chats" },
                        { icon: ArchiveBoxIcon, label: "Projects" },
                        { icon: SquaresPlusIcon, label: "Artifacts" },
                        { icon: CodeBracketIcon, label: "Code" },
                        { icon: ChartBarIcon, label: "Analytics" },
                    ].map((item) => (
                        <button
                            key={item.label}
                            style={{
                                width: isOpen ? "100%" : 42,
                                height: isOpen ? 36 : 42,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: isOpen ? "flex-start" : "center",
                                gap: 10,
                                padding: isOpen ? "0 12px" : 0,
                                background: "transparent",
                                border: "none",
                                borderRadius: 12,
                                color: "var(--sidebar-text-secondary)",
                                cursor: "pointer",
                                fontSize: 13,
                                fontWeight: 500,
                                transition: "background-color 0.15s, color 0.15s",
                            } as any}
                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--sidebar-bg-hover)"; e.currentTarget.style.color = "var(--sidebar-text-primary)"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "var(--sidebar-text-secondary)"; }}
                            onClick={() => {
                                if (item.label === "Search") triggerSearchOpen();
                                else if (item.label === "Artifacts" && onArtifactsClick) onArtifactsClick();
                                else if (item.label === "Customize" && onCustomizeClick) onCustomizeClick();
                                else if (item.label === "Integrations" && onIntegrationClick) onIntegrationClick();
                                else if (item.label === "Projects" && onProjectsClick) onProjectsClick();
                                else if (item.label === "Analytics" && onAnalyticsClick) onAnalyticsClick();
                            }}
                            title={!isOpen ? item.label : undefined}
                        >
                            <item.icon width={18} height={18} opacity={0.9} />
                            {isOpen && <span>{item.label}</span>}
                        </button>
                    ))}
                </div>
            </div>

            {/* History List - Only show if open */}
            <div style={{ padding: isOpen ? "12px 8px 20px" : "12px 0 20px", display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                {isOpen && history.length > 0 && (
                    <div style={{ padding: "12px 12px 12px", fontSize: 11, fontWeight: 700, color: "var(--sidebar-text-tertiary)", width: "100%", textTransform: "uppercase" }}>Recents</div>
                )}
                {isOpen && history.map((item) => (
                    <button
                        key={item.id}
                        onClick={() => onSelectConversation(item.id)}
                        style={{
                            width: "100%",
                            minHeight: 40,
                            display: "flex",
                            alignItems: "center",
                            gap: 14,
                            padding: "8px 14px",
                            justifyContent: "flex-start",
                            backgroundColor: activeConversationId === item.id ? "var(--sidebar-bg-selected)" : "transparent",
                            border: "none",
                            borderRadius: 12,
                            color: activeConversationId === item.id ? "var(--sidebar-text-primary)" : "var(--sidebar-text-secondary)",
                            cursor: "pointer",
                            fontSize: 13,
                            textAlign: "left",
                            transition: "background-color 0.15s, color 0.15s",
                            position: "relative",
                            marginBottom: 10,
                            fontWeight: activeConversationId === item.id ? 600 : 400,
                        }}
                        onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
                            if (activeConversationId !== item.id) {
                                e.currentTarget.style.backgroundColor = "var(--sidebar-bg-hover)";
                                e.currentTarget.style.color = "var(--sidebar-text-primary)";
                            }
                            const delBtn = e.currentTarget.querySelector('.del-btn') as HTMLElement;
                            if (delBtn) delBtn.style.opacity = '1';
                        }}
                        onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
                            if (activeConversationId !== item.id) {
                                e.currentTarget.style.backgroundColor = "transparent";
                                e.currentTarget.style.color = "var(--sidebar-text-secondary)";
                            }
                            const delBtn = e.currentTarget.querySelector('.del-btn') as HTMLElement;
                            if (delBtn) delBtn.style.opacity = '0';
                        }}
                    >
                        <div style={{ flexShrink: 0, opacity: 0.7, display: "flex", lineHeight: 1 }}>
                            {activeTaskIds.includes(item.id) ? (
                                <div style={{ position: "relative", width: 15, height: 15 }}>
                                    <div style={{
                                        position: "absolute",
                                        top: 0,
                                        left: 0,
                                        width: "100%",
                                        height: "100%",
                                        borderRadius: "50%",
                                        border: "2px solid rgba(0, 102, 255, 0.2)",
                                        borderTopColor: "#0066ff",
                                        animation: "everfern-spin 1s linear infinite"
                                    }}></div>
                                    <style>{`
                                        @keyframes everfern-spin {
                                            to { transform: rotate(360deg); }
                                        }
                                    `}</style>
                                </div>
                            ) : (
                                <ChatBubbleLeftIcon width={15} height={15} />
                            )}
                        </div>
                        {isOpen && (
                            <>
                                <span style={{
                                    flex: 1,
                                    overflow: "hidden",
                                    whiteSpace: "nowrap",
                                    maskImage: 'linear-gradient(to right, black calc(100% - 20px), transparent 100%)',
                                    WebkitMaskImage: 'linear-gradient(to right, black calc(100% - 20px), transparent 100%)'
                                }}>{item.title || "Untitled Chat"}</span>
                                {item.projectName && (
                                    <div style={{ fontSize: 10, backgroundColor: 'var(--sidebar-bg-active)', padding: '2px 6px', borderRadius: 6, color: 'var(--sidebar-project-text)', marginLeft: 4, whiteSpace: 'nowrap', fontWeight: 600 }}>
                                        {item.projectName}
                                    </div>
                                )}
                                <div className="del-btn" onClick={(e) => handleDelete(e, item.id)} style={{ padding: 4, borderRadius: 10, color: "var(--sidebar-project-text)", opacity: 0, transition: "opacity 0.15s, color 0.15s", cursor: "pointer", lineHeight: 1, display: "flex" }} onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => e.currentTarget.style.color = "#f87171"}>
                                    <TrashIcon width={14} height={14} />
                                </div>
                            </>
                        )}
                    </button>
                ))}
            </div>
            </div>
            {/* Footer */}
            <div style={{ padding: isOpen ? 12 : "12px 0", borderTop: "1px solid var(--sidebar-border)", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                <div style={{ display: "flex", width: "100%", alignItems: "center", gap: 10, padding: isOpen ? "10px 12px" : "10px 0", justifyContent: isOpen ? "flex-start" : "center", borderRadius: 14 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 999, background: "var(--sidebar-avatar-bg)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--sidebar-avatar-border)", overflow: "hidden" }}>
                        {avatarUrl ? (
                            <img src={avatarUrl} alt={username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--sidebar-text-primary)" }}>{username.charAt(0).toUpperCase()}</span>
                        )}
                    </div>
                    {isOpen && (
                        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                            <div style={{
                                fontSize: 13,
                                fontWeight: 600,
                                color: "var(--sidebar-text-primary)",
                                overflow: "hidden",
                                whiteSpace: "nowrap",
                                maskImage: 'linear-gradient(to right, black calc(100% - 20px), transparent 100%)',
                                WebkitMaskImage: 'linear-gradient(to right, black calc(100% - 20px), transparent 100%)'
                            }}>{username}</div>
                            <div style={{ fontSize: 11, color: "var(--sidebar-text-tertiary)", display: "flex", alignItems: "center", gap: 6 }}>
                                <span style={{ textTransform: "capitalize" }}>{userPlan} plan</span>
                            </div>
                            {dailyLimit !== null && dailyUsed !== null && (
                                <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 3, paddingRight: 4 }}>
                                    <div style={{ width: "100%", height: 4, backgroundColor: "var(--sidebar-border)", borderRadius: 2, overflow: "hidden" }}>
                                        <div style={{
                                            width: `${Math.min(100, (dailyUsed / dailyLimit) * 100)}%`,
                                            height: "100%",
                                            backgroundColor: (dailyUsed / dailyLimit) >= 1 ? "#ef4444" : "#10b981",
                                            borderRadius: 2,
                                            transition: "width 0.3s ease"
                                        }}></div>
                                    </div>
                                    <div style={{ fontSize: 9, color: "var(--sidebar-limit-text)", textAlign: "right", fontWeight: 500 }}>
                                        {Math.round((dailyUsed / dailyLimit) * 100)}% used{dailyCostUsd !== null ? ` · $${dailyCostUsd.toFixed(2)}` : ''}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                    {isOpen && onSettingsClick && (
                        <button
                            onClick={onSettingsClick}
                            style={{
                                width: 32, height: 32, borderRadius: 10, background: "var(--sidebar-settings-bg)",
                                border: "1px solid var(--sidebar-settings-border)", color: "var(--sidebar-settings-text)",
                                display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                                transition: "all 0.2s"
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--sidebar-settings-hover-border)"; e.currentTarget.style.color = "var(--sidebar-settings-hover-text)"; e.currentTarget.style.background = "var(--sidebar-settings-hover-bg)"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--sidebar-settings-border)"; e.currentTarget.style.color = "var(--sidebar-settings-text)"; e.currentTarget.style.background = "var(--sidebar-settings-bg)"; }}
                        >
                            <Cog6ToothIcon width={16} height={16} />
                        </button>
                    )}
                </div>
            </div>

            {/* Search Popup */}
            <SearchPopup
                isOpen={isSearchOpen}
                onClose={triggerSearchClose}
                history={history}
                onSelectConversation={onSelectConversation}
                activeConversationId={activeConversationId}
            />
        </motion.div>
    );
}
