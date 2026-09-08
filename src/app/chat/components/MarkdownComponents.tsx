'use client';
import React, { memo, useState, Fragment, cloneElement, isValidElement } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SyntaxHighlighter } from '../ArtifactsPanel';
import { Renderer } from '@openuidev/react-lang';
import { uiLibrary } from '@/lib/openui-library';
import { useFocusTrap } from '@/hooks/useFocusTrap';

// ── Link Confirmation Popup ───────────────────────────────────────────────────
const LinkPopup = ({ url, label, onClose }: { url: string; label: string; onClose: () => void }) => {
    const openInBrowser = () => {
        const api = (window as any).electronAPI;
        // Electron: shell.openExternal routes to the system browser instead
        // of spawning a window we don't control; the web fallback hardens
        // window.open with noopener,noreferrer (no reverse tab-nabbing).
        if (api?.system?.openExternal) {
            api.system.openExternal(url);
        } else {
            window.open(url, '_blank', 'noopener,noreferrer');
        }
        onClose();
    };

    // CU-UI-11: dialog semantics + Esc/Tab trap + focus restore via shared hook.
    const popupRef = useFocusTrap<HTMLDivElement>({ active: true, onEscape: onClose });

    return (
        <AnimatePresence>
            <div
                style={{
                    position: 'fixed', inset: 0, zIndex: 'var(--z-modal)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    backgroundColor: 'var(--color-bg-overlay)',
                }}
                onClick={onClose}
            >
                <motion.div
                    ref={popupRef}
                    role="dialog"
                    aria-modal="true"
                    aria-label={`Open link: ${label}`}
                    initial={{ opacity: 0, scale: 0.95, y: 8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 8 }}
                    transition={{ duration: 0.15 }}
                    onClick={e => e.stopPropagation()}
                    style={{
                        backgroundColor: 'var(--color-bg-surface)',
                        borderRadius: 16,
                        padding: '24px 24px 20px',
                        width: 360,
                        border: '1px solid var(--color-border)',
                    }}
                >
                    {/* Icon */}
                    <div style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: 'var(--color-info-dim)', border: '1px solid var(--color-info-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-info)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                            <polyline points="15 3 21 3 21 9" />
                            <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                    </div>

                    {/* Title */}
                    <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 6, fontFamily: "'Matter', system-ui, sans-serif" }}>
                        This link takes you to an external site
                    </div>

                    {/* Label */}
                    {label && label !== url && (
                        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 4, fontFamily: "'Matter', system-ui, sans-serif" }}>
                            {label}
                        </div>
                    )}

                    {/* URL */}
                    <div style={{
                        fontSize: 12, color: 'var(--color-text-tertiary)', backgroundColor: 'var(--color-bg-base)',
                        border: '1px solid var(--color-border)', borderRadius: 8,
                        padding: '8px 12px', marginBottom: 20,
                        wordBreak: 'break-all', fontFamily: "'JetBrains Mono', monospace",
                    }}>
                        {url}
                    </div>

                    {/* Buttons */}
                    <div style={{ display: 'flex', gap: 10 }}>
                        <button
                            onClick={onClose}
                            style={{
                                flex: 1, padding: '10px 0', borderRadius: 10,
                                border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-surface)',
                                color: 'var(--color-text-secondary)', fontSize: 14, fontWeight: 500,
                                cursor: 'pointer', fontFamily: "'Matter', system-ui, sans-serif",
                                transition: 'background 0.15s',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--color-bg-subtle)'; }}
                            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'var(--color-bg-surface)'; }}
                        >
                            Close
                        </button>
                        <button
                            onClick={openInBrowser}
                            style={{
                                flex: 1, padding: '10px 0', borderRadius: 10,
                                border: 'none', backgroundColor: 'var(--color-info)',
                                color: 'var(--color-text-inverse)', fontSize: 14, fontWeight: 600,
                                cursor: 'pointer', fontFamily: "'Matter', system-ui, sans-serif",
                                transition: 'background 0.15s, opacity 0.15s',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.opacity = '0.9'; }}
                            onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
                        >
                            Open in Browser
                        </button>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
};

// ── Inline Link Component ─────────────────────────────────────────────────────
const InlineLink = ({ href, label }: { href: string, label: string }) => {
    const [showPopup, setShowPopup] = useState(false);

    return (
        <>
            <span
                role="link"
                tabIndex={0}
                aria-label={`${label} (opens confirmation dialog)`}
                onClick={e => { e.preventDefault(); e.stopPropagation(); setShowPopup(true); }}
                onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault(); e.stopPropagation(); setShowPopup(true);
                    }
                }}
                style={{
                    color: 'var(--color-accent)',
                    textDecoration: 'underline',
                    textDecorationColor: 'var(--color-accent-dim)',
                    textUnderlineOffset: 2,
                    cursor: 'pointer',
                    fontWeight: 'inherit',
                    transition: 'color 0.1s',
                }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-accent-hover)'; }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-accent)'; }}
            >
                {label}
            </span>
            {showPopup && <LinkPopup url={href} label={label} onClose={() => setShowPopup(false)} />}
        </>
    );
};

// ── CU-STRM-01: Block Splitting ───────────────────────────────────────────────
/**
 * Split markdown content into closed blocks + one open tail.
 *
 * A block is "closed" when it is terminated by a blank line (\n\n) or is a
 * complete code fence. Blank lines inside an open fence do NOT split. An
 * unterminated fence consumes the rest of the content as the tail. The final
 * paragraph without a trailing blank line is the open tail.
 *
 * @param content Raw markdown; may end mid-fence or mid-paragraph while
 *   a message is streaming in.
 * @returns SplitResult containing every immutable ("closed") block plus the
 *   single open tail (null when content ends exactly on a block boundary).
 */
interface SplitResult { closed: string[]; tail: string | null; }

const splitBlocks = (content: string): SplitResult => {
    const closed: string[] = [];
    let tail: string | null = null;
    if (!content) return { closed, tail };

    const lines = content.split('\n');
    // A trailing '\n' yields a final '' element that is a split artifact, not
    // real content: it never closes a block (the boundary is a blank LINE,
    // i.e. '\n\n') and never enters an open fence.
    if (lines[lines.length - 1] === '') lines.pop();
    let current: string[] = [];
    let inFence = false;

    const flushClosed = () => {
        if (current.length > 0) {
            closed.push(current.join('\n'));
            current = [];
        }
    };

    for (const line of lines) {
        // Fence state machine: inside an open ``` fence, blank lines are
        // literal code content, NOT block boundaries — only a closing ```
        // line ends the block (and flushes it as closed).
        if (inFence) {
            current.push(line);
            if (line.trim().startsWith('```')) {
                inFence = false;
                flushClosed();
            }
            continue;
        }
        if (line.trim() === '') { flushClosed(); continue; }
        // A fence only opens at the START of a block: a ``` appearing
        // mid-paragraph is treated as literal text, not a fence marker.
        if (current.length === 0 && line.trim().startsWith('```')) {
            inFence = true;
            current.push(line);
            continue;
        }
        current.push(line);
    }

    // Unterminated fence or trailing paragraph: the remainder is the open tail.
    tail = current.length > 0 ? current.join('\n') : null;

    return { closed, tail };
};

// ── CU-STRM-01: fnv1a hashing + block LRU cache ──────────────────────────────
/**
 * 32-bit FNV-1a hash, returned as zero-padded lowercase hex.
 *
 * Purpose: a cheap, deterministic identity for arbitrarily long markdown
 * blocks. An 8-char digest is faster to compare and cheaper to key on than
 * full block text, and the same block always hashes identically across
 * renders, messages, and sessions.
 *
 * @param s Input string of any length.
 * @returns 8-char zero-padded lowercase hex digest.
 */
const fnv1a = (s: string): string => {
    let h = 0x811c9dc5;
    // Math.imul: 32-bit integer multiply with no float precision loss;
    // >>> 0 coerces the accumulator back to unsigned 32-bit each round.
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return (h >>> 0).toString(16).padStart(8, '0');
};
/** Alias of fnv1a, named for its role in block-cache key derivation. */
const hashBlock = fnv1a;

// Module-level LRU shared across ALL messages in the session. The cap bounds
// memory by limiting retained rendered subtrees to 400 blocks, and the Map's
// insertion order doubles as the LRU's recency order (newest = last entry).
const BLOCK_CACHE_CAP = 400;
const blockCache = new Map<string, React.ReactNode>();
let cacheHits = 0, cacheMisses = 0, cacheEvictions = 0, tailParses = 0;

interface BlockCacheStats { size: number; capacity: number; hits: number; misses: number; evictions: number; tailParses: number; }

/** Snapshot of LRU counters; exposed (via getBlockCacheStats) for tests/debugging. */
const getBlockCacheStats = (): BlockCacheStats => ({
    size: blockCache.size,
    capacity: BLOCK_CACHE_CAP,
    hits: cacheHits,
    misses: cacheMisses,
    evictions: cacheEvictions,
    tailParses,
});

/** Test hook: clears the block cache and resets all LRU counters. */
const resetBlockCache = () => {
    blockCache.clear();
    cacheHits = 0; cacheMisses = 0; cacheEvictions = 0; tailParses = 0;
};

const cacheGet = (key: string): React.ReactNode | undefined => {
    if (!blockCache.has(key)) return undefined;
    const node = blockCache.get(key)!;
    // LRU touch: delete+re-insert moves the key to the "newest" end of the
    // Map so the next eviction sweep spares recently used blocks.
    blockCache.delete(key);
    blockCache.set(key, node); // recency refresh
    cacheHits++;
    return node;
};

const cacheSet = (key: string, node: React.ReactNode) => {
    if (blockCache.has(key)) blockCache.delete(key);
    blockCache.set(key, node);
    // Evict from the front (oldest entry in insertion order) until within
    // the 400-block cap — this is the entire LRU eviction policy.
    while (blockCache.size > BLOCK_CACHE_CAP) {
        const oldest = blockCache.keys().next().value as string;
        blockCache.delete(oldest);
        cacheEvictions++;
    }
};

// ── Inline Renderer (parity-preserved) ────────────────────────────────────────
/**
 * Tokenize a text string against inline patterns (links, bold, italic, code)
 * and render each earliest match left-to-right; unmatched text passes
 * through verbatim. Patterns that produce null (computer:// links) are
 * stripped entirely.
 */
const renderInline = (text: string, parentKey: string | number): React.ReactNode => {
    const parts: React.ReactNode[] = [];
    let remaining = text;
    let idx = 0;
    const patterns: [RegExp, (m: RegExpMatchArray, k: string) => React.ReactNode | null][] = [
        // Strip computer:// links (handled by ReportLink/ReportPane)
        [/\[([^\]]*)\]\(computer:\/\/\/[^)]+\)/, () => null],
        // Markdown links — render as blue clickable with popup
        [/\[([^\]]+)\]\(((?:https?|file):\/\/[^)]+)\)/, (m, k) => <InlineLink key={k} href={m[2]} label={m[1]} />],
        // Bare URLs
        [/(?:https?|file):\/\/[^\s"'<>)\]]+/, (m, k) => <InlineLink key={k} href={m[0]} label={m[0]} />],
        [/\*\*(.+?)\*\*/, (m, k) => <strong key={k} style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>{renderInline(m[1], k)}</strong>],
        [/\*([^*]+)\*/, (m, k) => <em key={k} style={{ color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>{renderInline(m[1], k)}</em>],
        [/`([^`]+)`/, (m, k) => <code key={k} style={{ backgroundColor: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', borderRadius: 4, padding: '2px 6px', fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: 13, color: 'var(--color-text-primary)' }}>{m[1]}</code>],
    ];
    while (remaining.length > 0) {
        let earliest = -1, bestMatch: RegExpMatchArray | null = null, bestRenderer: ((m: RegExpMatchArray, k: string) => React.ReactNode) | null = null;
        for (const [regex, renderer] of patterns) {
            const match = remaining.match(regex);
            if (match && match.index !== undefined) {
                if (earliest === -1 || match.index < earliest) {
                    earliest = match.index; bestMatch = match; bestRenderer = renderer;
                }
            }
        }
        if (!bestMatch || bestRenderer === null) { parts.push(remaining); break; }
        if (earliest > 0) parts.push(remaining.slice(0, earliest));
        const rendered = bestRenderer(bestMatch, `inline-${parentKey}-${idx++}`);
        if (rendered !== null) parts.push(rendered);
        remaining = remaining.slice(earliest + bestMatch[0].length);
    }
    return <Fragment key={parentKey}>{parts}</Fragment>;
};

// ── Strict table separator (CU-STRM-01 #6) ───────────────────────────────────
const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{3,}[:?\s|]*\|/;
/** Strict pipe-table gate: true only for real separator rows (e.g. |---|---|). */
const isTableSeparatorLine = (line: string): boolean => TABLE_SEPARATOR_RE.test(line);

// ── Nested list tree (depth-stack) ───────────────────────────────────────────
interface ListItemNode { text: string; children: ListTree | null; }
interface ListTree { type: 'ul' | 'ol'; items: ListItemNode[]; }

const LIST_ITEM_RE = /^(\s*)([-*]|\d+\.)\s+(.*)$/;

/**
 * Build nested list structure from flat list lines using an indent stack:
 * indent >= parent+2 opens a child level, shallower pops back up. Type
 * switches (ul→ol) at the same depth start a sibling top-level list.
 */
const buildListTree = (lines: string[]): ListTree[] => {
    const trees: ListTree[] = [];
    const stack: { indent: number; tree: ListTree }[] = [];

    for (const rawLine of lines) {
        const m = rawLine.match(LIST_ITEM_RE);
        if (!m) continue;
        const indent = rawLine.replace(/\t/g, '  ').length - rawLine.replace(/^\s+/, '').length;
        const type: 'ul' | 'ol' = /^\d+\./.test(m[2]) ? 'ol' : 'ul';

        if (stack.length === 0) {
            const level: ListTree = { type, items: [{ text: m[3], children: null }] };
            trees.push(level);
            stack.push({ indent, tree: level });
            continue;
        }

        const top = stack[stack.length - 1];
        if (indent >= top.indent + 2) {
            const parentItem = top.tree.items[top.tree.items.length - 1];
            const childLevel: ListTree = { type, items: [{ text: m[3], children: null }] };
            if (parentItem) parentItem.children = childLevel;
            stack.push({ indent, tree: childLevel });
        } else {
            while (stack.length > 1 && indent < stack[stack.length - 1].indent) stack.pop();
            const level = stack[stack.length - 1];
            if (level.tree.type !== type) {
                const newLevel: ListTree = { type, items: [{ text: m[3], children: null }] };
                trees.push(newLevel);
                stack.pop();
                stack.push({ indent, tree: newLevel });
            } else {
                level.tree.items.push({ text: m[3], children: null });
            }
        }
    }

    return trees;
};

/**
 * Render a nested list tree as <ul>/<ol> elements, recursing into children.
 */
const renderListTree = (tree: ListTree, keyPrefix: string): React.ReactNode => {
    const Tag = tree.type as 'ul' | 'ol';
    return (
        <Tag style={{ margin: '6px 0', paddingLeft: 20, color: 'var(--color-text-secondary)' }}>
            {tree.items.map((it, j) => (
                <li key={`${keyPrefix}-li-${j}`} style={{ marginBottom: 3, lineHeight: 1.65 }}>
                    {renderInline(it.text, `${keyPrefix}-li-${j}`)}
                    {it.children ? renderListTree(it.children, `${keyPrefix}-li-${j}-nest`) : null}
                </li>
            ))}
        </Tag>
    );
};

// ── Single-block parser ───────────────────────────────────────────────────────
/**
 * Parse one CLOSED block (never the open tail) into React elements:
 * fenced code (incl. openui), blockquotes, pipe tables (strict separator
 * gate), headings, nested lists, and horizontal rules.
 */
const parseBlockLines = (lines: string[], opts: { isStreaming?: boolean; keyPrefix: string }): React.ReactNode[] => {
    const { keyPrefix } = opts;
    const isStreamingProp = opts.isStreaming || false;
    const elements: React.ReactNode[] = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];
        const blockStartIndex = i;

        if (line.trim().startsWith('```')) {
            const lang = line.trim().slice(3).trim();
            const codeLines: string[] = [];
            i++;
            while (i < lines.length && !lines[i].trim().startsWith('```')) { codeLines.push(lines[i]); i++; }

            if (lang === 'openui') {
                const openuiCode = codeLines.join('\n');
                elements.push(
                    <div key={`openui-${keyPrefix}-${blockStartIndex}`} style={{ margin: '16px 0' }}>
                        <Renderer response={openuiCode} library={uiLibrary} isStreaming={isStreamingProp || false} />
                    </div>
                );
            } else {
                elements.push(
                    <div key={`code-${keyPrefix}-${blockStartIndex}`} style={{ margin: '16px 0' }}>
                        <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-base)' }}>
                            {lang && (
                                <div style={{ padding: '6px 14px', backgroundColor: 'var(--color-bg-subtle)', fontSize: 11, color: 'var(--color-text-tertiary)', fontFamily: "'JetBrains Mono', 'Fira Code', monospace", letterSpacing: '0.05em', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
                                    {lang}
                                </div>
                            )}
                            <div style={{ padding: '14px 16px', overflowX: 'auto' }}>
                                <SyntaxHighlighter language={lang || 'text'} code={codeLines.join('\n')} />
                            </div>
                        </div>
                    </div>
                );
            }
            if (i < lines.length) i++;
            continue;
        }

        if (line.trim().startsWith('> ')) {
            const bqLines: string[] = [];
            while (i < lines.length && lines[i].trim().startsWith('> ')) { bqLines.push(lines[i].trim().slice(2)); i++; }
            elements.push(
                <blockquote key={`bq-${keyPrefix}`} style={{ margin: '8px 0', paddingLeft: 14, borderLeft: '3px solid var(--color-border)', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
                    {bqLines.map((l, j) => <div key={j}>{renderInline(l, j)}</div>)}
                </blockquote>
            );
            continue;
        }

    // table gate: a header line containing '|' is only a table if the NEXT
    // line matches the strict separator regex — prevents false positives on
    // prose that happens to contain pipes.
        if (line.includes('|') && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1])) {
            const headers = line.split('|').map(h => h.trim()).filter(Boolean);
            i += 2;
            const rows: string[][] = [];
            while (i < lines.length && lines[i].includes('|')) {
                rows.push(lines[i].split('|').map(c => c.trim()).filter(Boolean));
                i++;
            }
            elements.push(
                <div key={`table-${keyPrefix}-${blockStartIndex}`} style={{ overflowX: 'auto', margin: '10px 0' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead><tr>{headers.map((h, j) => <th key={j} style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)', textAlign: 'left', color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{renderInline(h, j)}</th>)}</tr></thead>
                        <tbody>{rows.map((row, ri) => <tr key={ri} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>{row.map((cell, ci) => <td key={ci} style={{ padding: '8px 12px', color: 'var(--color-text-secondary)' }}>{renderInline(cell, ci)}</td>)}</tr>)}</tbody>
                    </table>
                </div>
            );
            continue;
        }

        const h6 = line.match(/^###### (.+)/);
        const h5 = line.match(/^##### (.+)/);
        const h4 = line.match(/^#### (.+)/);
        const h3 = line.match(/^### (.+)/);
        const h2 = line.match(/^## (.+)/);
        const h1 = line.match(/^# (.+)/);
        if (h1) { elements.push(<h1 key={`h1-${keyPrefix}-${blockStartIndex}`} style={{ fontSize: 24, fontWeight: 500, color: 'var(--color-text-primary)', margin: '14px 0 6px', fontFamily: 'var(--font-serif)' }}>{renderInline(h1[1], keyPrefix)}</h1>); i++; continue; }
        if (h2) { elements.push(<h2 key={`h2-${keyPrefix}-${blockStartIndex}`} style={{ fontSize: 20, fontWeight: 500, color: 'var(--color-text-primary)', margin: '12px 0 5px', fontFamily: 'var(--font-serif)' }}>{renderInline(h2[1], keyPrefix)}</h2>); i++; continue; }
        if (h3) { elements.push(<h3 key={`h3-${keyPrefix}-${blockStartIndex}`} style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text-secondary)', margin: '10px 0 4px' }}>{renderInline(h3[1], keyPrefix)}</h3>); i++; continue; }
        if (h4) { elements.push(<h4 key={`h4-${keyPrefix}-${blockStartIndex}`} style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-tertiary)', margin: '10px 0 4px', letterSpacing: '0.01em' }}>{renderInline(h4[1], keyPrefix)}</h4>); i++; continue; }
        if (h5) { elements.push(<h5 key={`h5-${keyPrefix}-${blockStartIndex}`} style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-tertiary)', margin: '8px 0 3px', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{renderInline(h5[1], keyPrefix)}</h5>); i++; continue; }
        if (h6) { elements.push(<h6 key={`h6-${keyPrefix}-${blockStartIndex}`} style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-tertiary)', margin: '8px 0 3px', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{renderInline(h6[1], keyPrefix)}</h6>); i++; continue; }

        if (line.match(/^(\s*)([-*]|\d+\.)\s+/)) {
            const listLines: string[] = [];
            while (i < lines.length && lines[i].match(/^(\s*)([-*]|\d+\.)\s+/)) { listLines.push(lines[i]); i++; }
            const trees = buildListTree(listLines);
            trees.forEach((tree, ti) => {
                elements.push(<Fragment key={`${tree.type}-${keyPrefix}-${ti}`}>{renderListTree(tree, `${keyPrefix}-${ti}`)}</Fragment>);
            });
            continue;
        }

        if (line.match(/^[-*]{3,}$/)) { elements.push(<hr key={`hr-${keyPrefix}-${blockStartIndex}`} style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: '12px 0' }} />); i++; continue; }
        if (line.trim() === '') { elements.push(<div key={`empty-${keyPrefix}-${i}`} style={{ height: 8 }} />); i++; continue; }

        elements.push(<p key={`p-${keyPrefix}-${blockStartIndex}`} style={{ margin: '2px 0', lineHeight: 1.7, color: 'var(--color-text-primary)' }}>{renderInline(line, `${keyPrefix}-${blockStartIndex}`)}</p>);
        i++;
    }

    return elements;
};

// ── CU-STRM-01: streaming cursor (≤1 per message, inside open-tail p/h) ──────
const CURSOR_TESTID = 'streaming-cursor';

/**
 * Plain span (not a component) so the data-testid is present on the element
 * in the raw React tree, before DOM rendering.
 */
const makeCursor = (key: string): React.ReactElement => (
    <span
        key={key}
        data-testid={CURSOR_TESTID}
        style={{
            display: 'inline-block', width: 7, height: 15,
            backgroundColor: 'var(--color-text-primary)', borderRadius: 2,
            marginLeft: 2, verticalAlign: 'text-bottom', opacity: 0.7,
        }}
    />
);

const HEADING_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

/**
 * Attach the streaming cursor inside the last p/h element of the open tail
 * via cloneElement. Gated on isLive + showCursor; at most one cursor per
 * message.
 */
const withCursor = (nodes: React.ReactNode[], opts: { isLive?: boolean; showCursor?: boolean }): React.ReactNode[] => {
    // Cursor gating: `isLive === true` requires the strict true (not just
    // truthy), so a finished stream (isLive=false/undefined) never shows a
    // cursor even if showCursor defaults on; showCursor !== false lets a
    // caller opt out. When gating is off, nodes pass through untouched —
    // avoiding extra re-render work while the user types/streams.
    const showCursor = opts.isLive === true && opts.showCursor !== false;
    if (!showCursor) return nodes;
    for (let k = nodes.length - 1; k >= 0; k--) {
        const el = nodes[k];
        if (isValidElement(el)) {
            const tag = (el.type as string) || '';
            if (tag === 'p' || HEADING_TAGS.includes(tag)) {
                const children = (el.props as { children?: React.ReactNode }).children;
                nodes[k] = cloneElement(el, undefined, children, makeCursor(`${el.key ?? 'n'}-cursor`));
                break;
            }
        }
    }
    return nodes;
};

// ── CU-STRM-01: cached block rendering ───────────────────────────────────────
/**
 * Render markdown incrementally: closed blocks are looked up in the LRU
 * cache by `hash#occurrence` key and reused BY REFERENCE when hit; only the
 * open tail is re-parsed. The cursor is attached inside the tail's last
 * p/h element, gated on isLive/showCursor.
 */
const renderBlocks = (content: string, opts: { isLive?: boolean; showCursor?: boolean } = {}): React.ReactNode[] => {
    const { closed, tail } = splitBlocks(content);
    // Occurrence keys: identical blocks (e.g. two "OK." paragraphs) share the
    // same hash. The #1, #2, ... suffix disambiguates them so each gets a
    // distinct cache key AND React key — without it, duplicate keys would
    // break reconciliation (children collapse/duplicate).
    const occurrence = new Map<string, number>();
    const nodes: React.ReactNode[] = [];

    for (const block of closed) {
        const h = hashBlock(block);
        const occ = (occurrence.get(h) || 0) + 1;
        occurrence.set(h, occ);
        const key = `${h}#${occ}`;
        let cached = cacheGet(key);
        if (cached === undefined) {
            cacheMisses++;
            const parsed = parseBlockLines(block.split('\n'), { keyPrefix: key });
            // Cache the keyed wrapper so hits are reused BY REFERENCE.
            cached = <Fragment key={key}>{parsed}</Fragment>;
            cacheSet(key, cached);
        }
        nodes.push(cached);
    }

    if (tail !== null) {
        // The open tail is the only part re-parsed on each stream chunk —
        // closed blocks above are reused from the LRU by reference, so
        // streaming cost stays proportional to the growing tail, not the
        // whole message. It is deliberately NOT cached: it is still mutating.
        tailParses++;
        const tailKey = `tail-${hashBlock(tail)}`;
        const tailNodes = parseBlockLines(tail.split('\n'), { keyPrefix: tailKey, isStreaming: true });
        nodes.push(<Fragment key={tailKey}>{withCursor(tailNodes, opts)}</Fragment>);
    }

    return nodes;
};

// ── Markdown Renderer ────────────────────────────────────────────────────────
/**
 * Strip model-reasoning artifacts (think/thought/reflection tags, legacy
 * [Thinking] blocks, raw tool_call payloads, computer:// links) so they
 * never render as message body content.
 */
const cleanContent = (content: string): string => content
    .replace(/<(?:think|thought|reasoning|reflection)>[\s\S]*?(<\/(?:think|thought|reasoning|reflection)>|$)/gi, '')
    .replace(/\[(?:Thinking|Reasoning)\][\s\S]*?(\[\/(?:Thinking|Reasoning)\]|$)/gi, '')
    .replace(/<tool_call>[\s\S]*?(<\/tool_call>|$)/gi, '')
    .replace(/\[[^\]]+\]\(computer:\/\/\/[^)]+\)/g, '');

interface MarkdownBodyProps { content: string; isLive?: boolean; showCursor?: boolean; }

/**
 * Shared render path for both the static and streaming renderers. Parses
 * cleaned content into LRU-cached closed blocks plus a re-parsed open tail,
 * optionally attaching the streaming cursor. Rendering happens inline (not
 * memoized) so every content change during streaming is reflected.
 *
 * @param content Raw markdown (reasoning tags/tool calls stripped first).
 * @param isLive Strict-true gate for cursor display (see withCursor).
 * @param showCursor Opt-out flag; defaults to enabled when isLive is true.
 */
const MarkdownBody = ({ content, isLive, showCursor }: { content: string; isLive?: boolean; showCursor?: boolean }) => {
    const cleanedContent = cleanContent(content);
    const elements = renderBlocks(cleanedContent, { isLive, showCursor });
    return <div style={{ fontSize: 15 }}>{elements}</div>;
};

// memo boundary: MarkdownRenderer re-renders only when `content` changes
// (its only prop), so parent re-renders (e.g. chat list churn) are free.
// It deliberately drops isStreaming — the idle DOM stays byte-identical
// to StreamingMarkdown's idle DOM (inline parity).
const MarkdownRenderer = memo(({ content, isStreaming: isStreamingProp }: { content: string; isStreaming?: boolean }) => (
    <MarkdownBody content={content} />
));

// ── Streaming Markdown Component ─────────────────────────────────────────────
/**
 * Streaming variant of MarkdownRenderer. Shares MarkdownBody so the DOM is
 * byte-identical to MarkdownRenderer when idle (inline parity); while live,
 * the cursor is attached inside the open-tail p/h (≤1 per message).
 *
 * Note: `isLatest` is intentionally unused — parity means the last/committed
 * row renders exactly like history rows.
 */
const StreamingMarkdown = ({ content, isLive, isLatest }: { content: string; isLive?: boolean; isLatest?: boolean }) => (
    <MarkdownBody content={content} isLive={isLive} showCursor={true} />
);

export { MarkdownRenderer, StreamingMarkdown, InlineLink, splitBlocks, fnv1a, hashBlock, renderBlocks, getBlockCacheStats, resetBlockCache, BLOCK_CACHE_CAP, isTableSeparatorLine };
