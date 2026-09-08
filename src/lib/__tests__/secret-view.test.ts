// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { isSecretView, secretDisplay, secretConfigured, type SecretView } from '../secret-view';

describe('isSecretView', () => {
    it('returns true for a configured view', () => {
        const v: SecretView = { configured: true, last4: '4242' };
        expect(isSecretView(v)).toBe(true);
    });

    it('returns true for a not-configured view', () => {
        expect(isSecretView({ configured: false })).toBe(true);
    });

    it('returns false for plain strings (transition input)', () => {
        expect(isSecretView('sk-raw-key-123')).toBe(false);
        expect(isSecretView('')).toBe(false);
    });

    it('returns false for null/undefined/numbers/arrays', () => {
        expect(isSecretView(null)).toBe(false);
        expect(isSecretView(undefined)).toBe(false);
        expect(isSecretView(42)).toBe(false);
        expect(isSecretView([])).toBe(false);
    });

    it('returns false for objects without a configured key', () => {
        expect(isSecretView({ last4: '4242' })).toBe(false);
        expect(isSecretView({ configured: 'yes' } as any)).toBe(true); // duck-typed: key presence
    });
});

describe('secretDisplay', () => {
    it('renders mask + last4 for a configured view', () => {
        expect(secretDisplay({ configured: true, last4: '4242' })).toBe('••••4242');
    });

    it('renders bare mask when configured without last4', () => {
        expect(secretDisplay({ configured: true })).toBe('••••');
    });

    it('renders empty string when not configured', () => {
        expect(secretDisplay({ configured: false })).toBe('');
    });

    it('renders empty string for null/undefined', () => {
        expect(secretDisplay(null)).toBe('');
        expect(secretDisplay(undefined)).toBe('');
    });

    it('supports a custom mask', () => {
        expect(secretDisplay({ configured: true, last4: '9999' }, '****')).toBe('****9999');
    });

    it('treats a raw string (transition) as configured with its own last4', () => {
        expect(secretDisplay('sk-abc-1234')).toBe('••••1234');
    });

    it('renders only the mask for a short raw string', () => {
        expect(secretDisplay('abcd')).toBe('••••');
        expect(secretDisplay('abc')).toBe('••••');
    });

    it('renders empty string for an empty raw string', () => {
        expect(secretDisplay('')).toBe('');
    });
});

describe('secretConfigured', () => {
    it('is true for configured views and false otherwise', () => {
        expect(secretConfigured({ configured: true, last4: '1111' })).toBe(true);
        expect(secretConfigured({ configured: false })).toBe(false);
    });

    it('accepts raw strings during the transition (non-empty = configured)', () => {
        expect(secretConfigured('sk-xyz')).toBe(true);
        expect(secretConfigured('  ')).toBe(false);
        expect(secretConfigured('')).toBe(false);
    });

    it('is false for null/undefined/objects', () => {
        expect(secretConfigured(null)).toBe(false);
        expect(secretConfigured(undefined)).toBe(false);
        expect(secretConfigured({} as any)).toBe(false);
    });
});
