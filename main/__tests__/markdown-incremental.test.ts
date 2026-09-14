// @vitest-environment jsdom
// DOM-dependent React rendering tests: the gate runner passes
// --environment=node, but these suites require document/window.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('@/app/chat/ArtifactsPanel', () => ({
  SyntaxHighlighter: ({ code }: { code: string }) =>
    React.createElement('pre', { 'data-testid': 'syntax-highlighter' }, code),
}));
vi.mock('@openuidev/react-lang', () => ({
  Renderer: () => React.createElement('div', { 'data-testid': 'openui-renderer' }),
}));
vi.mock('@/lib/openui-library', () => ({ uiLibrary: {} }));
vi.mock('framer-motion', () => ({
  motion: new Proxy(() => null, { get: (t, p) => (p === Symbol.toPrimitive ? undefined : (props: any) => React.createElement('span', props)) }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
}));

import {
  MarkdownRenderer,
  StreamingMarkdown,
  InlineLink,
  splitBlocks,
  fnv1a,
  hashBlock,
  renderBlocks,
  getBlockCacheStats,
  resetBlockCache,
  BLOCK_CACHE_CAP,
  isTableSeparatorLine,
} from '../../src/app/chat/components/MarkdownComponents';

const h = React.createElement;

const nodeText = (node: React.ReactNode): string => {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  const el = node as React.ReactElement;
  if (el && el.props) return nodeText(el.props.children);
  return '';
};

const findAll = (node: React.ReactNode, predicate: (el: React.ReactElement) => boolean, acc: React.ReactElement[] = []): React.ReactElement[] => {
  if (!node || typeof node === 'string' || typeof node === 'boolean' || typeof node === 'number') return acc;
  if (Array.isArray(node)) { node.forEach(n => findAll(n, predicate, acc)); return acc; }
  const el = node as React.ReactElement;
  if (predicate(el)) acc.push(el);
  if (el.props && el.props.children) findAll(el.props.children, predicate, acc);
  return acc;
};

const countCursors = (nodes: React.ReactNode[]): number =>
  findAll(nodes, el => el.props && (el.props as Record<string, unknown>)['data-testid'] === 'streaming-cursor').length;

beforeEach(() => {
  resetBlockCache();
});

// ── fnv1a / hashBlock ─────────────────────────────────────────────────────────
describe('fnv1a / hashBlock', () => {
  it('hashes empty string to the FNV offset basis', () => {
    expect(fnv1a('')).toBe('811c9dc5');
  });

  it('matches the known FNV-1a vector for "a"', () => {
    expect(fnv1a('a')).toBe('e40c292c');
  });

  it('returns 8-char zero-padded lowercase hex', () => {
    const out = fnv1a('hello world');
    expect(out).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is deterministic and exported twice as same fn', () => {
    expect(fnv1a('abc')).toBe(fnv1a('abc'));
    expect(hashBlock).toBe(fnv1a);
  });
});

// ── splitBlocks: fence transitions + open tail ───────────────────────────────
describe('splitBlocks', () => {
  it('splits paragraphs on blank lines into closed blocks', () => {
    const r = splitBlocks('para one\n\npara two\n\n');
    expect(r.closed).toEqual(['para one', 'para two']);
    expect(r.tail).toBeNull();
  });

  it('does NOT split on blank lines inside an open fence', () => {
    const r = splitBlocks('```js\ncode one\n\ncode two\n```\nafter\n\n');
    expect(r.closed).toEqual(['```js\ncode one\n\ncode two\n```', 'after']);
    expect(r.tail).toBeNull();
  });

  it('unterminated fence consumes the rest as the open tail', () => {
    const r = splitBlocks('intro\n\n```python\nprint("hi")\n');
    expect(r.closed).toEqual(['intro']);
    expect(r.tail).toBe('```python\nprint("hi")');
  });

  it('a closed fence followed by a final unterminated paragraph is the open tail', () => {
    const r = splitBlocks('# Title\n\nbody text streaming');
    expect(r.closed).toEqual(['# Title']);
    expect(r.tail).toBe('body text streaming');
  });

  it('empty content produces no blocks and no tail', () => {
    expect(splitBlocks('')).toEqual({ closed: [], tail: null });
  });

  it('a closed fence is flushed as its own closed block even without a trailing blank line', () => {
    const r = splitBlocks('```\ncode\n```\nnext para');
    expect(r.closed[0]).toBe('```\ncode\n```');
    expect(r.tail).toBe('next para');
  });
});

// ── Incremental rendering: cache by hash#occurrence, reuse BY REFERENCE ──────
describe('renderBlocks incremental cache', () => {
  it('closed blocks are reused by reference on re-render with appended content', () => {
    const base = 'first para\n\nsecond para\n\n';
    const first = renderBlocks(base);
    const stats1 = getBlockCacheStats();
    const second = renderBlocks(base + 'tail streaming');
    const stats2 = getBlockCacheStats();
    // The two previously closed blocks were cache hits.
    expect(stats2.hits).toBe(stats1.hits + 2);
    // Same element references are returned (no re-parse).
    expect(second[0]).toBe(first[0]);
    expect(second[1]).toBe(first[1]);
  });

  it('the open tail is re-parsed (not cached) as content grows', () => {
    const s1 = getBlockCacheStats();
    renderBlocks('done block\n\nstream');
    const s2 = getBlockCacheStats();
    renderBlocks('done block\n\nstreaming more');
    const s3 = getBlockCacheStats();
    // Each render parses exactly one open tail.
    expect(s2.tailParses).toBe(s1.tailParses + 1);
    expect(s3.tailParses).toBe(s2.tailParses + 1);
    expect(s3.hits).toBe(1); // second render hits the cached closed block
    expect(s3.misses).toBe(1); // only the first render parsed the closed block
  });

  it('keys closed blocks as hash#occurrence (duplicates get #1 and #2)', () => {
    const nodes = renderBlocks('same text\n\nsame text\n\n');
    expect(nodes[0].key).toBe(`${hashBlock('same text')}#1`);
    expect(nodes[1].key).toBe(`${hashBlock('same text')}#2`);
  });

  it('duplicate blocks occupy distinct occurrence-keyed cache entries', () => {
    renderBlocks('dup\n\ndup\n\n');
    const stats = getBlockCacheStats();
    // 'hash#1' and 'hash#2' are separate keys → two misses, two entries.
    expect(stats.misses).toBe(2);
    expect(stats.size).toBe(2);
    // Re-render: both occurrence keys hit; nothing new is parsed.
    renderBlocks('dup\n\ndup\n\n');
    const after = getBlockCacheStats();
    expect(after.hits).toBe(2);
    expect(after.misses).toBe(2);
    expect(after.size).toBe(2);
  });

  it('fence transition: open fence parses as tail, closed fence becomes a cached block', () => {
    const r1 = renderBlocks('before\n\n```js\nconsole.log(1)');
    const openStats = getBlockCacheStats();
    expect(openStats.misses).toBe(1); // only 'before' cached; the open fence is the tail, not a miss
    expect(openStats.tailParses).toBe(1);
    expect(r1.length).toBe(2); // closed 'before' + open-fence tail

    renderBlocks('before\n\n```js\nconsole.log(1)\n```\n\ndone\n\n');
    const after = getBlockCacheStats();
    expect(after.misses).toBe(3); // before + code block + done
    expect(after.hits).toBe(1); // 'before' was re-used from cache
    expect(after.tailParses).toBe(1); // fully closed content has no tail to parse
  });

  it('LRU evicts after 400 entries and stays capped at 400 (405 inserted → 5 evictions)', () => {
    let content = '';
    for (let i = 0; i < 405; i++) content += `block number ${i} unique\n\n`;
    renderBlocks(content);
    const stats = getBlockCacheStats();
    expect(BLOCK_CACHE_CAP).toBe(400);
    expect(stats.size).toBe(400);
    expect(stats.evictions).toBe(5);
  });

  it('LRU holds exactly 400 unique blocks with zero evictions at the cap', () => {
    let content = '';
    for (let i = 0; i < 400; i++) content += `cap block ${i} unique\n\n`;
    renderBlocks(content);
    const stats = getBlockCacheStats();
    expect(stats.size).toBe(400);
    expect(stats.evictions).toBe(0);
    expect(stats.misses).toBe(400);
  });

  it('LRU recency refresh protects re-touched blocks from eviction', () => {
    for (let i = 0; i < 400; i++) renderBlocks(`item ${i}\n\n`);
    // Touch block 0 again to make it most-recent.
    renderBlocks('item 0\n\n');
    for (let i = 400; i < 405; i++) renderBlocks(`item ${i}\n\n`);
    // item 0 must still be a hit (its entry was refreshed, not evicted).
    const before = getBlockCacheStats().hits;
    const nodes = renderBlocks('item 0\n\n');
    const after = getBlockCacheStats();
    expect(after.hits).toBe(before + 1);
    expect(nodes.length).toBe(1);
  });

  it('resetBlockCache clears the cache and all counters', () => {
    renderBlocks('x\n\ny streaming tail');
    expect(getBlockCacheStats().size).toBeGreaterThan(0);
    resetBlockCache();
    const s = getBlockCacheStats();
    expect(s).toEqual({ size: 0, capacity: 400, hits: 0, misses: 0, evictions: 0, tailParses: 0 });
  });

  it('incremental spy: appended streaming chunks never re-parse closed blocks (reference identity)', () => {
    let content = 'p1\n\np2\n\n';
    const r1 = renderBlocks(content);
    expect(r1.length).toBe(2); // both closed, no tail
    const ref1 = r1[0];
    const ref2 = r1[1];

    // Chunk 1 lands in the open tail.
    content += 'streaming tail';
    const r2 = renderBlocks(content, { isLive: true });
    expect(r2[0]).toBe(ref1);
    expect(r2[1]).toBe(ref2);
    expect(getBlockCacheStats().hits).toBe(2);
    expect(countCursors(r2)).toBe(1);

    // Chunk 2 closes the old tail and opens a new paragraph.
    content += ' more\n\np3\n\nfinal tail';
    const r3 = renderBlocks(content, { isLive: true });
    // closed = [p1, p2, 'streaming tail more', p3] + tail
    expect(r3.length).toBe(5);
    expect(r3[0]).toBe(ref1);
    expect(r3[1]).toBe(ref2);
    expect(r3[3].key).toBe(`${hashBlock('p3')}#1`);
    const ref3 = r3[2];
    const ref4 = r3[3];
    expect(getBlockCacheStats().hits).toBe(4);

    // Chunk 3 extends only the tail.
    content += ' continues';
    const r4 = renderBlocks(content, { isLive: true });
    expect(r4[0]).toBe(ref1);
    expect(r4[1]).toBe(ref2);
    expect(r4[2]).toBe(ref3);
    expect(r4[3]).toBe(ref4);
    expect(getBlockCacheStats().hits).toBe(8); // all 4 closed blocks hit
    expect(countCursors(r4)).toBe(1);
  });
});

// ── Streaming cursor (CU-STRM-01 #4) ─────────────────────────────────────────
describe('streaming cursor', () => {
  it('attaches exactly one cursor inside the open-tail paragraph when live', () => {
    render(h(StreamingMarkdown, { content: 'done para\n\nstreaming wor', isLive: true }));
    const cursors = screen.getAllByTestId('streaming-cursor');
    expect(cursors.length).toBe(1);
  });

  it('does NOT render a cursor when isLive is false', () => {
    render(h(StreamingMarkdown, { content: 'all done', isLive: false, isLatest: true }));
    expect(screen.queryByTestId('streaming-cursor')).toBeNull();
  });

  it('cursor is gated by showCursor=false even when live', () => {
    const off = renderBlocks('open tail para', { isLive: true, showCursor: false });
    expect(countCursors(off)).toBe(0);
    expect(nodeText(off)).toContain('open tail para');
    const on = renderBlocks('open tail para', { isLive: true, showCursor: true });
    expect(countCursors(on)).toBe(1);
  });

  it('cursor attaches to an open-tail heading as well as paragraphs', () => {
    const nodes = renderBlocks('## Partial Head', { isLive: true });
    expect(countCursors(nodes)).toBe(1);
    const heading = findAll(nodes, el => el.type === 'h2');
    expect(heading.length).toBe(1);
  });

  it('closed blocks never contain a cursor (cursor only in open tail, ≤1 per message)', () => {
    render(h(StreamingMarkdown, { content: 'closed one\n\nclosed two\n\nopen tail', isLive: true }));
    const cursors = screen.getAllByTestId('streaming-cursor');
    expect(cursors.length).toBe(1);
    const paras = screen.getAllByText('closed one');
    expect(paras.length).toBeGreaterThan(0);
  });

  it('an unterminated fence tail renders without a cursor crash and keeps fence content', () => {
    render(h(StreamingMarkdown, { content: 'intro\n\n```js\nconst x = ', isLive: true }));
    expect(screen.queryByTestId('streaming-cursor')).toBeNull();
    expect(screen.getByTestId('syntax-highlighter')).toBeInTheDocument();
  });
});

// ── Strict table separator (CU-STRM-01 #6) ───────────────────────────────────
describe('strict table separator', () => {
  it('accepts a standard separator row', () => {
    expect(isTableSeparatorLine('| --- | --- |')).toBe(true);
    expect(isTableSeparatorLine('|:---|---:|')).toBe(true);
    expect(isTableSeparatorLine('--- | ---')).toBe(true);
  });

  it('renders a table from header + strict separator + rows', () => {
    render(h(MarkdownRenderer, { content: 'A | B\n| --- | --- |\nx | y\n' }));
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('y')).toBeInTheDocument();
  });

  it('rejects a dash line with no trailing pipe (not a table)', () => {
    render(h(MarkdownRenderer, { content: 'A | B\n- - -\nx | y\n' }));
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('rejects a short dash run (<3) as separator', () => {
    expect(isTableSeparatorLine('| -- | -- |')).toBe(false);
  });
});

// ── Nested lists (depth-stack) ───────────────────────────────────────────────
describe('nested lists', () => {
  it('builds a 3-level nested ul tree inside li elements', () => {
    const md = '- a\n  - b\n    - c\n- d\n';
    render(h(MarkdownRenderer, { content: md + '\n' }));
    const uls = document.querySelectorAll('ul');
    // top-level ul + two nested uls
    expect(uls.length).toBeGreaterThanOrEqual(3);
    const deepestLi = Array.from(document.querySelectorAll('li')).find(li => li.textContent === 'c');
    expect(deepestLi).toBeTruthy();
    expect(deepestLi!.closest('ul')!.parentElement!.closest('li')).not.toBeNull();
  });

  it('renders ordered lists with the depth stack', () => {
    render(h(MarkdownRenderer, { content: '1. one\n2. two\n\n' }));
    expect(document.querySelectorAll('ol li').length).toBe(2);
  });
});

// ── Inline rendering parity ──────────────────────────────────────────────────
describe('inline parity', () => {
  it('bold renders <strong>', () => {
    render(h(MarkdownRenderer, { content: 'this is **bold** text\n' }));
    expect(screen.getByText('bold').tagName).toBe('STRONG');
  });

  it('italic renders <em>', () => {
    render(h(MarkdownRenderer, { content: 'an *italic* word\n' }));
    expect(screen.getByText('italic').tagName).toBe('EM');
  });

  it('inline code renders <code>', () => {
    render(h(MarkdownRenderer, { content: 'use `npm run` here\n' }));
    expect(screen.getByText('npm run').tagName).toBe('CODE');
  });

  it('markdown links render InlineLink anchors with label', () => {
    render(h(MarkdownRenderer, { content: 'go to [Example](https://example.com) now\n' }));
    expect(screen.getByText('Example')).toBeInTheDocument();
  });

  it('bare URLs render as InlineLink with the URL as label', () => {
    render(h(MarkdownRenderer, { content: 'see https://example.com/docs now\n' }));
    expect(screen.getByText('https://example.com/docs')).toBeInTheDocument();
  });

  it('computer:// links are stripped from output', () => {
    render(h(MarkdownRenderer, { content: 'open [file](computer:///tmp/x.txt) please\n' }));
    expect(screen.queryByText('file')).toBeNull();
  });

  it('StreamingMarkdown with isLive=false has inline parity with MarkdownRenderer', () => {
    const content = '# Title\n\npara with **bold** and `code`\n\n- item one\n- item two\n\n';
    const { unmount: u1 } = render(h(MarkdownRenderer, { content }));
    const a = screen.getByRole('heading', { level: 1 }).parentElement!.innerHTML;
    u1();
    const { unmount: u2 } = render(h(StreamingMarkdown, { content, isLive: false }));
    const b = screen.getByRole('heading', { level: 1 }).parentElement!.innerHTML;
    u2();
    expect(a).toBe(b);
  });
});

// ── Exported components render ───────────────────────────────────────────────
describe('component exports', () => {
  it('MarkdownRenderer renders headings, paragraphs and code blocks', () => {
    render(h(MarkdownRenderer, { content: '# Title\n\nbody\n\n```ts\nlet x = 1\n```\n\n' }));
    expect(screen.getByText('body')).toBeInTheDocument();
    expect(screen.getByTestId('syntax-highlighter')).toHaveTextContent('let x = 1');
  });

  it('StreamingMarkdown renders full content and gates cursor on isLive', () => {
    render(h(StreamingMarkdown, { content: 'final content\n', isLive: true }));
    expect(screen.getByText('final content')).toBeInTheDocument();
  });

  it('InlineLink renders its label and opens a popup on click', () => {
    render(h(InlineLink, { href: 'https://example.com', label: 'click me' }));
    expect(screen.getByText('click me')).toBeInTheDocument();
  });
});
