'use client';
import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { XMarkIcon, PencilSquareIcon, CheckIcon, ArrowDownTrayIcon, GlobeAltIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';

interface Artifact {
    id: string; // filename
    chatId: string;
    name: string;
    lastEdited: number;
    snippet: string;
    size: number;
}

interface ArtifactsPanelProps {
    isOpen: boolean;
    onClose: () => void;
    activeChatId?: string | null;
    onApprovePlan?: (planContent: string) => void;
    selectedFileName?: string | null;
    projectPath?: string | null;
}

// Syntax highlighting helper
const getSyntaxHighlightingColors = (language: string, token: string): string => {
    const colorMap: Record<string, Record<string, string>> = {
        javascript: { keyword: '#d946ef', string: '#16a34a', number: '#2563eb', comment: '#8a8886', function: '#0891b2' },
        typescript: { keyword: '#d946ef', string: '#16a34a', number: '#2563eb', comment: '#8a8886', function: '#0891b2' },
        python: { keyword: '#d946ef', string: '#16a34a', number: '#2563eb', comment: '#8a8886', function: '#0891b2' },
        html: { tag: '#dc2626', attr: '#0891b2', string: '#16a34a', comment: '#8a8886' },
        css: { property: '#d946ef', value: '#2563eb', selector: '#dc2626', comment: '#8a8886' },
        json: { key: '#0891b2', string: '#16a34a', number: '#2563eb', boolean: '#d946ef' },
        sql: { keyword: '#d946ef', string: '#16a34a', number: '#2563eb', comment: '#8a8886' },
    };
    return colorMap[language]?.[token] || '#201e24';
};

// Detect language from filename
const detectLanguage = (filename: string): string => {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const langMap: Record<string, string> = {
        js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
        py: 'python', html: 'html', htm: 'html', css: 'css', scss: 'css',
        json: 'json', sql: 'sql', md: 'markdown', yml: 'yaml', yaml: 'yaml'
    };
    return langMap[ext] || 'text';
};

// Syntax highlighter component
export const SyntaxHighlighter = ({ code, language }: { code: string; language: string }) => {
    const colorSchemes: Record<string, Record<string, string>> = {
        python: {
            keyword: '#d946ef',
            string: '#16a34a',
            number: '#2563eb',
            comment: '#8a8886',
            function: '#0891b2',
        },
        javascript: {
            keyword: '#d946ef',
            string: '#16a34a',
            number: '#2563eb',
            comment: '#8a8886',
            function: '#0891b2',
        },
        typescript: {
            keyword: '#d946ef',
            string: '#16a34a',
            number: '#2563eb',
            comment: '#8a8886',
            function: '#0891b2',
        },
        html: {
            tag: '#dc2626',
            attr: '#0891b2',
            string: '#16a34a',
            comment: '#8a8886',
        },
        css: {
            property: '#d946ef',
            value: '#2563eb',
            selector: '#dc2626',
            comment: '#8a8886',
        },
        json: {
            key: '#0891b2',
            string: '#16a34a',
            number: '#2563eb',
            boolean: '#d946ef',
        },
    };

    const colors = colorSchemes[language] || {};
    const lines = code.split('\n');

    const highlightLine = (line: string): React.ReactNode[] => {
        if (!colors || Object.keys(colors).length === 0) {
            return [<span key={line} style={{ color: '#201e24' }}>{line}</span>];
        }

        // Comment detection
        const commentMatch = line.match(/^(\s*)(#|\/\/|\/\*|<!--)(.*)/);
        if (commentMatch) {
            return [<span key={line} style={{ color: colors.comment || '#8a8886' }}>{line}</span>];
        }

        const result: React.ReactNode[] = [];
        const stringPattern = /(['"`])(.*?)\1/g;
        const keywordPattern = /\b(if|else|for|while|function|def|class|return|const|let|var|import|export|from|async|await|try|catch|throw|new|this|true|false|null|undefined|and|or|not|in|is|lambda|def|self|super|pass|break|continue)\b/g;
        const numberPattern = /\b(\d+\.?\d*)\b/g;

        let lastIndex = 0;
        const tokens: Array<{ type: 'keyword' | 'string' | 'number' | 'text'; value: string; color?: string }> = [];

        // Tokenize the line
        let temp = line;
        const stringMatches = Array.from(line.matchAll(stringPattern));
        const keywordMatches = Array.from(line.matchAll(keywordPattern));
        const numberMatches = Array.from(line.matchAll(numberPattern));

        const allMatches = [
            ...stringMatches.map(m => ({ ...m, type: 'string' })),
            ...keywordMatches.map(m => ({ ...m, type: 'keyword' })),
            ...numberMatches.map(m => ({ ...m, type: 'number' })),
        ].sort((a, b) => a.index! - b.index!);

        lastIndex = 0;
        allMatches.forEach((match) => {
            if (match.index! > lastIndex) {
                tokens.push({ type: 'text', value: line.slice(lastIndex, match.index) });
            }
            const colorMap: Record<string, string> = { string: colors.string, keyword: colors.keyword, number: colors.number };
            const type = (match as any).type as 'string' | 'keyword' | 'number';
            tokens.push({ type, value: match[0], color: colorMap[type] || '#201e24' });
            lastIndex = match.index! + match[0].length;
        });

        if (lastIndex < line.length) {
            tokens.push({ type: 'text', value: line.slice(lastIndex) });
        }

        return tokens.map((token, idx) => (
            <span key={idx} style={{ color: token.color || '#201e24' }}>
                {token.value}
            </span>
        )) || [<span key={line}>{line}</span>];
    };

    return (
        <>
            {lines.map((line, idx) => (
                <div key={idx} style={{ color: '#201e24', lineHeight: 1.6 }}>
                    {highlightLine(line)}
                </div>
            ))}
        </>
    );
};

export default function ArtifactsPanel({ isOpen, onClose, activeChatId, onApprovePlan, selectedFileName, projectPath }: ArtifactsPanelProps) {
    const [activeTab, setActiveTab] = useState<'inspiration' | 'yours' | 'sites' | 'terminal'>('yours');
    const [artifacts, setArtifacts] = useState<Artifact[]>([]);
    const [sites, setSites] = useState<{id: string; chatId: string; name: string; lastEdited: number; size: number; path: string}[]>([]);
    const [selectedCode, setSelectedCode] = useState<{name: string, content: string, chatId: string} | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [editedContent, setEditedContent] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [viewMode, setViewMode] = useState<'code' | 'preview'>('code');
    const [artifactPath, setArtifactPath] = useState<string>('');

    // Terminal Processes state
    const [processes, setProcesses] = useState<{ id: string; commandLine: string; status: 'running' | 'done'; exitCode?: number | null; bufferSize: number }[]>([]);
    const [processesLoading, setProcessesLoading] = useState(false);

    const loadProcesses = useCallback(async () => {
        try {
            setProcessesLoading(true);
            const results = await (window as any).electronAPI.terminal.listProcesses();
            setProcesses(results || []);
        } catch (e) {
            console.error('Failed to load terminal processes', e);
            setProcesses([]);
        } finally {
            setProcessesLoading(false);
        }
    }, []);

    // Poll processes every 2s while the terminal tab is active
    useEffect(() => {
        if (activeTab !== 'terminal' || !isOpen) return;
        loadProcesses();
        const interval = setInterval(loadProcesses, 2000);
        return () => clearInterval(interval);
    }, [activeTab, isOpen, loadProcesses]);

    const handleKillProcess = async (id: string) => {
        try {
            await (window as any).electronAPI.terminal.killProcess(id);
            await loadProcesses();
        } catch (e) {
            console.error('Failed to kill process', e);
        }
    };

    // Fetch all artifacts on open (not filtered by chat)
    useEffect(() => {
        if (isOpen) {
            loadArtifacts(); // Load all artifacts across all chats
            loadAllSites();
        }
    }, [isOpen]);

    // Auto-enter edit mode for plan files
    useEffect(() => {
        if (selectedCode) {
            setEditedContent(selectedCode.content);
            const isPlan = selectedCode.name === 'execution_plan.md';
            setIsEditing(isPlan);
            
            // Auto-switch to preview for HTML artifacts if NOT a plan
            const isHtml = selectedCode.name.endsWith('.html') || selectedCode.name.endsWith('.htm');
            if (isHtml && !isPlan) {
                setViewMode('preview');
            } else {
                setViewMode('code');
            }
            
            // Get the artifact path
            const path = projectPath 
                ? `${projectPath}/.everfern/artifacts/${selectedCode.name}`
                : `~/.everfern/artifacts/${selectedCode.chatId}/${selectedCode.name}`;
            setArtifactPath(path);
        }
    }, [selectedCode]);

    // Handle auto-selection of specific file from props
    useEffect(() => {
        if (selectedFileName && activeChatId) {
            handleSelectArtifactByName(selectedFileName);
        }
    }, [selectedFileName, activeChatId]);

    const handleSelectArtifactByName = async (name: string) => {
        if (!activeChatId) return;
        const content = await (window as any).electronAPI?.artifacts.read(activeChatId, name, projectPath);
        if (content !== null) {
            setSelectedCode({ name, content, chatId: activeChatId });
            setActiveTab('yours');
        }
    };

    const loadArtifacts = async () => {
        try {
            const results = await (window as any).electronAPI?.artifacts.list(undefined, projectPath); // No chatId = load all for this project/global
            // Filter out exec/ temp files (Python scripts, shell scripts, JS/TS temp files)
            const EXEC_EXTS = ['.py', '.sh', '.bat', '.ps1', '.js', '.ts', '.tsx', '.jsx'];
            const filtered = (results || []).filter((a: any) => {
                const ext = '.' + (a.name.split('.').pop() || '');
                return !EXEC_EXTS.includes(ext.toLowerCase());
            });
            setArtifacts(filtered);
        } catch (e) {
            console.error("Failed to load artifacts", e);
            setArtifacts([]);
        }
    };

    const loadSites = async (chatId: string) => {
        try {
            const results = await (window as any).electronAPI.sites.list(chatId);
            const sitesList = results || [];
            setSites(sitesList.map((s: any) => ({
                id: s.id,
                chatId: s.chatId,
                name: s.name,
                lastEdited: s.lastEdited,
                size: s.size,
                path: s.path
            })));
        } catch (e) {
            console.error("Failed to load sites", e);
            setSites([]);
        }
    };

    const loadAllSites = async () => {
        try {
            const results = await (window as any).electronAPI.sites.list();
            const sitesList = results || [];
            setSites(sitesList.map((s: any) => ({
                id: s.id,
                chatId: s.chatId,
                name: s.name,
                lastEdited: s.lastEdited,
                size: s.size,
                path: s.path
            })));
        } catch (e) {
            console.error("Failed to load all sites", e);
            setSites([]);
        }
    };

    const handleReadArtifact = async (chatId: string, name: string) => {
        try {
            const content = await (window as any).electronAPI?.artifacts.read(chatId, name, projectPath);
            if (content) {
                setSelectedCode({ name, content, chatId });
                setSaveSuccess(false);
            }
        } catch (e) {
            console.error("Error reading artifact file", e);
        }
    };

    const handleSave = async () => {
        if (!selectedCode) return;
        setIsSaving(true);
        try {
            await (window as any).electronAPI?.artifacts.write(selectedCode.chatId, selectedCode.name, editedContent, projectPath);
            setSelectedCode(prev => prev ? { ...prev, content: editedContent } : null);
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 2000);
        } catch (e) {
            console.error("Error saving artifact", e);
        } finally {
            setIsSaving(false);
        }
    };

    const handleApprovePlan = async () => {
        // First save any changes
        if (selectedCode && editedContent !== selectedCode.content) {
            await handleSave();
        }
        // Then fire the callback to inject approval message into chat
        if (onApprovePlan) {
            onApprovePlan(editedContent);
            onClose();
        }
    };

    const handleDownload = () => {
        if (!selectedCode) return;
        const element = document.createElement('a');
        const file = new Blob([editedContent || selectedCode.content], { type: 'text/plain' });
        element.href = URL.createObjectURL(file);
        element.download = selectedCode.name;
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);
    };

    const isPlanFile = selectedCode?.name === 'execution_plan.md';

    const timeAgo = (timestamp: number) => {
        const seconds = Math.floor((Date.now() - timestamp) / 1000);
        let interval = seconds / 31536000;
        if (interval > 1) return Math.floor(interval) + " years ago";
        interval = seconds / 2592000;
        if (interval > 1) return Math.floor(interval) + " months ago";
        interval = seconds / 86400;
        if (interval > 1) return Math.floor(interval) + " days ago";
        interval = seconds / 3600;
        if (interval > 1) return Math.floor(interval) + " hours ago";
        interval = seconds / 60;
        if (interval > 1) return Math.floor(interval) + " minutes ago";
        return Math.floor(seconds) + " seconds ago";
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0, y: 40 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 40 }}
                    transition={{ type: "spring", damping: 25, stiffness: 250 }}
                    style={{
                        position: "fixed",
                        top: 0, left: 0, right: 0, bottom: 0,
                        backgroundColor: "#fcfcfb",
                        zIndex: 9999,
                        display: "flex",
                        flexDirection: "column",
                        color: "#201e24",
                        overflowY: "auto",
                        padding: "60px 80px"
                    }}
                >
                    <button
                        onClick={onClose}
                        style={{ position: "absolute", top: 30, right: 40, background: "transparent", border: "none", color: "#a1a1aa", cursor: "pointer", padding: 8, borderRadius: "50%" }}
                        onMouseEnter={e => e.currentTarget.style.backgroundColor = "rgba(0,0,0,0.05)"}
                        onMouseLeave={e => e.currentTarget.style.backgroundColor = "transparent"}
                    >
                        <XMarkIcon width={24} height={24} />
                    </button>

                    {selectedCode ? (
                        <motion.div 
                            initial={{ opacity: 0, scale: 0.95, y: 10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 10 }}
                            transition={{ type: "spring", damping: 20, stiffness: 300 }}
                            style={{ display: "flex", flexDirection: "column", flex: 1 }}
                        >
                            {/* Back button above filename */}
                            <button
                                onClick={() => { setSelectedCode(null); setIsEditing(false); }}
                                style={{ 
                                    alignSelf: 'flex-start',
                                    background: "transparent", 
                                    border: "1px solid #e8e6d9", 
                                    color: "#111111", 
                                    borderRadius: 8, 
                                    padding: "6px 16px", 
                                    cursor: "pointer", 
                                    fontSize: 13, 
                                    fontWeight: 600,
                                    marginBottom: 16,
                                    transition: "all 0.2s"
                                }}
                                onMouseEnter={e => { e.currentTarget.style.backgroundColor = "rgba(0,0,0,0.05)"; }}
                                onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; }}
                            >
                                {"\u2190"} Back
                            </button>

                            {/* Filename and path */}
                            <div style={{ marginBottom: 8 }}>
                                <h1 style={{ margin: "0 0 4px", fontSize: 28, fontWeight: 600 }}>{selectedCode.name}</h1>
                                <p style={{ margin: 0, fontSize: 12, color: "#8a8886", fontFamily: "'JetBrains Mono', 'Fira Code', monospace", wordBreak: "break-all" }}>{artifactPath}</p>
                            </div>

                            {/* Toolbar */}
                            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 24 }}>
                                {!isPlanFile && (
                                    <button
                                        onClick={() => setIsEditing(v => !v)}
                                        style={{ display: "flex", alignItems: "center", gap: 6, background: isEditing ? "rgba(0,0,0,0.05)" : "transparent", border: "1px solid #e8e6d9", color: "#111111", borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 13, transition: "all 0.2s" }}
                                        onMouseEnter={e => { if (!isEditing) e.currentTarget.style.backgroundColor = "rgba(0,0,0,0.04)"; }}
                                        onMouseLeave={e => { if (!isEditing) e.currentTarget.style.backgroundColor = "transparent"; }}
                                    >
                                        <PencilSquareIcon width={14} height={14} />
                                        {isEditing ? "Preview" : "Edit"}
                                    </button>
                                )}
                                {!isEditing && (
                                    <button
                                        onClick={handleDownload}
                                        style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: "1px solid #e8e6d9", color: "#111111", borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 13, transition: "all 0.2s" }}
                                        onMouseEnter={e => { e.currentTarget.style.backgroundColor = "rgba(0,0,0,0.04)"; }}
                                        onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; }}
                                        title="Download artifact"
                                    >
                                        <ArrowDownTrayIcon width={14} height={14} />
                                        Download
                                    </button>
                                )}
                                {isEditing && (
                                    <button
                                        onClick={handleSave}
                                        disabled={isSaving}
                                        style={{ display: "flex", alignItems: "center", gap: 6, background: saveSuccess ? "rgba(34,197,94,0.1)" : "rgba(0,0,0,0.04)", border: `1px solid ${saveSuccess ? "#22c55e" : "#e8e6d9"}`, color: saveSuccess ? "#16a34a" : "#111111", borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 13, transition: "all 0.3s" }}
                                    >
                                        {saveSuccess ? <><CheckIcon width={14} height={14} /> Saved!</> : "Save"}
                                    </button>
                                )}
                                {isPlanFile && (
                                    <button
                                        onClick={handleApprovePlan}
                                        style={{ display: "flex", alignItems: "center", gap: 8, background: "linear-gradient(135deg, rgba(74,222,128,0.2), rgba(34,197,94,0.1))", border: "1px solid rgba(74,222,128,0.5)", color: "#4ade80", borderRadius: 8, padding: "8px 18px", cursor: "pointer", fontSize: 13, fontWeight: 600, letterSpacing: "0.02em", transition: "all 0.2s" }}
                                        onMouseEnter={e => { e.currentTarget.style.background = "linear-gradient(135deg, rgba(74,222,128,0.28), rgba(34,197,94,0.18))"; e.currentTarget.style.borderColor = "rgba(74,222,128,0.8)"; }}
                                        onMouseLeave={e => { e.currentTarget.style.background = "linear-gradient(135deg, rgba(74,222,128,0.2), rgba(34,197,94,0.1))"; e.currentTarget.style.borderColor = "rgba(74,222,128,0.5)"; }}
                                    >
                                        <CheckIcon width={15} height={15} />
                                        Approve &amp; Execute
                                    </button>
                                )}
                            </div>

                            {/* View Mode Toggle (for HTML) */}
                            {!isPlanFile && (selectedCode.name.endsWith('.html') || selectedCode.name.endsWith('.htm')) && (
                                <div style={{ display: "flex", gap: 8, marginBottom: 16, backgroundColor: "rgba(0,0,0,0.03)", padding: 4, borderRadius: 10, width: "fit-content" }}>
                                    <button
                                        onClick={() => setViewMode('code')}
                                        style={{ padding: "6px 16px", borderRadius: 8, border: "none", fontSize: 13, fontWeight: 500, cursor: "pointer", backgroundColor: viewMode === 'code' ? "rgba(0,0,0,0.05)" : "transparent", color: viewMode === 'code' ? "#111111" : "#8a8886", transition: "all 0.2s" }}
                                    >
                                        Code
                                    </button>
                                    <button
                                        onClick={() => setViewMode('preview')}
                                        style={{ padding: "6px 16px", borderRadius: 8, border: "none", fontSize: 13, fontWeight: 500, cursor: "pointer", backgroundColor: viewMode === 'preview' ? "rgba(0,0,0,0.05)" : "transparent", color: viewMode === 'preview' ? "#111111" : "#8a8886", transition: "all 0.2s" }}
                                    >
                                        Visual Preview
                                    </button>
                                </div>
                            )}

                            {/* Plan notice */}
                            {isPlanFile && (
                                <div style={{ marginBottom: 16, padding: "12px 16px", backgroundColor: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.25)", borderRadius: 10, fontSize: 13, color: "#fbbf24", lineHeight: 1.5 }}>
                                    âœï¸ <strong>Review this plan carefully.</strong> You can edit any step before approving. Click <strong>Approve &amp; Execute</strong> when ready.
                                </div>
                            )}

                            {/* Content area */}
                            {viewMode === 'preview' ? (
                                <motion.div 
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    transition={{ delay: 0.1 }}
                                    style={{ flex: 1, backgroundColor: "#fff", borderRadius: 12, overflow: "hidden", border: "1px solid #27272a", position: "relative" }}>
                                    <iframe 
                                        srcDoc={(editedContent || selectedCode.content)}
                                        style={{ width: "100%", height: "100%", border: "none" }}
                                        title="Preview"
                                        sandbox="allow-scripts allow-forms allow-same-origin"
                                    />
                                    <div style={{ position: "absolute", bottom: 12, right: 12, backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", padding: "4px 10px", borderRadius: 6, fontSize: 10, color: "#fff", pointerEvents: "none" }}>
                                        Interactive Preview Mode
                                    </div>
                                </motion.div>
                            ) : isEditing ? (
                                <motion.textarea
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    transition={{ delay: 0.05 }}
                                    value={editedContent}
                                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setEditedContent(e.target.value)}
                                    spellCheck={false}
                                    style={{
                                        flex: 1,
                                        minHeight: "60vh",
                                        backgroundColor: "#f4f4f4",
                                        border: "1px solid #e8e6d9",
                                        borderRadius: 12,
                                        padding: 24,
                                        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                                        fontSize: 13,
                                        color: "#201e24",
                                        lineHeight: 1.7,
                                        resize: "vertical",
                                        outline: "none",
                                        caretColor: "#111111"
                                    }}
                                    onFocus={(e: React.FocusEvent<HTMLTextAreaElement>) => { (e.target as HTMLTextAreaElement).style.borderColor = "#3f3f46"; }}
                                    onBlur={(e: React.FocusEvent<HTMLTextAreaElement>) => { (e.target as HTMLTextAreaElement).style.borderColor = "#e8e6d9"; }}
                                />
                            ) : (
                                <motion.div 
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    transition={{ delay: 0.05 }}
                                    style={{ backgroundColor: "#f4f4f4", border: "1px solid #e8e6d9", borderRadius: 12, padding: 24, flex: 1, overflow: "auto", fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: 13, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
                                    <SyntaxHighlighter code={editedContent || selectedCode.content} language={detectLanguage(selectedCode.name)} />
                                </motion.div>
                            )}
                        </motion.div>
                    ) : (
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ type: "spring", damping: 20, stiffness: 250 }}
                        >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 40 }}>
                                <h1 style={{ margin: 0, fontSize: 32, fontFamily: "'OrticaLinear-Light', serif", fontWeight: 400 }}>Artifacts</h1>
                                <button style={{ backgroundColor: "#201e24", color: "#fcfcfb", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "all 0.2s" }}
                                    onMouseEnter={e => e.currentTarget.style.backgroundColor = "#3f3f46"}
                                    onMouseLeave={e => e.currentTarget.style.backgroundColor = "#201e24"}
                                >
                                    New artifact
                                </button>
                            </div>

                             <div style={{ display: "flex", gap: 32, borderBottom: "1px solid #e8e6d9", marginBottom: 32 }}>
                                <button
                                    onClick={() => setActiveTab('inspiration')}
                                    style={{ background: "transparent", border: "none", borderBottom: activeTab === 'inspiration' ? "2px solid #201e24" : "2px solid transparent", color: activeTab === 'inspiration' ? "#201e24" : "#8a8886", fontSize: 15, fontWeight: 500, paddingBottom: 12, cursor: "pointer", transition: "0.2s" }}
                                >
                                    Inspiration
                                </button>
                                <button
                                    onClick={() => setActiveTab('yours')}
                                    style={{ background: "transparent", border: "none", borderBottom: activeTab === 'yours' ? "2px solid #201e24" : "2px solid transparent", color: activeTab === 'yours' ? "#201e24" : "#8a8886", fontSize: 15, fontWeight: 500, paddingBottom: 12, cursor: "pointer", transition: "0.2s" }}
                                >
                                    Your artifacts
                                </button>
                                <button
                                    onClick={() => setActiveTab('sites')}
                                    style={{ background: "transparent", border: "none", borderBottom: activeTab === 'sites' ? "2px solid #201e24" : "2px solid transparent", color: activeTab === 'sites' ? "#201e24" : "#8a8886", fontSize: 15, fontWeight: 500, paddingBottom: 12, cursor: "pointer", transition: "0.2s", display: "flex", alignItems: "center", gap: 6 }}
                                >
                                    <GlobeAltIcon className="w-4 h-4" />
                                    Sites
                                    {sites.length > 0 && (
                                        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 18, height: 18, borderRadius: 9, backgroundColor: "rgba(139,92,246,0.15)", color: "#7c3aed", fontSize: 11, fontWeight: 700, padding: "0 5px" }}>
                                            {sites.length}
                                        </span>
                                    )}
                                </button>
                                <button
                                    onClick={() => setActiveTab('terminal')}
                                    style={{ background: "transparent", border: "none", borderBottom: activeTab === 'terminal' ? "2px solid #201e24" : "2px solid transparent", color: activeTab === 'terminal' ? "#201e24" : "#8a8886", fontSize: 15, fontWeight: 500, paddingBottom: 12, cursor: "pointer", transition: "0.2s", display: "flex", alignItems: "center", gap: 6 }}
                                >
                                    Terminal
                                    {processes.filter(p => p.status === 'running').length > 0 && (
                                        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 18, height: 18, borderRadius: 9, backgroundColor: "rgba(34,197,94,0.15)", color: "#16a34a", fontSize: 11, fontWeight: 700, padding: "0 5px" }}>
                                            {processes.filter(p => p.status === 'running').length}
                                        </span>
                                    )}
                                </button>
                            </div>

                            <AnimatePresence mode="wait">
                                {activeTab === 'yours' && (
                                    <motion.div 
                                        key="yours"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        transition={{ duration: 0.2 }}
                                        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 24 }}>
                                        {artifacts.length === 0 ? (
                                            <div style={{ backgroundColor: "#fcfbf7", border: "1px dashed #e8e6d9", borderRadius: 16, padding: "40px", textAlign: "center", gridColumn: "1 / -1" }}>
                                                <div style={{ fontSize: 15, fontWeight: 600, color: "#201e24" }}>No artifacts in this chat yet</div>
                                                <p style={{ color: "#8a8886", fontSize: 13, marginTop: 8, maxWidth: 300, margin: "8px auto" }}>Tell the AI to generate a report, dashboard, or code file to see it here.</p>
                                                <button 
                                                    onClick={() => loadArtifacts()}
                                                    style={{ marginTop: 20, padding: "8px 16px", backgroundColor: "#201e24", color: "#fff", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "none" }}
                                                >
                                                    Refresh Artifacts
                                                </button>
                                            </div>
                                        ) : artifacts.map((a, idx) => (
                                            <motion.div
                                                key={a.id + a.chatId}
                                                initial={{ opacity: 0, y: 20 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                transition={{ delay: idx * 0.05 }}
                                                onClick={() => handleReadArtifact(a.chatId, a.name)}
                                                style={{ cursor: "pointer" }}
                                            >
                                                <motion.div 
                                                    whileHover={{ y: -4 }}
                                                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                                                    style={{ backgroundColor: a.name === 'execution_plan.md' ? "rgba(234,179,8,0.05)" : "#ffffff", borderRadius: "16px", border: a.name === 'execution_plan.md' ? "1px solid rgba(234,179,8,0.3)" : "1px solid #e8e6d9", height: 220, overflow: "hidden", display: "flex", flexDirection: "column", position: "relative" }}>
                                                    {a.name === 'execution_plan.md' && (
                                                        <div style={{ position: "absolute", top: 10, right: 12, padding: "3px 8px", backgroundColor: "rgba(234,179,8,0.1)", border: "1px solid rgba(234,179,8,0.3)", borderRadius: 6, fontSize: 10, fontWeight: 700, color: "#854d0e", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                                                            Awaiting Approval
                                                        </div>
                                                    )}
                                                    <div style={{ margin: "24px 24px 0 24px", backgroundColor: "#fcfcfb", border: "1px solid #e8e6d9", borderBottom: "none", borderTopLeftRadius: 12, borderTopRightRadius: 12, flex: 1, padding: 16, overflow: "hidden" }}>
                                                        <pre style={{ margin: 0, fontSize: 10, color: "#8a8886", fontFamily: "'JetBrains Mono', 'Fira Code', monospace", opacity: 0.8, whiteSpace: "pre-wrap" }}>
                                                            {a.snippet}
                                                        </pre>
                                                    </div>
                                                    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 60, background: `linear-gradient(transparent, ${a.name === 'execution_plan.md' ? 'rgba(252,250,240,0.95)' : '#ffffff'} 90%)` }}></div>
                                                </motion.div>
                                                <div style={{ marginTop: 12 }}>
                                                    <div style={{ fontSize: 14, fontWeight: 600, color: "#201e24", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</div>
                                                    <div style={{ fontSize: 12, color: "#8a8886", marginTop: 4, display: "flex", gap: 8, alignItems: "center" }}>
                                                        <span>Last edited {timeAgo(a.lastEdited)}</span>
                                                        <span style={{ color: "#d1d5db" }}>·</span>
                                                        <span style={{ color: "#6366f1", fontWeight: 500 }}>Chat {a.chatId.slice(0, 8)}...</span>
                                                    </div>
                                                </div>
                                            </motion.div>
                                        ))}
                                    </motion.div>
                                )}

                                {activeTab === 'sites' && (
                                    <motion.div 
                                        key="sites"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        transition={{ duration: 0.2 }}
                                        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 24 }}>
                                        {sites.length === 0 ? (
                                            <div style={{ backgroundColor: "#fcfbf7", border: "1px dashed #e8e6d9", borderRadius: 16, padding: "40px", textAlign: "center", gridColumn: "1 / -1" }}>
                                                <GlobeAltIcon className="w-12 h-12 mx-auto mb-4 opacity-30" style={{ color: "#8a8886" }} />
                                                <div style={{ fontSize: 15, fontWeight: 600, color: "#201e24" }}>No websites created yet</div>
                                                <p style={{ color: "#8a8886", fontSize: 13, marginTop: 8, maxWidth: 300, margin: "8px auto" }}>Ask the AI to build a website, dashboard, or HTML report to see it here.</p>
                                                <button 
                                                    onClick={() => activeChatId && loadSites(activeChatId)}
                                                    style={{ marginTop: 20, padding: "8px 16px", backgroundColor: "#201e24", color: "#fff", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "none" }}
                                                >
                                                    Refresh Sites
                                                </button>
                                            </div>
                                        ) : sites.map((site, idx) => (
                                            <motion.div
                                                key={site.id + site.chatId}
                                                initial={{ opacity: 0, y: 20 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                transition={{ delay: idx * 0.05 }}
                                                style={{ cursor: "pointer" }}
                                            >
                                                <motion.div 
                                                    whileHover={{ y: -4 }}
                                                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                                                    style={{ backgroundColor: "#ffffff", borderRadius: "16px", border: "1px solid #e8e6d9", height: 280, overflow: "hidden", display: "flex", flexDirection: "column", position: "relative" }}>
                                                    {/* Site preview */}
                                                    <div style={{ flex: 1, backgroundColor: "#f4f4f4", overflow: "hidden", position: "relative" }}>
                                                        <iframe 
                                                            srcDoc={`<html><head><style>body{margin:0;padding:16px;font-family:system-ui}</style></head><body><p style="color:#8a8886;font-size:12px">Loading preview...</p></body></html>`}
                                                            style={{ width: "100%", height: "100%", border: "none", backgroundColor: "#f4f4f4" }}
                                                            title="Preview"
                                                            sandbox="allow-scripts"
                                                        />
                                                        <div style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 6 }}>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    if (activeChatId) {
                                                                        handleReadArtifact(activeChatId, site.name);
                                                                    }
                                                                }}
                                                                style={{ padding: "6px 10px", backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", borderRadius: 6, fontSize: 11, fontWeight: 500, color: "#fff", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
                                                            >
                                                                <PencilSquareIcon className="w-3 h-3" />
                                                                Edit
                                                            </button>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    window.open(`everfern-site://${site.chatId}/index.html`, '_blank');
                                                                }}
                                                                style={{ padding: "6px 10px", backgroundColor: "rgba(139,92,246,0.9)", backdropFilter: "blur(4px)", borderRadius: 6, fontSize: 11, fontWeight: 500, color: "#fff", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
                                                            >
                                                                <ArrowTopRightOnSquareIcon className="w-3 h-3" />
                                                                Open
                                                            </button>
                                                        </div>
                                                    </div>
                                                    <div style={{ padding: "16px 20px", borderTop: "1px solid #e8e6d9" }}>
                                                        <div style={{ fontSize: 14, fontWeight: 600, color: "#201e24", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{site.name}</div>
                                                        <div style={{ fontSize: 12, color: "#8a8886", marginTop: 4 }}>Last edited {timeAgo(site.lastEdited)}</div>
                                                    </div>
                                                </motion.div>
                                            </motion.div>
                                        ))}
                                    </motion.div>
                                )}

                                {activeTab === 'inspiration' && (
                                    <motion.div 
                                        key="inspiration"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        transition={{ duration: 0.2 }}
                                        style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, color: "#71717a", fontSize: 14 }}>
                                        The community artifact gallery is coming soon.
                                    </motion.div>
                                )}

                                {activeTab === 'terminal' && (
                                    <motion.div
                                        key="terminal"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        transition={{ duration: 0.2 }}
                                    >
                                        {processesLoading && processes.length === 0 ? (
                                            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, color: "#71717a", fontSize: 14 }}>
                                                Loading processes…
                                            </div>
                                        ) : processes.length === 0 ? (
                                            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 200, gap: 8 }}>
                                                <span style={{ fontSize: 32, opacity: 0.3 }}>▶</span>
                                                <span style={{ color: "#71717a", fontSize: 14 }}>No active terminal processes.</span>
                                                <span style={{ color: "#a1a1aa", fontSize: 12 }}>Processes spawned by the agent will appear here.</span>
                                            </div>
                                        ) : (
                                            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                                                {processes.map((proc, idx) => (
                                                    <motion.div
                                                        key={proc.id}
                                                        initial={{ opacity: 0, y: 12 }}
                                                        animate={{ opacity: 1, y: 0 }}
                                                        transition={{ delay: idx * 0.04 }}
                                                        style={{
                                                            display: "flex",
                                                            alignItems: "center",
                                                            gap: 16,
                                                            padding: "14px 20px",
                                                            borderRadius: 12,
                                                            border: "1px solid #e8e6d9",
                                                            backgroundColor: proc.status === 'running' ? "rgba(34,197,94,0.03)" : "#ffffff",
                                                            transition: "background-color 0.2s"
                                                        }}
                                                    >
                                                        {/* Status dot */}
                                                        <div style={{
                                                            width: 10, height: 10, borderRadius: "50%",
                                                            backgroundColor: proc.status === 'running' ? "#22c55e" : "#a1a1aa",
                                                            boxShadow: proc.status === 'running' ? "0 0 6px rgba(34,197,94,0.5)" : "none",
                                                            flexShrink: 0
                                                        }} />

                                                        {/* Command info */}
                                                        <div style={{ flex: 1, minWidth: 0 }}>
                                                            <div style={{
                                                                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                                                                fontSize: 13,
                                                                fontWeight: 500,
                                                                color: "#201e24",
                                                                whiteSpace: "nowrap",
                                                                overflow: "hidden",
                                                                textOverflow: "ellipsis"
                                                            }}>
                                                                {proc.commandLine}
                                                            </div>
                                                            <div style={{ fontSize: 11, color: "#8a8886", marginTop: 3, display: "flex", gap: 12 }}>
                                                                <span>ID: {proc.id.slice(0, 8)}…</span>
                                                                <span>{proc.status === 'running' ? '● Running' : `○ Exited (${proc.exitCode ?? '?'})`}</span>
                                                                <span>{(proc.bufferSize / 1024).toFixed(1)} KB buffered</span>
                                                            </div>
                                                        </div>

                                                        {/* Kill button */}
                                                        {proc.status === 'running' && (
                                                            <button
                                                                onClick={() => handleKillProcess(proc.id)}
                                                                style={{
                                                                    background: "rgba(239,68,68,0.08)",
                                                                    border: "1px solid rgba(239,68,68,0.25)",
                                                                    color: "#ef4444",
                                                                    borderRadius: 8,
                                                                    padding: "6px 14px",
                                                                    fontSize: 12,
                                                                    fontWeight: 600,
                                                                    cursor: "pointer",
                                                                    transition: "all 0.2s",
                                                                    flexShrink: 0
                                                                }}
                                                                onMouseEnter={e => { e.currentTarget.style.background = "rgba(239,68,68,0.15)"; e.currentTarget.style.borderColor = "rgba(239,68,68,0.5)"; }}
                                                                onMouseLeave={e => { e.currentTarget.style.background = "rgba(239,68,68,0.08)"; e.currentTarget.style.borderColor = "rgba(239,68,68,0.25)"; }}
                                                            >
                                                                Kill
                                                            </button>
                                                        )}
                                                    </motion.div>
                                                ))}
                                            </div>
                                        )}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </motion.div>
                    )}
                </motion.div>
            )}
        </AnimatePresence>
    );
}
