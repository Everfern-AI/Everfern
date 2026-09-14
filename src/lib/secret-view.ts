/**
 * MP-SEC-11 — shared SecretView helpers for the renderer.
 *
 * load-config returns secret fields as redacted {configured, last4} views
 * instead of raw strings. These helpers let components guard on and display
 * those views, and stay safe during the transition when a value may still be
 * a raw string (e.g. freshly typed by the user, or a stale legacy config).
 */

export interface SecretView {
    configured: boolean;
    last4?: string;
}

/**
 * True when v is a redacted SecretView object (not a raw string).
 * Strings are handled during the transition via secretDisplay/secretConfigured.
 */
export function isSecretView(v: unknown): v is SecretView {
    return !!v && typeof v === 'object' && 'configured' in (v as Record<string, unknown>);
}

/**
 * Masked display string for a secret field: mask + last4 when configured,
 * '' when not configured/absent. Accepts a raw string during the transition
 * (non-empty string → treated as configured with its own last4) so inputs
 * never render "[object Object]".
 */
export function secretDisplay(v: unknown, mask = '••••'): string {
    if (isSecretView(v)) {
        return v.configured ? (v.last4 ? `${mask}${v.last4}` : mask) : '';
    }
    if (typeof v === 'string' && v.length > 0) {
        return v.length <= 4 ? `${mask}` : `${mask}${v.slice(-4)}`;
    }
    return '';
}

/**
 * Truthy check for "a secret exists in this field", accepting either a
 * SecretView (configured) or a raw string (non-empty) during the transition.
 */
export function secretConfigured(v: unknown): boolean {
    if (isSecretView(v)) return v.configured === true;
    return typeof v === 'string' && v.trim().length > 0;
}
