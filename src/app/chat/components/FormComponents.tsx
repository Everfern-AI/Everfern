import React, { useState } from 'react';
import { MarkdownRenderer } from './MarkdownComponents';
import {
    CommandLineIcon,
    DocumentTextIcon,
    FolderOpenIcon,
    CodeBracketIcon,
    PhotoIcon,
    CpuChipIcon,
    PencilSquareIcon,
    CubeTransparentIcon,
    WrenchScrewdriverIcon,
    ChevronDownIcon,
    ChevronUpIcon,
    GlobeAltIcon
} from "@heroicons/react/24/outline";

// Add CSS animation for spinner
const spinnerStyle = `
@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
`;
if (typeof document !== 'undefined') {
    const style = document.createElement('style');
    style.textContent = spinnerStyle;
    document.head.appendChild(style);
}

// ── Tool Entry Types ─────────────────────────────────────────────────────────
interface ParsedTool {
    name: string;
    jsonValue: Record<string, any> | null;
    rawValue: string;
}

// ── Robust tool-line parser ──────────────────────────────────────────────────
// Handles: `toolName — {"key":"val"}` and `toolName — some command string`
// JSON may span multiple lines.
function parseToolEntries(text: string): ParsedTool[] {
    const lines = text.split('\n');
    const chunks: { name: string; rawValue: string }[] = [];
    let current: { name: string; rawValue: string } | null = null;

    for (const line of lines) {
        // Match:  toolName — rest   (em dash, en dash, or two hyphens)
        const match = line.match(
            /^(?:[-*•]\s*)?(?:\*{1,2})?([a-zA-Z0-9_]+)(?:\*{1,2})?\s*(?:—|–|--)\s*(.+)$/
        );
        if (match) {
            if (current) chunks.push(current);
            current = { name: match[1], rawValue: match[2] };
        } else if (current) {
            // continuation line (multi-line JSON)
            current.rawValue += '\n' + line;
        }
    }
    if (current) chunks.push(current);

    return chunks.map(({ name, rawValue }) => {
        let jsonValue: Record<string, any> | null = null;
        try {
            let s = rawValue.trim().replace(/^`+/, '').replace(/`+$/, '');
            jsonValue = JSON.parse(s);
        } catch {
            /* not JSON – use rawValue as command */
        }
        return { name, jsonValue, rawValue: rawValue.trim() };
    });
}

// ── Tool icon / colour helper ────────────────────────────────────────────────
function getToolMeta(name: string) {
    const n = name.toLowerCase();
    const s = { width: 14, height: 14 };

    if (n.includes("bash") || n.includes("command") || n.includes("terminal") || n.includes("shell") || n.includes("exec") || n.includes("run_command"))
        return { icon: <CommandLineIcon style={s} /> };

    if (n.includes("write") || n.includes("create") || n.includes("save") || n.includes("artifact") || n.includes("write_to_file"))
        return { icon: <DocumentTextIcon style={s} /> };

    if (n.includes("read") || n.includes("open") || n.includes("load") || n.includes("view_file") || n.includes("read_file"))
        return { icon: <FolderOpenIcon style={s} /> };

    if (n.includes("edit") || n.includes("update") || n.includes("modify") || n.includes("patch") || n.includes("replace_file") || n.includes("multi_replace_file"))
        return { icon: <PencilSquareIcon style={s} /> };

    if (n.includes("code") || n.includes("python") || n.includes("js"))
        return { icon: <CodeBracketIcon style={s} /> };

    if (n.includes("image") || n.includes("screenshot") || n.includes("photo"))
        return { icon: <PhotoIcon style={s} /> };

    if (n.includes("computer") || n.includes("mouse") || n.includes("click"))
        return { icon: <CpuChipIcon style={s} /> };

    if (n.includes("spawn") || n.includes("agent") || n.includes("sub") || n.includes("subagent"))
        return { icon: <CubeTransparentIcon style={s} /> };

    if (n.includes("navis") || n.includes("browser") || n.includes("web") || n.includes("visit"))
        return { icon: <GlobeAltIcon style={s} /> };

    return { icon: <WrenchScrewdriverIcon style={s} /> };
}

// ── Single tool card ─────────────────────────────────────────────────────────
const ToolCard = ({ tool }: { tool: ParsedTool }) => {
    const [isOpen, setIsOpen] = useState(false);
    const { icon } = getToolMeta(tool.name);
    const label = tool.name.replace(/_/g, ' ');

    const desc = (() => {
        if (tool.jsonValue?.query) return String(tool.jsonValue.query);
        if (tool.jsonValue?.url) return String(tool.jsonValue.url);
        if (tool.jsonValue?.url_to_visit) return String(tool.jsonValue.url_to_visit);
        if (tool.jsonValue?.command) return String(tool.jsonValue.command).slice(0, 80);
        if (tool.jsonValue?.CommandLine) return String(tool.jsonValue.CommandLine).slice(0, 80);
        if (tool.jsonValue?.TargetFile) return String(tool.jsonValue.TargetFile);
        if (tool.jsonValue?.path) return String(tool.jsonValue.path);
        if (tool.jsonValue?.content) return String(tool.jsonValue.content).slice(0, 60) + "…";
        return label;
    })();

    const isNavis = tool.name.toLowerCase().includes("navis");
    const galliumSurface = isNavis ? {
        background: "rgba(99, 102, 241, 0.07)",
        boxShadow: [
            "inset 0 1px 0 rgba(255,255,255,0.40)",
            "inset 0 -1px 0 rgba(99,102,241,0.08)",
            "0 1px 3px rgba(99,102,241,0.04)",
        ].join(", "),
        border: "1px solid rgba(99, 102, 241, 0.22)",
    } : {
        background: "var(--color-bg-subtle)",
        boxShadow: [
            "inset 0 1px 0 rgba(255,255,255,0.05)",
            "inset 0 -1px 0 rgba(0,0,0,0.1)",
            "0 1px 3px rgba(0,0,0,0.05)",
        ].join(", "),
        border: "1px solid var(--color-border)",
    };

    const hasDetails = !!tool.jsonValue || !!tool.rawValue;

    return (
        <div style={{
            ...galliumSurface,
            borderRadius: 14,
            overflow: 'hidden',
            marginBottom: 6,
        }}>
            {/* Header / Pill */}
            <div 
                onClick={hasDetails ? () => setIsOpen(!isOpen) : undefined}
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "7px 14px 7px 8px",
                    cursor: hasDetails ? "pointer" : "default",
                    fontSize: 12.5,
                    color: isNavis ? "#4f46e5" : "var(--color-text-primary)",
                    lineHeight: 1.4,
                    userSelect: "none",
                }}
            >
                <div style={{
                    width: 24,
                    height: 24,
                    flexShrink: 0,
                    borderRadius: 7,
                    background: isNavis ? "rgba(99, 102, 241, 0.16)" : "var(--color-border-strong)",
                    boxShadow: isNavis ? undefined : [
                        "inset 0 1px 0 rgba(255,255,255,0.05)",
                        "inset 0 -1px 0 rgba(0,0,0,0.1)",
                    ].join(", "),
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: isNavis ? "#4f46e5" : "var(--color-text-secondary)",
                }}>
                    {icon}
                </div>

                <span style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    flex: 1,
                    fontWeight: isNavis ? 600 : 500,
                }}>
                    {desc}
                </span>

                {hasDetails && (
                    <span style={{ color: "var(--color-text-tertiary)", display: "flex", alignItems: "center" }}>
                        {isOpen ? (
                            <ChevronUpIcon style={{ width: 14, height: 14 }} />
                        ) : (
                            <ChevronDownIcon style={{ width: 14, height: 14 }} />
                        )}
                    </span>
                )}
            </div>

            {/* Collapsible Body */}
            {isOpen && hasDetails && (
                <div style={{ 
                    padding: '12px 14px', 
                    backgroundColor: 'var(--color-bg-surface)',
                    borderTop: '1px solid var(--color-border)'
                }}>
                    {tool.jsonValue ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {Object.entries(tool.jsonValue).map(([k, v]) => {
                                const strVal = typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v);
                                const isLong = strVal.length > 80;
                                const isCommand = k === 'command' || k === 'CommandLine';
                                return (
                                    <div key={k}>
                                        <span style={{
                                            fontSize: 10,
                                            fontWeight: 700,
                                            color: 'var(--color-text-tertiary)',
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.07em',
                                        }}>
                                            {k.replace(/_/g, ' ')}
                                        </span>
                                        <div style={{
                                            marginTop: 3,
                                            padding: '6px 10px',
                                            borderRadius: 6,
                                            fontSize: 12,
                                            fontFamily: isCommand ? 'SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace' : 'inherit',
                                            wordBreak: 'break-all',
                                            whiteSpace: 'pre-wrap',
                                            maxHeight: isLong ? 150 : 'none',
                                            overflowY: isLong ? 'auto' : 'visible',
                                            ...(isCommand
                                                ? { backgroundColor: '#1a1a1a', color: '#4ade80', border: '1px solid #333' }
                                                : { backgroundColor: 'var(--color-bg-base)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }
                                            ),
                                        }}>
                                            {isCommand ? `$ ${strVal}` : strVal}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        (() => {
                            let cleanRaw = (tool.rawValue || '').trim();
                            if (cleanRaw.startsWith('$ ')) cleanRaw = cleanRaw.substring(2).trim();
                            cleanRaw = cleanRaw.replace(/^[`'"]+|[`'"]+$/g, '').trim();
                            const isCmd = /^(npm|npx|git|cd|node|python|sudo|docker|wsl|pip|cargo|go|make)\b/i.test(cleanRaw);

                            return (
                                <div style={{
                                    padding: '8px 12px',
                                    borderRadius: 6,
                                    fontSize: 12.5,
                                    lineHeight: 1.5,
                                    fontFamily: isCmd ? 'SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace' : 'inherit',
                                    wordBreak: 'break-word',
                                    whiteSpace: 'pre-wrap',
                                    ...(isCmd
                                        ? { backgroundColor: '#1a1a1a', color: '#4ade80', border: '1px solid #333' }
                                        : { backgroundColor: 'var(--color-bg-base)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border)' }
                                    ),
                                }}>
                                    {isCmd ? `$ ${cleanRaw}` : cleanRaw}
                                </div>
                            );
                        })()
                    )}
                </div>
            )}
        </div>
    );
};

// ── HITL Approval Form Component ─────────────────────────────────────────────
const HitlApprovalForm = ({
    request,
    onApprove,
    onReject,
    isInline,
}: {
    request: {
        question: string;
        details: {
            tools: any[];
            summary: string;
            reasoning: string;
        };
        options: string[];
    };
    onApprove: (sendMessage?: boolean) => void;
    onReject: (sendMessage?: boolean) => void;
    isInline?: boolean;
}) => {
    const [followUpQuestion, setFollowUpQuestion] = useState('');
    const [showFollowUpInput, setShowFollowUpInput] = useState(false);
    const [sendAsMessage, setSendAsMessage] = useState(true);
    const [userDecision, setUserDecision] = useState<'approved' | 'rejected' | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);

    const handleApprove = () => {
        setIsProcessing(true);
        setUserDecision('approved');
        setTimeout(() => onApprove(sendAsMessage), 500);
    };

    const handleReject = () => {
        setIsProcessing(true);
        setUserDecision('rejected');
        setTimeout(() => onReject(sendAsMessage), 500);
    };

    const handleAskQuestion = () => {
        if (followUpQuestion.trim()) {
            window.dispatchEvent(new CustomEvent('hitl-follow-up', { detail: { question: followUpQuestion } }));
            setFollowUpQuestion('');
            setShowFollowUpInput(false);
        }
    };

    const renderToolDetails = (tools: any[]) => {
        if (!tools || tools.length === 0) return null;
        
        // Filter out file viewing and skill tools as requested
        const filteredTools = tools.filter(tool => {
            const name = (tool.name || tool.toolName || '').toLowerCase();
            const isViewing = [
                'read_file', 'list_dir', 'view_file', 'list_screens', 
                'grep_search', 'read_url_content', 'command_status',
                'list_projects', 'get_project', 'get_screen', 'list_design_systems',
                'read_resource', 'list_resources', 'read_browser_page', 'screenshot_browser'
            ].some(safeTool => name.includes(safeTool));
            const isSkills = name.includes('skill') || name.includes('mcp') || name.includes('stitch');
            return !isViewing && !isSkills;
        });

        if (filteredTools.length === 0) return (
            <div style={{ backgroundColor: '#f0f4f8', border: '1px solid #d1d5db', borderRadius: 6, padding: 12, fontSize: 13, color: '#495057' }}>
                <div style={{ marginBottom: 4 }}><strong>Summary:</strong> Background operations (context gathering)</div>
                <div>These actions are safe and do not modify your files.</div>
            </div>
        );

        return filteredTools.map((tool, index) => {
            const parsed: ParsedTool = {
                name: tool.name || tool.toolName || 'unknown_tool',
                jsonValue: tool.arguments || tool.args || null,
                rawValue: '',
            };
            return <ToolCard key={index} tool={parsed} />;
        });
    };

    // ── Navis-specific clean inline authorization card ──────────────────────
    if (isInline) {
        // Derive a friendly action description from tools
        const toolNames = (request.details?.tools || []).map((t: any) => (t.name || t.toolName || '').toLowerCase());
        const hasBrowser = toolNames.some(n => n.includes('navis') || n.includes('browser') || n.includes('tab'));
        const hasComputerUse = toolNames.some(n => n.includes('computer') || n.includes('mouse') || n.includes('click') || n.includes('keyboard'));
        
        const actionLabel = hasBrowser
            ? 'use a new tab from My Browser'
            : hasComputerUse
                ? 'control your computer'
                : request.details?.summary || 'perform this action';

        const agentName = hasBrowser ? 'Navis' : 'EverFern';

        return (
            <div style={{
                background: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 16,
                padding: '20px 24px',
                margin: '16px 0',
                fontFamily: "var(--font-sans), 'Matter', system-ui, sans-serif",
                width: '100%',
                maxWidth: 520,
            }}>
                {/* Decision feedback */}
                {userDecision ? (
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                        borderRadius: 10,
                        background: userDecision === 'approved' ? '#f0fdf4' : '#fef2f2',
                        border: `1px solid ${userDecision === 'approved' ? '#bbf7d0' : '#fecaca'}`,
                    }}>
                        <span style={{ fontSize: 15 }}>{userDecision === 'approved' ? '✓' : '✕'}</span>
                        <span style={{
                            fontSize: 13.5, fontWeight: 600,
                            color: userDecision === 'approved' ? '#166534' : '#991b1b',
                        }}>
                            {userDecision === 'approved' ? `Authorized — ${agentName} is working` : `Declined — ${agentName} will continue without action`}
                        </span>
                        {isProcessing && (
                            <div style={{
                                marginLeft: 'auto', width: 14, height: 14,
                                border: '2px solid transparent',
                                borderTop: `2px solid ${userDecision === 'approved' ? '#16a34a' : '#dc2626'}`,
                                borderRadius: '50%', animation: 'spin 1s linear infinite',
                            }} />
                        )}
                    </div>
                ) : (
                    <>
                        {/* Icon row */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                            <div style={{
                                width: 32, height: 32, borderRadius: 10,
                                background: 'var(--color-bg-subtle)',
                                border: '1px solid var(--color-border)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                flexShrink: 0,
                            }}>
                                {hasBrowser ? (
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <circle cx="12" cy="12" r="10"></circle>
                                        <circle cx="12" cy="12" r="4"></circle>
                                        <line x1="21.17" y1="8" x2="12" y2="8"></line>
                                        <line x1="3.95" y1="6.06" x2="8.54" y2="14"></line>
                                        <line x1="10.88" y1="21.94" x2="15.46" y2="14"></line>
                                    </svg>
                                ) : (
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                                        <line x1="8" y1="21" x2="16" y2="21"></line>
                                        <line x1="12" y1="17" x2="12" y2="21"></line>
                                    </svg>
                                )}
                            </div>
                            <span style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--color-text-primary)', lineHeight: 1.4 }}>
                                Authorize {agentName} to {actionLabel} to complete your task
                            </span>
                        </div>

                        {/* Action buttons */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                            <button
                                onClick={handleReject}
                                disabled={isProcessing}
                                style={{
                                    flex: 1, padding: '10px 0', borderRadius: 10,
                                    border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-base)',
                                    color: 'var(--color-text-primary)', fontSize: 13.5, fontWeight: 600,
                                    cursor: isProcessing ? 'not-allowed' : 'pointer',
                                    opacity: isProcessing ? 0.5 : 1,
                                    transition: 'all 0.15s ease',
                                }}
                                onMouseEnter={e => { if (!isProcessing) { e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)'; } }}
                                onMouseLeave={e => { if (!isProcessing) { e.currentTarget.style.backgroundColor = 'var(--color-bg-base)'; } }}
                            >
                                No thanks
                            </button>
                            <button
                                onClick={handleApprove}
                                disabled={isProcessing}
                                style={{
                                    flex: 1, padding: '10px 0', borderRadius: 10,
                                    border: 'none', backgroundColor: 'var(--color-text-primary)',
                                    color: 'var(--color-bg-surface)', fontSize: 13.5, fontWeight: 600,
                                    cursor: isProcessing ? 'not-allowed' : 'pointer',
                                    opacity: isProcessing ? 0.5 : 1,
                                    transition: 'all 0.15s ease',
                                }}
                                onMouseEnter={e => { if (!isProcessing) e.currentTarget.style.opacity = '0.85'; }}
                                onMouseLeave={e => { if (!isProcessing) e.currentTarget.style.opacity = '1'; }}
                            >
                                Authorize
                            </button>
                        </div>

                        {/* Subtle note */}
                        <p style={{
                            margin: 0, fontSize: 12, color: 'var(--color-text-tertiary)', textAlign: 'center',
                            lineHeight: 1.4,
                        }}>
                            {agentName} will continue working after your reply
                        </p>
                    </>
                )}
            </div>
        );
    }

    // ── Generic (non-Navis) HITL form ────────────────────────────────────────
    return (
        <div style={{
            background: "var(--color-bg-subtle)",
            boxShadow: [
                "inset 0 1px 0 rgba(255,255,255,0.05)",
                "inset 0 -1px 0 rgba(0,0,0,0.1)",
                "0 1px 3px rgba(0,0,0,0.05)",
            ].join(", "),
            border: "1px solid var(--color-border)",
            borderRadius: 16,
            padding: 24,
            margin: '24px 0',
            fontFamily: "var(--font-sans), 'Matter', system-ui, sans-serif",
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, color: 'var(--color-text-primary)', fontSize: 14, fontWeight: 600 }}>
                <div style={{
                    width: 24,
                    height: 24,
                    borderRadius: 7,
                    background: "var(--color-border-strong)",
                    boxShadow: [
                        "inset 0 1px 0 rgba(255,255,255,0.05)",
                        "inset 0 -1px 0 rgba(0,0,0,0.1)",
                    ].join(", "),
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--color-text-secondary)",
                }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                </div>
                <span>High-risk action requires your approval</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, color: '#dc2626', fontSize: 13, fontWeight: 600 }}>
                <span>🚨</span>
                <span>Dangerous tool detected</span>
            </div>

            <h3 style={{ margin: '0 0 16px 0', fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                {request.question}
            </h3>

            <div style={{ backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
                <div style={{ fontWeight: 600, marginBottom: 12, color: 'var(--color-text-primary)', fontSize: 14 }}>
                    Actions to execute:
                </div>
                {/* Scrollable tools list */}
                <div style={{ maxHeight: 380, overflowY: 'auto', paddingRight: 2 }}>
                    {request.details.tools && request.details.tools.length > 0 ? (
                        renderToolDetails(request.details.tools)
                    ) : (
                        <div style={{ backgroundColor: 'var(--color-bg-base)', border: '1px solid var(--color-border)', borderRadius: 8, padding: 12, fontSize: 13, color: 'var(--color-text-secondary)' }}>
                            <div style={{ marginBottom: 4 }}><strong>Summary:</strong> {request.details.summary}</div>
                            <div><strong>Reason:</strong> {request.details.reasoning}</div>
                        </div>
                    )}
                </div>
            </div>

            {showFollowUpInput && (
                <div style={{ backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
                    <textarea
                        value={followUpQuestion}
                        onChange={(e) => setFollowUpQuestion(e.target.value)}
                        placeholder="Ask a follow-up question..."
                        style={{ width: '100%', minHeight: 60, padding: 8, borderRadius: 6, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-subtle)', color: 'var(--color-text-primary)', fontSize: 13, fontFamily: 'inherit', resize: 'vertical', outline: 'none' }}
                    />
                    <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
                        <button onClick={() => { setShowFollowUpInput(false); setFollowUpQuestion(''); }}
                            style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-surface)', color: 'var(--color-text-secondary)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
                            Cancel
                        </button>
                        <button onClick={handleAskQuestion} disabled={!followUpQuestion.trim()}
                            style={{ padding: '8px 16px', borderRadius: 6, border: 'none', backgroundColor: followUpQuestion.trim() ? 'var(--color-text-primary)' : 'var(--color-border)', color: followUpQuestion.trim() ? 'var(--color-text-inverse)' : 'var(--color-text-tertiary)', fontSize: 13, fontWeight: 600, cursor: followUpQuestion.trim() ? 'pointer' : 'not-allowed' }}>
                            Ask Question
                        </button>
                    </div>
                </div>
            )}

            {userDecision && (
                <div style={{ backgroundColor: userDecision === 'approved' ? 'var(--color-bg-hover)' : 'rgba(239, 68, 68, 0.15)', border: `1px solid ${userDecision === 'approved' ? 'var(--color-border)' : 'var(--color-error)'}`, borderRadius: 8, padding: 12, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 16 }}>{userDecision === 'approved' ? '✅' : '❌'}</span>
                    <span style={{ color: userDecision === 'approved' ? 'var(--color-success)' : 'var(--color-error)', fontWeight: 600, fontSize: 14 }}>
                        {userDecision === 'approved'
                            ? `Operation ${sendAsMessage ? 'approved (message sent)' : 'approved (silent)'}`
                            : `Operation ${sendAsMessage ? 'rejected (message sent)' : 'rejected (silent)'}`}
                    </span>
                    {isProcessing && (
                        <div style={{ marginLeft: 'auto', width: 16, height: 16, border: '2px solid transparent', borderTop: `2px solid ${userDecision === 'approved' ? 'var(--color-success)' : 'var(--color-error)'}`, borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                    )}
                </div>
            )}

            {!userDecision && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, padding: '8px 12px', backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', borderRadius: 8 }}>
                    <input type="checkbox" id="sendAsMessage" checked={sendAsMessage} onChange={(e) => setSendAsMessage(e.target.checked)} style={{ margin: 0 }} />
                    <label htmlFor="sendAsMessage" style={{ fontSize: 13, color: 'var(--color-text-secondary)', cursor: 'pointer', userSelect: 'none' }}>
                        Send approval/rejection as a chat message (visible in conversation)
                    </label>
                </div>
            )}

            {!userDecision && (
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <button onClick={() => setShowFollowUpInput(!showFollowUpInput)}
                        style={{ padding: '10px 16px', borderRadius: 8, border: '1px solid var(--color-border-focus)', backgroundColor: 'var(--color-bg-surface)', color: 'var(--color-text-primary)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                        onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)'; }}
                        onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'var(--color-bg-surface)'; }}>
                        {showFollowUpInput ? 'Cancel' : 'Ask Question'}
                    </button>
                    <div style={{ display: 'flex', gap: 12 }}>
                        <button onClick={handleReject} disabled={isProcessing}
                            style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid var(--color-error)', backgroundColor: 'var(--color-bg-surface)', color: 'var(--color-error)', fontSize: 14, fontWeight: 600, cursor: isProcessing ? 'not-allowed' : 'pointer', opacity: isProcessing ? 0.6 : 1 }}
                            onMouseEnter={e => { if (!isProcessing) { e.currentTarget.style.backgroundColor = 'var(--color-error)'; e.currentTarget.style.color = 'var(--color-bg-surface)'; } }}
                            onMouseLeave={e => { if (!isProcessing) { e.currentTarget.style.backgroundColor = 'var(--color-bg-surface)'; e.currentTarget.style.color = 'var(--color-error)'; } }}>
                            Reject
                        </button>
                        <button onClick={handleApprove} disabled={isProcessing}
                            style={{ padding: '10px 20px', borderRadius: 8, border: 'none', backgroundColor: 'var(--color-text-primary)', color: 'var(--color-text-inverse)', fontSize: 14, fontWeight: 600, cursor: isProcessing ? 'not-allowed' : 'pointer', opacity: isProcessing ? 0.6 : 1 }}
                            onMouseEnter={e => { if (!isProcessing) e.currentTarget.style.opacity = '0.9'; }}
                            onMouseLeave={e => { if (!isProcessing) e.currentTarget.style.opacity = '1'; }}>
                            Approve
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

// ── User Question Form Component ─────────────────────────────────────────────
const UserQuestionForm = ({
    questions,
    onSubmit,
    previewMarkdown,
    isInline,
}: {
    questions: Array<{
        question: string;
        options: Array<{ label: string; value: string; isRecommended?: boolean; requiresFileUpload?: boolean }>;
        multiSelect: boolean;
    }>;
    onSubmit: (answers: Record<string, string[]>, attachedFiles?: Array<{ name: string; content?: string; base64?: string; mimeType?: string }>) => void;
    previewMarkdown?: string;
    isInline?: boolean;
}) => {
    const [currentIndex, setCurrentIndex] = React.useState(0);
    const [answers, setAnswers] = React.useState<Record<string, string[]>>({});
    const [pendingFileOption, setPendingFileOption] = React.useState<string | null>(null);
    const [attachedFiles, setAttachedFiles] = React.useState<Array<{ name: string; content?: string; base64?: string; mimeType?: string }>>([]);
    const fileInputRef = React.useRef<HTMLInputElement>(null);
    const [isProcessing, setIsProcessing] = React.useState(false);

    React.useEffect(() => {
        setIsProcessing(false);
    }, [questions]);

    const [showBottomFade, setShowBottomFade] = React.useState(false);
    const scrollContainerRef = React.useRef<HTMLDivElement>(null);

    const checkScroll = () => {
        const el = scrollContainerRef.current;
        if (el) {
            const canScroll = el.scrollHeight > el.clientHeight;
            const reachedBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 5;
            setShowBottomFade(canScroll && !reachedBottom);
        }
    };

    React.useEffect(() => {
        const timer = setTimeout(checkScroll, 100);
        window.addEventListener('resize', checkScroll);
        return () => {
            clearTimeout(timer);
            window.removeEventListener('resize', checkScroll);
        };
    }, [currentIndex]);

    // Filter questions based on conditional visibility
    const visibleQuestions = React.useMemo(() => {
        return questions.filter((q, index) => {
            const depends = (q as any).dependsOn || (q as any).condition;
            if (!depends) return true;
            
            const targetQ = typeof depends.question === 'number' 
                ? (questions[depends.question]?.question || '')
                : String(depends.question);
                
            const targetVal = depends.value;
            const answer = answers[targetQ];
            
            if (depends.operator === 'not' || depends.operator === '!=' || depends.not) {
                return !answer || !answer.includes(targetVal);
            }
            
            return answer && answer.includes(targetVal);
        });
    }, [questions, answers]);

    // Clamp current index to bounds if visibleQuestions changes dynamically
    React.useEffect(() => {
        if (currentIndex >= visibleQuestions.length && visibleQuestions.length > 0) {
            setCurrentIndex(visibleQuestions.length - 1);
        }
    }, [visibleQuestions.length, currentIndex]);

    const current = visibleQuestions[currentIndex];
    const total = visibleQuestions.length;
    const currentAnswers = answers[current?.question] || [];
    const isQuestionAnswered = React.useCallback((q: any) => {
        const ans = answers[q.question] || [];
        if (!q.options || q.options.length === 0) {
            return ans.length > 0 && typeof ans[0] === 'string' && ans[0].trim().length > 0;
        }
        return ans.length > 0;
    }, [answers]);

    const isAnswered = current ? isQuestionAnswered(current) : false;
    const allAnswered = visibleQuestions.every(isQuestionAnswered);

    // Filter options based on conditional visibility
    const visibleOptions = React.useMemo(() => {
        if (!current || !current.options) return [];
        return current.options.filter((opt: any) => {
            const depends = opt.dependsOn || opt.condition;
            if (!depends) return true;
            
            const targetQ = typeof depends.question === 'number'
                ? (questions[depends.question]?.question || '')
                : String(depends.question);
                
            const targetVal = depends.value;
            const answer = answers[targetQ];
            
            if (depends.operator === 'not' || depends.operator === '!=' || depends.not) {
                return !answer || !answer.includes(targetVal);
            }
            
            return answer && answer.includes(targetVal);
        });
    }, [current, questions, answers]);

    const handleOptionClick = (value: string, requiresFileUpload?: boolean) => {
        if (isProcessing) return;
        const q = current.question;
        if (requiresFileUpload) {
            setAnswers(prev => ({ ...prev, [q]: [value] }));
            setPendingFileOption(value);
            setTimeout(() => fileInputRef.current?.click(), 50);
            return;
        }

        if (isHighRisk && !current.multiSelect) {
            // 1-Click execution for High Risk / HITL Security checks!
            setIsProcessing(true);
            const mapValue = (val: string) => {
                if (val.includes('Approve & Allow Always') || val.includes('[HITL_APPROVED_ALWAYS]')) return '[HITL_APPROVED_ALWAYS]';
                if (val.includes('Approve & Allow Prefix') || val.includes('[HITL_APPROVED_PREFIX]')) return '[HITL_APPROVED_PREFIX]';
                if (val.includes('Approve') || val.includes('[HITL_APPROVED]')) return '[HITL_APPROVED]';
                if (val.includes('Reject') || val.includes('[HITL_REJECTED]')) return '[HITL_REJECTED]';
                return val;
            };
            const processed = { ...answers, [q]: [mapValue(value)] };
            onSubmit(processed, attachedFiles.length > 0 ? attachedFiles : undefined);
            return;
        }

        setAnswers(prev => {
            if (current.multiSelect) {
                const existing = prev[q] || [];
                return { ...prev, [q]: existing.includes(value) ? existing.filter(v => v !== value) : [...existing, value] };
            }
            return { ...prev, [q]: [value] };
        });
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const result = ev.target?.result as string;
            const isImage = file.type.startsWith('image/');
            setAttachedFiles(prev => [...prev, { name: file.name, mimeType: file.type, ...(isImage ? { base64: result } : { content: result }) }]);
        };
        if (file.type.startsWith('image/')) reader.readAsDataURL(file);
        else reader.readAsText(file);
        e.target.value = '';
    };

    const handleNext = () => { if (currentIndex < total - 1) setCurrentIndex(i => i + 1); };
    const handleBack = () => { if (currentIndex > 0) setCurrentIndex(i => i - 1); };
    const handleSubmit = () => { 
        if (allAnswered && !isProcessing) {
            setIsProcessing(true);
            // Map labels to internal [HITL_APPROVED_ALWAYS] and [HITL_APPROVED_PREFIX] tags
            const processedAnswers = { ...answers };
            for (const q in processedAnswers) {
                processedAnswers[q] = processedAnswers[q].map(val => {
                    if (val === '🚀 Approve & Allow Always — never ask for this specific command again') return '[HITL_APPROVED_ALWAYS]';
                    if (val === '📂 Approve & Allow Prefix — never ask for commands starting with this base (e.g. npm)') return '[HITL_APPROVED_PREFIX]';
                    if (val === '✅ Approve — proceed once') return '[HITL_APPROVED]';
                    if (val === '❌ Reject — cancel and do not proceed') return '[HITL_REJECTED]';
                    return val;
                });
            }
            onSubmit(processedAnswers, attachedFiles.length > 0 ? attachedFiles : undefined); 
        }
    };

    if (!current) return null;

    const isHighRisk =
        current.question.includes('High-risk action requires your approval') ||
        current.question.includes('Security Check Required') ||
        current.question.includes('Actions to execute:');

    const isNavisSecurityCheck = isHighRisk && (current.question.toLowerCase().includes('navis') || current.question.toLowerCase().includes('browser') || current.question.toLowerCase().includes('tab'));
    const isComputerSecurityCheck = isHighRisk && (current.question.toLowerCase().includes('computer') || current.question.toLowerCase().includes('mouse') || current.question.toLowerCase().includes('click') || current.question.toLowerCase().includes('keyboard'));

    if (isHighRisk && isInline) {
        const rawQuestion = current.question;
        const parts = rawQuestion.split(/Actions to execute:/i);
        let headerReasoning = (parts[0] || '').replace('⚠️ High-risk action requires your approval', '').replace('⚠️ Security Check Required', '').replace('Dangerous tool detected', '').trim();
        let actionSnippet = (parts[1] || '').trim();
        if (/^no tools pending\.?$/i.test(actionSnippet)) actionSnippet = '';

        const cleanText = (str: string) => {
            let s = str.trim();
            if (s.startsWith('$ ')) s = s.substring(2).trim();
            return s.replace(/^[`'"]+|[`'"]+$/g, '').trim();
        };

        const displaySnippet = cleanText(actionSnippet || headerReasoning || 'Modifying local files on your system.');

        let actionLabel = 'modify local files on your system';
        if (isNavisSecurityCheck) {
            actionLabel = 'use a new tab from My Browser';
        } else if (isComputerSecurityCheck) {
            actionLabel = 'control your computer';
        } else if (displaySnippet.toLowerCase().includes('npm') || displaySnippet.toLowerCase().includes('git') || displaySnippet.toLowerCase().includes('command') || displaySnippet.toLowerCase().includes('node')) {
            actionLabel = 'run commands on your system';
        }

        const agentName = isNavisSecurityCheck ? 'Navis' : 'EverFern';

        return (
            <div style={{
                background: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 16,
                padding: '20px 24px',
                margin: '16px 0',
                fontFamily: "var(--font-sans), 'Matter', system-ui, sans-serif",
                width: '100%',
                maxWidth: 520,
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.05)',
            }}>
                {/* Header Icon + Title */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                    <div style={{
                        width: 32, height: 32, borderRadius: 10,
                        background: 'var(--color-bg-subtle)',
                        border: '1px solid var(--color-border)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0,
                        color: 'var(--color-text-secondary)',
                    }}>
                        {isNavisSecurityCheck ? (
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10"></circle>
                                <circle cx="12" cy="12" r="4"></circle>
                                <line x1="21.17" y1="8" x2="12" y2="8"></line>
                                <line x1="3.95" y1="6.06" x2="8.54" y2="14"></line>
                                <line x1="10.88" y1="21.94" x2="15.46" y2="14"></line>
                            </svg>
                        ) : (
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                            </svg>
                        )}
                    </div>
                    <span style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--color-text-primary)', lineHeight: 1.4 }}>
                        Authorize {agentName} to {actionLabel} to complete your task
                    </span>
                </div>

                {/* Reason / Snippet Preview */}
                {displaySnippet && (
                    <div style={{
                        backgroundColor: 'var(--color-bg-subtle)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 10,
                        padding: '10px 14px',
                        marginBottom: 16,
                        fontSize: 13,
                        color: 'var(--color-text-secondary)',
                        lineHeight: 1.5,
                        wordBreak: 'break-word',
                    }}>
                        {displaySnippet}
                    </div>
                )}

                {/* Action Buttons */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <button
                        onClick={() => {
                            if (isProcessing) return;
                            setIsProcessing(true);
                            onSubmit({ [current.question]: ['[HITL_REJECTED]'] }, undefined);
                        }}
                        disabled={isProcessing}
                        style={{
                            flex: 1, padding: '10px 0', borderRadius: 10,
                            border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-base)',
                            color: 'var(--color-text-primary)', fontSize: 13.5, fontWeight: 600,
                            cursor: isProcessing ? 'not-allowed' : 'pointer',
                            opacity: isProcessing ? 0.5 : 1,
                            transition: 'all 0.15s ease',
                        }}
                        onMouseEnter={e => { if (!isProcessing) e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)'; }}
                        onMouseLeave={e => { if (!isProcessing) e.currentTarget.style.backgroundColor = 'var(--color-bg-base)'; }}
                    >
                        No thanks
                    </button>

                    <button
                        onClick={() => {
                            if (isProcessing) return;
                            setIsProcessing(true);
                            onSubmit({ [current.question]: ['[HITL_APPROVED]'] }, undefined);
                        }}
                        disabled={isProcessing}
                        style={{
                            flex: 1, padding: '10px 0', borderRadius: 10,
                            border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-subtle)',
                            color: 'var(--color-text-primary)', fontSize: 13.5, fontWeight: 600,
                            cursor: isProcessing ? 'not-allowed' : 'pointer',
                            opacity: isProcessing ? 0.5 : 1,
                            transition: 'all 0.15s ease',
                        }}
                        onMouseEnter={e => { if (!isProcessing) e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)'; }}
                        onMouseLeave={e => { if (!isProcessing) e.currentTarget.style.backgroundColor = 'var(--color-bg-subtle)'; }}
                    >
                        Authorize once
                    </button>

                    <button
                        onClick={() => {
                            if (isProcessing) return;
                            setIsProcessing(true);
                            onSubmit({ [current.question]: ['[HITL_APPROVED_ALWAYS]'] }, undefined);
                        }}
                        disabled={isProcessing}
                        style={{
                            flex: 1, padding: '10px 0', borderRadius: 10,
                            border: 'none', backgroundColor: 'var(--color-text-primary)',
                            color: 'var(--color-bg-surface)', fontSize: 13.5, fontWeight: 600,
                            cursor: isProcessing ? 'not-allowed' : 'pointer',
                            opacity: isProcessing ? 0.5 : 1,
                            transition: 'all 0.15s ease',
                        }}
                        onMouseEnter={e => { if (!isProcessing) e.currentTarget.style.opacity = '0.85'; }}
                        onMouseLeave={e => { if (!isProcessing) e.currentTarget.style.opacity = '1'; }}
                    >
                        Always allow
                    </button>
                </div>

                {/* Footer text */}
                <p style={{
                    margin: 0, fontSize: 12, color: 'var(--color-text-tertiary)', textAlign: 'center',
                    lineHeight: 1.4,
                }}>
                    {agentName} will continue working after your reply
                </p>
            </div>
        );
    }

    // ── Render the high-risk approval section ──────────────────────────────
    const renderHighRiskContent = () => {
        const parts = current.question.split(/Actions to execute:/i);
        const headerPart = parts[0] || '';
        const actionsPart = parts[1] || '';
        const cleanedActionsPart = actionsPart.trim();
        const isNoToolsPlaceholder = /^no tools pending\.?$/i.test(cleanedActionsPart);
        const displayActionsPart = isNoToolsPlaceholder ? '' : cleanedActionsPart;
        const securityTitle = current.question.includes('Security Check Required')
            ? 'Security Check Required'
            : 'High-risk action requires your approval';

        const toolEntries = displayActionsPart ? parseToolEntries(displayActionsPart) : [];

        return (
            <div style={{ margin: '0 0 20px 0' }}>
                {/* Warning header */}
                <div style={{
                    backgroundColor: isInline ? '#fffbeb' : '#fff3cd',
                    border: isInline ? '1px solid #fde68a' : '1px solid #ffeaa7',
                    borderRadius: '12px 12px 0 0',
                    padding: '12px 16px',
                    color: isInline ? '#b45309' : '#856404',
                    fontSize: 14,
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    borderBottom: 'none',
                }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                    {securityTitle}
                </div>

                {/* Body */}
                <div style={{
                    backgroundColor: 'var(--color-bg-surface)',
                    border: isInline ? '1px solid #fde68a' : '1px solid #ffeaa7',
                    borderTop: 'none',
                    borderRadius: '0 0 12px 12px',
                    padding: 16,
                    fontSize: 14,
                    color: 'var(--color-text-primary)',
                    lineHeight: 1.6,
                }}>
                    {/* Preamble text */}
                    {headerPart.replace('⚠️ High-risk action requires your approval', '').replace('⚠️ Security Check Required', '').replace('Dangerous tool detected', '').trim() && (
                        <div style={{ marginBottom: displayActionsPart ? 16 : 0, color: 'var(--color-text-secondary)' }}>
                            <MarkdownRenderer content={
                                headerPart
                                    .replace('⚠️ High-risk action requires your approval', '')
                                    .replace('⚠️ Security Check Required', '')
                                    .replace('Dangerous tool detected', '🚨 **Dangerous tool detected**')
                                    .trim()
                            } />
                        </div>
                    )}

                    {displayActionsPart && (
                        <>
                            {/* Section label */}
                            <div style={{
                                fontWeight: 700,
                                marginBottom: 10,
                                color: 'var(--color-text-primary)',
                                fontSize: 11,
                                textTransform: 'uppercase',
                                letterSpacing: '0.08em',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                            }}>
                                <span>⚙️</span> Actions to execute
                                {toolEntries.length > 0 && (
                                    <span style={{
                                        backgroundColor: 'var(--color-text-tertiary)',
                                        color: 'var(--color-bg-surface)',
                                        borderRadius: 20,
                                        padding: '1px 7px',
                                        fontSize: 10,
                                        fontWeight: 700,
                                        marginLeft: 4,
                                    }}>
                                        {toolEntries.length}
                                    </span>
                                )}
                            </div>

                            {/* Scrollable tool cards */}
                            <div style={{
                                maxHeight: 420,
                                overflowY: 'auto',
                                paddingRight: 6,
                            }}>
                                {toolEntries.length > 0 ? (
                                    toolEntries
                                        .filter(tool => {
                                            const name = tool.name.toLowerCase();
                                            const isViewing = [
                                                'read_file', 'list_dir', 'view_file', 'list_screens', 
                                                'grep_search', 'read_url_content', 'command_status',
                                                'list_projects', 'get_project', 'get_screen', 'list_design_systems',
                                                'read_resource', 'list_resources', 'read_browser_page', 'screenshot_browser'
                                            ].some(safeTool => name.includes(safeTool));
                                            const isSkills = name.includes('skill') || name.includes('mcp') || name.includes('stitch');
                                            return !isViewing && !isSkills;
                                        })
                                        .map((tool, idx) => (
                                            <ToolCard key={idx} tool={tool} />
                                        ))
                                ) : (
                                    // Fallback: raw markdown
                                    <div style={{
                                        backgroundColor: '#f8f9fa',
                                        border: '1px solid #e5e7eb',
                                        borderRadius: 8,
                                        padding: '10px 14px',
                                        fontSize: 13,
                                        maxHeight: 300,
                                        overflowY: 'auto',
                                    }}>
                                        <MarkdownRenderer content={displayActionsPart} />
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div style={{
            background: isInline ? "var(--color-bg-surface)" : "var(--color-bg-subtle)",
            backdropFilter: isInline ? "blur(12px)" : "none",
            boxShadow: isInline 
                ? "0 8px 30px rgba(0, 0, 0, 0.06), 0 2px 8px rgba(0,0,0,0.04)"
                : "0 1px 3px rgba(0,0,0,0.1)",
            border: "1px solid var(--color-border)",
            borderRadius: 16,
            padding: isInline ? 20 : 24,
            margin: isInline ? '16px 0' : '24px 0',
            fontFamily: "var(--font-sans), 'Matter', system-ui, sans-serif",
            width: '100%',
        }}>
            {/* Hidden file input */}
            <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={handleFileChange} />

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-text-primary)', fontSize: 14, fontWeight: 600 }}>
                    <div style={{
                        width: 24,
                        height: 24,
                        borderRadius: 7,
                        background: "var(--color-bg-surface-hover)",
                        boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--color-text-secondary)",
                    }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <circle cx="12" cy="12" r="10" />
                            <path d="M9,9h6v6H9z" />
                        </svg>
                    </div>
                    <span>Waiting for your input</span>
                </div>
                {total > 1 && (
                    <span style={{ fontSize: 12, color: '#717171', fontWeight: 600 }}>
                        {currentIndex + 1} / {total}
                    </span>
                )}
            </div>

            {/* Progress bar */}
            {total > 1 && (
                <div style={{ height: 3, backgroundColor: 'var(--color-border)', borderRadius: 2, marginBottom: 16 }}>
                    <div style={{
                        height: '100%',
                        backgroundColor: 'var(--color-text-primary)',
                        borderRadius: 2,
                        width: `${((currentIndex + 1) / total) * 100}%`,
                        transition: 'width 0.2s ease',
                    }} />
                </div>
            )}

            {/* Coding plan preview — shown when the agent presents a plan for approval */}
            {previewMarkdown && (
                <div 
                    style={{ 
                        marginBottom: 20,
                        background: "var(--color-bg-subtle)",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 12,
                        overflow: 'hidden'
                    }}
                >
                    <div 
                        style={{ 
                            padding: '10px 16px',
                            background: "var(--color-bg-surface)",
                            borderBottom: '1px solid var(--color-border)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8
                        }}
                    >
                        <div style={{
                            width: 24,
                            height: 24,
                            borderRadius: 7,
                            background: "var(--color-bg-surface-hover)",
                            boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "var(--color-text-secondary)",
                        }}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="16 18 22 12 16 6" />
                                <polyline points="8 6 2 12 8 18" />
                            </svg>
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)', fontFamily: "'Matter', system-ui, sans-serif" }}>
                            Implementation Plan
                        </span>
                    </div>
                    <div 
                        style={{ 
                            padding: 16,
                            maxHeight: 280,
                            overflowY: 'auto',
                            backgroundColor: 'var(--color-bg-surface)',
                            fontSize: 13.5,
                            lineHeight: 1.6
                        }}
                        className="custom-scrollbar"
                    >
                        <MarkdownRenderer content={previewMarkdown} />
                    </div>
                </div>
            )}

            {/* Question content */}
            {isHighRisk
                ? renderHighRiskContent()
                : (
                    <div style={{ margin: '0 0 20px 0', fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)', lineHeight: 1.6 }}>
                        <MarkdownRenderer content={current.question} />
                    </div>
                )}

            {/* Subjective input (when no options are provided) */}
            {current && (!current.options || current.options.length === 0) && (
                <div style={{ marginBottom: 20 }}>
                    <textarea
                        value={currentAnswers[0] || ''}
                        onChange={(e) => {
                            const q = current.question;
                            setAnswers(prev => ({ ...prev, [q]: [e.target.value] }));
                        }}
                        placeholder="Type your answer here..."
                        style={{
                            width: '100%',
                            minHeight: 100,
                            padding: '12px 16px',
                            borderRadius: 10,
                            border: '1px solid var(--color-border)',
                            backgroundColor: 'var(--color-bg-surface)',
                            color: 'var(--color-text-primary)',
                            fontSize: 14,
                            fontFamily: 'inherit',
                            resize: 'vertical',
                            outline: 'none',
                            boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.05)',
                        }}
                    />
                </div>
            )}

            {/* Options */}
            {current && current.options && current.options.length > 0 && (
                <div style={{ position: 'relative', marginBottom: 20 }}>
                    <div 
                        ref={scrollContainerRef}
                        onScroll={checkScroll}
                        style={{ 
                            display: 'flex', 
                            flexDirection: 'column', 
                            gap: 10, 
                            maxHeight: 280,
                            overflowY: 'auto',
                            paddingRight: 4
                        }}
                        className="custom-scrollbar"
                    >
                        {visibleOptions.map((option, idx) => {
                        const selected = currentAnswers.includes(option.value);
                        const isFileOption = option.requiresFileUpload;
                        const fileAttached = isFileOption && attachedFiles.some(() => pendingFileOption === option.value);

                        if (isHighRisk) {
                            const val = option.value;
                            const isApproveOnce = val.includes('Approve — proceed once') || val.includes('[HITL_APPROVED]');
                            const isAlways = val.includes('Approve & Allow Always');
                            const isPrefix = val.includes('Approve & Allow Prefix');
                            const isReject = val.includes('Reject');

                            let title = option.label;
                            let sub = '';
                            let badge = '1-CLICK';
                            let badgeBg = 'rgba(16, 185, 129, 0.1)';
                            let badgeColor = '#10b981';
                            let borderHoverColor = 'var(--color-border-strong)';

                            if (isApproveOnce) {
                                title = 'Approve once';
                                sub = 'Run this action single time';
                                badge = 'PROCEED ONCE';
                                badgeBg = 'rgba(16, 185, 129, 0.12)';
                                badgeColor = '#059669';
                                borderHoverColor = '#10b981';
                            } else if (isAlways) {
                                title = 'Approve & Allow Always';
                                sub = 'Never ask for this specific command again';
                                badge = 'ALWAYS ALLOW';
                                badgeBg = 'rgba(99, 102, 241, 0.12)';
                                badgeColor = '#4f46e5';
                                borderHoverColor = '#6366f1';
                            } else if (isPrefix) {
                                title = 'Approve Command Prefix';
                                sub = 'Never ask for commands starting with this base';
                                badge = 'ALLOW PREFIX';
                                badgeBg = 'rgba(168, 85, 247, 0.12)';
                                badgeColor = '#9333ea';
                                borderHoverColor = '#a855f7';
                            } else if (isReject) {
                                title = 'Reject & Cancel';
                                sub = 'Stop execution and return control to agent';
                                badge = 'DENY';
                                badgeBg = 'rgba(239, 68, 68, 0.12)';
                                badgeColor = '#dc2626';
                                borderHoverColor = '#ef4444';
                            }

                            return (
                                <button
                                    key={idx}
                                    onClick={() => handleOptionClick(option.value, option.requiresFileUpload)}
                                    disabled={isProcessing}
                                    style={{
                                        padding: '12px 16px',
                                        borderRadius: 12,
                                        border: '1px solid var(--color-border)',
                                        backgroundColor: 'var(--color-bg-surface)',
                                        color: 'var(--color-text-primary)',
                                        cursor: isProcessing ? 'not-allowed' : 'pointer',
                                        opacity: isProcessing ? 0.6 : 1,
                                        textAlign: 'left',
                                        transition: 'all 0.18s cubic-bezier(0.4, 0, 0.2, 1)',
                                        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                                    }}
                                    onMouseEnter={e => {
                                        if (!isProcessing) {
                                            e.currentTarget.style.borderColor = borderHoverColor;
                                            e.currentTarget.style.backgroundColor = 'var(--color-bg-subtle)';
                                        }
                                    }}
                                    onMouseLeave={e => {
                                        if (!isProcessing) {
                                            e.currentTarget.style.borderColor = 'var(--color-border)';
                                            e.currentTarget.style.backgroundColor = 'var(--color-bg-surface)';
                                        }
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                            <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--color-text-primary)' }}>{title}</span>
                                            {sub && <span style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)' }}>{sub}</span>}
                                        </div>
                                        <span style={{
                                            fontSize: 10,
                                            fontWeight: 700,
                                            color: badgeColor,
                                            backgroundColor: badgeBg,
                                            padding: '3px 8px',
                                            borderRadius: 20,
                                            letterSpacing: '0.04em',
                                            flexShrink: 0
                                        }}>
                                            {badge}
                                        </span>
                                    </div>
                                </button>
                            );
                        }

                        return (
                            <button
                                key={idx}
                                onClick={() => handleOptionClick(option.value, option.requiresFileUpload)}
                                style={{
                                    padding: '14px 16px',
                                    borderRadius: 10,
                                    border: selected 
                                        ? '1px solid var(--color-text-primary)' 
                                        : '1px solid var(--color-border)',
                                    backgroundColor: selected 
                                        ? 'var(--color-bg-subtle)' 
                                        : 'var(--color-bg-surface)',
                                    color: 'var(--color-text-primary)',
                                    cursor: isProcessing ? 'not-allowed' : 'pointer',
                                    opacity: isProcessing ? 0.7 : 1,
                                    textAlign: 'left',
                                    fontSize: 14,
                                    fontWeight: option.isRecommended ? 600 : 500,
                                    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                                    boxShadow: selected 
                                        ? '0 1px 3px rgba(0,0,0,0.06)' 
                                        : '0 1px 2px rgba(0,0,0,0.03)',
                                }}
                                onMouseEnter={e => { if (!selected) e.currentTarget.style.backgroundColor = 'var(--color-bg-subtle)'; }}
                                onMouseLeave={e => { if (!selected) e.currentTarget.style.backgroundColor = 'var(--color-bg-surface)'; }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                    <div style={{
                                        width: 18, height: 18,
                                        borderRadius: current.multiSelect ? 4 : '50%',
                                        border: selected ? 'none' : '1px solid var(--color-border)',
                                        backgroundColor: selected 
                                            ? 'var(--color-text-primary)' 
                                            : 'var(--color-bg-surface)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                                        boxShadow: selected ? 'none' : 'inset 0 1px 2px rgba(0,0,0,0.05)',
                                    }}>
                                        {selected && (
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-bg-surface)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                <polyline points="20 6 9 17 4 12" />
                                            </svg>
                                        )}
                                    </div>
                                    <span style={{ color: 'var(--color-text-primary)' }}>{option.label}</span>
                                    {isFileOption && (
                                        <span style={{ fontSize: 11, color: 'var(--color-text-primary)', marginLeft: 4, opacity: 0.8 }}>
                                            📎 {fileAttached ? '✓ File attached' : 'Click to attach file'}
                                        </span>
                                    )}
                                    {option.isRecommended && (
                                        <span style={{ fontSize: 10, fontWeight: 700, color: '#166534', backgroundColor: '#dcfce7', border: '1px solid #bbf7d0', padding: '2px 8px', borderRadius: 20, marginLeft: 'auto', letterSpacing: '0.04em' }}>
                                            RECOMMENDED
                                        </span>
                                    )}
                                </div>
                            </button>
                        );
                    })}
                </div>
                    {showBottomFade && (
                        <div style={{
                            position: 'absolute',
                            bottom: 0,
                            left: 0,
                            right: 4,
                            height: 40,
                            background: 'linear-gradient(to bottom, transparent 0%, var(--color-bg-subtle) 100%)',
                            pointerEvents: 'none',
                            borderRadius: '0 0 10px 10px',
                        }} />
                    )}
                </div>
            )}

            {/* Attached files summary */}
            {attachedFiles.length > 0 && (
                <div style={{ marginBottom: 12, padding: '8px 12px', backgroundColor: '#e8f5e9', border: '1px solid #c8e6c9', borderRadius: 8 }}>
                    {attachedFiles.map((f, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#1b5e20' }}>
                            <span>📎</span>
                            <span style={{ fontWeight: 500 }}>{f.name}</span>
                            <button onClick={() => setAttachedFiles(prev => prev.filter((_, j) => j !== i))}
                                style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#c62828', fontSize: 12 }}>
                                ✕
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* Footer: back / next / submit */}
            <div style={{ display: 'flex', justifyContent: total > 1 ? 'space-between' : 'flex-end', gap: 8 }}>
                {total > 1 && (
                    <button onClick={handleBack} disabled={currentIndex === 0 || isProcessing}
                        style={{ padding: '10px 16px', borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: (currentIndex === 0 || isProcessing) ? 'transparent' : 'var(--color-bg-surface)', color: (currentIndex === 0 || isProcessing) ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)', fontSize: 14, fontWeight: (currentIndex === 0 || isProcessing) ? 500 : 600, cursor: (currentIndex === 0 || isProcessing) ? 'not-allowed' : 'pointer', opacity: isProcessing ? 0.6 : 1, boxShadow: (currentIndex === 0 || isProcessing) ? 'none' : '0 1px 2px rgba(0,0,0,0.04)' }}>
                        Back
                    </button>
                )}
                {currentIndex < total - 1 ? (
                    <button onClick={handleNext} disabled={!isAnswered || isProcessing}
                        style={{ padding: '10px 20px', borderRadius: 8, border: 'none', backgroundColor: isAnswered && !isProcessing ? 'var(--color-text-primary)' : 'var(--color-border)', color: isAnswered && !isProcessing ? 'var(--color-bg-surface)' : 'var(--color-text-tertiary)', fontSize: 14, fontWeight: 600, cursor: (!isAnswered || isProcessing) ? 'not-allowed' : 'pointer', opacity: isProcessing ? 0.6 : 1 }}>
                        Next
                    </button>
                ) : (
                    !(isHighRisk && !current.multiSelect) && (
                        <button onClick={handleSubmit} disabled={!allAnswered || isProcessing}
                            style={{ padding: '10px 20px', borderRadius: 8, border: 'none', backgroundColor: allAnswered && !isProcessing ? 'var(--color-text-primary)' : 'var(--color-border)', color: allAnswered && !isProcessing ? 'var(--color-bg-surface)' : 'var(--color-text-tertiary)', fontSize: 14, fontWeight: 600, cursor: (!allAnswered || isProcessing) ? 'not-allowed' : 'pointer', opacity: isProcessing ? 0.6 : 1 }}>
                            {isProcessing ? 'Submitting...' : 'Submit'} {current.multiSelect && currentAnswers.length > 1 ? `(${currentAnswers.length} selected)` : ''}
                        </button>
                    )
                )}
            </div>
        </div>
    );
};

export { HitlApprovalForm, UserQuestionForm };
