'use client';
import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useTheme } from '@/components/common/ThemeProvider';
import {
    Brain,
    Lightbulb,
    DownloadSimple,
    Export,
    ShareNetwork,
    Info,
    FileText,
    Trash,
    MagnifyingGlassPlus,
    MagnifyingGlassMinus,
    ArrowsCounterClockwise,
    CircleNotch,
    Plus,
    Graph,
    Heart,
    Lightning,
    ListDashes,
    MagnifyingGlass,
    X,
} from '@phosphor-icons/react';
import { SectionTitle, SectionSubtitle, Card, Label, Input } from './ui';
import { rotate3D, getGlobeGridPaths } from './memory-globe-physics';

/**
 * Memory settings section: renders the user's long-term memory graph as an
 * interactive 3D force-directed globe (or a flat table) with type filters,
 * search, add/delete, export/import-merge, and a branded PNG share generator.
 * All data flows through the `electronAPI.memory` IPC bridge.
 */
export function MemorySection() {
    const { theme } = useTheme();
    const [graph, setGraph] = useState<{ nodes: any[]; edges: any[] }>({ nodes: [], edges: [] });
    const [isLoading, setIsLoading] = useState(true);
    const [isBusy, setIsBusy] = useState<string | null>(null);
    const [selectedNode, setSelectedNode] = useState<any>(null);
    const [filterType, setFilterType] = useState<string>('all');
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [viewMode, setViewMode] = useState<'graph' | 'list'>('graph');
    const [nodePositions, setNodePositions] = useState<Record<string, { x: number; y: number; z: number }>>({});
    const [zoom, setZoom] = useState<number>(1);
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
    const [showAddModal, setShowAddModal] = useState<boolean>(false);
    const [newMemoryContent, setNewMemoryContent] = useState<string>('');
    const [newMemoryType, setNewMemoryType] = useState<'preference' | 'habit' | 'fact'>('preference');
    const [isSavingMemory, setIsSavingMemory] = useState<boolean>(false);
    const [isGraphVisible, setIsGraphVisible] = useState(true);

    const isDark = theme === 'dark';
    const globeBg0 = isDark ? '#181714' : '#fdfbf7';
    const globeBg100 = isDark ? '#0f0e0c' : '#FEFAEF';
    const globeShading = isDark ? '#0f0e0c' : '#FEFAEF';
    const gridStrokeBack = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(32, 30, 36, 0.06)';
    const gridStrokeFront = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(32, 30, 36, 0.12)';
    const hubStrokeBack = isDark ? 'rgba(255,255,255,0.015)' : 'rgba(32, 30, 36, 0.02)';
    const hubStrokeFront = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(32, 30, 36, 0.06)';
    const edgeStrokeBack = isDark ? 'rgba(255,255,255,0.02)' : 'rgba(32, 30, 36, 0.04)';
    const edgeStrokeFront = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(32, 30, 36, 0.12)';
    const nodeBorder = isDark ? '#181714' : '#ffffff';
    const tooltipBg = isDark ? '#22201b' : '#FEFAEF';
    const tooltipBorder = isDark ? '#333029' : 'rgba(32,30,36,0.15)';
    const tooltipText = isDark ? '#e5e4df' : '#201e24';

    const node3DPositionsRef = React.useRef<Record<string, { x: number; y: number; z: number }>>({});
    const rotationRef = React.useRef({ yaw: 0, pitch: 0.2 });
    const isDraggingRef = React.useRef(false);
    const lastMouseRef = React.useRef({ x: 0, y: 0 });
    const svgRef = React.useRef<SVGSVGElement>(null);
    const addModalRef = useRef<HTMLDivElement>(null);
    const previouslyFocusedRef = useRef<HTMLElement | null>(null);

    const fetchGraph = async () => {
        setIsLoading(true);
        try {
            const res = await (window as any).electronAPI?.memory?.getGraph?.();
            if (res) {
                setGraph(res);
            }
        } catch (e) {
            console.error('Failed to load memory graph:', e);
        }
        setIsLoading(false);
    };

    useEffect(() => {
        fetchGraph();
    }, []);

    const handleDeleteNode = async (nodeId: string) => {
        if (!window.confirm('Are you sure you want EverFern to forget this memory?')) return;
        try {
            const res = await (window as any).electronAPI?.memory?.deleteNode?.(nodeId);
            if (res?.success) {
                setSelectedNode(null);
                fetchGraph();
            } else {
                alert('Failed to delete memory node.');
            }
        } catch (e) {
            console.error('Delete error:', e);
        }
    };
    const handleDeleteMemory = handleDeleteNode;

    const handleSaveNewMemory = async () => {
        if (!newMemoryContent.trim()) return;
        setIsSavingMemory(true);
        try {
            const res = await (window as any).electronAPI?.memory?.saveDirect?.(
                newMemoryContent.trim(),
                `[User ${newMemoryType.toUpperCase()}]`
            );
            if (res?.success !== false) {
                setNewMemoryContent('');
                setShowAddModal(false);
                fetchGraph();
            } else {
                alert('Failed to save memory.');
            }
        } catch (e: any) {
            alert('Failed to save memory: ' + (e.message || 'Unknown error'));
        } finally {
            setIsSavingMemory(false);
        }
    };

    const handleExport = async () => {
        setIsBusy('export');
        try {
            const res = await (window as any).electronAPI?.memory?.exportZip?.();
            if (res?.success) {
                alert(`Memory exported successfully to:\n${res.filePath}`);
            } else if (res?.reason !== 'canceled') {
                alert('Export failed: ' + (res?.error || 'Unknown error'));
            }
        } catch (e: any) {
            alert('Export failed: ' + e.message);
        } finally {
            setIsBusy(null);
        }
    };

    const handleShareMemoryGraph = async () => {
        if (!svgRef.current) return;
        setIsBusy('share');
        try {
            // Wait for custom fonts to load
            try {
                await document.fonts.ready;
                await Promise.all([
                    document.fonts.load('bold 36px "Lora"'),
                    document.fonts.load('500 18px "Figtree"'),
                    document.fonts.load('bold 36px "Figtree"'),
                    document.fonts.load('16px "JetBrains Mono"')
                ]);
            } catch (e) {
                console.warn("Fonts load warning:", e);
            }

            const canvas = document.createElement('canvas');
            canvas.width = 1200;
            canvas.height = 1200;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error("Could not get canvas context");

            // 1. Draw cream background gradient
            const bgGrad = ctx.createRadialGradient(600, 600, 50, 600, 600, 800);
            bgGrad.addColorStop(0, '#fdfbf7');
            bgGrad.addColorStop(1, '#FEFAEF');
            ctx.fillStyle = bgGrad;
            ctx.fillRect(0, 0, 1200, 1200);

            // 2. Draw card container with light glassmorphism
            ctx.save();
            ctx.strokeStyle = 'rgba(32, 30, 36, 0.08)';
            ctx.lineWidth = 2;
            ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.shadowColor = 'rgba(32, 30, 36, 0.05)';
            ctx.shadowBlur = 40;

            ctx.beginPath();
            ctx.roundRect(60, 60, 1080, 1080, 24);
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            // 3. Draw Branding Header
            let logoImg: HTMLImageElement | null = null;
            try {
                logoImg = await new Promise<HTMLImageElement>((resolve, reject) => {
                    const img = new window.Image();
                    img.onload = () => resolve(img);
                    img.onerror = () => reject();
                    img.src = '/images/logos/black-logo-withoutbg.png';
                });
            } catch (e) {
                console.warn("Logo failed to load");
            }

            const headerY = 120;
            if (logoImg) {
                ctx.drawImage(logoImg, 100, headerY, 64, 64);
            } else {
                ctx.save();
                ctx.beginPath();
                ctx.arc(132, headerY + 32, 32, 0, Math.PI * 2);
                ctx.fillStyle = '#10b981';
                ctx.shadowColor = '#10b981';
                ctx.shadowBlur = 15;
                ctx.fill();
                ctx.restore();
                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 24px "Figtree", sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('EF', 132, headerY + 32);
            }

            ctx.fillStyle = '#201e24';
            ctx.font = '700 36px "Figtree", sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText('EverFern AI', 184, headerY);

            ctx.fillStyle = '#8a8886';
            ctx.font = '500 18px "Figtree", sans-serif';
            ctx.fillText('My Personal Memory & Knowledge Graph', 184, headerY + 44);

            // 4. Serialize, modify, and Draw the SVG Globe in light theme
            // Re-theme hack: serialize the LIVE dark-mode SVG, then string-replace its
            // hardcoded dark fills/strokes with cream-palette equivalents so the
            // exported PNG is always light-themed regardless of the user's theme.
            const serializer = new XMLSerializer();
            let svgString = serializer.serializeToString(svgRef.current);

            // Modify SVG string to convert dark theme to cream light theme
            svgString = svgString.replace(/fill="url\(#graph-bg\)"/g, 'fill="transparent"');
            svgString = svgString.replace(/stopColor="#090d16"/g, 'stopColor="#FEFAEF"');
            svgString = svgString.replace(/stopColor="#1e293b"/g, 'stopColor="#FEFAEF"');
            svgString = svgString.replace(/stopColor="#181714"/g, 'stopColor="#fdfbf7"');
            svgString = svgString.replace(/stopColor="#0f0e0c"/g, 'stopColor="#FEFAEF"');

            // Convert grid line strokes from indigo/white to dark/subtle
            svgString = svgString.replace(/stroke="rgba\(99,102,241,0\.04\)"/g, 'stroke="rgba(32,30,36,0.06)"');
            svgString = svgString.replace(/stroke="rgba\(99,102,241,0\.12\)"/g, 'stroke="rgba(32,30,36,0.15)"');
            svgString = svgString.replace(/stroke="rgba\(255,255,255,0\.015\)"/g, 'stroke="rgba(32,30,36,0.02)"');
            svgString = svgString.replace(/stroke="rgba\(255,255,255,0\.03\)"/g, 'stroke="rgba(32,30,36,0.06)"');
            svgString = svgString.replace(/stroke="rgba\(255,255,255,0\.04\)"/g, 'stroke="rgba(32,30,36,0.06)"');
            svgString = svgString.replace(/stroke="rgba\(255,255,255,0\.06\)"/g, 'stroke="rgba(32,30,36,0.12)"');
            svgString = svgString.replace(/stroke="rgba\(255,255,255,0\.08\)"/g, 'stroke="rgba(32,30,36,0.12)"');
            svgString = svgString.replace(/stroke="rgba\(255,255,255,0\.1\)"/g, 'stroke="rgba(32,30,36,0.15)"');
            svgString = svgString.replace(/stroke="rgba\(255,\s*255,\s*255,\s*0\.015\)"/g, 'stroke="rgba(32,30,36,0.02)"');
            svgString = svgString.replace(/stroke="rgba\(255,\s*255,\s*255,\s*0\.03\)"/g, 'stroke="rgba(32,30,36,0.06)"');
            svgString = svgString.replace(/stroke="rgba\(255,\s*255,\s*255,\s*0\.04\)"/g, 'stroke="rgba(32,30,36,0.06)"');
            svgString = svgString.replace(/stroke="rgba\(255,\s*255,\s*255,\s*0\.06\)"/g, 'stroke="rgba(32,30,36,0.12)"');
            svgString = svgString.replace(/stroke="rgba\(255,\s*255,\s*255,\s*0\.08\)"/g, 'stroke="rgba(32,30,36,0.12)"');

            // Convert white nodes to dark slate to be visible on cream
            svgString = svgString.replace(/fill="#ffffff" opacity/g, 'fill="#4f46e5" opacity');
            svgString = svgString.replace(/stroke="#181714"/g, 'stroke="#ffffff"');

            // Tooltip and brain core text colors
            svgString = svgString.replace(/fill="#0f172a"/g, 'fill="#FEFAEF"');
            svgString = svgString.replace(/stroke="rgba\(255,255,255,0\.15\)"/g, 'stroke="rgba(32,30,36,0.15)"');
            svgString = svgString.replace(/fill="#22201b"/g, 'fill="#FEFAEF"');
            svgString = svgString.replace(/stroke="#333029"/g, 'stroke="rgba(32,30,36,0.15)"');
            svgString = svgString.replace(/fill="#e5e4df"/g, 'fill="#201e24"');
            svgString = svgString.replace(/fill="#ffffff"/g, 'fill="#201e24"');

            const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
            const blobURL = URL.createObjectURL(svgBlob);

            const svgImg = await new Promise<HTMLImageElement>((resolve, reject) => {
                const img = new window.Image();
                img.onload = () => resolve(img);
                img.onerror = () => reject();
                img.src = blobURL;
            });
            URL.revokeObjectURL(blobURL);

            ctx.drawImage(svgImg, 150, 240, 900, 600);

            // 5. Draw Statistics Dashboard
            const stats = [
                { label: 'Preferences', value: graph.nodes.filter(n => n.type === 'preference').length.toString(), color: '#10b981' },
                { label: 'Habits', value: graph.nodes.filter(n => n.type === 'habit').length.toString(), color: '#059669' },
                { label: 'Facts', value: graph.nodes.filter(n => n.type === 'fact').length.toString(), color: '#0ea5e9' },
                { label: 'Files Linked', value: graph.nodes.filter(n => n.type === 'file').length.toString(), color: '#64748b' }
            ];

            const startX = 100;
            const totalWidth = 1000;
            const boxWidth = 220;
            const gap = (totalWidth - boxWidth * 4) / 3;

            stats.forEach((stat, i) => {
                const x = startX + i * (boxWidth + gap);
                const y = 900;

                ctx.save();
                ctx.fillStyle = '#ffffff';
                ctx.strokeStyle = '#e8e6d9';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.roundRect(x, y, boxWidth, 120, 16);
                ctx.fill();
                ctx.stroke();

                ctx.fillStyle = stat.color;
                ctx.beginPath();
                ctx.roundRect(x + 12, y + 12, 6, 24, 3);
                ctx.fill();

                ctx.fillStyle = '#201e24';
                ctx.font = 'bold 36px "Figtree", sans-serif';
                ctx.textAlign = 'left';
                ctx.fillText(stat.value, x + 30, y + 46);

                ctx.fillStyle = '#8a8886';
                ctx.font = '600 14px "Figtree", sans-serif';
                ctx.fillText(stat.label.toUpperCase(), x + 12, y + 90);
                ctx.restore();
            });

            // 6. Draw Footer Text
            ctx.fillStyle = '#8a8886';
            ctx.font = '16px "JetBrains Mono", monospace';
            ctx.textAlign = 'center';
            ctx.fillText('flexed with everfern.app', 600, 1090);

            // 7. Trigger download
            const url = canvas.toDataURL('image/png');
            const link = document.createElement('a');
            link.download = 'everfern-memory-graph.png';
            link.href = url;
            link.click();
        } catch (e: any) {
            alert('Failed to generate sharing image: ' + e.message);
        } finally {
            setIsBusy(null);
        }
    };

    const handleImportMerge = async () => {
        setIsBusy('import');
        try {
            const res = await (window as any).electronAPI?.memory?.importMergeGraph?.();
            if (res?.success) {
                alert(`Memory merged! Added ${res.addedNodes} new nodes and ${res.addedEdges} new edges.`);
                fetchGraph();
            } else if (res?.reason !== 'canceled') {
                alert('Import failed: ' + (res?.error || 'Unknown error'));
            }
        } catch (e: any) {
            alert('Import failed: ' + e.message);
        } finally {
            setIsBusy(null);
        }
    };

    const handleOpenFile = async (filePath: string) => {
        if (!filePath) return;
        try {
            let targetPath = filePath;
            // Bare file name (no path separators) means it's a linked-file reference —
            // resolve the real absolute path from the matching file_* node's value.
            if (!filePath.includes('/') && !filePath.includes('\\')) {
                const fileNodeId = `file_${filePath.toLowerCase()}`;
                const fileNode = graph.nodes.find(n => n.id === fileNodeId);
                if (fileNode?.value) {
                    targetPath = fileNode.value;
                }
            }
            const res = await (window as any).electronAPI?.system?.openExternal?.("file://" + targetPath);
            if (res && !res.success) {
                alert(`Could not open file: ${res.error}`);
            }
        } catch (e) {
            console.error('Open file error:', e);
        }
    };

    const filteredNodes = React.useMemo(() => {
        return graph.nodes.filter(n => {
            const matchesType = filterType === 'all' || n.type === filterType;
            const matchesSearch = !searchQuery ||
                n.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
                (n.value && n.value.toLowerCase().includes(searchQuery.toLowerCase())) ||
                (n.name && n.name.toLowerCase().includes(searchQuery.toLowerCase()));
            return matchesType && matchesSearch;
        });
    }, [graph.nodes, filterType, searchQuery]);

    // Only keep edges whose BOTH endpoints survive the type/search filter, so the
    // graph never renders lines dangling toward invisible nodes.
    const filteredEdges = React.useMemo(() => {
        const filteredNodeIds = new Set(filteredNodes.map(n => n.id));
        return graph.edges.filter(e => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target));
    }, [graph.edges, filteredNodes]);

    // Seed node positions on a Fibonacci sphere around the '__user__' hub (center).
    // The golden-angle stride (2.39996… rad) gives near-uniform spacing; existing ids
    // keep their physics-settled positions across re-filters, and ids that dropped
    // out of the current filter are pruned.
    const init3DPositions = () => {
        const current = { ...node3DPositionsRef.current };
        const R = 140;

        current['__user__'] = { x: 0, y: 0, z: 0 };

        const otherNodes = filteredNodes.filter(n => n.id !== '__user__');
        const N = otherNodes.length;

        otherNodes.forEach((node, idx) => {
            if (!current[node.id]) {
                const y = N > 1 ? 1 - (idx / (N - 1)) * 2 : 0;
                const rad = Math.sqrt(Math.max(0, 1 - y * y));
                const theta = 2.399963229728653 * idx;

                current[node.id] = {
                    x: Math.cos(theta) * rad * R,
                    y: y * R,
                    z: Math.sin(theta) * rad * R
                };
            }
        });

        const activeIds = new Set(filteredNodes.map(n => n.id));
        Object.keys(current).forEach(id => {
            if (id !== '__user__' && !activeIds.has(id)) {
                delete current[id];
            }
        });

        node3DPositionsRef.current = current;
    };

    useEffect(() => {
        init3DPositions();
    }, [filteredNodes]);

    // Pause the physics sim when the globe is offscreen (IntersectionObserver on the svg)
    useEffect(() => {
        if (viewMode !== 'graph' || isLoading || graph.nodes.length === 0) {
            setIsGraphVisible(true);
            return;
        }
        const el = svgRef.current;
        if (!el || typeof IntersectionObserver === 'undefined') return;
        const io = new IntersectionObserver(
            ([entry]) => setIsGraphVisible(entry.isIntersecting),
            { threshold: 0.01 }
        );
        io.observe(el);
        return () => io.disconnect();
    }, [viewMode, isLoading, graph.nodes.length]);

    useEffect(() => {
        if (viewMode !== 'graph' || filteredNodes.length === 0 || !isGraphVisible) return;
        let animationFrameId: number;

        // Per-frame force-directed layout on the sphere surface: pairwise
        // Coulomb-style repulsion spreads nodes apart, Hooke-style spring
        // attraction along edges (natural length 75) clusters related nodes,
        // then every position is re-projected back onto the sphere of radius R.
        const tick = () => {
            if (typeof document !== 'undefined' && document.hidden) {
                animationFrameId = requestAnimationFrame(tick);
                return;
            }
            const vx: Record<string, number> = {};
            const vy: Record<string, number> = {};
            const vz: Record<string, number> = {};

            filteredNodes.forEach(n => {
                vx[n.id] = 0;
                vy[n.id] = 0;
                vz[n.id] = 0;
            });

            const R = 140;
            const repulsion = 10000;

            for (let i = 0; i < filteredNodes.length; i++) {
                const u = filteredNodes[i];
                if (u.id === '__user__') continue;
                const posU = node3DPositionsRef.current[u.id];
                if (!posU) continue;

                for (let j = i + 1; j < filteredNodes.length; j++) {
                    const v = filteredNodes[j];
                    if (v.id === '__user__') continue;
                    const posV = node3DPositionsRef.current[v.id];
                    if (!posV) continue;

                    const dx = posV.x - posU.x;
                    const dy = posV.y - posU.y;
                    const dz = posV.z - posU.z;
                    const distSq = dx * dx + dy * dy + dz * dz || 1;
                    const dist = Math.sqrt(distSq);

                    const force = repulsion / distSq;
                    const forceX = (dx / dist) * force;
                    const forceY = (dy / dist) * force;
                    const forceZ = (dz / dist) * force;

                    vx[u.id] -= forceX;
                    vy[u.id] -= forceY;
                    vz[u.id] -= forceZ;
                    vx[v.id] += forceX;
                    vy[v.id] += forceY;
                    vz[v.id] += forceZ;
                }
            }

            const k = 0.03;
            const length = 75;

            filteredEdges.forEach(edge => {
                if (edge.source === '__user__' || edge.target === '__user__') return;
                const posU = node3DPositionsRef.current[edge.source];
                const posV = node3DPositionsRef.current[edge.target];
                if (!posU || !posV) return;

                const dx = posV.x - posU.x;
                const dy = posV.y - posU.y;
                const dz = posV.z - posU.z;
                const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;

                const force = k * (dist - length);
                const forceX = (dx / dist) * force;
                const forceY = (dy / dist) * force;
                const forceZ = (dz / dist) * force;

                vx[edge.source] += forceX;
                vy[edge.source] += forceY;
                vz[edge.source] += forceZ;
                vx[edge.target] -= forceX;
                vy[edge.target] -= forceY;
                vz[edge.target] -= forceZ;
            });

            filteredNodes.forEach(n => {
                if (n.id === '__user__') return;
                const pos = node3DPositionsRef.current[n.id];
                if (!pos) return;

                const newX = pos.x + vx[n.id];
                const newY = pos.y + vy[n.id];
                const newZ = pos.z + vz[n.id];

                // Normalize back onto the sphere so nodes orbit the hub instead of
                // slowly drifting off-radius under the accumulating forces.
                const d = Math.sqrt(newX * newX + newY * newY + newZ * newZ) || 1;
                node3DPositionsRef.current[n.id] = {
                    x: (newX / d) * R,
                    y: (newY / d) * R,
                    z: (newZ / d) * R
                };
            });

            if (!isDraggingRef.current) {
                rotationRef.current.yaw += 0.0015;
            }

            const { yaw, pitch } = rotationRef.current;
            const projected: Record<string, { x: number; y: number; z: number }> = {};

            filteredNodes.forEach(n => {
                const pos = node3DPositionsRef.current[n.id];
                if (!pos) return;

                const rot = rotate3D(pos.x, pos.y, pos.z, yaw, pitch);
                projected[n.id] = {
                    x: 300 + rot.x,
                    y: 200 + rot.y,
                    z: rot.z
                };
            });

            setNodePositions(projected);

            animationFrameId = requestAnimationFrame(tick);
        };

        animationFrameId = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(animationFrameId);
    }, [filteredNodes, filteredEdges, viewMode, isGraphVisible]);

    // Escape-to-close + focus trap + body scroll lock while the Add-memory modal is open
    useEffect(() => {
        if (!showAddModal) return;
        previouslyFocusedRef.current = document.activeElement as HTMLElement | null;

        const esc = (e: KeyboardEvent) => e.key === 'Escape' && setShowAddModal(false);
        document.addEventListener('keydown', esc as any);

        const trap = (e: KeyboardEvent) => {
            if (e.key !== 'Tab' || !addModalRef.current) return;
            const focusables = addModalRef.current.querySelectorAll<HTMLElement>(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            );
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
        document.addEventListener('keydown', trap);

        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        const focusables = addModalRef.current?.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const textareaEl = addModalRef.current?.querySelector<HTMLElement>('textarea');
        (textareaEl || focusables?.[0])?.focus();

        return () => {
            document.removeEventListener('keydown', esc as any);
            document.removeEventListener('keydown', trap);
            document.body.style.overflow = prevOverflow;
            previouslyFocusedRef.current?.focus?.();
        };
    }, [showAddModal]);

    const handleMouseDownSvg = (e: React.MouseEvent) => {
        const target = e.target as SVGElement;
        const nodeIdAttr = target.getAttribute('data-node-id');
        if (nodeIdAttr) {
            if (nodeIdAttr !== '__user__') {
                const node = graph.nodes.find(n => n.id === nodeIdAttr);
                if (node) setSelectedNode(node);
            }
        }
        isDraggingRef.current = true;
        lastMouseRef.current = { x: e.clientX, y: e.clientY };
    };

    const handleMouseMoveSvg = (e: React.MouseEvent) => {
        if (!isDraggingRef.current) return;
        const dx = e.clientX - lastMouseRef.current.x;
        const dy = e.clientY - lastMouseRef.current.y;

        rotationRef.current.yaw += dx * 0.005;
        rotationRef.current.pitch = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, rotationRef.current.pitch + dy * 0.005));

        lastMouseRef.current = { x: e.clientX, y: e.clientY };
    };

    const handleMouseUpSvg = () => {
        isDraggingRef.current = false;
    };

    const gridPaths = React.useMemo(
        () => getGlobeGridPaths(rotationRef.current.yaw, rotationRef.current.pitch),
        // nodePositions is regenerated by the rAF tick whenever rotation advances,
        // making it the render-level signal that the grid should be recomputed.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [nodePositions]
    );
    const sortedEdges = React.useMemo(() => {
        return filteredEdges.map(edge => {
            const posU = nodePositions[edge.source];
            const posV = nodePositions[edge.target];
            const z = posU && posV ? (posU.z + posV.z) / 2 : 0;
            return { edge, z };
        });
    }, [filteredEdges, nodePositions]);

    // Depth-based draw order: split edges/nodes into behind-the-globe (z < 0) and
    // front batches so the SVG painter's algorithm correctly occludes far-side geometry.
    const backEdges = sortedEdges.filter(se => se.z < 0).map(se => se.edge);
    const frontEdges = sortedEdges.filter(se => se.z >= 0).map(se => se.edge);

    const sortedHubNodes = React.useMemo(() => {
        return filteredNodes.map(node => {
            const pos = nodePositions[node.id];
            const z = pos ? pos.z / 2 : 0;
            return { node, z };
        });
    }, [filteredNodes, nodePositions]);

    const backHubNodes = sortedHubNodes.filter(sh => sh.z < 0).map(sh => sh.node);
    const frontHubNodes = sortedHubNodes.filter(sh => sh.z >= 0).map(sh => sh.node);

    const backNodes = filteredNodes.filter(n => n.id !== '__user__' && (nodePositions[n.id]?.z || 0) < 0);
    const frontNodes = filteredNodes.filter(n => n.id !== '__user__' && (nodePositions[n.id]?.z || 0) >= 0);

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, flexWrap: 'wrap', gap: 12 }}>
                <div>
                    <SectionTitle>Memory Graph</SectionTitle>
                    <SectionSubtitle>Manage and visualize your long-term preferences, habits, and knowledge facts.</SectionSubtitle>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0, marginTop: 4, flexWrap: 'wrap' }}>
                    <button
                        onClick={() => setShowAddModal(true)}
                        style={{
                            padding: '7px 14px', borderRadius: 10, border: 'none',
                            backgroundColor: 'var(--color-accent, var(--color-info))', color: '#ffffff', fontSize: 12.5, fontWeight: 600,
                            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.15s',
                            boxShadow: 'var(--shadow-sm)'
                        }}
                        onMouseEnter={e => e.currentTarget.style.filter = 'brightness(1.1)'}
                        onMouseLeave={e => e.currentTarget.style.filter = 'none'}
                    >
                        <Plus size={15} weight="bold" />
                        Add Memory
                    </button>
                    <button
                        onClick={handleImportMerge}
                        disabled={!!isBusy}
                        title="Import a .json or .zip memory file and merge it with your current memory"
                        style={{
                            padding: '7px 14px', borderRadius: 10, border: '1px solid var(--color-border)',
                            backgroundColor: 'var(--color-bg-surface)', color: 'var(--color-text-primary)', fontSize: 12.5, fontWeight: 600,
                            cursor: isBusy ? 'not-allowed' : 'pointer', opacity: isBusy === 'import' ? 0.6 : 1,
                            display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.15s',
                            boxShadow: 'var(--shadow-xs)'
                        }}
                        onMouseEnter={e => { if (!isBusy) e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)'; }}
                        onMouseLeave={e => { if (!isBusy) e.currentTarget.style.backgroundColor = 'var(--color-bg-surface)'; }}
                    >
                        {isBusy === 'import' ? <CircleNotch size={15} className="animate-spin" /> : <DownloadSimple size={15} weight="bold" />}
                        {isBusy === 'import' ? 'Merging…' : 'Import & Merge'}
                    </button>
                    <button
                        onClick={handleExport}
                        disabled={!!isBusy || graph.nodes.length === 0}
                        title="Export your full memory graph as a ZIP file (includes linked markdown files)"
                        style={{
                            padding: '7px 14px', borderRadius: 10, border: '1px solid var(--color-border)',
                            backgroundColor: 'var(--color-bg-surface)', color: 'var(--color-text-primary)', fontSize: 12.5, fontWeight: 600,
                            cursor: (isBusy || graph.nodes.length === 0) ? 'not-allowed' : 'pointer',
                            opacity: (isBusy === 'export' || graph.nodes.length === 0) ? 0.6 : 1,
                            display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.15s',
                            boxShadow: 'var(--shadow-xs)'
                        }}
                        onMouseEnter={e => { if (!isBusy && graph.nodes.length > 0) e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)'; }}
                        onMouseLeave={e => { if (!isBusy) e.currentTarget.style.backgroundColor = 'var(--color-bg-surface)'; }}
                    >
                        {isBusy === 'export' ? <CircleNotch size={15} className="animate-spin" /> : <Export size={15} weight="bold" />}
                        {isBusy === 'export' ? 'Exporting…' : 'Export ZIP'}
                    </button>
                    <button
                        onClick={handleShareMemoryGraph}
                        disabled={!!isBusy || graph.nodes.length === 0}
                        title="Generate a beautiful image of your memory globe to share"
                        style={{
                            padding: '7px 14px', borderRadius: 10, border: 'none',
                            backgroundColor: 'var(--color-text-primary)', color: 'var(--color-text-inverse)', fontSize: 12.5, fontWeight: 600,
                            cursor: (isBusy || graph.nodes.length === 0) ? 'not-allowed' : 'pointer',
                            opacity: (isBusy || graph.nodes.length === 0) ? 0.6 : 1,
                            display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.15s',
                            boxShadow: 'var(--shadow-sm)'
                        }}
                        onMouseEnter={e => { if (!isBusy && graph.nodes.length > 0) e.currentTarget.style.backgroundColor = 'var(--color-text-secondary)'; }}
                        onMouseLeave={e => { if (!isBusy) e.currentTarget.style.backgroundColor = 'var(--color-text-primary)'; }}
                    >
                        {isBusy === 'share' ? <CircleNotch size={15} className="animate-spin" /> : <ShareNetwork size={15} weight="bold" />}
                        {isBusy === 'share' ? 'Generating…' : 'Share & Flex'}
                    </button>
                </div>
            </div>

            <div style={{
                background: 'linear-gradient(135deg, var(--color-accent-dim, rgba(59, 130, 246, 0.08)) 0%, var(--color-navis-active-bg, rgba(59, 130, 246, 0.04)) 100%)',
                border: '1px solid var(--color-accent, var(--color-info))',
                borderRadius: 12, padding: '12px 16px', marginBottom: 20,
                display: 'flex', gap: 12, alignItems: 'flex-start'
            }}>
                <Lightbulb size={20} weight="duotone" color="var(--color-accent, var(--color-info))" style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                    <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600, color: 'var(--color-accent-dark, #2563eb)', marginBottom: 3 }}>How Memory Works</p>
                    <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: 'var(--color-text-secondary)' }}>
                        EverFern learns your preferences, habits, and facts as you chat. Nodes are draggable on the 3D globe — click any node to see its full details.
                        Use <strong>Export ZIP</strong> to back up your memory, <strong>Import &amp; Merge</strong> to restore across devices, or <strong>Add Memory</strong> to record facts directly.
                    </p>
                </div>
            </div>

            <div style={{ display: 'flex', gap: 12, marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--color-border)', flexWrap: 'wrap' }}>
                {[
                    { id: 'preference', label: 'Preferences', count: graph.nodes.filter(n => n.type === 'preference').length, icon: Heart, iconColor: '#f43f5e', bg: 'rgba(244, 63, 94, 0.1)' },
                    { id: 'habit', label: 'Habits', count: graph.nodes.filter(n => n.type === 'habit').length, icon: Lightning, iconColor: 'var(--color-success)', bg: 'rgba(16, 185, 129, 0.1)' },
                    { id: 'fact', label: 'Facts', count: graph.nodes.filter(n => n.type === 'fact').length, icon: Info, iconColor: 'var(--color-info)', bg: 'rgba(59, 130, 246, 0.1)' },
                    { id: 'file', label: 'Files Linked', count: graph.nodes.filter(n => n.type === 'file').length, icon: FileText, iconColor: '#a855f7', bg: 'rgba(168, 85, 247, 0.1)' }
                ].map(stat => {
                    const IconComponent = stat.icon;
                    const isCurrent = filterType === stat.id;
                    return (
                        <div
                            key={stat.label}
                            onClick={() => setFilterType(prev => prev === stat.id ? 'all' : stat.id)}
                            style={{
                                fontSize: 12.5,
                                color: isCurrent ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                padding: '6px 12px',
                                borderRadius: 10,
                                border: isCurrent ? '1px solid var(--color-text-primary)' : '1px solid var(--color-border)',
                                backgroundColor: isCurrent ? 'var(--color-bg-hover)' : 'var(--color-bg-surface)',
                                cursor: 'pointer',
                                transition: 'all 0.15s'
                            }}
                        >
                            <div style={{ width: 22, height: 22, borderRadius: 6, backgroundColor: stat.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <IconComponent size={13} weight="fill" color={stat.iconColor} />
                            </div>
                            <span style={{ fontWeight: 600 }}>{stat.count}</span>
                            <span>{stat.label}</span>
                        </div>
                    );
                })}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {[
                        { id: 'all', label: 'All' },
                        { id: 'preference', label: 'Preferences' },
                        { id: 'habit', label: 'Habits' },
                        { id: 'fact', label: 'Facts' },
                        { id: 'file', label: 'Files' }
                    ].map(f => (
                        <button
                            key={f.id}
                            onClick={() => setFilterType(f.id)}
                            style={{
                                padding: '6px 12px',
                                borderRadius: 8,
                                fontSize: 12,
                                fontWeight: 600,
                                border: '1px solid var(--color-border)',
                                backgroundColor: filterType === f.id ? 'var(--color-text-primary)' : 'var(--color-bg-surface)',
                                color: filterType === f.id ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)',
                                cursor: 'pointer',
                                transition: 'all 0.15s'
                            }}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                        <MagnifyingGlass size={14} style={{ position: 'absolute', left: 10, color: 'var(--color-text-tertiary)' }} />
                        <Input
                            placeholder="Search memories..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            style={{ height: 34, padding: '4px 12px 4px 30px', borderRadius: 8, fontSize: 13, width: 180 }}
                        />
                    </div>
                    <div style={{ display: 'flex', border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden' }}>
                        <button
                            onClick={() => setViewMode('graph')}
                            title="Graph visualization"
                            style={{
                                padding: '6px 10px',
                                fontSize: 12,
                                fontWeight: 600,
                                border: 'none',
                                backgroundColor: viewMode === 'graph' ? 'var(--color-text-primary)' : 'var(--color-bg-surface)',
                                color: viewMode === 'graph' ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 5
                            }}
                        >
                            <Graph size={14} weight="bold" />
                            <span>Graph</span>
                        </button>
                        <button
                            onClick={() => setViewMode('list')}
                            title="List view"
                            style={{
                                padding: '6px 10px',
                                fontSize: 12,
                                fontWeight: 600,
                                border: 'none',
                                backgroundColor: viewMode === 'list' ? 'var(--color-text-primary)' : 'var(--color-bg-surface)',
                                color: viewMode === 'list' ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 5
                            }}
                        >
                            <ListDashes size={14} weight="bold" />
                            <span>List</span>
                        </button>
                    </div>
                </div>
            </div>

            {isLoading ? (
                <div style={{ textAlign: 'center', padding: 80, color: 'var(--color-text-tertiary)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                    <CircleNotch size={28} className="animate-spin" color="var(--color-accent, var(--color-info))" />
                    <span style={{ fontSize: 13, fontWeight: 500 }}>Loading Memory Graph...</span>
                </div>
            ) : graph.nodes.length === 0 ? (
                <Card style={{ padding: 48, textAlign: 'center', color: 'var(--color-text-tertiary)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <Brain size={52} weight="duotone" color="var(--color-accent, var(--color-info))" />
                    <h3 style={{ margin: '16px 0 8px', fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)' }}>No memory established yet</h3>
                    <p style={{ fontSize: 13, margin: '0 0 20px', lineHeight: 1.5, maxWidth: 440 }}>
                        As you chat with EverFern, your preferences, coding habits, and facts are automatically remembered. You can also manually add memories right now.
                    </p>
                    <button
                        onClick={() => setShowAddModal(true)}
                        style={{
                            padding: '8px 16px', borderRadius: 10, border: 'none',
                            backgroundColor: 'var(--color-accent, var(--color-info))', color: '#ffffff', fontSize: 13, fontWeight: 600,
                            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.15s',
                            boxShadow: 'var(--shadow-sm)'
                        }}
                    >
                        <Plus size={14} weight="bold" />
                        Add First Memory
                    </button>
                </Card>
            ) : (
                <div style={{ display: 'flex', gap: 20, minHeight: 400 }}>
                    <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column' }}>
                        {viewMode === 'graph' ? (
                            <div style={{ position: 'relative' }}>
                                <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    {[
                                        { icon: MagnifyingGlassPlus, title: 'Zoom in', onClick: () => setZoom(z => Math.min(z + 0.25, 3)) },
                                        { icon: MagnifyingGlassMinus, title: 'Zoom out', onClick: () => setZoom(z => Math.max(z - 0.25, 0.25)) },
                                        { icon: ArrowsCounterClockwise, title: 'Reset zoom & orientation', onClick: () => { setZoom(1); rotationRef.current = { yaw: 0, pitch: 0.2 }; } },
                                    ].map((btn, idx) => {
                                        const IconComp = btn.icon;
                                        return (
                                            <button
                                                key={idx}
                                                title={btn.title}
                                                onClick={btn.onClick}
                                                style={{
                                                    width: 28, height: 28, borderRadius: 8, border: '1px solid var(--color-border)',
                                                    backgroundColor: 'var(--color-bg-surface)', color: 'var(--color-text-secondary)', fontSize: 14,
                                                    fontWeight: 600, cursor: 'pointer', display: 'flex',
                                                    alignItems: 'center', justifyContent: 'center',
                                                    boxShadow: 'var(--shadow-xs)', transition: 'all 0.15s'
                                                }}
                                                onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
                                                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'var(--color-bg-surface)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
                                            >
                                                <IconComp size={14} weight="bold" />
                                            </button>
                                        );
                                    })}
                                    <div style={{ fontSize: 10, textAlign: 'center', color: 'var(--color-text-tertiary)', marginTop: 4, fontFamily: 'monospace' }}>{Math.round(zoom * 100)}%</div>
                                </div>
                                <svg
                                    ref={svgRef}
                                    width="100%"
                                    height="400"
                                    viewBox={`${300 - 300/zoom} ${200 - 200/zoom} ${600/zoom} ${400/zoom}`}
                                    onMouseDown={handleMouseDownSvg}
                                    onMouseMove={handleMouseMoveSvg}
                                    onMouseUp={handleMouseUpSvg}
                                    onMouseLeave={handleMouseUpSvg}
                                    style={{
                                        border: '1px solid var(--color-border)',
                                        borderRadius: 20,
                                        backgroundColor: globeBg100,
                                        boxShadow: 'var(--shadow-md)',
                                        cursor: 'grab'
                                    }}
                                >
                                    <defs>
                                        <radialGradient id="graph-bg" cx="50%" cy="50%" r="60%">
                                            <stop offset="0%" stopColor={globeBg0} stopOpacity="0.8" />
                                            <stop offset="100%" stopColor={globeBg100} stopOpacity="1" />
                                        </radialGradient>
                                        <radialGradient id="globe-shading" cx="50%" cy="50%" r="50%">
                                            <stop offset="85%" stopColor={globeShading} stopOpacity="0" />
                                            <stop offset="98%" stopColor={globeShading} stopOpacity="0.75" />
                                            <stop offset="100%" stopColor={globeShading} stopOpacity="0.95" />
                                        </radialGradient>
                                        <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
                                            <feGaussianBlur stdDeviation="2.5" result="blur" />
                                            <feComposite in="SourceGraphic" in2="blur" operator="over" />
                                        </filter>
                                        <filter id="glow-strong" x="-60%" y="-60%" width="220%" height="220%">
                                            <feGaussianBlur stdDeviation="4.5" result="blur" />
                                            <feComposite in="SourceGraphic" in2="blur" operator="over" />
                                        </filter>
                                    </defs>
                                    <rect width="100%" height="100%" fill="url(#graph-bg)" rx="20" />
                                    <g opacity="0.3" pointerEvents="none">
                                        {gridPaths.filter(p => !p.isFront).map((gp, idx) => (
                                            <path key={`bg-grid-back-${idx}`} d={gp.path} fill="none" stroke={gridStrokeBack} strokeWidth="0.75" strokeDasharray="2,2" />
                                        ))}
                                    </g>
                                    {backHubNodes.map(node => {
                                        const targetPos = nodePositions[node.id];
                                        const rootPos = nodePositions['__user__'];
                                        if (!targetPos || !rootPos) return null;
                                        return <line key={`hub-back-${node.id}`} x1={rootPos.x} y1={rootPos.y} x2={targetPos.x} y2={targetPos.y} stroke={hubStrokeBack} strokeWidth="0.5" />;
                                    })}
                                    {backEdges.map((edge, idx) => {
                                        const sourcePos = nodePositions[edge.source];
                                        const targetPos = nodePositions[edge.target];
                                        if (!sourcePos || !targetPos) return null;
                                        return <line key={`edge-back-${idx}`} x1={sourcePos.x} y1={sourcePos.y} x2={targetPos.x} y2={targetPos.y} stroke={edgeStrokeBack} strokeWidth="0.75" strokeDasharray={edge.type === 'linked_to' ? '2,2' : 'none'} />;
                                    })}
                                    {backNodes.map(node => {
                                        const pos = nodePositions[node.id];
                                        if (!pos) return null;
                                        let nodeColor = 'var(--color-text-tertiary)';
                                        if (node.type === 'preference') nodeColor = '#f43f5e';
                                        else if (node.type === 'habit') nodeColor = 'var(--color-success)';
                                        else if (node.type === 'fact') nodeColor = 'var(--color-info)';
                                        else if (node.type === 'file') nodeColor = '#a855f7';
                                        const zDepth = pos.z;
                                        const op = 0.15 + 0.25 * ((zDepth + 140) / 140);
                                        return (
                                            <g key={node.id} transform={`translate(${pos.x}, ${pos.y})`} onClick={() => setSelectedNode(node)} onMouseEnter={() => setHoveredNodeId(node.id)} onMouseLeave={() => setHoveredNodeId(null)} style={{ cursor: 'pointer' }}>
                                                <circle data-node-id={node.id} r={3} fill={nodeColor} opacity={op} stroke="var(--color-border)" strokeWidth={0.5} style={{ transition: 'all 0.15s ease' }} />
                                            </g>
                                        );
                                    })}
                                    <circle cx="300" cy="200" r="140" fill="url(#globe-shading)" pointerEvents="none" />
                                    <circle cx="300" cy="200" r="140" fill="none" stroke={gridStrokeFront} strokeWidth="1" pointerEvents="none" />
                                    <g opacity="0.3" pointerEvents="none">
                                        {gridPaths.filter(p => p.isFront).map((gp, idx) => (
                                            <path key={`bg-grid-front-${idx}`} d={gp.path} fill="none" stroke={gridStrokeFront} strokeWidth="0.75" />
                                        ))}
                                    </g>
                                    {(() => {
                                        const rootPos = nodePositions['__user__'];
                                        if (!rootPos || filteredNodes.length === 0) return null;
                                        const isHovered = hoveredNodeId === '__user__';
                                        return (
                                            <g key="__user__" transform={`translate(${rootPos.x}, ${rootPos.y})`} style={{ cursor: 'pointer' }} onMouseEnter={() => setHoveredNodeId('__user__')} onMouseLeave={() => setHoveredNodeId(null)}>
                                                <motion.circle r="16" fill="var(--color-accent-dim, rgba(59, 130, 246, 0.2))" stroke="var(--color-accent, var(--color-info))" strokeWidth="1" animate={isGraphVisible ? { scale: [1, 1.3, 1], opacity: [0.6, 0.2, 0.6] } : { scale: 1, opacity: 0.6 }} transition={{ repeat: isGraphVisible ? Infinity : 0, duration: 3, ease: "easeInOut" }} />
                                                <circle r={isHovered ? 8 : 6} fill="var(--color-accent, var(--color-info))" filter="url(#glow-strong)" stroke={nodeBorder} strokeWidth="1.5" style={{ transition: 'all 0.2s ease' }} />
                                            </g>
                                        );
                                    })()}
                                    {frontHubNodes.map(node => {
                                        const targetPos = nodePositions[node.id];
                                        const rootPos = nodePositions['__user__'];
                                        if (!targetPos || !rootPos) return null;
                                        return <line key={`hub-front-${node.id}`} x1={rootPos.x} y1={rootPos.y} x2={targetPos.x} y2={targetPos.y} stroke={hubStrokeFront} strokeWidth="0.75" />;
                                    })}
                                    {frontEdges.map((edge, idx) => {
                                        const sourcePos = nodePositions[edge.source];
                                        const targetPos = nodePositions[edge.target];
                                        if (!sourcePos || !targetPos) return null;
                                        return <line key={`edge-front-${idx}`} x1={sourcePos.x} y1={sourcePos.y} x2={targetPos.x} y2={targetPos.y} stroke={edgeStrokeFront} strokeWidth="1.25" strokeDasharray={edge.type === 'linked_to' ? '3,3' : 'none'} />;
                                    })}
                                    {frontNodes.map(node => {
                                        const pos = nodePositions[node.id];
                                        if (!pos) return null;
                                        const isSelected = selectedNode?.id === node.id;
                                        const isHovered = hoveredNodeId === node.id;
                                        const isFocused = isSelected || isHovered;
                                        let nodeColor = 'var(--color-text-tertiary)';
                                        let useGlow = false;
                                        if (node.type === 'preference') { nodeColor = '#f43f5e'; useGlow = true; }
                                        else if (node.type === 'habit') { nodeColor = 'var(--color-success)'; useGlow = true; }
                                        else if (node.type === 'fact') { nodeColor = 'var(--color-info)'; useGlow = true; }
                                        else if (node.type === 'file') { nodeColor = '#a855f7'; useGlow = true; }
                                        const zDepth = pos.z;
                                        const op = 0.5 + 0.5 * (zDepth / 140);
                                        const size = isFocused ? 7 : 5;
                                        const labelText = node.category?.length > 20 ? `${node.category.slice(0, 17)}...` : (node.category || node.name || 'Memory');
                                        const tooltipWidth = Math.max(70, labelText.length * 6.5);
                                        return (
                                            <g key={node.id} transform={`translate(${pos.x}, ${pos.y})`} onClick={() => setSelectedNode(node)} onMouseEnter={() => setHoveredNodeId(node.id)} onMouseLeave={() => setHoveredNodeId(null)} style={{ cursor: 'pointer' }}>
                                                {isSelected && <circle r="12" fill="none" stroke="var(--color-border-strong, var(--color-info))" strokeWidth="1.5" strokeDasharray="2,2" />}
                                                {isHovered && <circle r="10" fill="none" stroke="var(--color-accent-dim, rgba(59, 130, 246, 0.3))" strokeWidth="2" />}
                                                <circle data-node-id={node.id} r={size} fill={nodeColor} opacity={op} filter={useGlow && isFocused ? 'url(#glow-strong)' : useGlow ? 'url(#glow)' : 'none'} stroke={nodeBorder} strokeWidth={isFocused ? 1.5 : 1} style={{ transition: 'all 0.15s ease' }} />
                                                {isFocused && (
                                                    <g transform="translate(0, -18)" style={{ pointerEvents: 'none', zIndex: 100 }}>
                                                        <rect x={-tooltipWidth / 2} y="-13" width={tooltipWidth} height="18" rx="6" fill={tooltipBg} stroke={tooltipBorder} strokeWidth="1" style={{ filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.1))' }} />
                                                        <text textAnchor="middle" dy="-1" style={{ fontSize: 9.5, fontWeight: 600, fill: tooltipText, userSelect: 'none', fontFamily: 'sans-serif' }}>{labelText}</text>
                                                    </g>
                                                )}
                                            </g>
                                        );
                                    })}
                                </svg>
                            </div>
                        ) : (
                            <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 20, backgroundColor: 'var(--color-bg-surface)', maxHeight: 400 }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                    <thead>
                                        <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--color-border-strong)', backgroundColor: 'var(--color-bg-subtle)', position: 'sticky', top: 0, zIndex: 10 }}>
                                            <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-primary)' }}>Type</th>
                                            <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-primary)' }}>Category</th>
                                            <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-primary)' }}>Value</th>
                                            <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-primary)' }}>Linked File</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredNodes.length === 0 ? (
                                            <tr><td colSpan={4} style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-tertiary)' }}>No matching memories found.</td></tr>
                                        ) : (
                                            filteredNodes.map(node => {
                                                const isSelected = selectedNode?.id === node.id;
                                                let badgeBg = 'var(--color-bg-subtle)';
                                                let badgeColor = 'var(--color-text-secondary)';
                                                if (node.type === 'preference') { badgeBg = 'rgba(244, 63, 94, 0.1)'; badgeColor = '#f43f5e'; }
                                                else if (node.type === 'habit') { badgeBg = 'rgba(16, 185, 129, 0.1)'; badgeColor = 'var(--color-success)'; }
                                                else if (node.type === 'fact') { badgeBg = 'rgba(59, 130, 246, 0.1)'; badgeColor = 'var(--color-info)'; }
                                                else if (node.type === 'file') { badgeBg = 'rgba(168, 85, 247, 0.1)'; badgeColor = '#a855f7'; }
                                                return (
                                                    <tr key={node.id} onClick={() => setSelectedNode(node)} style={{ borderBottom: '1px solid var(--color-border-subtle)', cursor: 'pointer', backgroundColor: isSelected ? 'var(--color-bg-subtle)' : 'transparent', transition: 'background-color 0.15s' }} onMouseEnter={e => { if(!isSelected) e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)'; }} onMouseLeave={e => { if(!isSelected) e.currentTarget.style.backgroundColor = 'transparent'; }}>
                                                        <td style={{ padding: '12px 16px' }}>
                                                            <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, textTransform: 'capitalize', backgroundColor: badgeBg, color: badgeColor }}>{node.type}</span>
                                                        </td>
                                                        <td style={{ padding: '12px 16px', fontWeight: 500, color: 'var(--color-text-primary)' }}>{node.category || node.name}</td>
                                                        <td style={{ padding: '12px 16px', color: 'var(--color-text-secondary)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.value}</td>
                                                        <td style={{ padding: '12px 16px', color: 'var(--color-text-tertiary)', fontSize: 12 }}>{node.linkedFile || node.name || ''}</td>
                                                    </tr>
                                                );
                                            })
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                    <div style={{ width: 260, flexShrink: 0 }}>
                        <Card style={{ height: '100%', minHeight: 380, display: 'flex', flexDirection: 'column', padding: 20, borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg-surface)', margin: 0 }}>
                            {selectedNode ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%' }}>
                                    <div>
                                        <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', backgroundColor: selectedNode.type === 'preference' ? 'rgba(244, 63, 94, 0.1)' : selectedNode.type === 'habit' ? 'rgba(16, 185, 129, 0.1)' : selectedNode.type === 'fact' ? 'rgba(59, 130, 246, 0.1)' : 'var(--color-bg-subtle)', color: selectedNode.type === 'preference' ? '#f43f5e' : selectedNode.type === 'habit' ? 'var(--color-success)' : selectedNode.type === 'fact' ? 'var(--color-info)' : 'var(--color-text-secondary)' }}>{selectedNode.type}</span>
                                        <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text-primary)', marginTop: 10, marginBottom: 4 }}>{selectedNode.name || selectedNode.category}</h3>
                                        <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontFamily: 'monospace' }}>ID: {selectedNode.id.split('_').slice(-1)[0]}</span>
                                    </div>
                                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
                                        <div>
                                            <Label>Value</Label>
                                            <div style={{ padding: 10, backgroundColor: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', borderRadius: 10, fontSize: 13, lineHeight: 1.4, color: 'var(--color-text-primary)', wordBreak: 'break-word', maxHeight: 150, overflowY: 'auto' }}>{selectedNode.value}</div>
                                        </div>
                                        {selectedNode.metadata && (
                                            <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                {selectedNode.metadata.created && <div>Created: {new Date(selectedNode.metadata.created).toLocaleDateString()}</div>}
                                                {selectedNode.metadata.lastUpdated && <div>Updated: {new Date(selectedNode.metadata.lastUpdated).toLocaleDateString()}</div>}
                                            </div>
                                        )}
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 'auto' }}>
                                        {(selectedNode.linkedFile || selectedNode.type === 'file') && (
                                            <button onClick={() => handleOpenFile(selectedNode.type === 'file' ? selectedNode.value : selectedNode.metadata?.linkedFile || selectedNode.linkedFile)} style={{ padding: '8px 12px', backgroundColor: 'var(--color-bg-surface)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border)', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'all 0.15s' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)'} onMouseLeave={e => e.currentTarget.style.backgroundColor = 'var(--color-bg-surface)'}>
                                                <FileText size={15} weight="bold" />
                                                <span>Open File</span>
                                            </button>
                                        )}
                                        {selectedNode.type !== 'file' && (
                                            <button onClick={() => handleDeleteMemory(selectedNode.id)} style={{ padding: '8px 12px', backgroundColor: 'var(--color-error-dim)', color: 'var(--color-error)', border: '1px solid var(--color-error)', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'all 0.15s' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--color-error)'} onMouseLeave={e => e.currentTarget.style.backgroundColor = 'var(--color-error-dim)'}>
                                                <Trash size={15} weight="bold" />
                                                <span>Forget Memory</span>
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-tertiary)', textAlign: 'center', padding: '40px 10px' }}>
                                    <Brain size={32} weight="duotone" style={{ marginBottom: 12, opacity: 0.5 }} />
                                    <p style={{ fontSize: 13, margin: 0, lineHeight: 1.5 }}>
                                        Click on a node in the graph or a row in the list to view its details.
                                    </p>
                                </div>
                            )}
                        </Card>
                    </div>
                </div>
            )}

            {showAddModal && (
                <div
                    style={{
                        position: 'fixed',
                        inset: 0,
                        backgroundColor: 'rgba(0, 0, 0, 0.5)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 'var(--z-modal)',
                        backdropFilter: 'blur(4px)',
                    }}
                    onClick={() => setShowAddModal(false)}
                >
                    <div
                        ref={addModalRef}
                        role="dialog"
                        aria-modal="true"
                        aria-label="Add Memory"
                        style={{
                            width: '100%',
                            maxWidth: 480,
                            backgroundColor: 'var(--color-bg-surface)',
                            border: '1px solid var(--color-border)',
                            borderRadius: 16,
                            padding: 24,
                            boxShadow: 'var(--shadow-xl)',
                        }}
                        onClick={e => e.stopPropagation()}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: 'var(--color-text-primary)' }}>Add Memory</h3>
                            <button
                                onClick={() => setShowAddModal(false)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)', padding: 4 }}
                            >
                                <X size={18} />
                            </button>
                        </div>
                        <div style={{ marginBottom: 16 }}>
                            <Label>Memory Type</Label>
                            <div style={{ display: 'flex', gap: 8 }}>
                                {(['preference', 'habit', 'fact'] as const).map(t => (
                                    <button
                                        key={t}
                                        type="button"
                                        onClick={() => setNewMemoryType(t)}
                                        style={{
                                            flex: 1,
                                            padding: '8px 12px',
                                            borderRadius: 8,
                                            border: '1px solid var(--color-border)',
                                            backgroundColor: newMemoryType === t ? 'var(--color-accent, var(--color-info))' : 'var(--color-bg-subtle)',
                                            color: newMemoryType === t ? '#ffffff' : 'var(--color-text-secondary)',
                                            fontSize: 12.5,
                                            fontWeight: 600,
                                            cursor: 'pointer',
                                            textTransform: 'capitalize',
                                            transition: 'all 0.15s'
                                        }}
                                    >
                                        {t}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div style={{ marginBottom: 20 }}>
                            <Label>Memory Content / Fact</Label>
                            <textarea
                                value={newMemoryContent}
                                onChange={e => setNewMemoryContent(e.target.value)}
                                placeholder="e.g. Always use TypeScript and prefer functional programming style..."
                                rows={4}
                                style={{
                                    width: '100%',
                                    padding: '12px',
                                    borderRadius: 10,
                                    border: '1px solid var(--color-border)',
                                    backgroundColor: 'var(--color-bg-subtle)',
                                    color: 'var(--color-text-primary)',
                                    fontSize: 13,
                                    outline: 'none',
                                    resize: 'vertical',
                                    boxSizing: 'border-box',
                                    fontFamily: 'inherit',
                                }}
                            />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                            <button
                                type="button"
                                onClick={() => setShowAddModal(false)}
                                style={{
                                    padding: '8px 16px',
                                    borderRadius: 8,
                                    border: '1px solid var(--color-border)',
                                    backgroundColor: 'var(--color-bg-surface)',
                                    color: 'var(--color-text-primary)',
                                    fontSize: 13,
                                    fontWeight: 500,
                                    cursor: 'pointer',
                                }}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleSaveNewMemory}
                                disabled={isSavingMemory || !newMemoryContent.trim()}
                                style={{
                                    padding: '8px 16px',
                                    borderRadius: 8,
                                    border: 'none',
                                    backgroundColor: 'var(--color-accent, var(--color-info))',
                                    color: '#ffffff',
                                    fontSize: 13,
                                    fontWeight: 600,
                                    cursor: (isSavingMemory || !newMemoryContent.trim()) ? 'not-allowed' : 'pointer',
                                    opacity: (isSavingMemory || !newMemoryContent.trim()) ? 0.6 : 1,
                                }}
                            >
                                {isSavingMemory ? 'Saving…' : 'Save Memory'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
