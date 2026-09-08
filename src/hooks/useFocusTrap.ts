'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Shared focus-trap hook (CU-UI-11 groundwork) extracted from the inline pattern
 * in settings/PrivacySection.tsx and settings/MemorySection.tsx.
 *
 * When `active`: Escape calls onEscape, Tab/Shift+Tab cycles focus among the
 * container's focusable children, body scroll is locked, and the previously
 * focused element is restored on deactivate.
 *
 * Attach the returned callback ref to the modal/dialog container element.
 */
export function useFocusTrap<T extends HTMLElement>(options: {
    active: boolean;
    onEscape?: () => void;
    restoreFocus?: boolean; // default true
}): (node: T | null) => void {
    const { active, onEscape, restoreFocus = true } = options;
    const containerRef = useRef<T | null>(null);
    const previouslyFocusedRef = useRef<HTMLElement | null>(null);
    const [attached, setAttached] = useState(false);

    const refCallback = useCallback((node: T | null) => {
        containerRef.current = node;
        setAttached(node !== null);
    }, []);

    useEffect(() => {
        if (!active || !attached || !containerRef.current) return;

        previouslyFocusedRef.current = document.activeElement as HTMLElement | null;

        const esc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onEscape?.();
        };

        const trap = (e: KeyboardEvent) => {
            if (e.key !== 'Tab' || !containerRef.current) return;
            const focusables = containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
            if (focusables.length === 0) return;
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', esc);
        document.addEventListener('keydown', trap);

        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        return () => {
            document.removeEventListener('keydown', esc);
            document.removeEventListener('keydown', trap);
            document.body.style.overflow = prevOverflow;
            if (restoreFocus) {
                previouslyFocusedRef.current?.focus?.();
            }
        };
    }, [active, attached, onEscape, restoreFocus]);

    return refCallback;
}
