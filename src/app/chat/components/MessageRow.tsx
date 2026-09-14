'use client';

// CU-REND-01 (scoped): memoized message row extracted from page.tsx' messages.map.
// CU-REND-04: per-message scrub/extract results cached in a WeakMap keyed by the
// immutable message object — committed messages are computed exactly once.
// CU-STRM-04: no entry animations / layout for history rows (only the live row
// animates), so streaming renders don't run springs over the whole list.

import React, { memo } from 'react';
import { motion } from 'framer-motion';
import { PaperClipIcon, HandThumbUpIcon, HandThumbDownIcon } from '@heroicons/react/24/outline';
import { SuggestedFollowUps } from './SuggestedFollowUps';
import { EverFernCloudLimitNotice } from './EverFernCloudBanners';
import { PlanApprovalBanner } from './PlanApprovalBanner';
import { RateLimitContinueButton, CloudAuthLoginButton } from './UIHelpers';
import { InlineVisualization } from './InlineVisualization';
import { InterruptedResponseBanner } from './InterruptedResponseBanner';
import { ReportContainer } from './ReportComponents';
import DocumentCard from './DocumentCard';
import FileArtifact from '../FileArtifact';
import SitePreview from '../SitePreview';
import { AgentTimeline } from '../../../components/AgentTimeline';
import { StreamingMarkdown } from './MarkdownComponents';
import { PlanPreviewCard } from './ToolCallDetailPane';
import { UserQuestionForm, HitlApprovalForm } from './FormComponents';
import LazyBase64Thumb from './LazyBase64Thumb';
import type { ToolCallDisplay, Message, SubAgentProgressEvent } from '../types/index';

const SuggestedFollowUpsComponent = SuggestedFollowUps;

// ── CU-REND-04: cached per-message derived view ──────────────────────────────
// extractFileArtifacts + scrubOrchestratorNoise + extractSuggestedFollowUps ran
// for EVERY historical assistant message on EVERY page render (20/sec while
// streaming). Messages are replaced immutably, so object identity is a safe key.
/**
 * Derived, cached presentation of one assistant message: scrubbed content at
 * each stage, extracted artifacts, and suggested follow-ups.
 */
export interface AssistantMessageView {
    scrubbedTrimmed: string;        // for the empty/noise skip-check
    displayContent: string;         // after artifact extraction + scrub
    finalContent: string;           // after follow-up extraction
    followUps: Array<{ icon: string; text: string }>;
    artifacts: Array<{ description: string; path: string }>;
    hasContent: boolean;
}

const messageViewCache = new WeakMap<Message, AssistantMessageView>();

/**
 * Get (or lazily derive) the cached view for a message. Derivation runs at
 * most once per message object identity; immutable message replacement is
 * what makes this cache-safe.
 */
export function getAssistantMessageView(
    msg: Message,
    derive: (msg: Message) => AssistantMessageView
): AssistantMessageView {
    let view = messageViewCache.get(msg);
    if (!view) {
        view = derive(msg);
        messageViewCache.set(msg, view);
    }
    return view;
}

/**
 * No-op cache clearer: WeakMap entries GC with their message objects.
 * Exposed for test observability only.
 */
export function clearMessageViewCache(): void {
    // WeakMap entries GC with their message objects; nothing to eagerly clear.
    // Exposed for test observability.
}

// Referentially stable empty array — avoids `msg.toolCalls || []` allocation
// per row per render (CU-REND-07) which defeated AgentTimeline's React.memo.
/** Stable shared EMPTY_TOOL_CALLS constant (see CU-REND-07 note above). */
export const EMPTY_TOOL_CALLS: ToolCallDisplay[] = [];

/** Props for MessageRow: the message, its position context, and every
 * parent-owned callback the row's inline banners/cards delegate to. */
export interface MessageRowProps {
    msg: Message;
    idx: number;
    isLast: boolean;
    chatId: string;
    activeConversationId: string | null;
    currentPhase?: "triage" | "planning" | "execution" | "validation" | "completion" | undefined;
    currentNode?: string;
    subAgentProgress: Map<string, SubAgentProgressEvent[]>;
    missionTimeline: any;
    sites: any[];
    currentModel?: { providerType?: string } | null;
    activeUserQuestions: Array<any>;
    showHitlApproval: boolean;
    hitlRequest: any;
    deriveView: (msg: Message) => AssistantMessageView;
    onPillClick: (tc: ToolCallDisplay) => void;
    onOpenArtifact: (name: string, path: string) => void;
    onSend: (text: string, historyOverride?: Message[], skipAddUserMessage?: boolean) => void;
    onUndoTurn: (msgIndex: number) => void;
    onFeedback: (idx: number, type: 'up' | 'down') => void;
    onOpenPlanPreview: (tc: ToolCallDisplay) => void;
    onEditPromptForStopped: (idx: number) => void;
    onTryAgainForStopped: (idx: number) => void;
    onContinueRateLimited: () => void;
    onNavisApprove: (sendMessage: boolean) => void;
    onNavisReject: (sendMessage: boolean) => void;
    onQuestionSubmit: (answers: Record<string, string[]>) => void;
    onCloudAuthLogin: () => void;
    onSetInputValue: (value: string) => void;
    isNavisQuestion: (questions: any[]) => boolean;
    isNavisHitl: (request: any) => boolean;
    toContentString: (content: any) => string;
}

/**
 * One message row. History rows render with NO framer entry animation and NO
 * layout prop (CU-STRM-04); only the live row keeps the animated presentation.
 */
export const MessageRow = memo(function MessageRow({
    msg,
    idx,
    isLast,
    chatId,
    activeConversationId,
    currentPhase,
    currentNode,
    subAgentProgress,
    missionTimeline,
    sites,
    currentModel,
    activeUserQuestions,
    showHitlApproval,
    hitlRequest,
    deriveView,
    onPillClick,
    onOpenArtifact,
    onSend,
    onUndoTurn,
    onFeedback,
    onOpenPlanPreview,
    onEditPromptForStopped,
    onTryAgainForStopped,
    onContinueRateLimited,
    onNavisApprove,
    onNavisReject,
    onQuestionSubmit,
    onCloudAuthLogin,
    onSetInputValue,
    isNavisQuestion,
    isNavisHitl,
    toContentString,
}: MessageRowProps) {
    // CU-REND-04: noise skip-check uses the cached view instead of re-scrubbing.
    const view = getAssistantMessageView(msg, deriveView);

    return (
        <motion.div
            key={msg.id}
            initial={isLast ? { opacity: 0, y: 30, scale: 0.95 } : false}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={isLast ? { opacity: 0, y: -20, scale: 0.95 } : { opacity: 0 }}
            transition={isLast ? { type: "spring", stiffness: 400, damping: 30, delay: 0 } : { duration: 0 }}
            style={{ marginBottom: 28, display: "flex", flexDirection: "column", alignItems: msg.role === "user" ? "flex-end" : "flex-start", width: "100%" }}
        >

            <div className={msg.role === "user" ? "glossy-bubble" : ""} style={{ maxWidth: msg.role === "user" ? "80%" : "100%", width: msg.role === "user" ? "auto" : "100%", padding: msg.role === "user" ? "12px 18px" : "0", borderRadius: msg.role === "user" ? 16 : 0, borderTopRightRadius: msg.role === "user" ? 4 : 0, background: msg.role === "user" ? "var(--color-user-bubble)" : "transparent", border: msg.role === "user" ? "1px solid var(--color-user-bubble-border)" : "none", fontSize: 15, lineHeight: 1.7 }}>
                {msg.role === "user" ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        {msg.attachments && msg.attachments.length > 0 && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                {msg.attachments.map(a => (
                                    <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", backgroundColor: "var(--color-bg-subtle)", borderRadius: 8, border: "1px solid var(--color-border)", maxWidth: '100%' }}>
                                        {a.mimeType.startsWith("image/") && a.base64 ? <LazyBase64Thumb base64={a.base64} size={32} borderRadius={4} /> : <PaperClipIcon width={16} height={16} color="var(--color-text-tertiary)" />}
                                        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                                            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-primary)", maxWidth: 200, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={a.path || a.name}>{a.name}</span>
                                            <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>{(a.size / 1024).toFixed(1)} KB</span>
                                            {a.path && (
                                                <span style={{ fontSize: 9, color: "var(--color-text-placeholder)", maxWidth: 200, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 1 }} title={a.path}>
                                                    {a.path}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                        {(() => {
                            const msgContentStr = toContentString(msg.content);
                            if (!msgContentStr) return null;
                            // The composer appends shared-folder context after
                            // the main text; split it back out for separate
                            // rendering below.
                            const parts = msgContentStr.split(/\n\n\[Shared folder context\]\n/);
                            const mainText = parts[0];
                            const folderContextBlock = parts.length > 1 ? parts[1].split("\n\nNote:")[0] : null;
                            const folderLines = folderContextBlock ? folderContextBlock.split('\n').filter(l => l.startsWith('- ')).map(l => l.substring(2).trim()) : [];
                            const isPlanApproved = mainText?.startsWith('[PLAN_APPROVED]');
                            const planText = isPlanApproved ? mainText.replace('[PLAN_APPROVED]\n', '').trim() : null;
                            return (
                                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                                    {isPlanApproved ? (
                                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                            <PlanApprovalBanner />
                                            {planText && planText !== 'I have reviewed and approved your execution plan. Please proceed with the execution as planned.' && (
                                                <span style={{ color: "var(--color-text-primary)", whiteSpace: "pre-wrap" }}>{planText}</span>
                                            )}
                                        </div>
                                    ) : (
                                        mainText && <span style={{ color: "var(--color-text-primary)", whiteSpace: "pre-wrap" }}>{mainText}</span>
                                    )}
                                    {folderLines.length > 0 && (
                                        <div style={{ padding: "12px 16px", backgroundColor: "var(--color-bg-surface)", border: "1px solid var(--color-border)", borderRadius: 12 }}>
                                            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-tertiary)", marginBottom: 8, display: "flex", alignItems: "center", gap: 6, textTransform: "uppercase" }}>
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                                                Shared context
                                            </div>
                                            <div style={{ fontSize: 13, color: "var(--color-text-secondary)", display: "flex", flexDirection: "column", gap: 4 }}>
                                                {folderLines.map((line, idx) => <div key={idx} style={{ wordBreak: "break-all", display: "flex", gap: 6 }}><span style={{ color: "var(--color-text-tertiary)" }}>-</span> {line}</div>)}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })()}
                    </div>
                ) : (
                    <>
                            <div
                                className="pr-3 custom-scrollbar"
                                style={{
                                    width: "100%",
                                    position: "relative",
                                    paddingLeft: "0px",
                                    marginBottom: msg.content?.trim() ? "14px" : "0px",
                                }}
                            >
                                <AgentTimeline
                                    key={`timeline-${msg.id}`}
                                    toolCalls={msg.toolCalls || EMPTY_TOOL_CALLS}
                                    thought={msg.thought}
                                    reasoningContent={msg.reasoning_content}
                                    isLive={false}
                                    currentPhase={currentPhase}
                                    currentNode={currentNode}
                                    subAgentProgress={subAgentProgress}
                                    generatedTitle={msg.generatedTitle}
                                    missionTimeline={msg.missionTimeline || missionTimeline}
                                    onPillClick={onPillClick}
                                />
                            </div>


                            {(() => {
                                const { displayContent, finalContent, followUps, artifacts, hasContent } = view;
                                const hasToolCalls = msg.toolCalls && msg.toolCalls.length > 0;

                                return (
                                    <>
                                        {hasContent ? (
                                            <StreamingMarkdown content={finalContent} isLive={false} isLatest={isLast} />
                                        ) : hasToolCalls ? (
                                            <div style={{ fontSize: 13, color: 'var(--color-text-tertiary)', fontStyle: 'italic', padding: '8px 0' }}>

                                            </div>
                                        ) : null}
                                        {msg.limitReached && <EverFernCloudLimitNotice />}
                                        {artifacts.map((art, i) => {
                                            const ext = art.path.split('.').pop()?.toLowerCase() || '';
                                            // Premium docs (.md) get the richer DocumentCard; all
                                            // other file types fall back to FileArtifact.
                                            const isPremiumDoc = ext === 'md';
                                            return (
                                                <div key={i} style={{ width: '100%', display: 'flex', justifyContent: 'flex-start' }}>
                                                    {isPremiumDoc ? (
                                                        <DocumentCard
                                                            path={art.path}
                                                            description={art.description}
                                                            chatId={chatId}
                                                            onOpenArtifact={(name: string) => onOpenArtifact(name, art.path)}
                                                        />
                                                    ) : (
                                                        <FileArtifact
                                                            path={art.path}
                                                            description={art.description}
                                                            chatId={chatId}
                                                            onOpenArtifact={(name: string) => onOpenArtifact(name, art.path)}
                                                        />
                                                    )}
                                                </div>
                                            );
                                        })}
                                        {followUps.length > 0 && (
                                            <SuggestedFollowUpsComponent
                                                followUps={followUps}
                                                onSelect={(text) => onSend(text)}
                                            />
                                        )}
                                    </>
                                );
                            })()}
                            {/* Presented File Cards — Claude-style file presentation after message text */}
                            {(() => {
                                const presentFileCalls = msg.toolCalls?.filter(
                                    (tc: any) => tc.toolName === 'present_files' && tc.data?.files && Array.isArray(tc.data.files)
                                ) || [];
                                if (presentFileCalls.length === 0) return null;
                                const presentedFiles = presentFileCalls.flatMap((tc: any) => tc.data.files);
                                return (
                                    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
                                        {presentedFiles.map((file: any, fi: number) => {
                                            const filePath = file.path || '';
                                            const fileDesc = file.title || file.description || undefined;
                                            return (
                                                <FileArtifact
                                                    key={`presented-${fi}-${filePath}`}
                                                    path={filePath}
                                                    description={fileDesc}
                                                    chatId={chatId}
                                                    onOpenArtifact={(name: string) => onOpenArtifact(name, filePath)}
                                                />
                                            );
                                        })}
                                    </div>
                                );
                            })()}
                            <ReportContainer
                                content={msg.content}
                                onView={(label, path) => {
                                    const filename = path.split(/[\\/]/).pop() || label;
                                    onOpenArtifact(filename, path);
                                }}
                            />
                            {/* Sites only render when a site was published for the
                                ACTIVE conversation (not the row's own chatId). */}
                            {msg.role === "assistant" && sites.length > 0 && sites.some(site => site.chatId === activeConversationId) && (
                                <div style={{ marginTop: 12 }}>
                                    {sites.filter(site => site.chatId === activeConversationId).map(site => <SitePreview key={site.id} chatId={chatId} filename={site.id} />)}
                                </div>
                            )}

                            {msg.toolCalls?.filter(tc => tc.toolName === 'visualize').map(tc => (
                                <InlineVisualization
                                    key={tc.id}
                                    html={tc.args?.html as string || ''}
                                    css={tc.args?.css as string}
                                    js={tc.args?.js as string}
                                    title={tc.args?.title as string}
                                    height={tc.args?.height as number}
                                />
                            ))}
                            {/* Plan Preview Card - Show when execution_plan tool is present */}
                            {msg.toolCalls?.filter(tc => tc.toolName === 'execution_plan').map(tc => {
                                const planContent = tc.data?.content || '';
                                const planTitle = planContent.match(/^# Execution Plan:\s*(.+)$/m)?.[1] || 'Execution Plan';
                                const stepCount = (planContent.match(/^### /gm) || []).length;
                                return (
                                    <div key={tc.id} style={{ marginTop: 12, marginBottom: 8 }}>
                                        <PlanPreviewCard
                                            title={planTitle}
                                            description="Click to view the full execution plan with all steps and details."
                                            stepCount={stepCount}
                                            completedCount={0}
                                            onClick={() => {
                                                // Open the tool call detail pane for this plan
                                                onOpenPlanPreview(tc);
                                            }}
                                            onApprove={() => {
                                                // Handle plan approval
                                                const approvalMsg = `[PLAN_APPROVED]\nI have reviewed and approved your execution plan. Please proceed with the execution as planned.`;
                                                onSend(approvalMsg);
                                            }}
                                        />
                                    </div>
                                );
                            })}
                            {/* Interrupted Response Banner (when user stops message) */}
                            {msg.stopped && (
                                    <InterruptedResponseBanner
                                        onEditPrompt={() => onEditPromptForStopped(idx)}
                                        onTryAgain={() => onTryAgainForStopped(idx)}
                                    />
                            )}
                            <RateLimitContinueButton content={msg.content} onContinue={() => { onContinueRateLimited(); }} />
                            <CloudAuthLoginButton content={toContentString(msg.content)} providerType={currentModel?.providerType} onLogin={onCloudAuthLogin} />
                            {isLast && activeUserQuestions.length > 0 && isNavisQuestion(activeUserQuestions) && (
                                <div style={{ marginTop: 16, width: '100%', maxWidth: '720px' }}>
                                    <UserQuestionForm
                                        questions={activeUserQuestions}
                                        onSubmit={onQuestionSubmit}
                                        previewMarkdown={activeUserQuestions[0]?.previewMarkdown}
                                        isInline={true}
                                    />
                                </div>
                            )}
                            {isLast && showHitlApproval && hitlRequest && isNavisHitl(hitlRequest) && (
                                <div style={{ marginTop: 16, width: '100%', maxWidth: '720px' }}>
                                    <HitlApprovalForm
                                        request={hitlRequest}
                                        onApprove={(sendMessage?: boolean) => onNavisApprove(!!sendMessage)}
                                        onReject={(sendMessage?: boolean) => onNavisReject(!!sendMessage)}
                                        isInline={true}
                                    />
                                </div>
                            )}

                            <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: 12 }}>
                                <button
                                    onClick={() => onUndoTurn(idx)}
                                    title="Undo Turn"
                                    className="hover:text-zinc-600 transition-colors"
                                    style={{
                                        background: 'transparent',
                                        border: 'none',
                                        padding: '4px',
                                        color: 'var(--color-text-tertiary)',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                    }}
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M3 7v6h6" />
                                        <path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13" />
                                    </svg>
                                </button>

                                <button
                                    onClick={() => onFeedback(idx, 'down')}
                                    title="Thumbs Down"
                                    className="hover:text-red-500 transition-colors"
                                    style={{
                                        background: 'transparent',
                                        border: 'none',
                                        padding: '4px',
                                        color: 'var(--color-text-tertiary)',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                    }}
                                >
                                    <HandThumbDownIcon className="w-4 h-4" />
                                </button>

                                <button
                                    onClick={() => onFeedback(idx, 'up')}
                                    title="Thumbs Up"
                                    className="hover:text-green-500 transition-colors"
                                    style={{
                                        background: 'transparent',
                                        border: 'none',
                                        padding: '4px',
                                        color: 'var(--color-text-tertiary)',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                    }}
                                >
                                    <HandThumbUpIcon className="w-4 h-4" />
                                </button>
                            </div>
                        </>
                    )}
                </div>
        </motion.div>
    );
});
