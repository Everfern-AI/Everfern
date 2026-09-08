// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { isEditableTarget } from '../keyboard';

const el = (tagName: string, isContentEditable?: boolean): any => ({
    tagName,
    isContentEditable,
});

describe('isEditableTarget', () => {
    it('returns true for input', () => {
        expect(isEditableTarget(el('input'))).toBe(true);
    });

    it('returns true for textarea', () => {
        expect(isEditableTarget(el('TEXTAREA'))).toBe(true);
    });

    it('returns true for select (case-insensitive tag)', () => {
        expect(isEditableTarget(el('SeLeCt'))).toBe(true);
    });

    it('returns true for lowercase tags (case-insensitive)', () => {
        expect(isEditableTarget(el('input'))).toBe(true);
        expect(isEditableTarget(el('textarea'))).toBe(true);
        expect(isEditableTarget(el('select'))).toBe(true);
    });

    it('returns true for contentEditable elements', () => {
        expect(isEditableTarget({ tagName: 'div', isContentEditable: true } as any)).toBe(true);
    });

    it('returns false for plain div without contentEditable', () => {
        expect(isEditableTarget(el('div', false))).toBe(false);
    });

    it('returns false for non-editable element with isContentEditable falsy', () => {
        expect(isEditableTarget({ tagName: 'span', isContentEditable: false } as any)).toBe(false);
        expect(isEditableTarget({ tagName: 'span', isContentEditable: undefined } as any)).toBe(false);
    });

    it('returns false for null target', () => {
        expect(isEditableTarget(null)).toBe(false);
    });

    it('returns false for target without string tagName', () => {
        expect(isEditableTarget({} as any)).toBe(false);
        expect(isEditableTarget({ tagName: 123 } as any)).toBe(false);
        expect(isEditableTarget({ tagName: undefined } as any)).toBe(false);
    });

    it('returns false for document (window) target', () => {
        // document has no tagName property — should be treated as non-editable
        const fakeDocument = { nodeType: 9 } as any;
        expect(isEditableTarget(fakeDocument)).toBe(false);
    });
});
