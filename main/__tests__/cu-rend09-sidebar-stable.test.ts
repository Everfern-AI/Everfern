/**
 * CU-REND-09 — Sidebar memo stability for onSelectConversation / onNewChat.
 *
 * DOM-free source contract: Sidebar is React.memo'd, so every prop passed to
 * it must have stable identity across renders. page.tsx previously passed the
 * plain `handleSelectConversation` / `handleNewChat` functions (re-created
 * every render), defeating the memo during ~20/sec streaming re-renders. The
 * fix wraps them in empty-deps useCallbacks (same pattern as handleToastSelect)
 * that call the plain handlers at click-time, when the late const bindings are
 * safely initialized.
 */
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const page = readFileSync(join(__dirname, '..', '..', 'src', 'app', 'chat', 'page.tsx'), 'utf8');
const sidebar = readFileSync(join(__dirname, '..', '..', 'src', 'app', 'components', 'Sidebar.tsx'), 'utf8');

describe('CU-REND-09 Sidebar stable props', () => {
    it('page passes handleSelectConversationStable to Sidebar', () => {
        expect(page).toContain('onSelectConversation={handleSelectConversationStable}');
    });

    it('page passes handleNewChatStable to Sidebar', () => {
        expect(page).toContain('onNewChat={handleNewChatStable}');
    });

    it('handleSelectConversationStable is an empty-deps useCallback wrapper', () => {
        expect(page).toMatch(/const handleSelectConversationStable = useCallback\(\(id: string\) => \{\s*\n\s*handleSelectConversation\(id\);/);
        expect(page).toMatch(/handleSelectConversationStable[\s\S]{0,200}?}, \[\]\);/);
    });

    it('handleNewChatStable is an empty-deps useCallback wrapper', () => {
        expect(page).toMatch(/const handleNewChatStable = useCallback\(\(\) => \{\s*\n\s*handleNewChat\(\);/);
        expect(page).toMatch(/handleNewChatStable[\s\S]{0,120}?}, \[\]\);/);
    });

    it('page no longer passes the plain handlers to Sidebar', () => {
        expect(page).not.toContain('onSelectConversation={handleSelectConversation}');
        expect(page).not.toContain('onNewChat={handleNewChat}');
    });

    it('Sidebar is React.memo guarded', () => {
        expect(sidebar).toContain('React.memo(Sidebar)');
    });

    it('handleToastSelect regression guard (pattern precedent untouched)', () => {
        expect(page).toContain('const handleToastSelect = useCallback((id: string) => {');
    });
});
