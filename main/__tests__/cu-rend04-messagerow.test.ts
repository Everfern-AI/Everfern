/**
 * CU-REND-04 / CU-REND-01 — MessageRow derived-view cache + memo contract.
 * DOM-free (node env): exercises the exported pure helpers from MessageRow.
 * Heavy child imports are mocked via alias paths so the import graph stays
 * tiny in node env (relative './X' mocks would resolve from THIS file and
 * never apply to MessageRow's own specifiers).
 */
import { describe, it, expect, vi } from 'vitest';
import type React from 'react';

vi.mock('@/app/chat/components/MarkdownComponents', () => ({ StreamingMarkdown: () => null }));
vi.mock('@/app/chat/components/ToolCallDetailPane', () => ({ PlanPreviewCard: () => null }));
vi.mock('@/app/chat/components/FormComponents', () => ({ UserQuestionForm: () => null, HitlApprovalForm: () => null }));
vi.mock('@/app/chat/components/SuggestedFollowUps', () => ({ SuggestedFollowUps: () => null }));
vi.mock('@/app/chat/components/EverFernCloudBanners', () => ({ EverFernCloudLimitNotice: () => null }));
vi.mock('@/app/chat/components/PlanApprovalBanner', () => ({ PlanApprovalBanner: () => null }));
vi.mock('@/app/chat/components/UIHelpers', () => ({ RateLimitContinueButton: () => null, CloudAuthLoginButton: () => null }));
vi.mock('@/app/chat/components/InlineVisualization', () => ({ InlineVisualization: () => null }));
vi.mock('@/app/chat/components/InterruptedResponseBanner', () => ({ InterruptedResponseBanner: () => null }));
vi.mock('@/app/chat/components/ReportComponents', () => ({ ReportContainer: () => null }));
vi.mock('@/app/chat/components/DocumentCard', () => ({ default: () => null }));
vi.mock('@/app/chat/FileArtifact', () => ({ default: () => null }));
vi.mock('@/app/chat/SitePreview', () => ({ default: () => null }));
vi.mock('@/components/AgentTimeline', () => ({ AgentTimeline: () => null }));
vi.mock('@/app/chat/components/LazyBase64Thumb', () => ({ default: () => null }));
vi.mock('framer-motion', () => ({
    motion: new Proxy({}, { get: () => (props: any) => null }),
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@heroicons/react/24/outline', () => ({
    PaperClipIcon: () => null,
    HandThumbUpIcon: () => null,
    HandThumbDownIcon: () => null,
}));

import {
    MessageRow,
    getAssistantMessageView,
    EMPTY_TOOL_CALLS,
    type AssistantMessageView,
} from '../../src/app/chat/components/MessageRow';
import type { Message } from '../../src/app/chat/types/index';

const derive = (msg: Message): AssistantMessageView => ({
    scrubbedTrimmed: String(msg.content),
    displayContent: String(msg.content),
    finalContent: String(msg.content),
    followUps: [],
    artifacts: [],
    hasContent: String(msg.content).length > 0,
});

describe('CU-REND-04 derived-view cache (via getAssistantMessageView)', () => {
    it('computes once per message object and reuses by identity', () => {
        const msg: Message = { id: 'm1', role: 'assistant', content: 'hello', timestamp: new Date() };
        const v1 = getAssistantMessageView(msg, derive);
        const v2 = getAssistantMessageView(msg, derive);
        expect(v1).toBe(v2);
    });

    it('recomputes for a new (immutable-replaced) message object', () => {
        const a: Message = { id: 'm2', role: 'assistant', content: 'one', timestamp: new Date() };
        const b: Message = { id: 'm2', role: 'assistant', content: 'two', timestamp: new Date() };
        expect(getAssistantMessageView(a, derive)).not.toBe(getAssistantMessageView(b, derive));
        expect(getAssistantMessageView(b, derive).scrubbedTrimmed).toBe('two');
    });

    it('caches many messages independently (WeakMap semantics)', () => {
        const msgs = Array.from({ length: 50 }, (_, i) =>
            ({ id: 'x' + i, role: 'assistant', content: 'c' + i, timestamp: new Date() }) as Message);
        const first = msgs.map(m => getAssistantMessageView(m, derive));
        const second = msgs.map(m => getAssistantMessageView(m, derive));
        expect(first.every((v, i) => v === second[i])).toBe(true);
    });
});

describe('CU-REND-07 stable exports', () => {
    it('MessageRow is memoized (component object) and EMPTY_TOOL_CALLS is a stable shared array', () => {
        expect(typeof MessageRow).toBe('object');
        expect(EMPTY_TOOL_CALLS).toEqual([]);
        expect(EMPTY_TOOL_CALLS.length).toBe(0);
    });
});
