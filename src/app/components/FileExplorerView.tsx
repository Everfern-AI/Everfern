"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";

// ── Types ────────────────────────────────────────────────────────────

interface FileEntry {
    path: string;
    type: 'file' | 'dir';
    size?: number;
}

interface FileOp {
    action: 'list' | 'mkdirp' | 'move' | 'rename' | 'delete';
    path?: string;
    from?: string;
    to?: string;
    root?: string;
    entries?: FileEntry[];
    status: 'running' | 'done' | 'error';
}

interface FileExplorerViewProps {
    operations: FileOp[];
}

// ── Helpers ──────────────────────────────────────────────────────────

const ACTION_CONFIG: Record<string, { icon: string; verb: string; color: string }> = {
    list: { icon: '📂', verb: 'Listed', color: '#60a5fa' },
    mkdirp: { icon: '📁', verb: 'Created', color: '#4ade80' },
    move: { icon: '📦', verb: 'Moved', color: '#fbbf24' },
    rename: { icon: '✏️', verb: 'Renamed', color: '#c084fc' },
    delete: { icon: '🗑️', verb: 'Deleted', color: '#f87171' },
};

function formatSize(bytes?: number): string {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(path: string, type: 'file' | 'dir'): string {
    if (type === 'dir') return '📁';
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    const iconMap: Record<string, string> = {
        ttf: '🔤', otf: '🔤', woff: '🔤', woff2: '🔤', fon: '🔤',
        png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', webp: '🖼️', svg: '🖼️', ico: '🖼️',
        mp4: '🎬', mkv: '🎬', avi: '🎬', mov: '🎬', webm: '🎬',
        mp3: '🎵', wav: '🎵', flac: '🎵', aac: '🎵', ogg: '🎵',
        zip: '📦', rar: '📦', '7z': '📦', tar: '📦', gz: '📦',
        pdf: '📕', doc: '📝', docx: '📝', txt: '📄', md: '📄',
        exe: '⚙️', msi: '⚙️', bat: '⚙️', sh: '⚙️',
        js: '💛', ts: '💙', py: '🐍', json: '📋', css: '🎨', html: '🌐',
    };
    return iconMap[ext] || '📄';
}

function basename(p: string): string {
    return p.split(/[/\\]/).filter(Boolean).pop() || p;
}

// ── Tree Builder ─────────────────────────────────────────────────────

interface TreeNode {
    name: string;
    path: string;
    type: 'file' | 'dir';
    size?: number;
    children: TreeNode[];
    highlight?: string; // action color if involved in an operation
}

function buildTree(entries: FileEntry[], ops: FileOp[]): TreeNode {
    const root: TreeNode = { name: '/', path: '', type: 'dir', children: [] };
    // Track moved files for highlighting
    const movedTo = new Set<string>();
    const createdDirs = new Set<string>();
    for (const op of ops) {
        if (op.action === 'move' && op.to) movedTo.add(op.to.replace(/\\/g, '/'));
        if (op.action === 'mkdirp' && op.path) createdDirs.add(op.path.replace(/\\/g, '/'));
    }

    for (const entry of entries) {
        const parts = entry.path.replace(/\\/g, '/').split('/').filter(Boolean);
        let current = root;
        for (let i = 0; i < parts.length; i++) {
            const isLast = i === parts.length - 1;
            let child = current.children.find(c => c.name === parts[i]);
            if (!child) {
                const childPath = parts.slice(0, i + 1).join('/');
                child = {
                    name: parts[i],
                    path: childPath,
                    type: isLast ? entry.type : 'dir',
                    size: isLast ? entry.size : undefined,
                    children: [],
                };
                // Highlight
                if (movedTo.has(childPath)) child.highlight = '#fbbf24';
                if (createdDirs.has(childPath)) child.highlight = '#4ade80';
                current.children.push(child);
            }
            current = child;
        }
    }

    // Sort: dirs first, then alphabetical
    const sortTree = (node: TreeNode) => {
        node.children.sort((a, b) => {
            if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
        node.children.forEach(sortTree);
    };
    sortTree(root);
    return root;
}

// ── Components ───────────────────────────────────────────────────────

const TreeRow = ({ node, depth, defaultOpen }: { node: TreeNode; depth: number; defaultOpen?: boolean }) => {
    const [open, setOpen] = React.useState(defaultOpen ?? depth < 1);
    const isDir = node.type === 'dir';
    const indent = depth * 18;

    return (
        <>
            <motion.div
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: depth * 0.03 }}
                onClick={() => isDir && setOpen(!open)}
                style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '3px 8px 3px 8px',
                    paddingLeft: indent + 8,
                    cursor: isDir ? 'pointer' : 'default',
                    borderRadius: 6,
                    fontSize: 12,
                    fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
                    color: node.highlight ? node.highlight : 'var(--color-text-tertiary)',
                    background: node.highlight ? `${node.highlight}10` : 'transparent',
                    transition: 'background 0.15s',
                }}
                onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => e.currentTarget.style.background = node.highlight ? `${node.highlight}10` : 'transparent'}
            >
                {isDir && (
                    <span style={{ fontSize: 9, color: 'var(--color-text-secondary)', width: 10, textAlign: 'center', transition: 'transform 0.15s', transform: open ? 'rotate(90deg)' : 'none' }}>▶</span>
                )}
                {!isDir && <span style={{ width: 10 }} />}
                <span style={{ fontSize: 13 }}>{getFileIcon(node.name, node.type)}</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
                {node.size !== undefined && (
                    <span style={{ fontSize: 10, color: 'var(--color-text-secondary)', flexShrink: 0 }}>{formatSize(node.size)}</span>
                )}
                {node.highlight && (
                    <span style={{ fontSize: 9, color: node.highlight, border: `1px solid ${node.highlight}40`, borderRadius: 4, padding: '0 4px', flexShrink: 0 }}>
                        {node.highlight === '#4ade80' ? 'NEW' : 'MOVED'}
                    </span>
                )}
            </motion.div>
            <AnimatePresence>
                {isDir && open && node.children.map(child => (
                    <TreeRow key={child.path} node={child} depth={depth + 1} />
                ))}
            </AnimatePresence>
        </>
    );
};

const OperationLog = ({ op, index }: { op: FileOp; index: number }) => {
    const cfg = ACTION_CONFIG[op.action] || ACTION_CONFIG.list;
    return (
        <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.08 }}
            style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '5px 10px', borderRadius: 8,
                background: `${cfg.color}08`,
                border: `1px solid ${cfg.color}18`,
                fontSize: 12,
            }}
        >
            <span>{cfg.icon}</span>
            <span style={{ color: cfg.color, fontWeight: 600, flexShrink: 0 }}>{cfg.verb}</span>
            <span style={{ color: 'var(--color-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {op.action === 'move' || op.action === 'rename'
                    ? `${basename(op.from || '')} → ${basename(op.to || '')}`
                    : basename(op.path || op.root || '')}
            </span>
            {op.status === 'running' && (
                <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }}
                    style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid transparent', borderTopColor: cfg.color, flexShrink: 0, marginLeft: 'auto' }}
                />
            )}
            {op.status === 'done' && (
                <span style={{ marginLeft: 'auto', fontSize: 11, color: '#4ade80' }}>✓</span>
            )}
        </motion.div>
    );
};

// ── Main Export ───────────────────────────────────────────────────────

export const FileExplorerView: React.FC<FileExplorerViewProps> = ({ operations }) => {
    // Collect all entries from list operations
    const allEntries = operations
        .filter(op => op.action === 'list' && op.entries)
        .flatMap(op => op.entries || []);

    const tree = allEntries.length > 0 ? buildTree(allEntries, operations) : null;

    return (
        <div style={{
            background: '#1a1918',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            borderRadius: 12,
            overflow: 'hidden',
            marginTop: 6,
        }}>
            {/* Header */}
            <div style={{
                padding: '8px 12px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                display: 'flex', alignItems: 'center', gap: 8,
                background: 'rgba(255,255,255,0.02)',
            }}>
                <span style={{ fontSize: 14 }}>📂</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-border)' }}>File Explorer</span>
                <span style={{ fontSize: 10, color: 'var(--color-text-secondary)', marginLeft: 'auto' }}>
                    {allEntries.length} items
                </span>
            </div>

            {/* Operation Log */}
            {operations.length > 0 && (
                <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    {operations.map((op, i) => (
                        <OperationLog key={i} op={op} index={i} />
                    ))}
                </div>
            )}

            {/* Tree View */}
            {tree && tree.children.length > 0 && (
                <div style={{ padding: '6px 2px', maxHeight: 320, overflowY: 'auto' }}>
                    {tree.children.map(child => (
                        <TreeRow key={child.path} node={child} depth={0} defaultOpen={child.type === 'dir'} />
                    ))}
                </div>
            )}
        </div>
    );
};

export default FileExplorerView;
