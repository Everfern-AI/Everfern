import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
    XMarkIcon, 
    ClipboardIcon, 
    ArrowTopRightOnSquareIcon, 
    DocumentDuplicateIcon, 
    ListBulletIcon, 
    DocumentTextIcon, 
    TableCellsIcon, 
    PresentationChartBarIcon, 
    ArrowDownTrayIcon,
    ChevronDownIcon,
    SparklesIcon,
    GlobeAltIcon,
    CodeBracketIcon,
    PhotoIcon,
    FilmIcon,
    MusicalNoteIcon,
    ArchiveBoxIcon,
    MagnifyingGlassIcon,
    PrinterIcon,
    ArrowPathIcon,
    EyeIcon,
    ArrowLeftIcon,
    ArrowRightIcon
} from '@heroicons/react/24/outline';
import { useTheme } from '@/components/ThemeProvider';
import FileIcon from '@/app/chat/FileIcon';

interface FileViewerModalProps {
    file: { name: string; path: string } | null;
    onClose: () => void;
    chatId: string;
    projectPath?: string;
}

// ── 1. PDF VIEWER ───────────────────────────────────────────────────
export function PDFViewer({ file }: { file: { name: string; path: string } }) {
    const { theme } = useTheme();
    const isDark = theme === 'dark';
    const [zoom, setZoom] = useState(100);
    const [rotation, setRotation] = useState(0);
    const [pdfDataUrl, setPdfDataUrl] = useState<string | null>(null);
    const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
    const [loadingPdf, setLoadingPdf] = useState(true);
    const [loadError, setLoadError] = useState(false);
    const [copiedPath, setCopiedPath] = useState(false);
    const [apps, setApps] = useState<Array<{ name: string; path: string; icon: string }>>([]);
    const [showAppDropdown, setShowAppDropdown] = useState(false);
    const appDropdownRef = useRef<HTMLDivElement>(null);

    // NR-UI-09: mirror the URL in a ref so cleanup revokes the CURRENT blob
    // url, not the stale state value captured when this effect was created.
    const pdfBlobUrlRef = useRef<string | null>(null);
    const updatePdfBlobUrl = (url: string | null) => {
        pdfBlobUrlRef.current = url;
        setPdfBlobUrl(url);
    };

    // Fetch registered default opener apps (VS Code, Acrobat, Edge, etc.)
    useEffect(() => {
        if (!file?.path) return;
        (window as any).electronAPI?.system?.getFileApps?.(file.path)
            .then((res: any[]) => {
                if (Array.isArray(res)) setApps(res);
            })
            .catch(() => {});
    }, [file?.path]);

    // Handle outside click for app dropdown
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (appDropdownRef.current && !appDropdownRef.current.contains(e.target as Node)) {
                setShowAppDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Load PDF as base64 data URL and create Blob URL for reliable Chromium preview
    useEffect(() => {
        let isMounted = true;
        setLoadingPdf(true);
        setLoadError(false);

        const loadPdfBytes = async () => {
            try {
                if (!file?.path) return;

                // 1. Try reading via readImageDataUrl
                const imgRes = await (window as any).electronAPI?.system?.readImageDataUrl?.(file.path);
                if (isMounted && imgRes && imgRes.success && imgRes.dataUrl) {
                    setPdfDataUrl(imgRes.dataUrl);

                    // Convert base64 to Blob URL
                    try {
                        const base64Data = imgRes.dataUrl.split(',')[1];
                        if (base64Data) {
                            const byteCharacters = atob(base64Data);
                            const byteNumbers = new Array(byteCharacters.length);
                            for (let i = 0; i < byteCharacters.length; i++) {
                                byteNumbers[i] = byteCharacters.charCodeAt(i);
                            }
                            const byteArray = new Uint8Array(byteNumbers);
                            const blob = new Blob([byteArray], { type: 'application/pdf' });
                            const bUrl = URL.createObjectURL(blob);
                            if (isMounted) updatePdfBlobUrl(bUrl);
                        }
                    } catch (e) {
                        if (isMounted) updatePdfBlobUrl(imgRes.dataUrl);
                    }
                    if (isMounted) setLoadingPdf(false);
                    return;
                }

                // 2. Fallback to file:// URL
                const cleanPath = file.path.replace(/\\/g, '/');
                const fallbackUrl = `file:///${cleanPath.startsWith('/') ? cleanPath.slice(1) : cleanPath}`;
                if (isMounted) {
                    updatePdfBlobUrl(fallbackUrl);
                    setLoadingPdf(false);
                }
            } catch (err) {
                console.error("Failed to load PDF preview:", err);
                if (isMounted) {
                    setLoadError(true);
                    setLoadingPdf(false);
                }
            }
        };

        loadPdfBytes();

        return () => {
            isMounted = false;
            const currentUrl = pdfBlobUrlRef.current;
            if (currentUrl && currentUrl.startsWith('blob:')) {
                URL.revokeObjectURL(currentUrl);
            }
        };
    }, [file?.path]);

    const defaultApp = apps[0] || null;

    const handleOpenInApp = async (appPath?: string) => {
        setShowAppDropdown(false);
        try {
            if (appPath) {
                await (window as any).electronAPI?.system?.openFile?.(file.path, appPath);
            } else {
                await (window as any).electronAPI?.system?.openFile?.(file.path);
            }
        } catch {
            const cleanPath = file.path.replace(/\\/g, '/');
            (window as any).electronAPI?.system?.openExternal?.(`file:///${cleanPath}`);
        }
    };

    const handleCopyPath = async () => {
        try {
            await navigator.clipboard.writeText(file.path);
            setCopiedPath(true);
            setTimeout(() => setCopiedPath(false), 2000);
        } catch {}
    };

    const handleDownload = () => {
        const fileUrl = 'file:///' + file.path.replace(/\\/g, '/');
        const a = document.createElement('a');
        a.href = pdfDataUrl || fileUrl;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: isDark ? '#141416' : '#f4f4f6', minWidth: 0, minHeight: 0 }}>
            {/* PDF Control Bar */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 16px',
                borderBottom: isDark ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid rgba(0, 0, 0, 0.08)',
                backgroundColor: isDark ? '#1a1a1c' : '#ffffff',
                gap: 12,
                flexShrink: 0
            }}>
                {/* Left: Document Info & Status */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '4px 8px',
                        borderRadius: 6,
                        backgroundColor: 'rgba(239, 68, 68, 0.12)',
                        color: '#ef4444',
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em'
                    }}>
                        <DocumentTextIcon width={14} height={14} />
                        PDF Document
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)', fontWeight: 500 }}>
                        {file.name}
                    </span>
                </div>

                {/* Center: Zoom & Rotate Controls */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button
                        onClick={() => setZoom(prev => Math.max(50, prev - 15))}
                        title="Zoom Out"
                        style={{
                            padding: '5px 10px',
                            borderRadius: 6,
                            border: isDark ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid rgba(0, 0, 0, 0.1)',
                            backgroundColor: isDark ? '#222224' : '#f4f4f5',
                            color: 'var(--color-text-primary)',
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: 'pointer'
                        }}
                    >
                        -
                    </button>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', minWidth: 42, textAlign: 'center' }}>
                        {zoom}%
                    </span>
                    <button
                        onClick={() => setZoom(prev => Math.min(200, prev + 15))}
                        title="Zoom In"
                        style={{
                            padding: '5px 10px',
                            borderRadius: 6,
                            border: isDark ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid rgba(0, 0, 0, 0.1)',
                            backgroundColor: isDark ? '#222224' : '#f4f4f5',
                            color: 'var(--color-text-primary)',
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: 'pointer'
                        }}
                    >
                        +
                    </button>
                    <button
                        onClick={() => setZoom(100)}
                        title="Reset Zoom"
                        style={{
                            padding: '5px 10px',
                            borderRadius: 6,
                            border: isDark ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid rgba(0, 0, 0, 0.1)',
                            backgroundColor: isDark ? '#222224' : '#f4f4f5',
                            color: 'var(--color-text-secondary)',
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: 'pointer'
                        }}
                    >
                        Fit
                    </button>
                    <button
                        onClick={() => setRotation(prev => (prev + 90) % 360)}
                        title="Rotate 90°"
                        style={{
                            padding: '5px 8px',
                            borderRadius: 6,
                            border: isDark ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid rgba(0, 0, 0, 0.1)',
                            backgroundColor: isDark ? '#222224' : '#f4f4f5',
                            color: 'var(--color-text-secondary)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center'
                        }}
                    >
                        <ArrowPathIcon width={13} height={13} />
                    </button>
                </div>

                {/* Right: Dynamic App Opener with App Icon + Theme-aware Colors */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} ref={appDropdownRef}>
                    {/* Dynamic Default Opener Button: Seamless Unified Split Button */}
                    <div
                        style={{
                            position: 'relative',
                            display: 'flex',
                            alignItems: 'stretch',
                            height: 32,
                            borderRadius: 8,
                            backgroundColor: isDark ? '#ffffff' : '#18181b',
                            overflow: 'visible'
                        }}
                    >
                        <button
                            onClick={() => handleOpenInApp(defaultApp?.path)}
                            title={defaultApp ? `Open in ${defaultApp.name}` : 'Open in Default System PDF Reader'}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 7,
                                padding: '0 12px',
                                height: '100%',
                                borderRadius: apps.length > 1 ? '8px 0 0 8px' : '8px',
                                backgroundColor: 'transparent',
                                border: 'none',
                                color: isDark ? '#18181b' : '#ffffff',
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: 'pointer',
                                transition: 'background-color 0.15s ease',
                                whiteSpace: 'nowrap'
                            }}
                            onMouseEnter={e => { e.currentTarget.style.backgroundColor = isDark ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.12)'; }}
                            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                        >
                            {defaultApp?.icon ? (
                                <img src={defaultApp.icon} alt="" width={15} height={15} style={{ borderRadius: 2, flexShrink: 0 }} />
                            ) : (
                                <ArrowTopRightOnSquareIcon width={14} height={14} />
                            )}
                            <span>{defaultApp ? `Open in ${defaultApp.name}` : 'Open in System App'}</span>
                        </button>

                        {/* Optional Dropdown Seam & Chevron Button */}
                        {apps.length > 1 && (
                            <>
                                <div style={{
                                    width: 1,
                                    height: '100%',
                                    backgroundColor: isDark ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.18)'
                                }} />
                                <button
                                    onClick={() => setShowAppDropdown(prev => !prev)}
                                    title="Choose application"
                                    style={{
                                        height: '100%',
                                        padding: '0 8px',
                                        borderRadius: '0 8px 8px 0',
                                        backgroundColor: 'transparent',
                                        border: 'none',
                                        color: isDark ? '#18181b' : '#ffffff',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        cursor: 'pointer',
                                        transition: 'background-color 0.15s ease'
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.backgroundColor = isDark ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.12)'; }}
                                    onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                                >
                                    <ChevronDownIcon width={12} height={12} strokeWidth={2.5} />
                                </button>
                            </>
                        )}

                        {/* Apps Dropdown Menu */}
                        <AnimatePresence>
                            {showAppDropdown && (
                                <motion.div
                                    initial={{ opacity: 0, y: 4, scale: 0.97 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: 4, scale: 0.97 }}
                                    style={{
                                        position: 'absolute',
                                        top: 'calc(100% + 4px)',
                                        right: 0,
                                        zIndex: 100,
                                        backgroundColor: isDark ? '#1f1f23' : '#ffffff',
                                        border: isDark ? '1px solid rgba(255, 255, 255, 0.12)' : '1px solid rgba(0, 0, 0, 0.1)',
                                        borderRadius: 8,
                                        boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
                                        minWidth: 180,
                                        padding: '4px 0',
                                        overflow: 'hidden'
                                    }}
                                >
                                    <div style={{ padding: '4px 10px', fontSize: 10, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase' }}>
                                        Open with
                                    </div>
                                    {apps.map(app => (
                                        <button
                                            key={app.path}
                                            onClick={() => handleOpenInApp(app.path)}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 8,
                                                width: '100%',
                                                padding: '7px 10px',
                                                border: 'none',
                                                background: 'transparent',
                                                color: 'var(--color-text-primary)',
                                                fontSize: 12,
                                                cursor: 'pointer',
                                                textAlign: 'left'
                                            }}
                                            onMouseEnter={e => { e.currentTarget.style.backgroundColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'; }}
                                            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                                        >
                                            {app.icon && <img src={app.icon} alt="" width={15} height={15} style={{ borderRadius: 2 }} />}
                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{app.name}</span>
                                        </button>
                                    ))}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
            </div>

            {/* Embedded PDF View Frame */}
            <div style={{
                flex: 1,
                position: 'relative',
                overflow: 'auto',
                backgroundColor: isDark ? '#0e0e10' : '#e4e4e7',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 16
            }}>
                {loadingPdf ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: 'var(--color-text-tertiary)', fontSize: 13 }}>
                        <DocumentTextIcon width={36} height={36} className="animate-pulse" />
                        <span>Rendering PDF preview...</span>
                    </div>
                ) : pdfBlobUrl ? (
                    <div style={{
                        width: `${zoom}%`,
                        height: `${zoom}%`,
                        maxWidth: zoom > 100 ? `${zoom}%` : '100%',
                        maxHeight: zoom > 100 ? `${zoom}%` : '100%',
                        transform: rotation !== 0 ? `rotate(${rotation}deg)` : 'none',
                        transition: 'transform 0.2s ease, width 0.15s ease, height 0.15s ease',
                        display: 'flex',
                        flexDirection: 'column',
                        position: 'relative'
                    }}>
                        <iframe
                            src={`${pdfBlobUrl}#toolbar=1&navpanes=1&scrollbar=1`}
                            title={file.name}
                            onError={() => setLoadError(true)}
                            style={{
                                width: '100%',
                                height: '100%',
                                minHeight: 600,
                                border: 'none',
                                backgroundColor: isDark ? '#1a1a1c' : '#ffffff',
                                borderRadius: 6,
                                boxShadow: '0 8px 32px rgba(0,0,0,0.2)'
                            }}
                        />
                    </div>
                ) : (
                    <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: 'var(--color-bg-base)',
                        gap: 16,
                        padding: 32,
                        textAlign: 'center',
                        borderRadius: 12
                    }}>
                        <DocumentTextIcon width={48} height={48} style={{ color: '#ef4444' }} />
                        <div>
                            <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)', margin: '0 0 6px 0' }}>
                                PDF Document Ready
                            </h3>
                            <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: 0, maxWidth: 400 }}>
                                Open this PDF in your default application {defaultApp ? `(${defaultApp.name})` : ''} to view all pages.
                            </p>
                        </div>
                        <button
                            onClick={() => handleOpenInApp(defaultApp?.path)}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                padding: '10px 20px',
                                borderRadius: 8,
                                backgroundColor: isDark ? '#ffffff' : '#18181b',
                                color: isDark ? '#18181b' : '#ffffff',
                                border: 'none',
                                fontWeight: 600,
                                fontSize: 13,
                                cursor: 'pointer',
                                transition: 'all 0.15s ease'
                            }}
                            onMouseEnter={e => { e.currentTarget.style.backgroundColor = isDark ? '#e4e4e7' : '#27272a'; }}
                            onMouseLeave={e => { e.currentTarget.style.backgroundColor = isDark ? '#ffffff' : '#18181b'; }}
                        >
                            {defaultApp?.icon ? (
                                <img src={defaultApp.icon} alt="" width={16} height={16} style={{ borderRadius: 3 }} />
                            ) : (
                                <ArrowTopRightOnSquareIcon width={16} height={16} />
                            )}
                            Open in {defaultApp?.name || 'System PDF App'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

// ── 2. MARKDOWN VIEWER ──────────────────────────────────────────────
export function MarkdownViewer({ content }: { content: string }) {
    const { theme } = useTheme();
    const isDark = theme === 'dark';

    const renderMarkdown = (text: string) => {
        const lines = text.split('\n');
        const elements: React.ReactNode[] = [];
        let inCodeBlock = false;
        let codeBlockContent: string[] = [];
        let codeBlockLang = '';

        const formatInline = (t: string) => {
            const codeBlocks: string[] = [];
            let f = t.replace(/`(.*?)`/g, (_, c) => {
                codeBlocks.push(`<code style="background-color: var(--color-bg-subtle); padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 13px; color: var(--color-accent);">${c}</code>`);
                return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
            });
            f = f.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            f = f.replace(/__(.*?)\__/g, '<strong>$1</strong>');
            f = f.replace(/\*(.*?)\*/g, '<em>$1</em>');
            f = f.replace(/_(.*?)_/g, '<em>$1</em>');
            codeBlocks.forEach((block, idx) => {
                f = f.replace(`__CODE_BLOCK_${idx}__`, () => block);
            });
            return f;
        };

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            if (line.trim().startsWith('```')) {
                if (inCodeBlock) {
                    inCodeBlock = false;
                    const code = codeBlockContent.join('\n');
                    codeBlockContent = [];
                    elements.push(
                        <pre key={`code-${i}`} style={{ 
                            backgroundColor: isDark ? '#101012' : '#f4f4f6', 
                            color: 'var(--color-text-primary)', 
                            padding: 16, 
                            borderRadius: 8, 
                            overflowX: 'auto', 
                            fontSize: 13, 
                            fontFamily: 'monospace', 
                            margin: '14px 0',
                            border: isDark ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid rgba(0, 0, 0, 0.08)'
                        }}>
                            <code>{code}</code>
                        </pre>
                    );
                } else {
                    inCodeBlock = true;
                    codeBlockLang = line.trim().substring(3);
                }
                continue;
            }

            if (inCodeBlock) {
                codeBlockContent.push(line);
                continue;
            }

            if (line.startsWith('# ')) {
                elements.push(<h1 key={`h1-${i}`} style={{ fontSize: 24, fontWeight: 700, margin: '24px 0 12px 0', borderBottom: isDark ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid rgba(0, 0, 0, 0.08)', paddingBottom: 6, color: 'var(--color-text-primary)' }}>{line.substring(2)}</h1>);
                continue;
            }
            if (line.startsWith('## ')) {
                elements.push(<h2 key={`h2-${i}`} style={{ fontSize: 19, fontWeight: 600, margin: '20px 0 10px 0', borderBottom: isDark ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid rgba(0, 0, 0, 0.08)', paddingBottom: 4, color: 'var(--color-text-primary)' }}>{line.substring(3)}</h2>);
                continue;
            }
            if (line.startsWith('### ')) {
                elements.push(<h3 key={`h3-${i}`} style={{ fontSize: 15.5, fontWeight: 600, margin: '16px 0 8px 0', color: 'var(--color-text-primary)' }}>{line.substring(4)}</h3>);
                continue;
            }

            // Table support
            if (line.includes('|') && i + 1 < lines.length && lines[i + 1].includes('---')) {
                const headers = line.split('|').map(h => h.trim()).filter(Boolean);
                i += 2;
                const rows: string[][] = [];
                while (i < lines.length && lines[i].includes('|')) {
                    const cells = lines[i].split('|').map(c => c.trim()).filter(Boolean);
                    if (cells.length > 0) rows.push(cells);
                    i++;
                }
                i--;
                elements.push(
                    <div key={`table-${i}`} style={{ overflowX: 'auto', margin: '14px 0', borderRadius: 8, border: isDark ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid rgba(0, 0, 0, 0.08)' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                                <tr style={{ backgroundColor: isDark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.02)' }}>
                                    {headers.map((h, j) => (
                                        <th key={j} style={{ padding: '8px 12px', borderBottom: isDark ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid rgba(0, 0, 0, 0.08)', textAlign: 'left', color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }} dangerouslySetInnerHTML={{ __html: formatInline(h) }} />
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row, ri) => (
                                    <tr key={ri} style={{ borderBottom: isDark ? '1px solid rgba(255, 255, 255, 0.04)' : '1px solid rgba(0, 0, 0, 0.04)' }}>
                                        {row.map((cell, ci) => (
                                            <td key={ci} style={{ padding: '8px 12px', color: 'var(--color-text-primary)' }} dangerouslySetInnerHTML={{ __html: formatInline(cell) }} />
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                );
                continue;
            }

            if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
                const itemContent = line.trim().substring(2);
                elements.push(
                    <li key={`li-${i}`} style={{ margin: '6px 0 6px 20px', fontSize: 14, color: 'var(--color-text-primary)', lineHeight: 1.6 }}
                        dangerouslySetInnerHTML={{ __html: formatInline(itemContent) }}
                    />
                );
                continue;
            }

            if (line.trim() === '---') {
                elements.push(<hr key={`hr-${i}`} style={{ border: 'none', borderTop: isDark ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid rgba(0, 0, 0, 0.08)', margin: '20px 0' }} />);
                continue;
            }

            if (line.trim() === '') {
                elements.push(<div key={`spacer-${i}`} style={{ height: 10 }} />);
                continue;
            }

            elements.push(
                <p key={`p-${i}`} style={{ fontSize: 14, lineHeight: 1.7, margin: '8px 0', color: 'var(--color-text-primary)' }}
                    dangerouslySetInnerHTML={{ __html: formatInline(line) }}
                />
            );
        }

        return elements;
    };

    return (
        <div style={{ 
            padding: '32px 48px', 
            overflowY: 'auto', 
            height: '100%', 
            fontFamily: 'Inter, sans-serif', 
            backgroundColor: 'var(--color-bg-surface)',
            color: 'var(--color-text-primary)'
        }}>
            <div style={{ maxWidth: 740, margin: '0 auto', paddingBottom: 80 }}>
                {renderMarkdown(content)}
            </div>
        </div>
    );
}

// ── 3. EXCEL & CSV VIEWER ───────────────────────────────────────────
// NR-UI-10: bijective base-26 column labels (A..Z, AA..ZZ, ...).
// String.fromCharCode(65 + i) emits punctuation past column Z.
const excelColumnLabel = (index: number): string => {
    let label = '';
    let n = index;
    do {
        label = String.fromCharCode(65 + (n % 26)) + label;
        n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return label;
};

function ExcelViewer({ filename, content }: { filename: string; content: string | null }) {
    const { theme } = useTheme();
    const isDark = theme === 'dark';
    const [filterQuery, setFilterQuery] = useState('');

    let parsedData: string[][] = [];
    if (content && (filename.endsWith('.csv') || filename.endsWith('.tsv') || content.includes(',') || content.includes('\t'))) {
        const delimiter = filename.endsWith('.tsv') ? '\t' : ',';
        parsedData = content.split('\n')
            .map(row => {
                const cells: string[] = [];
                let insideQuote = false;
                let currentCell = '';
                for (let i = 0; i < row.length; i++) {
                    const char = row[i];
                    if (char === '"') insideQuote = !insideQuote;
                    else if (char === delimiter && !insideQuote) {
                        cells.push(currentCell.replace(/^"|"$/g, '').trim());
                        currentCell = '';
                    } else {
                        currentCell += char;
                    }
                }
                cells.push(currentCell.replace(/^"|"$/g, '').trim());
                return cells;
            })
            .filter(row => row.length > 1 || (row[0] && row[0] !== ''));
    }

    const filteredRows = React.useMemo(() => {
        if (!filterQuery) return parsedData;
        const q = filterQuery.toLowerCase();
        return parsedData.filter((row, idx) => {
            if (idx === 0) return true; // keep header
            return row.some(cell => cell.toLowerCase().includes(q));
        });
    }, [parsedData, filterQuery]);

    const columns = Array.from({ length: Math.max(parsedData[0]?.length || 10, 10) }, (_, i) => excelColumnLabel(i));

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--color-bg-base)', minWidth: 0, minHeight: 0 }}>
            {/* Formula & Filter Bar */}
            <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 12, 
                padding: '8px 16px', 
                borderBottom: isDark ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid rgba(0, 0, 0, 0.08)', 
                backgroundColor: isDark ? '#1a1a1c' : '#ffffff' 
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#10b981', fontStyle: 'italic', paddingRight: 4 }}>fx</span>
                    <div style={{ borderLeft: isDark ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid rgba(0, 0, 0, 0.1)', height: 16 }} />
                    <input 
                        type="text" 
                        readOnly
                        value={parsedData[1] ? `=SUM(${columns[3]}2:${columns[3]}${parsedData.length})` : ''} 
                        style={{ flex: 1, border: 'none', outline: 'none', fontSize: 12, color: 'var(--color-text-primary)', background: 'transparent', fontWeight: 500 }} 
                    />
                </div>

                {/* Filter / Search input */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 6, backgroundColor: isDark ? '#222224' : '#f4f4f5', border: isDark ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid rgba(0, 0, 0, 0.08)' }}>
                    <MagnifyingGlassIcon width={13} height={13} style={{ color: 'var(--color-text-tertiary)' }} />
                    <input
                        type="text"
                        placeholder="Filter table rows..."
                        value={filterQuery}
                        onChange={e => setFilterQuery(e.target.value)}
                        style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 11.5, color: 'var(--color-text-primary)', width: 140 }}
                    />
                    {filterQuery && (
                        <button onClick={() => setFilterQuery('')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, color: 'var(--color-text-tertiary)' }}>
                            <XMarkIcon width={12} height={12} />
                        </button>
                    )}
                </div>
            </div>

            <div className="excel-scrollable" style={{ flex: 1, overflow: 'auto', position: 'relative', maxWidth: '100%', maxHeight: '100%', minHeight: 0, minWidth: 0 }}>
                <table style={{ borderCollapse: 'collapse', width: 'max-content', minWidth: '100%', fontSize: 12, backgroundColor: 'var(--color-bg-surface)' }}>
                    <thead>
                        <tr>
                            <th style={{ backgroundColor: isDark ? '#1e1e20' : '#f4f4f5', border: isDark ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid rgba(0, 0, 0, 0.08)', width: 45, height: 28, position: 'sticky', top: 0, left: 0, zIndex: 10 }}></th>
                            {columns.map((col, i) => (
                                <th key={i} style={{ backgroundColor: isDark ? '#1e1e20' : '#f4f4f5', border: isDark ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid rgba(0, 0, 0, 0.08)', fontWeight: 600, color: 'var(--color-text-secondary)', position: 'sticky', top: 0, zIndex: 9, minWidth: 120, height: 28, textAlign: 'center' }}>
                                    {col}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {filteredRows.map((row, rowIndex) => (
                            <tr key={rowIndex}>
                                <td style={{ backgroundColor: isDark ? '#1e1e20' : '#f4f4f5', border: isDark ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid rgba(0, 0, 0, 0.08)', fontWeight: 600, color: 'var(--color-text-secondary)', textAlign: 'center', width: 45, height: 26, position: 'sticky', left: 0, zIndex: 8 }}>
                                    {rowIndex + 1}
                                </td>
                                {row.map((cell, cellIndex) => (
                                    <td 
                                        key={cellIndex} 
                                        style={{ 
                                            border: isDark ? '1px solid rgba(255, 255, 255, 0.06)' : '1px solid rgba(0, 0, 0, 0.06)', 
                                            padding: '6px 12px', 
                                            whiteSpace: 'nowrap', 
                                            fontWeight: rowIndex === 0 ? 600 : 'normal',
                                            backgroundColor: rowIndex === 0 
                                                ? (isDark ? '#232326' : '#ededf0') 
                                                : 'transparent',
                                            color: 'var(--color-text-primary)'
                                        }}
                                    >
                                        {cell}
                                    </td>
                                ))}
                                {Array.from({ length: Math.max(0, columns.length - row.length) }).map((_, i) => (
                                    <td key={row.length + i} style={{ border: isDark ? '1px solid rgba(255, 255, 255, 0.06)' : '1px solid rgba(0, 0, 0, 0.06)', backgroundColor: 'transparent' }} />
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ── 4. POWERPOINT (PPTX) VIEWER ─────────────────────────────────────
function PPTViewer({ filename, filePath }: { filename: string; filePath?: string }) {
    const { theme } = useTheme();
    const isDark = theme === 'dark';
    const [activeSlide, setActiveSlide] = useState(0);
    const [slides, setSlides] = useState<Array<{ title: string; subtitle: string; points: string[] }>>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!filePath) {
            setLoading(false);
            setError("No file path provided");
            return;
        }

        let isMounted = true;
        setLoading(true);
        setError(null);

        (window as any).electronAPI?.system?.parsePptx?.(filePath)
            .then((res: any) => {
                if (!isMounted) return;
                if (res && res.success && res.slides && res.slides.length > 0) {
                    setSlides(res.slides);
                    setActiveSlide(0);
                } else {
                    setError(res?.error || "Could not parse presentation slides or file is empty");
                }
                setLoading(false);
            })
            .catch((err: any) => {
                if (!isMounted) return;
                setError(err.message || "Failed to parse presentation");
                setLoading(false);
            });

        return () => {
            isMounted = false;
        };
    }, [filePath]);

    if (loading) {
        return (
            <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-bg-subtle)', width: '100%', minHeight: 400 }}>
                <div style={{ textAlign: 'center' }}>
                    <div style={{ marginBottom: 8, fontSize: 15, fontWeight: 500, color: 'var(--color-text-primary)' }}>Parsing Presentation Slides...</div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>Extracting slide deck content</div>
                </div>
            </div>
        );
    }

    if (error || slides.length === 0) {
        return (
            <div style={{ display: 'flex', flex: 1, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', backgroundColor: 'var(--color-bg-subtle)', padding: 24, textAlign: 'center', width: '100%', minHeight: 400, gap: 12 }}>
                <PresentationChartBarIcon width={36} height={36} style={{ color: '#f59e0b' }} />
                <div style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>PowerPoint Presentation</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', maxWidth: 400 }}>{error || "Presentation slides ready."}</div>
            </div>
        );
    }

    const currentSlide = slides[activeSlide] || { title: "", subtitle: "", points: [] };

    return (
        <div style={{ display: 'flex', height: '100%', backgroundColor: 'var(--color-bg-base)', width: '100%', minWidth: 0, minHeight: 0 }}>
            {/* Sidebar with slide previews */}
            <div style={{ width: 180, borderRight: isDark ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid rgba(0, 0, 0, 0.08)', display: 'flex', flexDirection: 'column', gap: 10, padding: 12, overflowY: 'auto', flexShrink: 0 }}>
                {slides.map((slide, index) => (
                    <div 
                        key={index}
                        onClick={() => setActiveSlide(index)}
                        style={{
                            border: `2px solid ${activeSlide === index ? 'var(--color-accent)' : (isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)')}`,
                            borderRadius: 6,
                            padding: 8,
                            backgroundColor: 'var(--color-bg-surface)',
                            cursor: 'pointer',
                            aspectRatio: '16/9',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                            transition: 'all 0.15s',
                            flexShrink: 0
                        }}
                    >
                        <span style={{ fontSize: 9, color: activeSlide === index ? 'var(--color-accent)' : 'var(--color-text-tertiary)', fontWeight: 600 }}>Slide {index + 1}</span>
                        <div style={{ fontSize: 8, color: 'var(--color-text-secondary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {slide.title || `Slide ${index + 1}`}
                        </div>
                    </div>
                ))}
            </div>

            {/* Slide Stage */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 24, justifyContent: 'center', alignItems: 'center', gap: 16, minWidth: 0, overflowY: 'auto' }}>
                <div style={{
                    width: '100%',
                    maxWidth: 640,
                    aspectRatio: '16/9',
                    backgroundColor: 'var(--color-bg-surface)',
                    boxShadow: 'var(--shadow-lg)',
                    borderRadius: 10,
                    padding: '28px 36px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    fontFamily: 'Inter, sans-serif',
                    boxSizing: 'border-box',
                    border: isDark ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid rgba(0, 0, 0, 0.08)'
                }}>
                    <div>
                        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-text-primary)', borderBottom: '2px solid var(--color-accent)', paddingBottom: 6, wordBreak: 'break-word' }}>
                            {currentSlide.title || "Untitled Slide"}
                        </div>
                        {currentSlide.subtitle && (
                            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 4, fontStyle: 'italic', wordBreak: 'break-word' }}>
                                {currentSlide.subtitle}
                            </div>
                        )}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '12px 0', flex: 1, justifyContent: 'center', overflowY: 'auto' }}>
                        {currentSlide.points.map((pt, i) => (
                            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                                <div style={{ width: 5, height: 5, borderRadius: '50%', backgroundColor: 'var(--color-accent)', marginTop: 6, flexShrink: 0 }} />
                                <div style={{ fontSize: 13, color: 'var(--color-text-primary)', lineHeight: 1.4, wordBreak: 'break-word' }}>{pt}</div>
                            </div>
                        ))}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 9, color: 'var(--color-text-tertiary)', borderTop: isDark ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid rgba(0, 0, 0, 0.08)', paddingTop: 6 }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>{filename}</span>
                        <span>Slide {activeSlide + 1} of {slides.length}</span>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <button 
                        onClick={() => setActiveSlide(prev => Math.max(0, prev - 1))}
                        disabled={activeSlide === 0}
                        style={{
                            padding: '5px 14px',
                            borderRadius: 6,
                            border: isDark ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid rgba(0, 0, 0, 0.1)',
                            backgroundColor: 'var(--color-bg-surface)',
                            color: activeSlide === 0 ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)',
                            cursor: activeSlide === 0 ? 'not-allowed' : 'pointer',
                            fontSize: 12,
                            fontWeight: 600
                        }}
                    >
                        Prev
                    </button>
                    <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', fontWeight: 500 }}>
                        {activeSlide + 1} / {slides.length}
                    </span>
                    <button 
                        onClick={() => setActiveSlide(prev => Math.min(slides.length - 1, prev + 1))}
                        disabled={activeSlide === slides.length - 1}
                        style={{
                            padding: '5px 14px',
                            borderRadius: 6,
                            border: isDark ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid rgba(0, 0, 0, 0.1)',
                            backgroundColor: 'var(--color-bg-surface)',
                            color: activeSlide === slides.length - 1 ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)',
                            cursor: activeSlide === slides.length - 1 ? 'not-allowed' : 'pointer',
                            fontSize: 12,
                            fontWeight: 600
                        }}
                    >
                        Next
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── Simple Syntax Highlighter ─────────────────────────────────────────
function highlightCode(code: string, extension: string, isDark: boolean): string {
    const colors = {
        keyword: isDark ? '#c678dd' : '#a626a4',
        string: isDark ? '#98c379' : '#50a14f',
        comment: isDark ? '#5c6370' : '#a0a1a7',
        function: isDark ? '#61afef' : '#4078f2',
        number: isDark ? '#d19a66' : '#986801',
        operator: isDark ? '#56b6c2' : '#0184bc',
    };

    const keywords = /\b(import|from|export|default|const|let|var|function|class|extends|return|if|else|for|while|do|switch|case|break|continue|try|catch|finally|throw|new|this|typeof|instanceof|void|delete|in|of|async|await|yield|get|set|static|public|private|protected|interface|type|enum|namespace|module|require|exports|global|window|document|console|true|false|null|undefined)\b/g;
    const strings = /(['"`])(?:(?!\1).|\\.)*?\1/g;
    const comments = /(\/\/.*$|\/\*[\s\S]*?\*\/|#.*$)/gm;
    const functions = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?=\()/g;
    const numbers = /\b\d+\.?\d*\b/g;
    const operators = /[\+\-\*\/=<>!&\|\^%]+/g;

    // Escape HTML
    let highlighted = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Store comments and strings to restore later
    const placeholders: { [key: string]: string } = {};
    let counter = 0;

    // Extract comments
    highlighted = highlighted.replace(comments, (match) => {
        const key = `__PLACEHOLDER_${counter++}__`;
        placeholders[key] = `<span style="color: ${colors.comment}">${match}</span>`;
        return key;
    });

    // Extract strings
    highlighted = highlighted.replace(strings, (match) => {
        const key = `__PLACEHOLDER_${counter++}__`;
        placeholders[key] = `<span style="color: ${colors.string}">${match}</span>`;
        return key;
    });

    // Highlight functions
    highlighted = highlighted.replace(functions, (match) => {
        return `<span style="color: ${colors.function}">${match}</span>`;
    });

    // Highlight keywords
    highlighted = highlighted.replace(keywords, (match) => {
        return `<span style="color: ${colors.keyword}">${match}</span>`;
    });

    // Highlight numbers
    highlighted = highlighted.replace(numbers, (match) => {
        return `<span style="color: ${colors.number}">${match}</span>`;
    });

    // Highlight operators
    highlighted = highlighted.replace(operators, (match) => {
        return `<span style="color: ${colors.operator}">${match}</span>`;
    });

    // Restore placeholders
    Object.keys(placeholders).forEach(key => {
        highlighted = highlighted.replace(key, placeholders[key]);
    });

    return highlighted;
}

// ── 5. CODE & TEXT VIEWER (20+ Code & Data Languages) ────────────────
function CodeTextViewer({ filename, content, extension }: { filename: string; content: string | null; extension: string }) {
    const { theme } = useTheme();
    const isDark = theme === 'dark';
    const isHtml = extension === 'html' || extension === 'htm';
    const [viewMode, setViewMode] = useState<'code' | 'preview'>(isHtml ? 'preview' : 'code');
    const [copySuccess, setCopySuccess] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    const handleCopy = () => {
        if (!content) return;
        navigator.clipboard.writeText(content);
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
    };

    if (content === null) {
        return (
            <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-secondary)', fontSize: 13 }}>
                Loading file content...
            </div>
        );
    }

    const lines = content.split('\n');

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: isDark ? '#101012' : '#ffffff' }}>
            <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'space-between', 
                padding: '8px 16px', 
                borderBottom: isDark ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid rgba(0, 0, 0, 0.08)', 
                backgroundColor: isDark ? '#161618' : '#f9f9fb' 
            }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {isHtml && (
                        <div style={{ display: 'flex', gap: 4, padding: 3, backgroundColor: isDark ? '#222224' : '#e4e4e7', borderRadius: 8 }}>
                            <button
                                onClick={() => setViewMode('preview')}
                                style={{
                                    padding: '4px 12px',
                                    borderRadius: 6,
                                    fontSize: 11.5,
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    border: 'none',
                                    backgroundColor: viewMode === 'preview' ? 'var(--color-bg-active)' : 'transparent',
                                    color: viewMode === 'preview' ? 'var(--color-text-primary)' : 'var(--color-text-secondary)'
                                }}
                            >
                                Live Preview
                            </button>
                            <button
                                onClick={() => setViewMode('code')}
                                style={{
                                    padding: '4px 12px',
                                    borderRadius: 6,
                                    fontSize: 11.5,
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    border: 'none',
                                    backgroundColor: viewMode === 'code' ? 'var(--color-bg-active)' : 'transparent',
                                    color: viewMode === 'code' ? 'var(--color-text-primary)' : 'var(--color-text-secondary)'
                                }}
                            >
                                Source Code
                            </button>
                        </div>
                    )}
                    <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontFamily: 'monospace' }}>
                        {lines.length} lines · {extension.toUpperCase()}
                    </span>
                </div>

                <button
                    onClick={handleCopy}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '5px 12px',
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: 500,
                        cursor: 'pointer',
                        border: isDark ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid rgba(0, 0, 0, 0.1)',
                        backgroundColor: isDark ? '#222224' : '#f4f4f5',
                        color: 'var(--color-text-secondary)',
                        transition: 'all 0.15s'
                    }}
                >
                    <ClipboardIcon width={13} height={13} />
                    {copySuccess ? 'Copied!' : 'Copy Code'}
                </button>
            </div>

            <div style={{ flex: 1, overflow: 'auto' }}>
                {viewMode === 'preview' && isHtml ? (
                    <iframe
                        title="HTML Preview"
                        srcDoc={content}
                        sandbox="allow-scripts allow-same-origin"
                        style={{ width: '100%', height: '100%', border: 'none', backgroundColor: '#ffffff' }}
                    />
                ) : (
                    <div style={{ display: 'flex', fontFamily: 'JetBrains Mono, Fira Code, monospace', fontSize: 12.5, lineHeight: '21px', color: 'var(--color-text-primary)', padding: '12px 16px' }}>
                        <div style={{ textAlign: 'right', paddingRight: 14, color: 'var(--color-text-tertiary)', userSelect: 'none', borderRight: isDark ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid rgba(0, 0, 0, 0.08)', marginRight: 14, minWidth: 32 }}>
                            {lines.map((_, i) => (
                                <div key={i}>{i + 1}</div>
                            ))}
                        </div>
                        <pre style={{ margin: 0, overflowX: 'auto', flex: 1, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>
                            <code dangerouslySetInnerHTML={{ __html: highlightCode(content, extension, isDark) }} />
                        </pre>
                    </div>
                )}
            </div>
        </div>
    );
}

// ── 6. MEDIA VIEWER (Images, Video, Audio, Archives) ────────────────
function MediaViewer({ file }: { file: { name: string; path: string } }) {
    const { theme } = useTheme();
    const isDark = theme === 'dark';
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    
    const isImage = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'avif', 'tiff'].includes(ext);
    const isVideo = ['mp4', 'webm', 'mov', 'mkv', 'ogv'].includes(ext);
    const isAudio = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(ext);
    const isArchive = ['zip', 'tar', 'gz', 'tgz', '7z', 'rar'].includes(ext);

    const src = 'file:///' + file.path.replace(/\\/g, '/');

    if (isImage) {
        return (
            <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                height: '100%', 
                backgroundColor: isDark ? '#0d0d0f' : '#f0f0f2', 
                padding: 24,
                backgroundImage: isDark
                    ? 'radial-gradient(rgba(255,255,255,0.05) 1px, transparent 0)'
                    : 'radial-gradient(rgba(0,0,0,0.05) 1px, transparent 0)',
                backgroundSize: '16px 16px'
            }}>
                <img 
                    src={src} 
                    alt={file.name} 
                    style={{ maxWidth: '90%', maxHeight: '90%', objectFit: 'contain', borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }} 
                />
            </div>
        );
    }

    if (isVideo) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', backgroundColor: '#000000', padding: 24 }}>
                <video 
                    controls 
                    autoPlay 
                    src={src} 
                    style={{ maxWidth: '90%', maxHeight: '90%', borderRadius: 8 }}
                />
            </div>
        );
    }

    if (isAudio) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', backgroundColor: 'var(--color-bg-base)', padding: 32, gap: 20 }}>
                <div style={{
                    width: 72,
                    height: 72,
                    borderRadius: '50%',
                    backgroundColor: 'rgba(59, 130, 246, 0.15)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#3b82f6'
                }}>
                    <MusicalNoteIcon width={36} height={36} />
                </div>
                <div style={{ textAlign: 'center' }}>
                    <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)', margin: '0 0 4px 0' }}>{file.name}</h3>
                    <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0 }}>Audio Track</p>
                </div>
                <audio controls src={src} style={{ width: 340 }} />
            </div>
        );
    }

    if (isArchive) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', backgroundColor: 'var(--color-bg-base)', padding: 32, gap: 16, textAlign: 'center' }}>
                <ArchiveBoxIcon width={44} height={44} style={{ color: 'var(--color-accent)' }} />
                <div>
                    <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)', margin: '0 0 4px 0' }}>{file.name}</h3>
                    <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: 0 }}>Compressed archive package.</p>
                </div>
                <button
                    onClick={() => {
                        (window as any).electronAPI?.system?.openFile?.(file.path);
                    }}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '8px 18px',
                        borderRadius: 8,
                        backgroundColor: '#3b82f6',
                        color: '#ffffff',
                        border: 'none',
                        fontWeight: 600,
                        cursor: 'pointer',
                        fontSize: 13
                    }}
                >
                    <ArrowTopRightOnSquareIcon width={16} height={16} />
                    Open in System Archive Manager
                </button>
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', backgroundColor: 'var(--color-bg-base)', padding: 32, gap: 16, textAlign: 'center' }}>
            <FileIcon size="lg" fileName={file.name} />
            <div>
                <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)', margin: '0 0 4px 0' }}>{file.name}</h3>
                <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: 0 }}>View or open this file in your default system application.</p>
            </div>
            <button
                onClick={() => {
                    (window as any).electronAPI?.system?.openFile?.(file.path);
                }}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 18px',
                    borderRadius: 8,
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'var(--color-bg-surface)',
                    color: 'var(--color-text-primary)',
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontSize: 13
                }}
            >
                <ArrowTopRightOnSquareIcon width={16} height={16} />
                Open Externally
            </button>
        </div>
    );
}

// ── MAIN MODAL COMPONENT ───────────────────────────────────────────
export default function FileViewerModal({ file, onClose, chatId, projectPath }: FileViewerModalProps) {
    const { theme } = useTheme();
    const isDark = theme === 'dark';

    const [content, setContent] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [copyPathSuccess, setCopyPathSuccess] = useState(false);
    const [showSidebar, setShowSidebar] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [lastModifiedText, setLastModifiedText] = useState('Just now');
    const [isPillBtnHovered, setIsPillBtnHovered] = useState(false);

    useEffect(() => {
        if (!file) return;
        setLoading(true);
        setContent(null);

        const readFileContent = async () => {
            try {
                let res = null;
                // 1. Try reading from artifacts directory
                try {
                    res = await (window as any).electronAPI?.artifacts.read(chatId, file.name, projectPath);
                } catch (e) {}

                // 2. If null, try reading from absolute path
                if (res === null && file.path) {
                    const lastSlash = Math.max(file.path.lastIndexOf('\\'), file.path.lastIndexOf('/'));
                    const dir = lastSlash !== -1 ? file.path.substring(0, lastSlash) : '';
                    const name = lastSlash !== -1 ? file.path.substring(lastSlash + 1) : file.name;
                    res = await (window as any).electronAPI?.projects.readFile(dir, name);
                }

                // 3. Fallbacks for DOCX and XLSX
                const extension = file.name.split('.').pop()?.toLowerCase() || '';
                if (res === null && (extension === 'docx' || extension === 'doc') && file.path) {
                    const docxRes = await (window as any).electronAPI?.system.parseDocx(file.path);
                    if (docxRes && docxRes.success && docxRes.text) {
                        res = docxRes.text;
                    }
                } else if ((extension === 'xlsx' || extension === 'xls') && file.path) {
                    const xlsxRes = await (window as any).electronAPI?.system.parseXlsx(file.path);
                    if (xlsxRes && xlsxRes.success && xlsxRes.csv) {
                        res = xlsxRes.csv;
                    }
                }

                if (res !== null) {
                    setContent(res);
                }

                // Get last modified text
                if (file.path) {
                    try {
                        const list = await (window as any).electronAPI?.artifacts.list(chatId);
                        const art = list?.find((a: any) => a.name === file.name);
                        if (art && art.lastEdited) {
                            const diffMins = Math.round((Date.now() - art.lastEdited) / 60000);
                            if (diffMins < 1) setLastModifiedText('Just now');
                            else if (diffMins === 1) setLastModifiedText('Last modified: 1 minute ago');
                            else if (diffMins < 60) setLastModifiedText(`Last modified: ${diffMins} minutes ago`);
                            else setLastModifiedText(`Last modified: ${new Date(art.lastEdited).toLocaleTimeString()}`);
                        } else {
                            setLastModifiedText('Last modified: Just now');
                        }
                    } catch {}
                }
            } catch (err) {
                console.error("Error reading file content:", err);
            } finally {
                setLoading(false);
            }
        };

        readFileContent();
    }, [file, chatId, projectPath]);

    if (!file) return null;

    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    
    // Categorize 20+ file formats
    const getViewerType = () => {
        if (extension === 'pdf') return 'pdf';
        if (['md', 'markdown', 'mdown', 'mkdn', 'rst'].includes(extension)) return 'markdown';
        if (['xlsx', 'xls', 'csv', 'tsv'].includes(extension)) return 'excel';
        if (['pptx', 'ppt', 'ppsx', 'key'].includes(extension)) return 'ppt';
        if ([
            'py', 'java', 'html', 'htm', 'css', 'scss', 'sass', 'less', 'js', 'ts', 'tsx', 'jsx', 'json', 
            'jsonl', 'xml', 'yaml', 'yml', 'toml', 'txt', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd', 'sql',
            'rs', 'go', 'c', 'cpp', 'h', 'hpp', 'cs', 'kt', 'swift', 'php', 'rb', 'lua', 'dart', 'diff', 'patch'
        ].includes(extension)) {
            return 'code';
        }
        return 'media';
    };

    const viewerType = getViewerType();

    const handleCopyPath = () => {
        navigator.clipboard.writeText(file.path);
        setCopyPathSuccess(true);
        setTimeout(() => setCopyPathSuccess(false), 2000);
    };

    const handleDownload = () => {
        const fileUrl = 'file:///' + file.path.replace(/\\/g, '/');
        const a = document.createElement('a');
        a.href = fileUrl;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    // Determine floating pill text & action based on content and file type
    const getFloatingPillDetails = () => {
        const lowerName = file.name.toLowerCase();
        // Hide for HTML files and code files (already code, doesn't need conversion)
        if (extension === 'html' || extension === 'htm' || viewerType === 'code') {
            return null;
        }
        if (viewerType === 'excel') {
            return {
                icon: <TableCellsIcon width={16} height={16} style={{ color: '#10b981' }} />,
                text: "Turn this spreadsheet into an interactive dashboard?",
                btnText: "Generate Dashboard",
                query: `Generate an interactive dashboard for the spreadsheet ${file.name}`
            };
        }
        if (viewerType === 'ppt') {
            return {
                icon: <PresentationChartBarIcon width={16} height={16} style={{ color: 'var(--color-accent)' }} />,
                text: "Turn this presentation into a shareable slide deck?",
                btnText: "Create Slides",
                query: `Create a shareable web presentation for ${file.name}`
            };
        }
        return {
            icon: <SparklesIcon width={16} height={16} style={{ color: 'var(--color-accent)' }} />,
            text: "Turn this document into a shareable web page?",
            btnText: "Create website",
            query: `Create a shareable web page for the document ${file.name}`
        };
    };

    const pillDetails = getFloatingPillDetails();

    const handlePillAction = () => {
        if (!pillDetails) return;
        window.dispatchEvent(new CustomEvent('send-chat-message', { detail: pillDetails!.query }));
        onClose();
    };

    const handleShareAction = () => {
        window.dispatchEvent(new CustomEvent('send-chat-message', { detail: `Can you help me share this file: ${file.name}?` }));
        onClose();
    };

    return (
        <AnimatePresence>
            <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: isFullscreen ? 0 : 24 }}>
                {/* Backdrop Blur Overlay */}
                <motion.div 
                    initial={{ opacity: 0 }} 
                    animate={{ opacity: 1 }} 
                    exit={{ opacity: 0 }} 
                    onClick={onClose}
                    style={{
                        position: 'absolute',
                        inset: 0,
                        backgroundColor: 'rgba(0, 0, 0, 0.65)',
                        backdropFilter: 'blur(8px)',
                        WebkitBackdropFilter: 'blur(8px)'
                    }} 
                />

                {/* Modal Container */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.97, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.97, y: 10 }}
                    transition={{ type: 'spring', damping: 28, stiffness: 240 }}
                    className="glossy"
                    style={{
                        position: 'relative',
                        width: isFullscreen ? '100vw' : '92%',
                        maxWidth: isFullscreen ? '100vw' : 1240,
                        height: isFullscreen ? '100vh' : '86vh',
                        backgroundColor: 'var(--color-bg-surface)',
                        border: isFullscreen ? 'none' : (isDark ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid rgba(0, 0, 0, 0.1)'),
                        borderRadius: isFullscreen ? 0 : 16,
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: 'hidden',
                        zIndex: 10
                    }}
                >
                    {/* Header */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '14px 20px',
                        borderBottom: isDark ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid rgba(0, 0, 0, 0.08)',
                        backgroundColor: isDark ? '#161618' : '#fafafa'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            {/* Color-coded Doc Icon */}
                            <div style={{
                                width: 34,
                                height: 34,
                                borderRadius: 8,
                                backgroundColor: isDark ? '#222224' : '#f4f4f5',
                                border: isDark ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid rgba(0, 0, 0, 0.08)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0
                            }}>
                                {extension === 'pdf' ? (
                                    <DocumentTextIcon width={18} height={18} style={{ color: '#ef4444' }} />
                                ) : ['xlsx', 'xls', 'csv'].includes(extension) ? (
                                    <TableCellsIcon width={18} height={18} style={{ color: '#10b981' }} />
                                ) : ['pptx', 'ppt'].includes(extension) ? (
                                    <PresentationChartBarIcon width={18} height={18} style={{ color: '#f59e0b' }} />
                                ) : (
                                    <DocumentTextIcon width={18} height={18} style={{ color: '#3b82f6' }} />
                                )}
                            </div>
                            
                            <div>
                                <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
                                    {file.name}
                                </h2>
                                <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: 0, fontWeight: 500, marginTop: 1 }}>
                                    {lastModifiedText}
                                </p>
                            </div>
                        </div>

                        {/* Top Right Action Row */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {/* Share */}
                            <button
                                onClick={handleShareAction}
                                title="Share document"
                                style={{
                                    border: 'none',
                                    background: 'transparent',
                                    color: 'var(--color-text-secondary)',
                                    cursor: 'pointer',
                                    padding: '6px 8px',
                                    borderRadius: 6,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    transition: 'all 0.15s'
                                }}
                                onMouseEnter={e => { e.currentTarget.style.backgroundColor = isDark ? '#222224' : '#f4f4f5'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
                                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
                            >
                                <GlobeAltIcon width={18} height={18} />
                            </button>

                            {/* Download */}
                            <button
                                onClick={handleDownload}
                                title="Download document"
                                style={{
                                    border: 'none',
                                    background: 'transparent',
                                    color: 'var(--color-text-secondary)',
                                    cursor: 'pointer',
                                    padding: '6px 8px',
                                    borderRadius: 6,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    transition: 'all 0.15s'
                                }}
                                onMouseEnter={e => { e.currentTarget.style.backgroundColor = isDark ? '#222224' : '#f4f4f5'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
                                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
                            >
                                <ArrowDownTrayIcon width={18} height={18} />
                            </button>

                            {/* Columns / Sidebar Layout toggle */}
                            <button
                                onClick={() => setShowSidebar(!showSidebar)}
                                title="Toggle File Details Sidebar"
                                style={{
                                    border: 'none',
                                    background: showSidebar ? (isDark ? '#2a2a2e' : '#e4e4e7') : 'transparent',
                                    color: showSidebar ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                                    cursor: 'pointer',
                                    padding: '6px 8px',
                                    borderRadius: 6,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    transition: 'all 0.15s'
                                }}
                                onMouseEnter={e => { if(!showSidebar) e.currentTarget.style.backgroundColor = isDark ? '#222224' : '#f4f4f5'; }}
                                onMouseLeave={e => { if(!showSidebar) e.currentTarget.style.backgroundColor = 'transparent'; }}
                            >
                                <ListBulletIcon width={18} height={18} />
                            </button>

                            {/* Fullscreen */}
                            <button
                                onClick={() => setIsFullscreen(!isFullscreen)}
                                title="Toggle Fullscreen"
                                style={{
                                    border: 'none',
                                    background: 'transparent',
                                    color: 'var(--color-text-secondary)',
                                    cursor: 'pointer',
                                    padding: '6px 8px',
                                    borderRadius: 6,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    transition: 'all 0.15s'
                                }}
                                onMouseEnter={e => { e.currentTarget.style.backgroundColor = isDark ? '#222224' : '#f4f4f5'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
                                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
                            >
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    {isFullscreen ? (
                                        <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7" />
                                    ) : (
                                        <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3M10 21v-6H4M14 3v6h6" />
                                    )}
                                </svg>
                            </button>

                            <div style={{ height: 16, borderLeft: isDark ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid rgba(0, 0, 0, 0.1)', margin: '0 4px' }} />

                            {/* Close */}
                            <button
                                onClick={onClose}
                                style={{
                                    border: 'none',
                                    background: 'transparent',
                                    color: 'var(--color-text-secondary)',
                                    cursor: 'pointer',
                                    padding: '6px 8px',
                                    borderRadius: 6,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    transition: 'all 0.15s'
                                }}
                                onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#ef4444'; e.currentTarget.style.color = '#ffffff'; }}
                                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
                            >
                                <XMarkIcon width={18} height={18} />
                            </button>
                        </div>
                    </div>

                    {/* Content Split Pane */}
                    <div style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative' }}>
                        {/* Left: Centered Content Area */}
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative' }}>
                            {loading && viewerType !== 'pdf' ? (
                                <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', fontSize: 13, color: 'var(--color-text-tertiary)', backgroundColor: 'var(--color-bg-surface)' }}>
                                    Loading file content...
                                </div>
                            ) : (
                                <>
                                    {viewerType === 'pdf' && <PDFViewer file={file} />}
                                    {viewerType === 'markdown' && <MarkdownViewer content={content || ''} />}
                                    {viewerType === 'excel' && <ExcelViewer filename={file.name} content={content} />}
                                    {viewerType === 'ppt' && <PPTViewer filename={file.name} filePath={file.path} />}
                                    {viewerType === 'code' && <CodeTextViewer filename={file.name} content={content} extension={extension} />}
                                    {viewerType === 'media' && <MediaViewer file={file} />}
                                </>
                            )}

                            {/* Floating bottom pill overlay */}
                            {!loading && pillDetails && (
                                <motion.div
                                    initial={{ y: 24, x: '-50%', opacity: 0, scale: 0.9 }}
                                    animate={{ y: 0, x: '-50%', opacity: 1, scale: 1 }}
                                    exit={{ y: 24, x: '-50%', opacity: 0, scale: 0.9 }}
                                    transition={{ delay: 0.25, type: 'spring', damping: 22, stiffness: 300 }}
                                    style={{
                                        position: 'absolute',
                                        bottom: 20,
                                        left: '50%',
                                        zIndex: 50,
                                        backgroundColor: isDark ? '#1a1a1c' : '#ffffff',
                                        border: isDark ? '1px solid rgba(255, 255, 255, 0.12)' : '1px solid rgba(0, 0, 0, 0.1)',
                                        borderRadius: 24,
                                        padding: '6px 6px 6px 16px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 14,
                                        boxShadow: isDark ? '0 12px 32px rgba(0,0,0,0.55)' : '0 12px 32px rgba(0,0,0,0.12)',
                                        maxWidth: '90%',
                                        whiteSpace: 'nowrap'
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        {pillDetails.icon}
                                        <span style={{ fontSize: 13, color: 'var(--color-text-primary)', fontWeight: 500 }}>
                                            {pillDetails.text}
                                        </span>
                                    </div>
                                    <button
                                        onClick={handlePillAction}
                                        onMouseEnter={() => setIsPillBtnHovered(true)}
                                        onMouseLeave={() => setIsPillBtnHovered(false)}
                                        style={{
                                            backgroundColor: isDark
                                                ? (isPillBtnHovered ? '#e4e4e7' : '#ffffff')
                                                : (isPillBtnHovered ? '#3f3f46' : '#18181b'),
                                            color: isDark ? '#18181b' : '#ffffff',
                                            border: 'none',
                                            borderRadius: 18,
                                            padding: '7px 16px',
                                            fontSize: 12,
                                            fontWeight: 600,
                                            cursor: 'pointer',
                                            transition: 'all 0.15s ease'
                                        }}
                                    >
                                        {pillDetails.btnText}
                                    </button>
                                </motion.div>
                            )}
                        </div>

                        {/* Right: Sidebar Panel (toggled visibility) */}
                        <AnimatePresence>
                            {showSidebar && (
                                <motion.div
                                    initial={{ width: 0, opacity: 0 }}
                                    animate={{ width: 280, opacity: 1 }}
                                    exit={{ width: 0, opacity: 0 }}
                                    transition={{ type: 'spring', damping: 28, stiffness: 220 }}
                                    style={{
                                        backgroundColor: isDark ? '#161618' : '#fafafa',
                                        borderLeft: isDark ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid rgba(0, 0, 0, 0.08)',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: 20,
                                        flexShrink: 0,
                                        overflow: 'hidden',
                                        boxSizing: 'border-box',
                                        padding: 20
                                    }}
                                >
                                    {/* File Info */}
                                    <div style={{ minWidth: 240 }}>
                                        <h4 style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 10px 0' }}>File Info</h4>
                                        <div style={{
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: 12,
                                            backgroundColor: 'var(--color-bg-surface)',
                                            padding: 14,
                                            borderRadius: 10,
                                            border: isDark ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid rgba(0, 0, 0, 0.08)'
                                        }}>
                                            <div>
                                                <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>Filename</div>
                                                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)', wordBreak: 'break-all', marginTop: 2 }}>{file.name}</div>
                                            </div>
                                            <div>
                                                <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>Format</div>
                                                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)', textTransform: 'uppercase', marginTop: 2 }}>{extension || 'Unknown'}</div>
                                            </div>
                                            <div>
                                                <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>Path</div>
                                                <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', wordBreak: 'break-all', marginTop: 2, fontFamily: 'monospace' }}>{file.path}</div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Quick Actions */}
                                    <div style={{ minWidth: 240, display: 'flex', flexDirection: 'column', gap: 8 }}>
                                        <button
                                            onClick={handleCopyPath}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 8,
                                                padding: '9px 12px',
                                                borderRadius: 8,
                                                border: isDark ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid rgba(0, 0, 0, 0.1)',
                                                backgroundColor: isDark ? '#222224' : '#ffffff',
                                                color: 'var(--color-text-primary)',
                                                fontSize: 12,
                                                fontWeight: 500,
                                                cursor: 'pointer'
                                            }}
                                        >
                                            <ClipboardIcon width={14} height={14} />
                                            {copyPathSuccess ? 'Path Copied!' : 'Copy Path'}
                                        </button>
                                        <button
                                            onClick={handleDownload}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 8,
                                                padding: '9px 12px',
                                                borderRadius: 8,
                                                border: isDark ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid rgba(0, 0, 0, 0.1)',
                                                backgroundColor: isDark ? '#222224' : '#ffffff',
                                                color: 'var(--color-text-primary)',
                                                fontSize: 12,
                                                fontWeight: 500,
                                                cursor: 'pointer'
                                            }}
                                        >
                                            <ArrowDownTrayIcon width={14} height={14} />
                                            Save to Disk
                                        </button>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
