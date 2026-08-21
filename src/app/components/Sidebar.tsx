"use client";

import React, { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { 
    PlusIcon, 
    ChatBubbleLeftIcon, 
    MagnifyingGlassIcon, 
    Cog6ToothIcon, 
    SparklesIcon, 
    CodeBracketIcon, 
    EllipsisHorizontalIcon, 
    TrashIcon, 
    BriefcaseIcon, 
    ArchiveBoxIcon, 
    SquaresPlusIcon, 
    UserCircleIcon, 
    LinkIcon, 
    ChartBarIcon, 
    ClockIcon,
    PencilSquareIcon,
    EyeSlashIcon,
    EyeIcon,
    ChevronRightIcon,
    CheckIcon,
    XMarkIcon,
    FolderMinusIcon
} from "@heroicons/react/24/outline";
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
    onScheduledTasksClick?: () => void;
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
    projectId?: string;
    isPinned?: boolean;
    isBookmarked?: boolean;
    isUnread?: boolean;
}

export default function Sidebar({ 
    isOpen, 
    onToggle, 
    activeConversationId, 
    activeTaskIds = [], 
    onSelectConversation, 
    onNewChat, 
    onSettingsClick, 
    onArtifactsClick, 
    onCustomizeClick, 
    onIntegrationClick, 
    onProjectsClick, 
    onScheduledTasksClick, 
    onAnalyticsClick, 
    titlebarInset = 0, 
    showSearch, 
    onSearchClose, 
    onSearchOpen 
}: SidebarProps) {
    const [isMac, setIsMac] = useState(false);
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

    const [history, setHistory] = useState<ConversationSummary[]>([]);
    const [projects, setProjects] = useState<any[]>([]);

    // 3-dots dropdown menu state
    const [menuConvId, setMenuConvId] = useState<string | null>(null);
    const [menuPosition, setMenuPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
    const [showChangeProjectSubmenu, setShowChangeProjectSubmenu] = useState(false);
    const menuRef = useRef<HTMLDivElement | null>(null);

    // Inline renaming state
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renamingTitle, setRenamingTitle] = useState<string>("");
    const renameInputRef = useRef<HTMLInputElement | null>(null);

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
        let inFlight = false;
        const ipcTimeout = <T,>(p: Promise<T>, ms = 3000): Promise<T | { success: false }> =>
            Promise.race([p, new Promise<{ success: false }>(r => setTimeout(() => r({ success: false }), ms))]) as any;

        const fetchUsername = async () => {
            if (inFlight) return;
            inFlight = true;
            try {
                let name = "User";
                let avatar = null;
                const sessionStr = localStorage.getItem('everfern_cloud_session');
                if (sessionStr) {
                    try {
                        const session = JSON.parse(sessionStr);
                        if (!session?.accessToken) { inFlight = false; return; }
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
                    const res = await ipcTimeout((window as any).electronAPI.loadConfig());
                    if ((res as any).success && typeof (res as any).config?.userName === "string" && (res as any).config.userName) {
                        name = (res as any).config.userName;
                    } else if ((window as any).electronAPI?.system?.getUsername) {
                        const systemUsername = await ipcTimeout((window as any).electronAPI.system.getUsername());
                        if (typeof systemUsername === "string" && systemUsername) {
                            name = systemUsername;
                        }
                    }
                }
                if (typeof name !== "string" || !name) name = "User";
                setUsername(name.charAt(0).toUpperCase() + name.slice(1));
                setAvatarUrl(avatar);
            } catch { }
            inFlight = false;
        };
        fetchUsername();

        const interval = setInterval(fetchUsername, 5000);
        return () => clearInterval(interval);
    }, []);

    const loadHistory = async () => {
        if ((window as any).electronAPI?.history?.list) {
            try {
                const list = await (window as any).electronAPI.history.list();
                setHistory(list || []);
            } catch (err) {
                console.error("Failed to load history:", err);
            }
        }
    };

    const loadProjects = async () => {
        if ((window as any).electronAPI?.projects?.list) {
            try {
                const projs = await (window as any).electronAPI.projects.list();
                setProjects(projs || []);
            } catch (err) {
                console.error("Failed to load projects:", err);
            }
        }
    };

    useEffect(() => {
        loadHistory();
        loadProjects();
        const interval = setInterval(() => {
            loadHistory();
            loadProjects();
        }, 4000);

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

    // Close 3-dots menu on outside click or escape
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setMenuConvId(null);
                setShowChangeProjectSubmenu(false);
            }
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setMenuConvId(null);
                setShowChangeProjectSubmenu(false);
                setRenamingId(null);
            }
            if (menuConvId) {
                const activeItem = history.find(h => h.id === menuConvId);
                if (!activeItem) return;

                if (e.key === "p" || e.key === "P") {
                    e.preventDefault();
                    handleTogglePin(activeItem.id);
                } else if (e.key === "u" || e.key === "U") {
                    e.preventDefault();
                    handleToggleUnread(activeItem.id);
                } else if (e.key === "r" || e.key === "R") {
                    e.preventDefault();
                    startRenaming(activeItem);
                } else if (e.key === "d" || e.key === "D") {
                    e.preventDefault();
                    handleDelete(activeItem.id);
                }
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [menuConvId, history]);

    // Focus rename input on start
    useEffect(() => {
        if (renamingId && renameInputRef.current) {
            renameInputRef.current.focus();
            renameInputRef.current.select();
        }
    }, [renamingId]);

    const handleOpenMenu = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        e.preventDefault();
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setMenuPosition({
            top: rect.bottom + 4,
            left: Math.min(rect.left, window.innerWidth - 220),
        });
        setMenuConvId(id === menuConvId ? null : id);
        setShowChangeProjectSubmenu(false);
    };

    const handleTogglePin = async (id: string) => {
        setMenuConvId(null);
        setShowChangeProjectSubmenu(false);
        try {
            if ((window as any).electronAPI?.history?.togglePin) {
                const res = await (window as any).electronAPI.history.togglePin(id);
                if (res?.success) {
                    setHistory(prev => prev.map(c => c.id === id ? { ...c, isPinned: res.isPinned } : c));
                }
            }
        } catch (err) {
            console.error("Failed to toggle pin:", err);
        }
    };

    const handleToggleUnread = async (id: string) => {
        setMenuConvId(null);
        setShowChangeProjectSubmenu(false);
        try {
            if ((window as any).electronAPI?.history?.toggleUnread) {
                const res = await (window as any).electronAPI.history.toggleUnread(id);
                if (res?.success) {
                    setHistory(prev => prev.map(c => c.id === id ? { ...c, isUnread: res.isUnread } : c));
                }
            }
        } catch (err) {
            console.error("Failed to toggle unread:", err);
        }
    };

    const startRenaming = (item: ConversationSummary) => {
        setMenuConvId(null);
        setShowChangeProjectSubmenu(false);
        setRenamingId(item.id);
        setRenamingTitle(item.title || "Untitled Chat");
    };

    const handleSaveRename = async (id: string) => {
        if (!renamingTitle.trim()) {
            setRenamingId(null);
            return;
        }
        const updated = renamingTitle.trim();
        setRenamingId(null);
        setHistory(prev => prev.map(c => c.id === id ? { ...c, title: updated } : c));
        try {
            if ((window as any).electronAPI?.history?.updateTitle) {
                await (window as any).electronAPI.history.updateTitle(id, updated);
            }
        } catch (err) {
            console.error("Failed to update title:", err);
        }
    };

    const handleAssignProject = async (convId: string, projectId: string | null) => {
        setMenuConvId(null);
        setShowChangeProjectSubmenu(false);
        try {
            if ((window as any).electronAPI?.history?.setProject) {
                await (window as any).electronAPI.history.setProject(convId, projectId);
                const projObj = projects.find(p => p.id === projectId);
                setHistory(prev => prev.map(c => c.id === convId ? { 
                    ...c, 
                    projectId: projectId || undefined, 
                    projectName: projObj ? projObj.name : undefined 
                } : c));
            }
        } catch (err) {
            console.error("Failed to set project:", err);
        }
    };

    const handleDelete = async (id: string) => {
        setMenuConvId(null);
        setShowChangeProjectSubmenu(false);
        try {
            if ((window as any).electronAPI?.history?.delete) {
                await (window as any).electronAPI.history.delete(id);
                setHistory(prev => prev.filter(item => item.id !== id));
            }
        } catch (err) {
            console.error("Failed to delete conversation:", err);
        }
    };

    // Separate pinned and recent chats
    const pinnedChats = history.filter(c => c.isPinned || c.isBookmarked);
    const recentChats = history.filter(c => !c.isPinned && !c.isBookmarked);

    const activeItem = history.find(h => h.id === menuConvId);

    const renderChatItem = (item: ConversationSummary) => {
        const isActive = activeConversationId === item.id;
        const isRenaming = renamingId === item.id;

        return (
            <div
                key={item.id}
                onClick={() => {
                    if (!isRenaming) onSelectConversation(item.id);
                }}
                style={{
                    width: "100%",
                    minHeight: 38,
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "6px 10px",
                    justifyContent: "flex-start",
                    backgroundColor: isActive ? "var(--sidebar-bg-selected)" : "transparent",
                    border: "none",
                    borderRadius: 10,
                    color: isActive ? "var(--sidebar-text-primary)" : "var(--sidebar-text-secondary)",
                    cursor: "pointer",
                    fontSize: 13,
                    textAlign: "left",
                    transition: "background-color 0.15s, color 0.15s",
                    position: "relative",
                    marginBottom: 2,
                    fontWeight: isActive ? 600 : 400,
                    overflow: "hidden",
                }}
                onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => {
                    if (!isActive) {
                        e.currentTarget.style.backgroundColor = "var(--sidebar-bg-hover)";
                        e.currentTarget.style.color = "var(--sidebar-text-primary)";
                    }
                    const dotsBtn = e.currentTarget.querySelector('.chat-dots-btn') as HTMLElement;
                    if (dotsBtn) dotsBtn.style.opacity = '1';
                }}
                onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => {
                    if (!isActive) {
                        e.currentTarget.style.backgroundColor = "transparent";
                        e.currentTarget.style.color = "var(--sidebar-text-secondary)";
                    }
                    if (menuConvId !== item.id) {
                        const dotsBtn = e.currentTarget.querySelector('.chat-dots-btn') as HTMLElement;
                        if (dotsBtn) dotsBtn.style.opacity = '0';
                    }
                }}
            >
                {/* Icon & Unread Dot */}
                <div style={{ flexShrink: 0, opacity: 0.75, display: "flex", alignItems: "center", position: "relative", zIndex: 1 }}>
                    {activeTaskIds.includes(item.id) ? (
                        <div style={{ position: "relative", width: 14, height: 14 }}>
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
                            }} />
                        </div>
                    ) : (
                        <ChatBubbleLeftIcon width={14} height={14} />
                    )}

                    {item.isUnread && (
                        <span style={{
                            position: "absolute",
                            top: -2,
                            right: -2,
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            backgroundColor: "#3b82f6",
                        }} />
                    )}
                </div>

                {isOpen && (
                    <>
                        {isRenaming ? (
                            <input
                                ref={renameInputRef}
                                type="text"
                                value={renamingTitle}
                                onChange={e => setRenamingTitle(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === "Enter") handleSaveRename(item.id);
                                    if (e.key === "Escape") setRenamingId(null);
                                }}
                                onBlur={() => handleSaveRename(item.id)}
                                onClick={e => e.stopPropagation()}
                                style={{
                                    flex: 1,
                                    background: "var(--color-bg-surface, #ffffff)",
                                    border: "1px solid var(--color-border, #cccccc)",
                                    borderRadius: 6,
                                    padding: "2px 6px",
                                    fontSize: 12.5,
                                    color: "var(--color-text-primary, #111111)",
                                    outline: "none",
                                    minWidth: 0,
                                    zIndex: 3,
                                }}
                            />
                        ) : (
                            <div style={{
                                flex: 1,
                                minWidth: 0,
                                position: "relative",
                                overflow: "hidden",
                                paddingRight: item.projectName ? 4 : 26,
                                maskImage: "linear-gradient(to right, black 0%, black calc(100% - 32px), transparent 100%)",
                                WebkitMaskImage: "linear-gradient(to right, black 0%, black calc(100% - 32px), transparent 100%)",
                            }}>
                                <span style={{
                                    display: "block",
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "clip",
                                    fontSize: 13,
                                    color: item.isUnread ? "var(--color-text-primary, #111111)" : "inherit",
                                    fontWeight: item.isUnread ? 600 : "inherit",
                                }}>
                                    {item.title || "Untitled Chat"}
                                </span>
                            </div>
                        )}

                        {item.projectName && !isRenaming && (
                            <div style={{
                                fontSize: 9.5,
                                backgroundColor: 'var(--sidebar-bg-active, rgba(0,0,0,0.06))',
                                padding: '1px 5px',
                                borderRadius: 5,
                                color: 'var(--sidebar-project-text, #666666)',
                                whiteSpace: 'nowrap',
                                fontWeight: 500,
                                flexShrink: 0,
                                maxWidth: 70,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                zIndex: 3,
                                marginRight: 24,
                            }}>
                                {item.projectName}
                            </div>
                        )}

                        {/* 3 Dots Button */}
                        <div
                            className="chat-dots-btn"
                            onClick={(e) => handleOpenMenu(e, item.id)}
                            title="Options"
                            style={{
                                position: "absolute",
                                right: 6,
                                top: "50%",
                                transform: "translateY(-50%)",
                                padding: "3px 4px",
                                borderRadius: 6,
                                color: "var(--sidebar-text-tertiary)",
                                opacity: menuConvId === item.id ? 1 : 0,
                                transition: "opacity 0.15s, background-color 0.15s, color 0.15s",
                                cursor: "pointer",
                                lineHeight: 1,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                zIndex: 4,
                            }}
                            onMouseEnter={e => {
                                e.currentTarget.style.backgroundColor = "var(--sidebar-bg-hover)";
                                e.currentTarget.style.color = "var(--sidebar-text-primary)";
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.backgroundColor = "transparent";
                                e.currentTarget.style.color = "var(--sidebar-text-tertiary)";
                            }}
                        >
                            <EllipsisHorizontalIcon width={16} height={16} />
                        </div>
                    </>
                )}
            </div>
        );
    };

    const sidebarWidth = 260;
    const collapsedWidth = 68;

    return (
        <>
            <motion.div
                initial={false}
                animate={{ width: isOpen ? sidebarWidth : collapsedWidth }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className="glossy-no-border"
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
                {/* Top Control Bar */}
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
                </div>

                {/* Brand Area */}
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
                        <Image unoptimized src="/images/logos/black-logo-withoutbg.png" alt="EverFern" width={48} height={48} priority loading="eager" style={{ filter: theme === 'dark' ? 'invert(1) brightness(0.9)' : 'none' }} />
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
                    <div style={{ padding: isOpen ? "8px 10px" : "8px 0", display: "flex", flexDirection: "column", gap: 2, alignItems: "center", flexShrink: 0 }}>
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

                        <div style={{ width: "100%", paddingTop: 6, display: "flex", flexDirection: "column", gap: 4, alignItems: "center" }}>
                            {[
                                { icon: MagnifyingGlassIcon, label: "Search" },
                                { icon: BriefcaseIcon, label: "Customize" },
                                { icon: LinkIcon, label: "Integrations" },
                                { icon: ArchiveBoxIcon, label: "Projects" },
                                { icon: ClockIcon, label: "Scheduled Tasks" },
                                { icon: SquaresPlusIcon, label: "Artifacts" },
                                { icon: CodeBracketIcon, label: "Code" },
                                { icon: ChartBarIcon, label: "Analytics" },
                            ].map((item) => (
                                <button
                                    key={item.label}
                                    style={{
                                        width: isOpen ? "100%" : 42,
                                        height: isOpen ? 34 : 40,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: isOpen ? "flex-start" : "center",
                                        gap: 10,
                                        padding: isOpen ? "0 12px" : 0,
                                        background: "transparent",
                                        border: "none",
                                        borderRadius: 10,
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
                                        else if (item.label === "Scheduled Tasks" && onScheduledTasksClick) onScheduledTasksClick();
                                        else if (item.label === "Analytics" && onAnalyticsClick) onAnalyticsClick();
                                    }}
                                    title={!isOpen ? item.label : undefined}
                                >
                                    <item.icon width={17} height={17} opacity={0.9} />
                                    {isOpen && <span>{item.label}</span>}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* History List */}
                    <div style={{ padding: isOpen ? "8px 8px 20px" : "8px 0 20px", display: "flex", flexDirection: "column", flexShrink: 0 }}>
                        {isOpen && (
                            <>
                                {/* Pinned Chats Section */}
                                {pinnedChats.length > 0 && (
                                    <div style={{ marginBottom: 12 }}>
                                        <div style={{ 
                                            padding: "6px 12px 6px", 
                                            fontSize: 11, 
                                            fontWeight: 700, 
                                            color: "var(--sidebar-text-tertiary)", 
                                            width: "100%",
                                            letterSpacing: "0.02em"
                                        }}>
                                            Pinned
                                        </div>
                                        {pinnedChats.map(renderChatItem)}
                                    </div>
                                )}

                                {/* Recent Chats Section - Only R capital */}
                                {recentChats.length > 0 && (
                                    <div>
                                        <div style={{ 
                                            padding: "6px 12px 6px", 
                                            fontSize: 11, 
                                            fontWeight: 700, 
                                            color: "var(--sidebar-text-tertiary)", 
                                            width: "100%",
                                            letterSpacing: "0.02em"
                                        }}>
                                            Recent
                                        </div>
                                        {recentChats.map(renderChatItem)}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div style={{ padding: isOpen ? 12 : "12px 0", borderTop: "1px solid var(--sidebar-border)", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                    <div style={{ display: "flex", width: "100%", alignItems: "center", gap: 10, padding: isOpen ? "8px 10px" : "8px 0", justifyContent: isOpen ? "flex-start" : "center", borderRadius: 12 }}>
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
                                    textOverflow: "ellipsis"
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
                                    width: 30, height: 30, borderRadius: 8, background: "var(--sidebar-settings-bg)",
                                    border: "1px solid var(--sidebar-settings-border)", color: "var(--sidebar-settings-text)",
                                    display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                                    transition: "all 0.2s"
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--sidebar-settings-hover-border)"; e.currentTarget.style.color = "var(--sidebar-settings-hover-text)"; e.currentTarget.style.background = "var(--sidebar-settings-hover-bg)"; }}
                                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--sidebar-settings-border)"; e.currentTarget.style.color = "var(--sidebar-settings-text)"; e.currentTarget.style.background = "var(--sidebar-settings-bg)"; }}
                            >
                                <Cog6ToothIcon width={15} height={15} />
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

            {/* 3-Dots Dropdown Menu (Fixed in DOM) */}
            <AnimatePresence>
                {menuConvId && activeItem && (
                    <motion.div
                        ref={menuRef}
                        initial={{ opacity: 0, scale: 0.95, y: -4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: -4 }}
                        transition={{ duration: 0.12 }}
                        style={{
                            position: "fixed",
                            top: menuPosition.top,
                            left: menuPosition.left,
                            zIndex: 9999,
                            backgroundColor: "var(--color-bg-surface, #ffffff)",
                            border: "1px solid var(--color-border, #e5e5e5)",
                            borderRadius: 14,
                            boxShadow: "0 14px 34px -4px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.06)",
                            padding: "6px",
                            minWidth: 195,
                            display: "flex",
                            flexDirection: "column",
                            gap: 1,
                        }}
                    >
                        {/* 1. Pin / Unpin */}
                        <button
                            type="button"
                            onClick={() => handleTogglePin(activeItem.id)}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                width: "100%",
                                padding: "7px 10px",
                                border: "none",
                                background: "transparent",
                                borderRadius: 8,
                                fontSize: 13,
                                color: "var(--color-text-primary, #111111)",
                                cursor: "pointer",
                                textAlign: "left",
                                transition: "background-color 0.12s",
                            }}
                            onMouseEnter={e => e.currentTarget.style.backgroundColor = "var(--color-bg-hover, #f4f4f4)"}
                            onMouseLeave={e => e.currentTarget.style.backgroundColor = "transparent"}
                        >
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/>
                                </svg>
                                <span>{activeItem.isPinned ? "Unpin" : "Pin"}</span>
                            </div>
                            <span style={{ fontSize: 11.5, color: "var(--color-text-tertiary, #999999)", fontWeight: 500 }}>P</span>
                        </button>

                        {/* 2. Mark as unread / read */}
                        <button
                            type="button"
                            onClick={() => handleToggleUnread(activeItem.id)}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                width: "100%",
                                padding: "7px 10px",
                                border: "none",
                                background: "transparent",
                                borderRadius: 8,
                                fontSize: 13,
                                color: "var(--color-text-primary, #111111)",
                                cursor: "pointer",
                                textAlign: "left",
                                transition: "background-color 0.12s",
                            }}
                            onMouseEnter={e => e.currentTarget.style.backgroundColor = "var(--color-bg-hover, #f4f4f4)"}
                            onMouseLeave={e => e.currentTarget.style.backgroundColor = "transparent"}
                        >
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                {activeItem.isUnread ? (
                                    <EyeIcon width={16} height={16} />
                                ) : (
                                    <EyeSlashIcon width={16} height={16} />
                                )}
                                <span>{activeItem.isUnread ? "Mark as read" : "Mark as unread"}</span>
                            </div>
                            <span style={{ fontSize: 11.5, color: "var(--color-text-tertiary, #999999)", fontWeight: 500 }}>U</span>
                        </button>

                        {/* 3. Rename */}
                        <button
                            type="button"
                            onClick={() => startRenaming(activeItem)}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                width: "100%",
                                padding: "7px 10px",
                                border: "none",
                                background: "transparent",
                                borderRadius: 8,
                                fontSize: 13,
                                color: "var(--color-text-primary, #111111)",
                                cursor: "pointer",
                                textAlign: "left",
                                transition: "background-color 0.12s",
                            }}
                            onMouseEnter={e => e.currentTarget.style.backgroundColor = "var(--color-bg-hover, #f4f4f4)"}
                            onMouseLeave={e => e.currentTarget.style.backgroundColor = "transparent"}
                        >
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <PencilSquareIcon width={15} height={15} />
                                <span>Rename</span>
                            </div>
                            <span style={{ fontSize: 11.5, color: "var(--color-text-tertiary, #999999)", fontWeight: 500 }}>R</span>
                        </button>

                        {/* 4. Change project (with submenu) */}
                        <div
                            style={{ position: "relative" }}
                            onMouseEnter={() => setShowChangeProjectSubmenu(true)}
                            onMouseLeave={() => setShowChangeProjectSubmenu(false)}
                        >
                            <button
                                type="button"
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    width: "100%",
                                    padding: "7px 10px",
                                    border: "none",
                                    background: showChangeProjectSubmenu ? "var(--color-bg-hover, #f4f4f4)" : "transparent",
                                    borderRadius: 8,
                                    fontSize: 13,
                                    color: "var(--color-text-primary, #111111)",
                                    cursor: "pointer",
                                    textAlign: "left",
                                    transition: "background-color 0.12s",
                                }}
                            >
                                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                    <ArchiveBoxIcon width={15} height={15} />
                                    <span>Change project</span>
                                </div>
                                <ChevronRightIcon width={13} height={13} color="var(--color-text-tertiary, #999999)" />
                            </button>

                            {/* Submenu for projects */}
                            <AnimatePresence>
                                {showChangeProjectSubmenu && (
                                    <motion.div
                                        key="change-project-submenu"
                                        initial={{ opacity: 0, x: -6, scale: 0.97 }}
                                        animate={{ opacity: 1, x: 0, scale: 1 }}
                                        exit={{ opacity: 0, x: -6, scale: 0.97 }}
                                        transition={{ duration: 0.14, ease: "easeOut" }}
                                        style={{
                                            position: "absolute",
                                            left: "100%",
                                            top: -4,
                                            backgroundColor: "var(--color-bg-surface, #ffffff)",
                                            border: "1px solid var(--color-border, #e5e5e5)",
                                            borderRadius: 12,
                                            boxShadow: "0 10px 28px rgba(0,0,0,0.14)",
                                            padding: "6px",
                                            minWidth: 160,
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: 2,
                                            marginLeft: 6,
                                        }}
                                    >
                                    {projects.length === 0 ? (
                                        <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--color-text-tertiary)" }}>
                                            No projects available
                                        </div>
                                    ) : (
                                        projects.map((proj: any) => (
                                            <button
                                                key={proj.id}
                                                type="button"
                                                onClick={() => handleAssignProject(activeItem.id, proj.id)}
                                                style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "space-between",
                                                    padding: "6px 10px",
                                                    border: "none",
                                                    background: activeItem.projectId === proj.id ? "var(--color-bg-active, #ececec)" : "transparent",
                                                    borderRadius: 6,
                                                    fontSize: 12.5,
                                                    color: "var(--color-text-primary, #111111)",
                                                    cursor: "pointer",
                                                    textAlign: "left",
                                                }}
                                                onMouseEnter={e => e.currentTarget.style.backgroundColor = "var(--color-bg-hover, #f4f4f4)"}
                                                onMouseLeave={e => e.currentTarget.style.backgroundColor = activeItem.projectId === proj.id ? "var(--color-bg-active, #ececec)" : "transparent"}
                                            >
                                                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                    {proj.name}
                                                </span>
                                                {activeItem.projectId === proj.id && (
                                                    <CheckIcon width={13} height={13} color="#10b981" />
                                                )}
                                            </button>
                                        ))
                                    )}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>

                        {/* 5. Remove from project */}
                        {activeItem.projectId && (
                            <button
                                type="button"
                                onClick={() => handleAssignProject(activeItem.id, null)}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    width: "100%",
                                    padding: "7px 10px",
                                    border: "none",
                                    background: "transparent",
                                    borderRadius: 8,
                                    fontSize: 13,
                                    color: "var(--color-text-primary, #111111)",
                                    cursor: "pointer",
                                    textAlign: "left",
                                    transition: "background-color 0.12s",
                                }}
                                onMouseEnter={e => e.currentTarget.style.backgroundColor = "var(--color-bg-hover, #f4f4f4)"}
                                onMouseLeave={e => e.currentTarget.style.backgroundColor = "transparent"}
                            >
                                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                    <FolderMinusIcon width={15} height={15} />
                                    <span>Remove from project</span>
                                </div>
                            </button>
                        )}

                        {/* Divider */}
                        <div style={{ height: 1, backgroundColor: "var(--color-border-subtle, #f0f0f0)", margin: "4px 2px" }} />

                        {/* 6. Delete */}
                        <button
                            type="button"
                            onClick={() => handleDelete(activeItem.id)}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                width: "100%",
                                padding: "7px 10px",
                                border: "none",
                                background: "transparent",
                                borderRadius: 8,
                                fontSize: 13,
                                color: "#dc2626",
                                cursor: "pointer",
                                textAlign: "left",
                                transition: "background-color 0.12s",
                            }}
                            onMouseEnter={e => e.currentTarget.style.backgroundColor = "rgba(220, 38, 38, 0.08)"}
                            onMouseLeave={e => e.currentTarget.style.backgroundColor = "transparent"}
                        >
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <TrashIcon width={15} height={15} color="#dc2626" />
                                <span style={{ fontWeight: 500 }}>Delete</span>
                            </div>
                            <span style={{ fontSize: 11.5, color: "#dc2626", opacity: 0.8, fontWeight: 500 }}>D</span>
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
}
