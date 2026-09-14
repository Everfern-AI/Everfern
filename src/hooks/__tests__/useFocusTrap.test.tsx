import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useFocusTrap } from '../useFocusTrap';

let container: HTMLDivElement | null = null;
let root: Root | null = null;

const renderTrap = (options: Parameters<typeof useFocusTrap>[0], children?: React.ReactNode) => {
    function Host() {
        const ref = useFocusTrap<HTMLDivElement>(options);
        return (
            <div>
                <button id="outside">Outside</button>
                <div id="trap-container" ref={ref}>
                    {children ?? (
                        <>
                            <button id="first">First</button>
                            <button id="mid">Middle</button>
                            <button id="last">Last</button>
                        </>
                    )}
                </div>
            </div>
        );
    }
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const utils = { rerender: (opts: Parameters<typeof useFocusTrap>[0]) => act(() => { root!.render(<Host {...{ ...opts, __key: Math.random() }} />); }) };
    act(() => {
        root!.render(<Host />);
    });
    return utils;
};

const key = (target: Element, k: string, shift = false) => {
    const ev = new KeyboardEvent('keydown', {
        key: k,
        shiftKey: shift,
        bubbles: true,
        cancelable: true,
    });
    Object.defineProperty(ev, 'target', { value: target });
    target.dispatchEvent(ev);
    return ev;
};

describe('useFocusTrap', () => {
    const getEl = (id: string) => document.getElementById(id) as HTMLElement;
    const getContainer = () => document.getElementById('trap-container') as HTMLDivElement;

    it('returns a ref callback that attaches to a node', () => {
        const { result } = renderHook(() =>
            useFocusTrap<HTMLDivElement>({ active: false })
        );
        expect(typeof result.current).toBe('function');
        const node = document.createElement('div');
        act(() => {
            result.current(node);
        });
        act(() => {
            result.current(null);
        });
    });

    it('calls onEscape when Escape is pressed while active', () => {
        const onEscape = vi.fn();
        renderTrap({ active: true, onEscape });

        act(() => {
            key(getContainer(), 'Escape');
        });
        expect(onEscape).toHaveBeenCalledTimes(1);

        // non-Escape key does not trigger
        act(() => {
            key(getContainer(), 'Enter');
        });
        expect(onEscape).toHaveBeenCalledTimes(1);

        act(() => {
            root!.unmount();
        });
    });

    it('does not call onEscape while inactive', () => {
        const onEscape = vi.fn();
        renderTrap({ active: false, onEscape });

        act(() => {
            key(getContainer(), 'Escape');
        });
        expect(onEscape).not.toHaveBeenCalled();

        act(() => {
            root!.unmount();
        });
    });

    it('traps Tab focus inside container (wraps last -> first)', () => {
        renderTrap({ active: true });

        const last = getEl('last');
        const first = getEl('first');

        act(() => {
            last.focus();
        });
        expect(document.activeElement).toBe(last);

        act(() => {
            const ev = key(last, 'Tab');
            expect(ev.defaultPrevented).toBe(true);
        });
        expect(document.activeElement).toBe(first);

        act(() => {
            root!.unmount();
        });
    });

    it('traps Shift+Tab focus inside container (wraps first -> last)', () => {
        renderTrap({ active: true });

        const last = getEl('last');
        const first = getEl('first');

        act(() => {
            first.focus();
        });
        expect(document.activeElement).toBe(first);

        act(() => {
            const ev = key(first, 'Tab', true);
            expect(ev.defaultPrevented).toBe(true);
        });
        expect(document.activeElement).toBe(last);

        act(() => {
            root!.unmount();
        });
    });

    it('lets Tab pass through when focus is on a middle element', () => {
        renderTrap({ active: true });

        const mid = getEl('mid');
        act(() => {
            mid.focus();
        });

        act(() => {
            const ev = key(mid, 'Tab');
            // not at a boundary -> hook does not intercept
            expect(ev.defaultPrevented).toBe(false);
        });

        act(() => {
            root!.unmount();
        });
    });

    it('locks body scroll while active and restores it on deactivate', () => {
        document.body.style.overflow = 'auto';
        renderTrap({ active: true });

        expect(document.body.style.overflow).toBe('hidden');

        act(() => {
            root!.unmount();
        });

        expect(document.body.style.overflow).toBe('auto');
        document.body.style.overflow = '';
    });

    it('restores focus to previously focused element on deactivate (restoreFocus default)', () => {
        const outside = document.createElement('button');
        outside.id = 'pre-focus';
        document.body.appendChild(outside);
        outside.focus();
        expect(document.activeElement).toBe(outside);

        renderTrap({ active: true });
        const first = getEl('first');

        act(() => {
            first.focus();
        });
        expect(document.activeElement).toBe(first);

        act(() => {
            root!.unmount();
        });
        expect(document.activeElement).toBe(outside);

        outside.remove();
    });

    it('does not restore focus when restoreFocus is false', () => {
        const outside = document.createElement('button');
        outside.id = 'pre-focus-2';
        document.body.appendChild(outside);
        outside.focus();
        expect(document.activeElement).toBe(outside);

        renderTrap({ active: true, restoreFocus: false });
        const first = getEl('first');

        act(() => {
            first.focus();
        });

        act(() => {
            root!.unmount();
        });
        expect(document.activeElement).not.toBe(outside);

        outside.remove();
    });

    it('traps focus with a single focusable child', () => {
        renderTrap(
            { active: true },
            <button id="only">Only</button>
        );

        const only = getEl('only');
        act(() => {
            only.focus();
        });

        // Tab on the only (first === last) element wraps to itself
        act(() => {
            key(only, 'Tab');
        });
        expect(document.activeElement).toBe(only);

        act(() => {
            key(only, 'Tab', true);
        });
        expect(document.activeElement).toBe(only);

        act(() => {
            root!.unmount();
        });
    });
});
