// @vitest-environment jsdom
// DOM-dependent React rendering tests: the gate runner passes
// --environment=node, but these suites require document/window.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
    ToolCallTag,
    LiveToolCallCard,
    __cuRend06MemoHooks as hooks,
    __cuRend06ExtractionStats as extractionStats,
} from '../../src/app/chat/components/ToolCallComponents';
import type { ToolCallDisplay } from '../../src/app/chat/types/index';

// Mock the Loader component to avoid SVG getTotalLength issues in JSDOM
// (same accommodation as ShimmerProgressComponent.test.tsx)
vi.mock('@/components/ui/animated-loading-svg-text-shimmer', () => ({
    Loader: (props: { className?: string }) =>
        React.createElement('div', { 'data-testid': 'loader', className: props.className }, 'Loading...')
}));

const h = React.createElement;

const makeTc = (over: Partial<ToolCallDisplay> = {}): ToolCallDisplay => ({
    id: 'tc-default',
    status: 'running',
    toolName: 'web_search',
    label: 'Search',
    ...over,
});

const tagEl = (onClick: () => void, tc: ToolCallDisplay) =>
    h(ToolCallTag, { tc, isLast: false, isSelected: false, onClick });

beforeEach(() => {
    extractionStats.calls = 0;
});

describe('CU-REND-06: React.memo comparators (white-box)', () => {
    it('areToolCallDisplaysEqual: reference fast-path', () => {
        const tc = makeTc();
        expect(hooks.areToolCallDisplaysEqual(tc, tc)).toBe(true);
    });

    it('areToolCallDisplaysEqual: distinct refs, same stable id, equal primitives => true', () => {
        const a = makeTc({ id: 'stable-1', output: 'out', durationMs: 120 });
        const b = makeTc({ id: 'stable-1', output: 'out', durationMs: 120 });
        expect(hooks.areToolCallDisplaysEqual(a, b)).toBe(true);
    });

    it('areToolCallDisplaysEqual: same id, changed primitive => false', () => {
        const a = makeTc({ id: 'stable-1', output: 'out' });
        const b = makeTc({ id: 'stable-1', output: 'out-v2' });
        expect(hooks.areToolCallDisplaysEqual(a, b)).toBe(false);
    });

    it('areToolCallDisplaysEqual: different stable id => false', () => {
        const a = makeTc({ id: 'a' });
        const b = makeTc({ id: 'b' });
        expect(hooks.areToolCallDisplaysEqual(a, b)).toBe(false);
    });

    it('pill comparator gates on primitives + fn identity alongside tc equality', () => {
        const tc = makeTc({ id: 'p1' });
        const fnA = () => {};
        const fnB = () => {};
        const base = { tc, isLast: false, isSelected: false, onClick: fnA };
        expect(hooks.toolCallPillPropsAreEqual(base, { ...base })).toBe(true);
        expect(hooks.toolCallPillPropsAreEqual(base, { ...base, onClick: fnB })).toBe(false);
        expect(hooks.toolCallPillPropsAreEqual(base, { ...base, isSelected: true })).toBe(false);
    });

    it('memo wrappers carry the expected comparator wiring', () => {
        const MEMO = Symbol.for('react.memo');
        expect((ToolCallTag as any).$$typeof).toBe(MEMO);
        expect((ToolCallTag as any).compare).toBe(hooks.toolCallPillPropsAreEqual);
        expect((LiveToolCallCard as any).$$typeof).toBe(MEMO);
        // React stores `null` for memo()'s default shallow comparator; assert
        // "no custom comparator" (null or undefined) to pin that semantic.
        expect((LiveToolCallCard as any).compare == null).toBe(true);
    });
});

describe('CU-REND-06: ToolCallTag behavioral memoization', () => {
    it('same-object rerender with changed onClick => fresh handler takes over (no stale memo trap)', () => {
        const spyA = vi.fn();
        const spyB = vi.fn();
        const tc = makeTc({ id: 'tag-1' });
        const view = render(tagEl(spyA, tc));

        fireEvent.click(screen.getByRole('button'));
        expect(spyA).toHaveBeenCalledTimes(1);
        expect(spyB).not.toHaveBeenCalled();

        view.rerender(tagEl(spyB, tc));
        fireEvent.click(screen.getByRole('button'));
        expect(spyA).toHaveBeenCalledTimes(1);
        expect(spyB).toHaveBeenCalledTimes(1);
    });

    it('stable-id change => fn recalled (fresh handler takes over)', () => {
        const spyA = vi.fn();
        const spyB = vi.fn();
        const view = render(tagEl(spyA, makeTc({ id: 'call-a' })));

        fireEvent.click(screen.getByRole('button'));
        expect(spyA).toHaveBeenCalledTimes(1);

        view.rerender(tagEl(spyB, makeTc({ id: 'call-b' })));
        fireEvent.click(screen.getByRole('button'));
        expect(spyA).toHaveBeenCalledTimes(1);
        expect(spyB).toHaveBeenCalledTimes(1);
    });

    it('same id + changed primitive => fn recalled (no over-blocking)', () => {
        const spyA = vi.fn();
        const spyC = vi.fn();
        const tcFirst = makeTc({ id: 'keep-id', output: undefined });
        const view = render(tagEl(spyA, tcFirst));

        view.rerender(tagEl(spyC, { ...tcFirst, output: 'streamed-output' }));
        fireEvent.click(screen.getByRole('button'));
        expect(spyC).toHaveBeenCalledTimes(1);
        expect(spyA).not.toHaveBeenCalled();
    });
});

describe('CU-REND-06: LiveToolCallCard partial-JSON extraction memo', () => {
    it('extraction runs exactly once per raw string across re-renders', () => {
        const raw = '{"TargetFile":"/proj/src/App.tsx","CodeContent":"const a = 1;';
        const props = (isStreaming: boolean) => ({
            index: 0,
            toolName: 'write_to_file',
            partialArguments: raw,
            isStreaming,
        });

        const view = render(h(LiveToolCallCard, props(true)));
        expect(extractionStats.calls).toBe(1);
        expect(screen.getByText('App.tsx')).toBeInTheDocument();

        view.rerender(h(LiveToolCallCard, props(false)));
        expect(screen.getByText('Ready')).toBeInTheDocument();
        expect(extractionStats.calls).toBe(1);

        view.rerender(
            h(LiveToolCallCard, { ...props(false), partialArguments: '{"TargetFile":"/proj/src/Other.tsx"}' })
        );
        expect(extractionStats.calls).toBe(2);
    });
});
