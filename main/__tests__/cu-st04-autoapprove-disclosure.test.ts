// @vitest-environment node
/**
 * CU-ST-04 — auto-approve disclosure in tool-call output.
 *
 * DOM-free source contract (style of cu-ui08-z-tiers.test.ts): when the
 * silent `localAlwaysAllowedRef` branch auto-approves a local-execution
 * request, no permission card is shown — so the in-page tool-call output
 * must itself disclose the session "Always allow" semantics (per the
 * comprehensive audit's UI-07-family finding). The card copy in
 * LocalExecutionPermissionCard.tsx keeps its own disclosure; the
 * non-silent approved path must keep its original output text.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string): string =>
    readFileSync(resolve(__dirname, rel), 'utf8');

const page = read('../../src/app/chat/page.tsx');
const card = read('../../src/app/chat/components/LocalExecutionPermissionCard.tsx');

describe('CU-ST-04 · auto-approve disclosure (silent branch)', () => {
    it('silent branch passes the disclosure flag through respondToLocalExecutionRequest', () => {
        expect(page).toMatch(/if \(localAlwaysAllowedRef\.current\) \{\s*\n\s*\/\/ CU-ST-04[^\n]*\n\s*respondToLocalExecutionRequest\(request, true, true, undefined, true\);/);
    });

    it('tool-call output discloses the active session "Always allow" semantics', () => {
        expect(page).toContain('Auto-approved — "Always allow" is active for this chat until you switch conversations.');
    });

    it('applyToolCallApprovalStatus takes a 6th silent param after command', () => {
        expect(page).toMatch(/applyToolCallApprovalStatus = useCallback\(\(requestId: string, approved: boolean, alwaysAllow: boolean, allowPrefix\?: boolean, command\?: string, silent\?: boolean\)/);
    });

    it('respondToLocalExecutionRequest passes silent through to applyToolCallApprovalStatus', () => {
        expect(page).toMatch(/applyToolCallApprovalStatus\(request\.requestId, approved, alwaysAllow, allowPrefix, request\.command, silent\);/);
    });

    it('LocalExecutionPermissionCard copy still discloses session semantics', () => {
        expect(card).toContain('until you switch conversations');
    });

    it('non-silent approvals keep the original approved output line', () => {
        expect(page).toContain("'Permission approved. Running local command...'");
    });
});
