'use client';
import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
    XMarkIcon, 
    PencilSquareIcon, 
    CheckIcon, 
    ArrowDownTrayIcon, 
    GlobeAltIcon, 
    ArrowTopRightOnSquareIcon,
    TableCellsIcon,
    PresentationChartBarIcon,
} from '@heroicons/react/24/outline';
import FileIcon from './FileIcon';

interface Artifact {
    id: string; // filename
    chatId: string;
    name: string;
    lastEdited: number;
    snippet: string;
    size: number;
}

interface ArtifactsPanelProps {
    isOpen: boolean;
    onClose: () => void;
    activeChatId?: string | null;
    onApprovePlan?: (planContent: string) => void;
    selectedFileName?: string | null;
    projectPath?: string | null;
}

// CU-STRM-02: theme-aware syntax-highlight palette. Roles map to globals.css
// tokens (CSS vars are valid in inline styles) so highlight colors follow the
// active light/dark theme; the low-contrast hardcoded comment gray is gone.
// keyword/property/boolean keep their hex: globals.css has NO fuchsia/purple
// semantic token (--color-accent is teal and reserved for function/attr/key).
const SYNTAX_COLORS = {
    keyword: '#d946ef',
    string: 'var(--color-success)',        // was #16a34a
    number: 'var(--color-info)',           // was #2563eb
    comment: 'var(--color-text-tertiary)', // was #8a8886
    function: 'var(--color-accent)',       // was #0891b2
    tag: 'var(--color-error)',             // was #dc2626
    attr: 'var(--color-accent)',
    property: '#d946ef',
    value: 'var(--color-info)',
    selector: 'var(--color-error)',
    key: 'var(--color-accent)',
    boolean: '#d946ef',
};

// ── 1. MARKDOWN VIEWER ──────────────────────────────────────────────
export function MarkdownViewer({ content }: { content: string }) {
    const renderMarkdown = (text: string) => {
        const lines = text.split('\n');
        const elements: React.ReactNode[] = [];
        let inCodeBlock = false;
        let codeBlockContent: string[] = [];
        let codeBlockLang = '';

        const formatInline = (text: string) => {
            let f = text;
            f = f.replace(/`(.*?)`/g, '<code style="background-color: var(--color-bg-subtle); padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 13px; color: var(--color-accent);">$1</code>');
            f = f.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            f = f.replace(/__(.*?)\__/g, '<strong>$1</strong>');
            f = f.replace(/\*(.*?)\*/g, '<em>$1</em>');
            f = f.replace(/_(.*?)_/g, '<em>$1</em>');
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
                            backgroundColor: '#1e1e1a', 
                            color: '#f8f7f2', 
                            padding: 16, 
                            borderRadius: 8, 
                            overflowX: 'auto', 
                            fontSize: 13, 
                            fontFamily: 'monospace', 
                            margin: '12px 0',
                            border: '1px solid #2d2d27'
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
                elements.push(<h1 key={`h1-${i}`} style={{ fontSize: 24, fontWeight: 700, margin: '20px 0 10px 0', borderBottom: '1px solid var(--color-border)', paddingBottom: 6, color: 'var(--color-text-primary)' }}>{line.substring(2)}</h1>);
                continue;
            }
            if (line.startsWith('## ')) {
                elements.push(<h2 key={`h2-${i}`} style={{ fontSize: 20, fontWeight: 600, margin: '18px 0 8px 0', borderBottom: '1px solid var(--color-border)', paddingBottom: 4, color: 'var(--color-text-primary)' }}>{line.substring(3)}</h2>);
                continue;
            }
            if (line.startsWith('### ')) {
                elements.push(<h3 key={`h3-${i}`} style={{ fontSize: 16, fontWeight: 600, margin: '16px 0 6px 0', color: 'var(--color-text-primary)' }}>{line.substring(4)}</h3>);
                continue;
            }

            // Table support: detect pipe table (line with | followed by separator line with ---)
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
                    <div key={`table-${i}`} style={{ overflowX: 'auto', margin: '12px 0' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                                <tr>
                                    {headers.map((h, j) => (
                                        <th key={j} style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)', textAlign: 'left', color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }} dangerouslySetInnerHTML={{ __html: formatInline(h) }} />
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row, ri) => (
                                    <tr key={ri} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                        {row.map((cell, ci) => (
                                            <td key={ci} style={{ padding: '8px 12px', color: 'var(--color-text-secondary)' }} dangerouslySetInnerHTML={{ __html: formatInline(cell) }} />
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
                const content = line.trim().substring(2);
                elements.push(
                    <li key={`li-${i}`} style={{ margin: '4px 0 4px 20px', fontSize: 14, color: 'var(--color-text-primary)' }}
                        dangerouslySetInnerHTML={{ __html: formatInline(content) }}
                    />
                );
                continue;
            }

            if (line.trim() === '---') {
                elements.push(<hr key={`hr-${i}`} style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: '20px 0' }} />);
                continue;
            }

            if (line.trim() === '') {
                elements.push(<div key={`spacer-${i}`} style={{ height: 10 }} />);
                continue;
            }

            elements.push(
                <p key={`p-${i}`} style={{ fontSize: 14, lineHeight: 1.6, margin: '8px 0', color: 'var(--color-text-primary)' }}
                    dangerouslySetInnerHTML={{ __html: formatInline(line) }}
                />
            );
        }

        return elements;
    };

    return (
        <div style={{ padding: 28, overflowY: 'auto', height: '100%', fontFamily: 'Inter, sans-serif', backgroundColor: 'var(--color-bg-surface)', borderTopLeftRadius: 8 }}>
            {renderMarkdown(content)}
        </div>
    );
}

// ── 2. EXCEL (XLSX/CSV) VIEWER ──────────────────────────────────────
function ExcelViewer({ filename, content }: { filename: string; content: string | null }) {
    
    let parsedData: string[][] = [];
    if (content && (filename.endsWith('.csv') || content.includes(','))) {
        parsedData = content.split('\n')
            .map(row => row.split(',').map(cell => cell.trim().replace(/^["']|["']$/g, '')))
            .filter(row => row.length > 1 || row[0] !== '');
    }

    if (parsedData.length === 0) {
        parsedData = [
            ['Column A', 'Column B', 'Column C', 'Column D'],
            ['Row 1', 'Sample Data', 'Active', '102.50'],
            ['Row 2', 'Verification', 'Pending', '45.00'],
            ['Row 3', 'Total Summary', 'Closed', '147.50']
        ];
    }

    const columns = Array.from({ length: Math.max(parsedData[0]?.length || 10, 10) }, (_, i) => String.fromCharCode(65 + i));

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--color-bg-base)', minWidth: 0, minHeight: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-surface)' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-accent)', fontStyle: 'italic', paddingRight: 8 }}>fx</span>
                <div style={{ borderLeft: '1px solid var(--color-border)', height: 16 }} />
                <input 
                    type="text" 
                    readOnly
                    value={parsedData[1] ? `=SUM(${columns[3]}2:${columns[3]}${parsedData.length})` : ''} 
                    style={{ flex: 1, border: 'none', outline: 'none', fontSize: 12, color: 'var(--color-text-primary)', background: 'transparent', fontWeight: 500 }} 
                />
            </div>

            <div className="excel-scrollable" style={{ flex: 1, overflow: 'auto', position: 'relative', maxWidth: '100%', maxHeight: '100%', minHeight: 0, minWidth: 0 }}>
                <style dangerouslySetInnerHTML={{ __html: `
                    .excel-scrollable::-webkit-scrollbar {
                        width: 10px;
                        height: 10px;
                    }
                    .excel-scrollable::-webkit-scrollbar-track {
                        background: var(--color-bg-subtle);
                        border-left: 1px solid var(--color-border);
                        border-top: 1px solid var(--color-border);
                    }
                    .excel-scrollable::-webkit-scrollbar-thumb {
                        background: var(--color-border-strong);
                        border-radius: 5px;
                        border: 2.5px solid var(--color-bg-subtle);
                    }
                    .excel-scrollable::-webkit-scrollbar-thumb:hover {
                        background: var(--color-text-tertiary);
                    }
                `}} />
                <table style={{ borderCollapse: 'collapse', width: 'max-content', minWidth: '100%', fontSize: 12, backgroundColor: 'var(--color-bg-surface)' }}>
                    <thead>
                        <tr>
                            <th style={{ backgroundColor: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', width: 45, height: 28, position: 'sticky', top: 0, left: 0, zIndex: 10 }}></th>
                            {columns.map((col, i) => (
                                <th key={i} style={{ backgroundColor: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', fontWeight: 600, color: 'var(--color-text-secondary)', position: 'sticky', top: 0, zIndex: 9, minWidth: 120, height: 28, textAlign: 'center' }}>
                                    {col}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {parsedData.map((row, rowIndex) => (
                            <tr key={rowIndex}>
                                <td style={{ backgroundColor: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', fontWeight: 600, color: 'var(--color-text-secondary)', textAlign: 'center', width: 45, height: 26, position: 'sticky', left: 0, zIndex: 8 }}>
                                    {rowIndex + 1}
                                </td>
                                {row.map((cell, cellIndex) => (
                                    <td 
                                        key={cellIndex} 
                                        style={{ 
                                            border: '1px solid var(--color-border)', 
                                            padding: '6px 12px', 
                                            whiteSpace: 'nowrap',
                                            fontWeight: rowIndex === 0 ? 600 : 'normal',
                                            backgroundColor: rowIndex === 0 ? 'var(--color-bg-subtle)' : cell.startsWith('-') || cell.includes('Over Budget') || cell === 'High' ? 'rgba(239, 68, 68, 0.05)' : cell.includes('Under Budget') || cell === 'Low' ? 'rgba(16, 185, 129, 0.05)' : 'var(--color-bg-surface)',
                                            color: cell.startsWith('-') || cell.includes('Over Budget') || cell === 'High' ? '#dc2626' : cell.includes('Under Budget') || cell === 'Low' ? '#059669' : 'var(--color-text-primary)'
                                        }}
                                    >
                                        {cell}
                                    </td>
                                ))}
                                {Array.from({ length: Math.max(0, columns.length - row.length) }).map((_, i) => (
                                    <td key={row.length + i} style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-surface)' }} />
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

        </div>
    );
}

// ── 3. POWERPOINT (PPT/PPTX) VIEWER ─────────────────────────────────
function PPTViewer({ filename, filePath }: { filename: string; filePath?: string }) {
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
                console.error("Failed to parse pptx:", err);
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
                    <div style={{ marginBottom: 12, fontSize: 16, fontWeight: 500, color: 'var(--color-text-primary)' }}>Parsing Presentation Slides...</div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>Extracting text and shapes from the PPTX structure</div>
                </div>
            </div>
        );
    }

    if (error || slides.length === 0) {
        return (
            <div style={{ display: 'flex', flex: 1, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-error)', backgroundColor: 'var(--color-bg-subtle)', padding: 24, textAlign: 'center', width: '100%', minHeight: 400 }}>
                <span style={{ fontSize: 32, marginBottom: 16 }}>⚠️</span>
                <div style={{ fontWeight: 600, marginBottom: 8, color: 'var(--color-error)' }}>Failed to View PowerPoint</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', maxWidth: 400, margin: '0 auto' }}>{error || "No slide content found."}</div>
            </div>
        );
    }

    const currentSlide = slides[activeSlide] || { title: "", subtitle: "", points: [] };

    return (
        <div style={{ display: 'flex', height: '100%', backgroundColor: 'var(--color-bg-base)', width: '100%', minWidth: 0, minHeight: 0 }}>
            {/* Sidebar with slide previews */}
            <div style={{ width: 180, borderRight: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: 12, padding: 12, overflowY: 'auto', flexShrink: 0 }}>
                {slides.map((slide, index) => (
                    <div 
                        key={index}
                        onClick={() => setActiveSlide(index)}
                        style={{
                            border: `2px solid ${activeSlide === index ? 'var(--color-accent)' : 'var(--color-border)'}`,
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

            {/* Slide stage */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 24, justifyContent: 'center', alignItems: 'center', gap: 16, minWidth: 0, overflowY: 'auto' }}>
                <div style={{
                    width: '100%',
                    maxWidth: 620,
                    aspectRatio: '16/9',
                    backgroundColor: 'var(--color-bg-surface)',
                    boxShadow: '0 16px 40px var(--color-bg-overlay)',
                    borderRadius: 8,
                    padding: '28px 40px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    fontFamily: 'Inter, sans-serif',
                    boxSizing: 'border-box'
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

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: '14px 0', flex: 1, justifyContent: 'center', overflowY: 'auto' }}>
                        {currentSlide.points.map((pt, i) => (
                            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                                <div style={{ width: 5, height: 5, borderRadius: '50%', backgroundColor: 'var(--color-accent)', marginTop: 6, flexShrink: 0 }} />
                                <div style={{ fontSize: 13, color: 'var(--color-text-primary)', lineHeight: 1.4, wordBreak: 'break-word' }}>{pt}</div>
                            </div>
                        ))}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 9, color: 'var(--color-text-tertiary)', borderTop: '1px solid var(--color-border)', paddingTop: 6 }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>{filename}</span>
                        <span>Slide {activeSlide + 1} of {slides.length}</span>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <button 
                        onClick={() => setActiveSlide(prev => Math.max(0, prev - 1))}
                        disabled={activeSlide === 0}
                        style={{
                            padding: '4px 14px',
                            borderRadius: 6,
                            border: '1px solid var(--color-border)',
                            backgroundColor: 'var(--color-bg-surface)',
                            color: activeSlide === 0 ? 'var(--color-text-placeholder)' : 'var(--color-text-primary)',
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
                            padding: '4px 14px',
                            borderRadius: 6,
                            border: '1px solid var(--color-border)',
                            backgroundColor: 'var(--color-bg-surface)',
                            color: activeSlide === slides.length - 1 ? 'var(--color-text-placeholder)' : 'var(--color-text-primary)',
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

// ── 4. PDF DOCUMENT VIEWER ──────────────────────────────────────────
export function PDFViewer({ filename, content, filePath }: { filename: string; content?: string | null; filePath?: string }) {
    const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
    const [loadingPdf, setLoadingPdf] = useState(true);
    const [zoom, setZoom] = useState(100);
    const [apps, setApps] = useState<Array<{ name: string; path: string; icon: string }>>([]);
    const [showAppDropdown, setShowAppDropdown] = useState(false);
    const appDropdownRef = React.useRef<HTMLDivElement>(null);

    // Fetch registered opener apps
    useEffect(() => {
        if (!filePath) return;
        (window as any).electronAPI?.system?.getFileApps?.(filePath)
            .then((res: any[]) => {
                if (Array.isArray(res)) setApps(res);
            })
            .catch(() => {});
    }, [filePath]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (appDropdownRef.current && !appDropdownRef.current.contains(e.target as Node)) {
                setShowAppDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        let isMounted = true;
        setLoadingPdf(true);

        const loadPdf = async () => {
            try {
                // 1. If content is already a base64 data URL
                if (content && content.startsWith('data:application/pdf')) {
                    try {
                        const base64Data = content.split(',')[1];
                        if (base64Data) {
                            const byteCharacters = atob(base64Data);
                            const byteNumbers = new Array(byteCharacters.length);
                            for (let i = 0; i < byteCharacters.length; i++) {
                                byteNumbers[i] = byteCharacters.charCodeAt(i);
                            }
                            const byteArray = new Uint8Array(byteNumbers);
                            const blob = new Blob([byteArray], { type: 'application/pdf' });
                            const bUrl = URL.createObjectURL(blob);
                            if (isMounted) {
                                setPdfBlobUrl(bUrl);
                                setLoadingPdf(false);
                            }
                            return;
                        }
                    } catch (e) {
                        if (isMounted) {
                            setPdfBlobUrl(content);
                            setLoadingPdf(false);
                        }
                        return;
                    }
                }

                // 2. If filePath is provided, try reading via readImageDataUrl
                if (filePath) {
                    const imgRes = await (window as any).electronAPI?.system?.readImageDataUrl?.(filePath);
                    if (isMounted && imgRes && imgRes.success && imgRes.dataUrl) {
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
                                if (isMounted) setPdfBlobUrl(bUrl);
                            }
                        } catch (e) {
                            if (isMounted) setPdfBlobUrl(imgRes.dataUrl);
                        }
                        if (isMounted) setLoadingPdf(false);
                        return;
                    }

                    // 3. Fallback file:// URL
                    const cleanPath = filePath.replace(/\\/g, '/');
                    const fallbackUrl = `file:///${cleanPath.startsWith('/') ? cleanPath.slice(1) : cleanPath}`;
                    if (isMounted) {
                        setPdfBlobUrl(fallbackUrl);
                        setLoadingPdf(false);
                    }
                    return;
                }

                if (isMounted) {
                    setLoadingPdf(false);
                }
            } catch (err) {
                console.error("Failed to load PDF preview:", err);
                if (isMounted) {
                    setLoadingPdf(false);
                }
            }
        };

        loadPdf();

        return () => {
            isMounted = false;
            if (pdfBlobUrl && pdfBlobUrl.startsWith('blob:')) {
                URL.revokeObjectURL(pdfBlobUrl);
            }
        };
    }, [content, filePath]);

    const handleOpenInDefault = () => {
        try {
            if (filePath && (window as any).electronAPI?.system?.openFile) {
                (window as any).electronAPI.system.openFile(filePath);
            }
        } catch (e) {
            console.error('Failed to open PDF externally:', e);
        }
    };

    const handleOpenInApp = (appPath: string) => {
        try {
            setShowAppDropdown(false);
            if (filePath && (window as any).electronAPI?.system?.openFile) {
                (window as any).electronAPI.system.openFile(filePath, appPath);
            }
        } catch (e) {
            console.error('Failed to open PDF in app:', e);
        }
    };

    const handleDownloadPdf = () => {
        if (!pdfBlobUrl && !content) return;
        const a = document.createElement('a');
        a.href = pdfBlobUrl || (content as string);
        a.download = filename || 'document.pdf';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', minHeight: 450, backgroundColor: 'var(--color-bg-base)', position: 'relative' }}>
            {/* Top Toolbar */}
            <div className="glossy" style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 18px',
                backgroundColor: 'var(--color-bg-surface)',
                borderBottom: '1px solid var(--color-border)',
                borderTop: '1px solid var(--glossy-highlight)',
                boxShadow: 'var(--glossy-inner), 0 2px 8px rgba(0,0,0,0.03)',
                fontSize: 12,
                flexShrink: 0
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '3px 8px',
                        borderRadius: 6,
                        backgroundColor: '#ef4444',
                        color: '#ffffff',
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: '0.04em'
                    }}>
                        PDF
                    </span>
                    <span style={{ fontWeight: 600, color: 'var(--color-text-primary)', fontSize: 13.5 }}>{filename}</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {/* Zoom controls */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, backgroundColor: 'var(--color-bg-subtle)', borderRadius: 8, padding: '2px 6px', border: '1px solid var(--color-border)' }}>
                        <button
                            onClick={() => setZoom(z => Math.max(50, z - 15))}
                            style={{ background: 'transparent', border: 'none', color: 'var(--color-text-primary)', cursor: 'pointer', padding: '3px 6px', fontSize: 12, fontWeight: 700 }}
                            title="Zoom Out"
                        >
                            -
                        </button>
                        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', minWidth: 36, textAlign: 'center' }}>{zoom}%</span>
                        <button
                            onClick={() => setZoom(z => Math.min(200, z + 15))}
                            style={{ background: 'transparent', border: 'none', color: 'var(--color-text-primary)', cursor: 'pointer', padding: '3px 6px', fontSize: 12, fontWeight: 700 }}
                            title="Zoom In"
                        >
                            +
                        </button>
                    </div>

                    <button
                        onClick={handleDownloadPdf}
                        className="glossy"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '6px 12px',
                            borderRadius: 8,
                            border: '1px solid var(--color-border)',
                            borderTop: '1px solid var(--glossy-highlight)',
                            backgroundColor: 'var(--color-bg-surface)',
                            color: 'var(--color-text-primary)',
                            fontSize: 12,
                            fontWeight: 500,
                            cursor: 'pointer',
                            transition: 'all 0.15s'
                        }}
                    >
                        <ArrowDownTrayIcon width={13} height={13} />
                        Download
                    </button>

                    {filePath && (
                        <div ref={appDropdownRef} style={{ position: 'relative', display: 'flex' }}>
                            <button
                                onClick={handleOpenInDefault}
                                className="glossy"
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    padding: '6px 12px',
                                    borderRadius: '8px 0 0 8px',
                                    borderTop: '1px solid var(--glossy-highlight)',
                                    borderBottom: '1px solid var(--color-border)',
                                    borderLeft: '1px solid var(--color-border)',
                                    borderRight: 'none',
                                    backgroundColor: 'var(--color-bg-surface)',
                                    color: 'var(--color-text-primary)',
                                    fontSize: 12,
                                    fontWeight: 500,
                                    cursor: 'pointer',
                                    transition: 'all 0.15s'
                                }}
                            >
                                <ArrowTopRightOnSquareIcon width={13} height={13} />
                                Open PDF
                            </button>
                            <button
                                onClick={() => setShowAppDropdown(v => !v)}
                                className="glossy"
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    padding: '6px 8px',
                                    borderRadius: '0 8px 8px 0',
                                    borderTop: '1px solid var(--glossy-highlight)',
                                    borderBottom: '1px solid var(--color-border)',
                                    borderLeft: '1px solid var(--color-border)',
                                    borderRight: '1px solid var(--color-border)',
                                    backgroundColor: 'var(--color-bg-surface)',
                                    color: 'var(--color-text-primary)',
                                    fontSize: 12,
                                    cursor: 'pointer'
                                }}
                            >
                                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" style={{ transform: showAppDropdown ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                                    <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                            </button>

                            {showAppDropdown && (
                                <div style={{
                                    position: 'absolute',
                                    top: 'calc(100% + 6px)',
                                    right: 0,
                                    zIndex: 9999,
                                    backgroundColor: 'var(--color-bg-elevated)',
                                    border: '1px solid var(--color-border)',
                                    borderRadius: 12,
                                    boxShadow: '0 8px 32px var(--color-bg-overlay)',
                                    minWidth: 200,
                                    overflow: 'hidden',
                                    padding: '6px 0',
                                }}>
                                    <div style={{ padding: '6px 14px 8px', fontSize: 11, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase' }}>
                                        Open with
                                    </div>
                                    {apps.length === 0 ? (
                                        <div style={{ padding: '8px 14px', fontSize: 12, color: 'var(--color-text-tertiary)' }}>Default PDF Reader</div>
                                    ) : apps.map(app => (
                                        <button
                                            key={app.path}
                                            onClick={() => handleOpenInApp(app.path)}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 8,
                                                width: '100%',
                                                padding: '8px 14px',
                                                background: 'transparent',
                                                border: 'none',
                                                cursor: 'pointer',
                                                fontSize: 12.5,
                                                color: 'var(--color-text-primary)',
                                                textAlign: 'left'
                                            }}
                                            onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)'}
                                            onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                                        >
                                            {app.icon && <img src={app.icon} alt="" width={16} height={16} style={{ borderRadius: 3 }} />}
                                            <span>{app.name}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Embedded PDF View Frame */}
            <div style={{ flex: 1, position: 'relative', width: '100%', height: '100%', overflow: 'hidden', backgroundColor: 'var(--color-bg-subtle)' }}>
                {loadingPdf ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-secondary)', gap: 12 }}>
                        <div style={{ width: 24, height: 24, borderRadius: '50%', border: '2px solid rgba(239,68,68,0.2)', borderTopColor: '#ef4444', animation: 'spin 0.8s linear infinite' }} />
                        <span style={{ fontSize: 13 }}>Rendering PDF preview...</span>
                    </div>
                ) : pdfBlobUrl ? (
                    <iframe
                        src={`${pdfBlobUrl}#toolbar=1&navpanes=1&scrollbar=1&zoom=${zoom}`}
                        style={{
                            width: '100%',
                            height: '100%',
                            border: 'none',
                            backgroundColor: '#525659'
                        }}
                        title={filename}
                    />
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-secondary)', gap: 16, padding: 32, textAlign: 'center' }}>
                        <div style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: 'rgba(239,68,68,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444', fontSize: 22, fontWeight: 700 }}>
                            PDF
                        </div>
                        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)' }}>{filename}</div>
                        <div style={{ fontSize: 13, color: 'var(--color-text-tertiary)', maxWidth: 360 }}>
                            Open this PDF in your default system reader or click download to save.
                        </div>
                        <button
                            onClick={handleOpenInDefault}
                            className="glossy"
                            style={{
                                padding: '8px 20px',
                                borderRadius: 8,
                                backgroundColor: 'var(--color-text-primary)',
                                color: 'var(--color-bg-base)',
                                border: 'none',
                                fontSize: 13,
                                fontWeight: 600,
                                cursor: 'pointer'
                            }}
                        >
                            Open in System App
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

// ── 5. INSPIRATION TEMPLATES ─────────────────────────────────────────
const INSPIRATION_TEMPLATES = [
    {
        id: 'global-warming-pdf',
        name: 'Climate Action & Carbon Impact Report.pdf',
        type: 'pdf',
        badge: 'PDF',
        badgeColor: '#ef4444',
        badgeBg: 'rgba(239,68,68,0.12)',
        title: 'Global Climate Impact Assessment',
        description: 'Comprehensive ESG carbon emissions breakdown with mitigation targets, renewable transition timeline, and regulatory compliance risk matrix.',
        previewSnippet: '%PDF-1.4\n1 0 obj << /Title (Global Climate Impact Report 2026) /Author (EverFern Environmental AI) >>\n[Executive Summary: Global greenhouse gas trajectory analysis and Scope 1-3 reduction strategy]',
        sampleContent: `%PDF-1.4\n% EverFern Environmental Impact Report\n1 0 obj << /Title (Global Climate Impact Assessment 2026) /Author (EverFern Analytics) >>\nendobj\n`
    },
    {
        id: 'saas-dashboard-html',
        name: 'executive_revenue_dashboard.html',
        type: 'html',
        badge: 'WEB',
        badgeColor: '#8b5cf6',
        badgeBg: 'rgba(139,92,246,0.12)',
        title: 'Executive SaaS Revenue Dashboard',
        description: 'Interactive analytics cockpit with ARR trajectory charts, net revenue retention (NRR) cohorts, and customer lifetime value waterfall.',
        previewSnippet: '<div class="dashboard">\n  <header><h1>Executive SaaS Velocity</h1><span class="pill">$14.2M ARR (+42% YoY)</span></header>\n  <div class="metrics-grid">...</div>\n</div>',
        sampleContent: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Executive SaaS Revenue Dashboard</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f1117; color: #f3f4f6; margin: 0; padding: 32px; }
    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #232736; padding-bottom: 20px; }
    h1 { margin: 0; font-size: 24px; font-weight: 700; }
    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin: 24px 0; }
    .card { background: #161922; border: 1px solid #232736; border-radius: 14px; padding: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.3); }
    .card .label { font-size: 12px; color: #9ca3af; text-transform: uppercase; font-weight: 600; }
    .card .val { font-size: 28px; font-weight: 700; margin-top: 8px; color: #fff; }
    .trend { font-size: 12px; color: #10b981; font-weight: 600; margin-top: 4px; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>EverFern Growth Analytics</h1>
      <p style="margin:4px 0 0; color:#9ca3af; font-size:13px">Live Performance Telemetry</p>
    </div>
    <span style="background:rgba(99,102,241,0.15); color:#818cf8; padding:6px 14px; border-radius:20px; font-size:13px; font-weight:600">Q3 Active</span>
  </div>
  <div class="grid">
    <div class="card"><div class="label">Annual Recurring Revenue</div><div class="val">$14.8M</div><div class="trend">▲ +44.2% YoY</div></div>
    <div class="card"><div class="label">Net Revenue Retention</div><div class="val">138%</div><div class="trend">▲ Top Quartile</div></div>
    <div class="card"><div class="label">Customer Acquisition Cost</div><div class="val">$4,250</div><div class="trend">▼ -12% Payback</div></div>
    <div class="card"><div class="label">Gross Margin</div><div class="val">84.5%</div><div class="trend">▲ +3.1% Exp.</div></div>
  </div>
</body>
</html>`
    },
    {
        id: 'financial-model-csv',
        name: 'proforma_valuation_model.csv',
        type: 'csv',
        badge: 'CSV',
        badgeColor: '#10b981',
        badgeBg: 'rgba(16,185,129,0.12)',
        title: '5-Year Pro-Forma DCF Model',
        description: 'Multi-year financial valuation forecast covering revenue growth, gross margins, EBITDA, discounted cash flows, and terminal valuation.',
        previewSnippet: 'Metric,2024 (A),2025 (P),2026 (P),2027 (P),2028 (P)\nTotal Revenue,$8.4M,$14.8M,$24.5M,$38.2M,$56.0M\nGross Profit (82%),$6.8M,$12.1M,$20.1M,$31.3M,$45.9M\nEBITDA,$1.2M,$3.6M,$7.4M,$13.3M,$21.8M',
        sampleContent: `Metric,2024 (A),2025 (P),2026 (P),2027 (P),2028 (P)
Total Revenue,$8.4M,$14.8M,$24.5M,$38.2M,$56.0M
YoY Growth %,—,76.2%,65.5%,55.9%,46.6%
Gross Margin (82%),$6.89M,$12.14M,$20.09M,$31.32M,$45.92M
R&D Expense,$2.80M,$4.20M,$6.50M,$9.20M,$12.50M
Sales & Marketing,$2.10M,$3.40M,$5.10M,$7.20M,$9.80M
G&A Expense,$0.79M,$0.94M,$1.09M,$1.62M,$1.82M
EBITDA,$1.20M,$3.60M,$7.40M,$13.30M,$21.80M
Free Cash Flow (FCF),$0.95M,$2.88M,$5.92M,$10.64M,$17.44M
Discounted FCF (10%),$0.95M,$2.62M,$4.89M,$8.00M,$11.91M
Terminal Valuation (8x),—,—,—,—,$174.4M`
    },
    {
        id: 'pitch-deck-pptx',
        name: 'series_a_pitch_deck.pptx',
        type: 'pptx',
        badge: 'PPTX',
        badgeColor: '#f59e0b',
        badgeBg: 'rgba(245,158,11,0.12)',
        title: 'Series A Pitch Presentation',
        description: '10-slide venture deck structuring Problem, Agentic AI Solution, Market Opportunity, Moat, Competitive Landscape, and Financial Milestones.',
        previewSnippet: 'Slide 1: EverFern - Next Generation Agentic Workspaces\nSlide 2: The Problem - Fragmentation in AI Workflows\nSlide 3: The Solution - Autonomous Local-First Brain\nSlide 4: Market Opportunity & TAM',
        sampleContent: '{"slides":[{"title":"EverFern - Autonomous Workspace","subtitle":"Series A Financing Presentation","points":["Next generation local AI agent orchestration","100% privacy preserving architecture","Seamless integration across IDE, Terminal, and Files"]},{"title":"The Problem: AI Workflow Fragmentation","subtitle":"Developers lose 40% of time bridging tools","points":["Context lost between chat and code","Cloud latency hinders iteration cycles","Security risks from external API dependency"]},{"title":"The Solution: Local-First Agentic Brain","subtitle":"State-of-the-art developer assistant","points":["Unified filesystem and terminal orchestration","Real-time cognitive routing and memory","Offline-first with cloud acceleration"]}]}'
    },
    {
        id: 'system-arch-md',
        name: 'system_architecture_spec.md',
        type: 'md',
        badge: 'MD',
        badgeColor: '#6366f1',
        badgeBg: 'rgba(99,102,241,0.12)',
        title: 'System Architecture & API Spec',
        description: 'Detailed software architecture blueprint with Mermaid sequence diagrams, memory model, and distributed IPC messaging schemas.',
        previewSnippet: '# EverFern System Architecture Spec\n\n## 1. Executive Summary\nEverFern is designed as a hybrid Electron and Node.js agentic runtime with reactive event loops...\n\n```mermaid\ngraph TD\n  Brain --> Router\n  Router --> Tools\n```',
        sampleContent: `# EverFern Architecture & Runtime Specification

## 1. High-Level Architecture Overview
EverFern operates as a hybrid local-first agentic workspace built with Electron, React, and an autonomous LangGraph/Node.js reasoning core.

\`\`\`mermaid
graph TD
    UI[React Desktop Interface] <-->|Electron IPC| Runner[Agent Orchestration Engine]
    Runner --> Router[Cognitive Intent Router]
    Router --> Tools[Local Tools & Terminal]
    Router --> Brain[Long-Term Vector Memory]
    Tools --> FS[Workspace Filesystem]
\`\`\`

## 2. Core Subsystems
- **Cognitive Intent Router**: Evaluates streaming LLM tokens to detect tools, file edits, and bash executions.
- **Checkpoint State Store**: SQLite WAL-mode transaction log saving state on every agent turn for crash recovery.
- **Memory Store**: Semantic retrieval indexing SOUL.md, AGENTS.md, and past conversation findings.

## 3. Security & Sandboxing
All subprocess executions pass through strict environment isolation with explicit path confinement.`
    },
    {
        id: 'unit-economics-html',
        name: 'unit_economics_calculator.html',
        type: 'html',
        badge: 'TOOL',
        badgeColor: '#06b6d4',
        badgeBg: 'rgba(6,182,212,0.12)',
        title: 'Unit Economics & LTV/CAC Calculator',
        description: 'Interactive financial modeling tool with real-time sliders to calculate Payback Months, Magic Number, and Lifetime Value under varying churn scenarios.',
        previewSnippet: '<div class="sim-container">\n  <h2>SaaS Unit Economics Simulator</h2>\n  <label>Monthly ARPU: <input type="range" id="arpu" /></label>\n  <label>Gross Margin %: <input type="range" id="gm" /></label>\n</div>',
        sampleContent: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>SaaS Unit Economics Simulator</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0c0e14; color: #e5e7eb; margin: 0; padding: 32px; }
    .card { background: #151821; border: 1px solid #282d3d; border-radius: 16px; padding: 24px; max-width: 640px; margin: 0 auto; box-shadow: 0 8px 30px rgba(0,0,0,0.4); }
    h1 { font-size: 20px; font-weight: 700; margin-top: 0; border-bottom: 1px solid #282d3d; padding-bottom: 14px; }
    .row { display: flex; justify-content: space-between; align-items: center; margin: 16px 0; }
    input[type=range] { flex: 1; margin: 0 16px; accent-color: #06b6d4; }
    .stat { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 24px; padding-top: 20px; border-top: 1px solid #282d3d; }
    .stat-box { background: #0c0e14; border: 1px solid #282d3d; border-radius: 10px; padding: 14px; text-align: center; }
    .stat-val { font-size: 24px; font-weight: 700; color: #06b6d4; }
    .stat-label { font-size: 11px; color: #9ca3af; text-transform: uppercase; margin-top: 4px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>SaaS Unit Economics Simulator</h1>
    <div class="row"><span>Monthly ARPU ($)</span><input type="range" id="arpu" min="10" max="500" value="120" oninput="calc()"><span id="arpuVal">$120</span></div>
    <div class="row"><span>Gross Margin (%)</span><input type="range" id="gm" min="40" max="95" value="82" oninput="calc()"><span id="gmVal">82%</span></div>
    <div class="row"><span>Monthly Churn (%)</span><input type="range" id="churn" min="0.5" max="8" step="0.1" value="1.8" oninput="calc()"><span id="churnVal">1.8%</span></div>
    <div class="row"><span>Blended CAC ($)</span><input type="range" id="cac" min="200" max="5000" step="50" value="1100" oninput="calc()"><span id="cacVal">$1,100</span></div>
    <div class="stat">
      <div class="stat-box"><div class="stat-val" id="ltv">$5,466</div><div class="stat-label">Customer Lifetime Value (LTV)</div></div>
      <div class="stat-box"><div class="stat-val" id="ltvCac">4.97x</div><div class="stat-label">LTV / CAC Ratio</div></div>
      <div class="stat-box"><div class="stat-val" id="payback">11.2 mo</div><div class="stat-label">CAC Payback Period</div></div>
      <div class="stat-box"><div class="stat-val" id="status">Healthy</div><div class="stat-label">Economic Rating</div></div>
    </div>
  </div>
  <script>
    function calc() {
      const arpu = +document.getElementById('arpu').value;
      const gm = +document.getElementById('gm').value / 100;
      const churn = +document.getElementById('churn').value / 100;
      const cac = +document.getElementById('cac').value;
      document.getElementById('arpuVal').textContent = '$' + arpu;
      document.getElementById('gmVal').textContent = Math.round(gm * 100) + '%';
      document.getElementById('churnVal').textContent = (churn * 100).toFixed(1) + '%';
      document.getElementById('cacVal').textContent = '$' + cac;
      const ltv = (arpu * gm) / churn;
      const ratio = ltv / cac;
      const payback = cac / (arpu * gm);
      document.getElementById('ltv').textContent = '$' + Math.round(ltv).toLocaleString();
      document.getElementById('ltvCac').textContent = ratio.toFixed(2) + 'x';
      document.getElementById('payback').textContent = payback.toFixed(1) + ' mo';
      const status = document.getElementById('status');
      if (ratio >= 3 && payback <= 12) { status.textContent = '🌟 Elite'; status.style.color = '#10b981'; }
      else if (ratio >= 2) { status.textContent = '✅ Healthy'; status.style.color = '#06b6d4'; }
      else { status.textContent = '⚠️ Risk'; status.style.color = '#f59e0b'; }
    }
  </script>
</body>
</html>`
    }
];

// Syntax highlighting helper
const getSyntaxHighlightingColors = (language: string, token: string): string => {
    const colorMap: Record<string, Record<string, string>> = {
        javascript: { keyword: SYNTAX_COLORS.keyword, string: SYNTAX_COLORS.string, number: SYNTAX_COLORS.number, comment: SYNTAX_COLORS.comment, function: SYNTAX_COLORS.function },
        typescript: { keyword: SYNTAX_COLORS.keyword, string: SYNTAX_COLORS.string, number: SYNTAX_COLORS.number, comment: SYNTAX_COLORS.comment, function: SYNTAX_COLORS.function },
        python: { keyword: SYNTAX_COLORS.keyword, string: SYNTAX_COLORS.string, number: SYNTAX_COLORS.number, comment: SYNTAX_COLORS.comment, function: SYNTAX_COLORS.function },
        html: { tag: SYNTAX_COLORS.tag, attr: SYNTAX_COLORS.attr, string: SYNTAX_COLORS.string, comment: SYNTAX_COLORS.comment },
        css: { property: SYNTAX_COLORS.property, value: SYNTAX_COLORS.value, selector: SYNTAX_COLORS.selector, comment: SYNTAX_COLORS.comment },
        json: { key: SYNTAX_COLORS.key, string: SYNTAX_COLORS.string, number: SYNTAX_COLORS.number, boolean: SYNTAX_COLORS.boolean },
        sql: { keyword: SYNTAX_COLORS.keyword, string: SYNTAX_COLORS.string, number: SYNTAX_COLORS.number, comment: SYNTAX_COLORS.comment },
    };
    return colorMap[language]?.[token] || 'var(--color-text-primary)';
};

// Detect language from filename
const detectLanguage = (filename: string): string => {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const langMap: Record<string, string> = {
        js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
        py: 'python', html: 'html', htm: 'html', css: 'css', scss: 'css',
        json: 'json', sql: 'sql', md: 'markdown', yml: 'yaml', yaml: 'yaml',
        txt: 'text'
    };
    return langMap[ext] || 'text';
};

// Syntax highlighter component
export const SyntaxHighlighter = ({ code, language }: { code: string; language: string }) => {
    const colorSchemes: Record<string, Record<string, string>> = {
        python: {
            keyword: SYNTAX_COLORS.keyword,
            string: SYNTAX_COLORS.string,
            number: SYNTAX_COLORS.number,
            comment: SYNTAX_COLORS.comment,
            function: SYNTAX_COLORS.function,
        },
        javascript: {
            keyword: SYNTAX_COLORS.keyword,
            string: SYNTAX_COLORS.string,
            number: SYNTAX_COLORS.number,
            comment: SYNTAX_COLORS.comment,
            function: SYNTAX_COLORS.function,
        },
        typescript: {
            keyword: SYNTAX_COLORS.keyword,
            string: SYNTAX_COLORS.string,
            number: SYNTAX_COLORS.number,
            comment: SYNTAX_COLORS.comment,
            function: SYNTAX_COLORS.function,
        },
        html: {
            tag: SYNTAX_COLORS.tag,
            attr: SYNTAX_COLORS.attr,
            string: SYNTAX_COLORS.string,
            comment: SYNTAX_COLORS.comment,
        },
        css: {
            property: SYNTAX_COLORS.property,
            value: SYNTAX_COLORS.value,
            selector: SYNTAX_COLORS.selector,
            comment: SYNTAX_COLORS.comment,
        },
        json: {
            key: SYNTAX_COLORS.key,
            string: SYNTAX_COLORS.string,
            number: SYNTAX_COLORS.number,
            boolean: SYNTAX_COLORS.boolean,
        },
    };

    const colors = colorSchemes[language] || {};
    const lines = code.split('\n');

    const highlightLine = (line: string): React.ReactNode[] => {
        if (!colors || Object.keys(colors).length === 0) {
            return [<span key={line} style={{ color: 'var(--color-text-primary)' }}>{line}</span>];
        }

        // Comment detection
        const commentMatch = line.match(/^(\s*)(#|\/\/|\/\*|<!--)(.*)/);
        if (commentMatch) {
            return [<span key={line} style={{ color: colors.comment || 'var(--color-text-tertiary)' }}>{line}</span>];
        }

        const result: React.ReactNode[] = [];
        const stringPattern = /(['"`])(.*?)\1/g;
        const keywordPattern = /\b(if|else|for|while|function|def|class|return|const|let|var|import|export|from|async|await|try|catch|throw|new|this|true|false|null|undefined|and|or|not|in|is|lambda|def|self|super|pass|break|continue)\b/g;
        const numberPattern = /\b(\d+\.?\d*)\b/g;

        let lastIndex = 0;
        const tokens: Array<{ type: 'keyword' | 'string' | 'number' | 'text'; value: string; color?: string }> = [];

        // Tokenize the line
        let temp = line;
        const stringMatches = Array.from(line.matchAll(stringPattern));
        const keywordMatches = Array.from(line.matchAll(keywordPattern));
        const numberMatches = Array.from(line.matchAll(numberPattern));

        const allMatches = [
            ...stringMatches.map(m => ({ ...m, type: 'string' })),
            ...keywordMatches.map(m => ({ ...m, type: 'keyword' })),
            ...numberMatches.map(m => ({ ...m, type: 'number' })),
        ].sort((a, b) => a.index! - b.index!);

        lastIndex = 0;
        allMatches.forEach((match) => {
            if (match.index! > lastIndex) {
                tokens.push({ type: 'text', value: line.slice(lastIndex, match.index) });
            }
            const colorMap: Record<string, string> = { string: colors.string, keyword: colors.keyword, number: colors.number };
            const type = (match as any).type as 'string' | 'keyword' | 'number';
            tokens.push({ type, value: match[0], color: colorMap[type] || 'var(--color-text-primary)' });
            lastIndex = match.index! + match[0].length;
        });

        if (lastIndex < line.length) {
            tokens.push({ type: 'text', value: line.slice(lastIndex) });
        }

        return tokens.map((token, idx) => (
            <span key={idx} style={{ color: token.color || 'var(--color-text-primary)' }}>
                {token.value}
            </span>
        )) || [<span key={line}>{line}</span>];
    };

    return (
        <>
            {lines.map((line, idx) => (
                <div key={idx} style={{ color: 'var(--color-text-primary)', lineHeight: 1.6 }}>
                    {highlightLine(line)}
                </div>
            ))}
        </>
    );
};

export default function ArtifactsPanel({ isOpen, onClose, activeChatId, onApprovePlan, selectedFileName, projectPath }: ArtifactsPanelProps) {
    const [activeTab, setActiveTab] = useState<'inspiration' | 'yours' | 'sites' | 'terminal'>('yours');
    const [artifacts, setArtifacts] = useState<Artifact[]>([]);
    const [sites, setSites] = useState<{id: string; chatId: string; name: string; lastEdited: number; size: number; path: string}[]>([]);
    const [selectedCode, setSelectedCode] = useState<{name: string, content: string, chatId: string} | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [editedContent, setEditedContent] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [viewMode, setViewMode] = useState<'code' | 'preview'>('code');
    const [artifactPath, setArtifactPath] = useState<string>('');
    const [realArtifactPath, setRealArtifactPath] = useState<string>('');
    const [showNewModal, setShowNewModal] = useState(false);
    const [newArtifactName, setNewArtifactName] = useState('');
    const [newArtifactExt, setNewArtifactExt] = useState<'md' | 'pdf' | 'html' | 'csv' | 'pptx' | 'py'>('md');

    // Open-in-app state
    const [openApps, setOpenApps] = useState<Array<{ name: string; path: string; icon: string }>>([]);
    const [openAppsLoading, setOpenAppsLoading] = useState(false);
    const [showAppDropdown, setShowAppDropdown] = useState(false);
    const openAppRef = React.useRef<HTMLDivElement>(null);

    // Terminal Processes state
    const [processes, setProcesses] = useState<{ id: string; commandLine: string; status: 'running' | 'done'; exitCode?: number | null; bufferSize: number }[]>([]);
    const [processesLoading, setProcessesLoading] = useState(false);

    const loadProcesses = useCallback(async () => {
        try {
            setProcessesLoading(true);
            const results = await (window as any).electronAPI.terminal.listProcesses();
            setProcesses(results || []);
        } catch (e) {
            console.error('Failed to load terminal processes', e);
            setProcesses([]);
        } finally {
            setProcessesLoading(false);
        }
    }, []);

    // Poll processes every 2s while the terminal tab is active
    useEffect(() => {
        if (activeTab !== 'terminal' || !isOpen) return;
        loadProcesses();
        const interval = setInterval(loadProcesses, 2000);
        return () => clearInterval(interval);
    }, [activeTab, isOpen, loadProcesses]);

    const handleKillProcess = async (id: string) => {
        try {
            await (window as any).electronAPI.terminal.killProcess(id);
            await loadProcesses();
        } catch (e) {
            console.error('Failed to kill process', e);
        }
    };

    // Fetch all artifacts on open (not filtered by chat)
    useEffect(() => {
        if (isOpen) {
            loadArtifacts(); // Load all artifacts across all chats
            loadAllSites();
        }
    }, [isOpen]);

    // Auto-enter edit mode for plan files
    useEffect(() => {
        if (selectedCode) {
            setEditedContent(selectedCode.content);
            const isPlan = selectedCode.name === 'execution_plan.md';
            setIsEditing(isPlan);
            
            // Auto-switch to preview for specific file types if NOT a plan
            const ext = selectedCode.name.split('.').pop()?.toLowerCase() || '';
            const previewExts = ['html', 'htm', 'xlsx', 'xls', 'csv', 'pptx', 'ppt', 'md', 'pdf'];
            
            if (previewExts.includes(ext) && !isPlan) {
                setViewMode('preview');
            } else {
                setViewMode('code');
            }
            
            // Get the artifact path (display form)
            const displayPath = projectPath 
                ? `${projectPath}/.everfern/artifacts/${selectedCode.name}`
                : `~/.everfern/artifacts/${selectedCode.chatId}/${selectedCode.name}`;
            setArtifactPath(displayPath);

            // Resolve actual absolute path for file open operations
            const homeDir = displayPath.startsWith('~')
                ? displayPath // OS will expand
                : displayPath;
            setRealArtifactPath(homeDir);

            // Reset open-app state when file changes
            setOpenApps([]);
            setShowAppDropdown(false);

            // Preload apps in background as soon as a file is selected
            // We use a slight delay to not block the initial render
            const extForPreload = selectedCode.name.split('.').pop()?.toLowerCase();
            if (extForPreload) {
                setTimeout(() => {
                    const preloadPath = projectPath
                        ? `${projectPath}/.everfern/artifacts/${selectedCode.name}`
                        : `~/.everfern/artifacts/${selectedCode.chatId}/${selectedCode.name}`;
                    (window as any).electronAPI?.system?.getFileApps?.(preloadPath)
                        .then((apps: any[]) => { if (apps?.length) setOpenApps(apps); })
                        .catch(() => {});
                }, 200);
            }
        }
    }, [selectedCode]);

    // Handle auto-selection of specific file from props
    useEffect(() => {
        if (selectedFileName && activeChatId) {
            handleSelectArtifactByName(selectedFileName);
        }
    }, [selectedFileName, activeChatId]);

    const handleSelectArtifactByName = async (name: string) => {
        if (!activeChatId) return;
        const content = await (window as any).electronAPI?.artifacts.read(activeChatId, name, projectPath);
        if (content !== null) {
            setSelectedCode({ name, content, chatId: activeChatId });
            setActiveTab('yours');
        }
    };

    const loadArtifacts = async () => {
        try {
            const results = await (window as any).electronAPI?.artifacts.list(undefined, projectPath); // No chatId = load all for this project/global
            // Filter out exec/ temp files (Python scripts, shell scripts, JS/TS temp files)
            const EXEC_EXTS = ['.py', '.sh', '.bat', '.ps1', '.js', '.ts', '.tsx', '.jsx'];
            const filtered = (results || []).filter((a: any) => {
                const ext = '.' + (a.name.split('.').pop() || '');
                return !EXEC_EXTS.includes(ext.toLowerCase());
            });
            setArtifacts(filtered);
        } catch (e) {
            console.error("Failed to load artifacts", e);
            setArtifacts([]);
        }
    };

    const loadSites = async (chatId: string) => {
        try {
            const results = await (window as any).electronAPI.sites.list(chatId);
            const sitesList = results || [];
            setSites(sitesList.map((s: any) => ({
                id: s.id,
                chatId: s.chatId,
                name: s.name,
                lastEdited: s.lastEdited,
                size: s.size,
                path: s.path
            })));
        } catch (e) {
            console.error("Failed to load sites", e);
            setSites([]);
        }
    };

    const loadAllSites = async () => {
        try {
            const results = await (window as any).electronAPI.sites.list();
            const sitesList = results || [];
            setSites(sitesList.map((s: any) => ({
                id: s.id,
                chatId: s.chatId,
                name: s.name,
                lastEdited: s.lastEdited,
                size: s.size,
                path: s.path
            })));
        } catch (e) {
            console.error("Failed to load all sites", e);
            setSites([]);
        }
    };

    const handleReadArtifact = async (chatId: string, name: string) => {
        try {
            const content = await (window as any).electronAPI?.artifacts.read(chatId, name, projectPath);
            if (content) {
                setSelectedCode({ name, content, chatId });
                setSaveSuccess(false);
            }
        } catch (e) {
            console.error("Error reading artifact file", e);
        }
    };

    const handleSave = async () => {
        if (!selectedCode) return;
        setIsSaving(true);
        try {
            await (window as any).electronAPI?.artifacts.write(selectedCode.chatId, selectedCode.name, editedContent, projectPath);
            setSelectedCode(prev => prev ? { ...prev, content: editedContent } : null);
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 2000);
        } catch (e) {
            console.error("Error saving artifact", e);
        } finally {
            setIsSaving(false);
        }
    };

    const handleApprovePlan = async () => {
        // First save any changes
        if (selectedCode && editedContent !== selectedCode.content) {
            await handleSave();
        }
        // Then fire the callback to inject approval message into chat
        if (onApprovePlan) {
            onApprovePlan(editedContent);
            onClose();
        }
    };

    const handleDownload = () => {
        if (!selectedCode) return;
        const element = document.createElement('a');
        const file = new Blob([editedContent || selectedCode.content], { type: 'text/plain' });
        element.href = URL.createObjectURL(file);
        element.download = selectedCode.name;
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);
    };

    const handleOpenInDefault = async () => {
        if (!realArtifactPath) return;
        try {
            await (window as any).electronAPI?.system?.openFile?.(realArtifactPath);
        } catch (e) {
            console.error('[ArtifactsPanel] openFile error:', e);
        }
    };

    const handleFetchApps = async () => {
        if (!realArtifactPath) return;
        setOpenAppsLoading(true);
        try {
            const apps = await (window as any).electronAPI?.system?.getFileApps?.(realArtifactPath);
            setOpenApps(apps || []);
        } catch (e) {
            console.error('[ArtifactsPanel] getFileApps error:', e);
            setOpenApps([]);
        } finally {
            setOpenAppsLoading(false);
        }
    };

    const handleOpenInApp = async (appPath: string) => {
        if (!realArtifactPath) return;
        setShowAppDropdown(false);
        try {
            await (window as any).electronAPI?.system?.openFile?.(realArtifactPath, appPath);
        } catch (e) {
            console.error('[ArtifactsPanel] openFile error:', e);
        }
    };

    // Close dropdown on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (openAppRef.current && !openAppRef.current.contains(e.target as Node)) {
                setShowAppDropdown(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const isPlanFile = selectedCode?.name === 'execution_plan.md';

    const timeAgo = (timestamp: number) => {
        const seconds = Math.floor((Date.now() - timestamp) / 1000);
        let interval = seconds / 31536000;
        if (interval > 1) return Math.floor(interval) + " years ago";
        interval = seconds / 2592000;
        if (interval > 1) return Math.floor(interval) + " months ago";
        interval = seconds / 86400;
        if (interval > 1) return Math.floor(interval) + " days ago";
        interval = seconds / 3600;
        if (interval > 1) return Math.floor(interval) + " hours ago";
        interval = seconds / 60;
        if (interval > 1) return Math.floor(interval) + " minutes ago";
        return Math.floor(seconds) + " seconds ago";
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0, y: 40 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 40 }}
                    transition={{ type: "spring", damping: 25, stiffness: 250 }}
                    style={{
                        position: "fixed",
                        top: 0, left: 0, right: 0, bottom: 0,
                        backgroundColor: "var(--color-bg-base)",
                        zIndex: 9999,
                        display: "flex",
                        flexDirection: "column",
                        color: "var(--color-text-primary)",
                        overflowY: "auto",
                        padding: "60px 80px"
                    }}
                >
                    <button
                        onClick={onClose}
                        style={{ position: "absolute", top: 30, right: 40, background: "transparent", border: "none", color: "var(--color-text-tertiary)", cursor: "pointer", padding: 8, borderRadius: "50%" }}
                        onMouseEnter={e => e.currentTarget.style.backgroundColor = "var(--color-bg-hover)"}
                        onMouseLeave={e => e.currentTarget.style.backgroundColor = "transparent"}
                    >
                        <XMarkIcon width={24} height={24} />
                    </button>

                    {selectedCode ? (
                        <motion.div 
                            initial={{ opacity: 0, scale: 0.95, y: 10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 10 }}
                            transition={{ type: "spring", damping: 20, stiffness: 300 }}
                            style={{ display: "flex", flexDirection: "column", flex: 1 }}
                        >
                            {/* Back button above filename */}
                            <button
                                onClick={() => { setSelectedCode(null); setIsEditing(false); }}
                                style={{ 
                                    alignSelf: 'flex-start',
                                    background: "transparent", 
                                    border: "1px solid var(--color-border)", 
                                    color: "var(--color-text-primary)", 
                                    borderRadius: 8, 
                                    padding: "6px 16px", 
                                    cursor: "pointer", 
                                    fontSize: 13, 
                                    fontWeight: 600,
                                    marginBottom: 16,
                                    transition: "all 0.2s"
                                }}
                                onMouseEnter={e => { e.currentTarget.style.backgroundColor = "var(--color-bg-hover)"; }}
                                onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; }}
                            >
                                {"\u2190"} Back
                            </button>

                            {/* Filename and path */}
                            <div style={{ marginBottom: 8 }}>
                                <h1 style={{ margin: "0 0 4px", fontSize: 28, fontWeight: 600 }}>{selectedCode.name}</h1>
                                <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-tertiary)", fontFamily: "'JetBrains Mono', 'Fira Code', monospace", wordBreak: "break-all" }}>{artifactPath}</p>
                            </div>

                            {/* Toolbar */}
                            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 24 }}>
                                {!isPlanFile && (
                                    <button
                                        onClick={() => setIsEditing(v => !v)}
                                        style={{ display: "flex", alignItems: "center", gap: 6, background: isEditing ? "var(--color-bg-selected)" : "transparent", border: "1px solid var(--color-border)", color: "var(--color-text-primary)", borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 13, transition: "all 0.2s" }}
                                        onMouseEnter={e => { if (!isEditing) e.currentTarget.style.backgroundColor = "var(--color-bg-hover)"; }}
                                        onMouseLeave={e => { if (!isEditing) e.currentTarget.style.backgroundColor = "transparent"; }}
                                    >
                                        <PencilSquareIcon width={14} height={14} />
                                        {isEditing ? "Preview" : "Edit"}
                                    </button>
                                )}
                                {!isEditing && (
                                    <>
                                    <button
                                        onClick={handleDownload}
                                        style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: "1px solid var(--color-border)", color: "var(--color-text-primary)", borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 13, transition: "all 0.2s" }}
                                        onMouseEnter={e => { e.currentTarget.style.backgroundColor = "var(--color-bg-hover)"; }}
                                        onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; }}
                                        title="Download artifact"
                                    >
                                        <ArrowDownTrayIcon width={14} height={14} />
                                        Download
                                    </button>

                                    {/* Open In App */}
                                    <div ref={openAppRef} style={{ position: 'relative', display: 'flex' }}>
                                        {/* Main open-in-default button */}
                                        <button
                                            onClick={handleOpenInDefault}
                                            style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", borderTop: "1px solid var(--color-border)", borderBottom: "1px solid var(--color-border)", borderLeft: "1px solid var(--color-border)", borderRight: "none", color: "var(--color-text-primary)", borderRadius: "8px 0 0 8px", padding: "6px 14px", cursor: "pointer", fontSize: 13, transition: "all 0.2s" }}
                                            onMouseEnter={e => { e.currentTarget.style.backgroundColor = "var(--color-bg-hover)"; }}
                                            onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; }}
                                            title="Open in default app"
                                        >
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                                                <line x1="7" y1="17" x2="17" y2="7"></line>
                                                <polyline points="7 7 17 7 17 17"></polyline>
                                            </svg>
                                            Open
                                        </button>
                                        {/* Chevron to show app picker */}
                                        <button
                                            onClick={() => {
                                                const next = !showAppDropdown;
                                                setShowAppDropdown(next);
                                                if (next && openApps.length === 0) handleFetchApps();
                                            }}
                                            style={{ display: "flex", alignItems: "center", background: "transparent", borderTop: "1px solid var(--color-border)", borderBottom: "1px solid var(--color-border)", borderLeft: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)", color: "var(--color-text-primary)", borderRadius: "0 8px 8px 0", padding: "6px 8px", cursor: "pointer", fontSize: 13, transition: "all 0.2s" }}
                                            onMouseEnter={e => { e.currentTarget.style.backgroundColor = "var(--color-bg-hover)"; }}
                                            onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; }}
                                            title="Choose app to open with"
                                        >
                                            {/* Animated caret */}
                                            <svg
                                                width="11" height="11"
                                                viewBox="0 0 12 12"
                                                fill="none"
                                                xmlns="http://www.w3.org/2000/svg"
                                                style={{
                                                    transition: 'transform 0.2s ease',
                                                    transform: showAppDropdown ? 'rotate(180deg)' : 'rotate(0deg)',
                                                    flexShrink: 0,
                                                }}
                                            >
                                                <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                            </svg>
                                        </button>

                                        {/* App picker dropdown */}
                                        <AnimatePresence>
                                            {showAppDropdown && (
                                                <motion.div
                                                    initial={{ opacity: 0, y: -6, scale: 0.96 }}
                                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                                    exit={{ opacity: 0, y: -6, scale: 0.96 }}
                                                    transition={{ type: 'spring', stiffness: 350, damping: 25 }}
                                                    style={{
                                                        position: 'absolute',
                                                        top: 'calc(100% + 6px)',
                                                        left: 0,
                                                        zIndex: 9999,
                                                        backgroundColor: 'var(--color-bg-elevated)',
                                                        border: '1px solid var(--color-border)',
                                                        borderRadius: 12,
                                                        boxShadow: '0 8px 32px var(--color-bg-overlay)',
                                                        minWidth: 220,
                                                        overflow: 'hidden',
                                                        padding: '6px 0',
                                                    }}
                                                >
                                                    <div style={{ padding: '6px 14px 8px', fontSize: 11, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                                        Open with
                                                    </div>

                                                    {openAppsLoading ? (
                                                        <div style={{ padding: '12px 14px', fontSize: 13, color: 'var(--color-text-tertiary)' }}>Detecting apps…</div>
                                                    ) : openApps.length === 0 ? (
                                                        <div style={{ padding: '12px 14px', fontSize: 13, color: 'var(--color-text-tertiary)' }}>No apps detected</div>
                                                    ) : openApps.map(app => (
                                                        <button
                                                            key={app.path}
                                                            onClick={() => handleOpenInApp(app.path)}
                                                            style={{
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: 10,
                                                                width: '100%',
                                                                padding: '8px 14px',
                                                                background: 'transparent',
                                                                border: 'none',
                                                                cursor: 'pointer',
                                                                fontSize: 13,
                                                                color: 'var(--color-text-primary)',
                                                                textAlign: 'left',
                                                                transition: 'background 0.15s',
                                                            }}
                                                            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)'; }}
                                                            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                                                        >
                                                            {app.icon ? (
                                                                <img src={app.icon} alt="" width={18} height={18} style={{ borderRadius: 4, flexShrink: 0 }} />
                                                            ) : (
                                                                <div style={{ width: 18, height: 18, borderRadius: 4, backgroundColor: 'var(--color-border)', flexShrink: 0 }} />
                                                            )}
                                                            <span style={{ fontWeight: 500 }}>{app.name}</span>
                                                        </button>
                                                    ))}
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>
                                    </>
                                )}
                                {isEditing && (
                                    <button
                                        onClick={handleSave}
                                        disabled={isSaving}
                                        style={{ display: "flex", alignItems: "center", gap: 6, background: saveSuccess ? "var(--color-success-dim, rgba(34,197,94,0.1))" : "var(--color-bg-hover)", border: `1px solid ${saveSuccess ? "var(--color-success)" : "var(--color-border)"}`, color: saveSuccess ? "var(--color-success)" : "var(--color-text-primary)", borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 13, transition: "all 0.3s" }}
                                    >
                                        {saveSuccess ? <><CheckIcon width={14} height={14} /> Saved!</> : "Save"}
                                    </button>
                                )}
                                {isPlanFile && (
                                    <button
                                        onClick={handleApprovePlan}
                                        style={{ display: "flex", alignItems: "center", gap: 8, background: "linear-gradient(135deg, rgba(74,222,128,0.2), rgba(34,197,94,0.1))", border: "1px solid rgba(74,222,128,0.5)", color: "#4ade80", borderRadius: 8, padding: "8px 18px", cursor: "pointer", fontSize: 13, fontWeight: 600, letterSpacing: "0.02em", transition: "all 0.2s" }}
                                        onMouseEnter={e => { e.currentTarget.style.background = "linear-gradient(135deg, rgba(74,222,128,0.28), rgba(34,197,94,0.18))"; e.currentTarget.style.borderColor = "rgba(74,222,128,0.8)"; }}
                                        onMouseLeave={e => { e.currentTarget.style.background = "linear-gradient(135deg, rgba(74,222,128,0.2), rgba(34,197,94,0.1))"; e.currentTarget.style.borderColor = "rgba(74,222,128,0.5)"; }}
                                    >
                                        <CheckIcon width={15} height={15} />
                                        Approve &amp; Execute
                                    </button>
                                )}
                            </div>

                            {/* View Mode Toggle */}
                            {!isPlanFile && (['html', 'htm', 'xlsx', 'xls', 'csv', 'pptx', 'ppt', 'md', 'pdf'].includes(selectedCode.name.split('.').pop()?.toLowerCase() || '')) && (
                                <div style={{ display: "flex", gap: 8, marginBottom: 16, backgroundColor: "var(--color-bg-hover)", padding: 4, borderRadius: 10, width: "fit-content" }}>
                                    <button
                                        onClick={() => setViewMode('code')}
                                        style={{ padding: "6px 16px", borderRadius: 8, border: "none", fontSize: 13, fontWeight: 500, cursor: "pointer", backgroundColor: viewMode === 'code' ? "var(--color-bg-selected)" : "transparent", color: viewMode === 'code' ? "var(--color-text-primary)" : "var(--color-text-tertiary)", transition: "all 0.2s" }}
                                    >
                                        Code
                                    </button>
                                    <button
                                        onClick={() => setViewMode('preview')}
                                        style={{ padding: "6px 16px", borderRadius: 8, border: "none", fontSize: 13, fontWeight: 500, cursor: "pointer", backgroundColor: viewMode === 'preview' ? "var(--color-bg-selected)" : "transparent", color: viewMode === 'preview' ? "var(--color-text-primary)" : "var(--color-text-tertiary)", transition: "all 0.2s" }}
                                    >
                                        {['xlsx', 'xls', 'csv', 'pptx', 'ppt', 'md', 'pdf'].includes(selectedCode.name.split('.').pop()?.toLowerCase() || '') ? 'Preview' : 'Visual Preview'}
                                    </button>
                                </div>
                            )}

                            {/* Plan notice */}
                            {isPlanFile && (
                                <div style={{ marginBottom: 16, padding: "12px 16px", backgroundColor: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.25)", borderRadius: 10, fontSize: 13, color: "#fbbf24", lineHeight: 1.5 }}>
                                    ✍️ <strong>Review this plan carefully.</strong> You can edit any step before approving. Click <strong>Approve &amp; Execute</strong> when ready.
                                </div>
                            )}

                            {/* Content area */}
                            {viewMode === 'preview' ? (
                                <motion.div 
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    transition={{ delay: 0.1 }}
                                    style={{ flex: 1, backgroundColor: "var(--color-bg-surface)", borderRadius: 12, overflow: "hidden", border: "1px solid var(--color-border)", position: "relative", minHeight: 400 }}>
                                    {(() => {
                                        const ext = selectedCode.name.split('.').pop()?.toLowerCase() || '';
                                        if (ext === 'md') {
                                            return <MarkdownViewer content={editedContent || selectedCode.content} />;
                                        }
                                        if (['xlsx', 'xls', 'csv'].includes(ext)) {
                                            return <ExcelViewer filename={selectedCode.name} content={selectedCode.content} />;
                                        }
                                        if (['pptx', 'ppt'].includes(ext)) {
                                            return <PPTViewer filename={selectedCode.name} filePath={realArtifactPath} />;
                                        }
                                        if (ext === 'pdf') {
                                            return <PDFViewer filename={selectedCode.name} content={selectedCode.content} filePath={realArtifactPath} />;
                                        }
                                        return (
                                            <>
                                                <iframe 
                                                    srcDoc={(editedContent || selectedCode.content)}
                                                    style={{ width: "100%", height: "100%", border: "none" }}
                                                    title="Preview"
                                                    sandbox="allow-scripts allow-forms allow-same-origin"
                                                />
                                                <div style={{ position: "absolute", bottom: 12, right: 12, backgroundColor: "var(--color-bg-overlay)", backdropFilter: "blur(4px)", padding: "4px 10px", borderRadius: 6, fontSize: 10, color: "var(--color-text-primary)", pointerEvents: "none" }}>
                                                    Interactive Preview Mode
                                                </div>
                                            </>
                                        );
                                    })()}
                                </motion.div>
                            ) : isEditing ? (
                                <motion.textarea
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    transition={{ delay: 0.05 }}
                                    value={editedContent}
                                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setEditedContent(e.target.value)}
                                    spellCheck={false}
                                    style={{
                                        flex: 1,
                                        minHeight: "60vh",
                                        backgroundColor: "var(--color-bg-subtle)",
                                        border: "1px solid var(--color-border)",
                                        borderRadius: 12,
                                        padding: 24,
                                        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                                        fontSize: 13,
                                        color: "var(--color-text-primary)",
                                        lineHeight: 1.7,
                                        resize: "vertical",
                                        outline: "none",
                                        caretColor: "var(--color-text-primary)"
                                    }}
                                    onFocus={(e: React.FocusEvent<HTMLTextAreaElement>) => { (e.target as HTMLTextAreaElement).style.borderColor = "var(--color-border-strong)"; }}
                                    onBlur={(e: React.FocusEvent<HTMLTextAreaElement>) => { (e.target as HTMLTextAreaElement).style.borderColor = "var(--color-border)"; }}
                                />
                            ) : (
                                <motion.div 
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    transition={{ delay: 0.05 }}
                                    style={{ backgroundColor: "var(--color-bg-subtle)", border: "1px solid var(--color-border)", borderRadius: 12, padding: 24, flex: 1, overflow: "auto", fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: 13, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
                                    <SyntaxHighlighter code={editedContent || selectedCode.content} language={detectLanguage(selectedCode.name)} />
                                </motion.div>
                            )}
                        </motion.div>
                    ) : (
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ type: "spring", damping: 20, stiffness: 250 }}
                        >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 40 }}>
                                <h1 style={{ margin: 0, fontSize: 32, fontFamily: "'OrticaLinear-Light', serif", fontWeight: 400 }}>Artifacts</h1>
                                <button 
                                    onClick={() => {
                                        setNewArtifactName('');
                                        setNewArtifactExt('md');
                                        setShowNewModal(true);
                                    }}
                                    className="glossy"
                                    style={{ 
                                        backgroundColor: "var(--color-text-primary)", 
                                        color: "var(--color-bg-base)", 
                                        border: "none", 
                                        borderTop: "1px solid var(--glossy-highlight)",
                                        boxShadow: "var(--glossy-inner), var(--glossy-outer)",
                                        borderRadius: 8, 
                                        padding: "10px 20px", 
                                        fontSize: 13, 
                                        fontWeight: 600, 
                                        cursor: "pointer", 
                                        transition: "all 0.2s" 
                                    }}
                                >
                                    New artifact
                                </button>
                            </div>

                             <div style={{ display: "flex", gap: 32, borderBottom: "1px solid var(--color-border)", marginBottom: 32 }}>
                                <button
                                    onClick={() => setActiveTab('inspiration')}
                                    style={{ background: "transparent", border: "none", borderBottom: activeTab === 'inspiration' ? "2px solid var(--color-text-primary)" : "2px solid transparent", color: activeTab === 'inspiration' ? "var(--color-text-primary)" : "var(--color-text-tertiary)", fontSize: 15, fontWeight: 500, paddingBottom: 12, cursor: "pointer", transition: "0.2s" }}
                                >
                                    Inspiration
                                </button>
                                <button
                                    onClick={() => setActiveTab('yours')}
                                    style={{ background: "transparent", border: "none", borderBottom: activeTab === 'yours' ? "2px solid var(--color-text-primary)" : "2px solid transparent", color: activeTab === 'yours' ? "var(--color-text-primary)" : "var(--color-text-tertiary)", fontSize: 15, fontWeight: 500, paddingBottom: 12, cursor: "pointer", transition: "0.2s" }}
                                >
                                    Your artifacts
                                </button>
                                <button
                                    onClick={() => setActiveTab('sites')}
                                    style={{ background: "transparent", border: "none", borderBottom: activeTab === 'sites' ? "2px solid var(--color-text-primary)" : "2px solid transparent", color: activeTab === 'sites' ? "var(--color-text-primary)" : "var(--color-text-tertiary)", fontSize: 15, fontWeight: 500, paddingBottom: 12, cursor: "pointer", transition: "0.2s", display: "flex", alignItems: "center", gap: 6 }}
                                >
                                    <GlobeAltIcon className="w-4 h-4" />
                                    Sites
                                    {sites.length > 0 && (
                                        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 18, height: 18, borderRadius: 9, backgroundColor: "rgba(139,92,246,0.15)", color: "#7c3aed", fontSize: 11, fontWeight: 700, padding: "0 5px" }}>
                                            {sites.length}
                                        </span>
                                    )}
                                </button>
                                <button
                                    onClick={() => setActiveTab('terminal')}
                                    style={{ background: "transparent", border: "none", borderBottom: activeTab === 'terminal' ? "2px solid var(--color-text-primary)" : "2px solid transparent", color: activeTab === 'terminal' ? "var(--color-text-primary)" : "var(--color-text-tertiary)", fontSize: 15, fontWeight: 500, paddingBottom: 12, cursor: "pointer", transition: "0.2s", display: "flex", alignItems: "center", gap: 6 }}
                                >
                                    Terminal
                                    {processes.filter(p => p.status === 'running').length > 0 && (
                                        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 18, height: 18, borderRadius: 9, backgroundColor: "rgba(34,197,94,0.15)", color: "#16a34a", fontSize: 11, fontWeight: 700, padding: "0 5px" }}>
                                            {processes.filter(p => p.status === 'running').length}
                                        </span>
                                    )}
                                </button>
                            </div>

                            <AnimatePresence mode="wait">
                                {activeTab === 'yours' && (
                                    <motion.div 
                                        key="yours"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        transition={{ duration: 0.2 }}
                                        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 24 }}>
                                        {artifacts.length === 0 ? (
                                            <div className="glossy" style={{ backgroundColor: "var(--color-bg-subtle)", border: "1px dashed var(--color-border)", borderTop: "1px solid var(--glossy-highlight)", boxShadow: "var(--glossy-inner), var(--glossy-outer)", borderRadius: 16, padding: "40px", textAlign: "center", gridColumn: "1 / -1" }}>
                                                <div style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)" }}>No artifacts in this chat yet</div>
                                                <p style={{ color: "var(--color-text-tertiary)", fontSize: 13, marginTop: 8, maxWidth: 300, margin: "8px auto" }}>Tell the AI to generate a report, PDF, dashboard, or code file to see it here.</p>
                                                <button 
                                                    onClick={() => loadArtifacts()}
                                                    className="glossy"
                                                    style={{ marginTop: 20, padding: "8px 16px", backgroundColor: "var(--color-text-primary)", color: "var(--color-bg-base)", borderTop: "1px solid var(--glossy-highlight)", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "none" }}
                                                >
                                                    Refresh Artifacts
                                                </button>
                                            </div>
                                        ) : artifacts.map((a, idx) => {
                                            const ext = (a.name.split('.').pop() || '').toLowerCase();
                                            const badgeConfig = ext === 'pdf' ? { label: 'PDF', bg: 'rgba(239,68,68,0.12)', color: '#ef4444', border: 'rgba(239,68,68,0.25)' }
                                                : ['html', 'htm'].includes(ext) ? { label: 'WEB', bg: 'rgba(139,92,246,0.12)', color: '#8b5cf6', border: 'rgba(139,92,246,0.25)' }
                                                : ['csv', 'xlsx', 'xls'].includes(ext) ? { label: 'DATA', bg: 'rgba(16,185,129,0.12)', color: '#10b981', border: 'rgba(16,185,129,0.25)' }
                                                : ['pptx', 'ppt'].includes(ext) ? { label: 'SLIDES', bg: 'rgba(245,158,11,0.12)', color: '#f59e0b', border: 'rgba(245,158,11,0.25)' }
                                                : { label: 'DOC', bg: 'rgba(99,102,241,0.12)', color: '#6366f1', border: 'rgba(99,102,241,0.25)' };

                                            return (
                                                <motion.div
                                                    key={a.id + a.chatId}
                                                    initial={{ opacity: 0, y: 20 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    transition={{ delay: idx * 0.05 }}
                                                    onClick={() => handleReadArtifact(a.chatId, a.name)}
                                                    style={{ cursor: "pointer" }}
                                                >
                                                    <motion.div 
                                                        whileHover={{ y: -4 }}
                                                        transition={{ type: "spring", stiffness: 300, damping: 20 }}
                                                        className="glossy"
                                                        style={{ 
                                                            backgroundColor: a.name === 'execution_plan.md' ? "rgba(234,179,8,0.05)" : "var(--color-bg-surface)", 
                                                            borderRadius: "16px", 
                                                            border: a.name === 'execution_plan.md' ? "1px solid rgba(234,179,8,0.3)" : "1px solid var(--color-border)", 
                                                            borderTop: "1px solid var(--glossy-highlight)",
                                                            boxShadow: "var(--glossy-inner), var(--glossy-outer)",
                                                            height: 220, 
                                                            overflow: "hidden", 
                                                            display: "flex", 
                                                            flexDirection: "column", 
                                                            position: "relative" 
                                                        }}
                                                    >
                                                        {/* Badge */}
                                                        <div style={{ position: "absolute", top: 12, right: 12, zIndex: 2, display: "flex", gap: 6 }}>
                                                            {a.name === 'execution_plan.md' && (
                                                                <div style={{ padding: "3px 8px", backgroundColor: "rgba(234,179,8,0.1)", border: "1px solid rgba(234,179,8,0.3)", borderRadius: 6, fontSize: 10, fontWeight: 700, color: "#854d0e", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                                                                    Awaiting Approval
                                                                </div>
                                                            )}
                                                            <div style={{ padding: "3px 8px", backgroundColor: badgeConfig.bg, border: `1px solid ${badgeConfig.border}`, borderRadius: 6, fontSize: 10, fontWeight: 700, color: badgeConfig.color, letterSpacing: "0.05em" }}>
                                                                {badgeConfig.label}
                                                            </div>
                                                        </div>

                                                        {ext === 'pdf' ? (
                                                            <div style={{ margin: "24px 24px 0 24px", backgroundColor: "var(--color-bg-base)", border: "1px solid var(--color-border)", borderBottom: "none", borderTopLeftRadius: 12, borderTopRightRadius: 12, flex: 1, padding: 16, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
                                                                <div style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: "rgba(239,68,68,0.12)", display: "flex", alignItems: "center", justifyContent: "center", color: "#ef4444", fontSize: 14, fontWeight: 700 }}>
                                                                    PDF
                                                                </div>
                                                                <span style={{ fontSize: 11, color: "var(--color-text-secondary)", fontWeight: 500, textAlign: "center", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                                    {a.name}
                                                                </span>
                                                            </div>
                                                        ) : (
                                                            <div style={{ margin: "24px 24px 0 24px", backgroundColor: "var(--color-bg-base)", border: "1px solid var(--color-border)", borderBottom: "none", borderTopLeftRadius: 12, borderTopRightRadius: 12, flex: 1, padding: 16, overflow: "hidden" }}>
                                                                <pre style={{ margin: 0, fontSize: 10, color: "var(--color-text-tertiary)", fontFamily: "'JetBrains Mono', 'Fira Code', monospace", opacity: 0.8, whiteSpace: "pre-wrap" }}>
                                                                    {a.snippet}
                                                                </pre>
                                                            </div>
                                                        )}
                                                        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 60, background: `linear-gradient(transparent, ${a.name === 'execution_plan.md' ? 'rgba(252,250,240,0.95)' : 'var(--color-bg-surface)'} 90%)` }}></div>
                                                    </motion.div>
                                                    <div style={{ marginTop: 12 }}>
                                                        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</div>
                                                        <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginTop: 4, display: "flex", gap: 8, alignItems: "center" }}>
                                                            <span>Last edited {timeAgo(a.lastEdited)}</span>
                                                            <span style={{ color: "var(--color-border)" }}>·</span>
                                                            <span style={{ color: "#6366f1", fontWeight: 500 }}>Chat {a.chatId.slice(0, 8)}...</span>
                                                        </div>
                                                    </div>
                                                </motion.div>
                                            );
                                        })}
                                    </motion.div>
                                )}

                                {activeTab === 'sites' && (
                                    <motion.div 
                                        key="sites"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        transition={{ duration: 0.2 }}
                                        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 24 }}>
                                        {sites.length === 0 ? (
                                            <div className="glossy" style={{ backgroundColor: "var(--color-bg-subtle)", border: "1px dashed var(--color-border)", borderTop: "1px solid var(--glossy-highlight)", boxShadow: "var(--glossy-inner), var(--glossy-outer)", borderRadius: 16, padding: "40px", textAlign: "center", gridColumn: "1 / -1" }}>
                                                <GlobeAltIcon className="w-12 h-12 mx-auto mb-4 opacity-30" style={{ color: "var(--color-text-tertiary)" }} />
                                                <div style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)" }}>No websites created yet</div>
                                                <p style={{ color: "var(--color-text-tertiary)", fontSize: 13, marginTop: 8, maxWidth: 300, margin: "8px auto" }}>Ask the AI to build a website, dashboard, or HTML report to see it here.</p>
                                                <button 
                                                    onClick={() => activeChatId && loadSites(activeChatId)}
                                                    className="glossy"
                                                    style={{ marginTop: 20, padding: "8px 16px", backgroundColor: "var(--color-text-primary)", color: "var(--color-bg-base)", borderTop: "1px solid var(--glossy-highlight)", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "none" }}
                                                >
                                                    Refresh Sites
                                                </button>
                                            </div>
                                        ) : sites.map((site, idx) => (
                                            <motion.div
                                                key={site.id + site.chatId}
                                                initial={{ opacity: 0, y: 20 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                transition={{ delay: idx * 0.05 }}
                                                style={{ cursor: "pointer" }}
                                            >
                                                <motion.div 
                                                    whileHover={{ y: -4 }}
                                                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                                                    className="glossy"
                                                    style={{ 
                                                        backgroundColor: "var(--color-bg-surface)", 
                                                        borderRadius: "16px", 
                                                        border: "1px solid var(--color-border)", 
                                                        borderTop: "1px solid var(--glossy-highlight)",
                                                        boxShadow: "var(--glossy-inner), var(--glossy-outer)",
                                                        height: 280, 
                                                        overflow: "hidden", 
                                                        display: "flex", 
                                                        flexDirection: "column", 
                                                        position: "relative" 
                                                    }}
                                                >
                                                    {/* Site preview */}
                                                    <div style={{ flex: 1, backgroundColor: "var(--color-bg-subtle)", overflow: "hidden", position: "relative" }}>
                                                        <iframe
                                                            src={`everfern-site://${site.chatId}/index.html`}
                                                            style={{ width: "100%", height: "100%", border: "none", backgroundColor: "var(--color-bg-subtle)" }}
                                                            title="Preview"
                                                            sandbox="allow-scripts"
                                                        />
                                                        <div style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 6 }}>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    if (activeChatId) {
                                                                        handleReadArtifact(activeChatId, site.name);
                                                                    }
                                                                }}
                                                                className="glossy"
                                                                style={{ padding: "6px 10px", backgroundColor: "var(--color-bg-overlay)", backdropFilter: "blur(4px)", borderRadius: 6, fontSize: 11, fontWeight: 500, color: "var(--color-text-primary)", border: "1px solid var(--color-border)", borderTop: "1px solid var(--glossy-highlight)", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
                                                            >
                                                                <PencilSquareIcon className="w-3 h-3" />
                                                                Edit
                                                            </button>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    window.open(`everfern-site://${site.chatId}/index.html`, '_blank');
                                                                }}
                                                                className="glossy"
                                                                style={{ padding: "6px 10px", backgroundColor: "rgba(139,92,246,0.9)", backdropFilter: "blur(4px)", borderRadius: 6, fontSize: 11, fontWeight: 500, color: "#fff", border: "none", borderTop: "1px solid var(--glossy-highlight)", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
                                                            >
                                                                <ArrowTopRightOnSquareIcon className="w-3 h-3" />
                                                                Open
                                                            </button>
                                                        </div>
                                                    </div>
                                                    <div style={{ padding: "16px 20px", borderTop: "1px solid var(--color-border)" }}>
                                                        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{site.name}</div>
                                                        <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginTop: 4 }}>Last edited {timeAgo(site.lastEdited)}</div>
                                                    </div>
                                                </motion.div>
                                            </motion.div>
                                        ))}
                                    </motion.div>
                                )}

                                {activeTab === 'inspiration' && (
                                    <motion.div 
                                        key="inspiration"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        transition={{ duration: 0.2 }}
                                        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 24 }}
                                    >
                                        {INSPIRATION_TEMPLATES.map((tmpl, idx) => (
                                            <motion.div
                                                key={tmpl.id}
                                                initial={{ opacity: 0, y: 20 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                transition={{ delay: idx * 0.05 }}
                                                style={{ display: "flex", flexDirection: "column" }}
                                            >
                                                <motion.div
                                                    whileHover={{ y: -4 }}
                                                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                                                    className="glossy"
                                                    style={{
                                                        backgroundColor: "var(--color-bg-surface)",
                                                        borderRadius: "18px",
                                                        border: "1px solid var(--color-border)",
                                                        borderTop: "1px solid var(--glossy-highlight)",
                                                        boxShadow: "var(--glossy-inner), var(--glossy-outer)",
                                                        padding: 22,
                                                        display: "flex",
                                                        flexDirection: "column",
                                                        justifyContent: "space-between",
                                                        minHeight: 250
                                                    }}
                                                >
                                                    <div>
                                                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                                                            <span style={{
                                                                padding: "3px 8px",
                                                                borderRadius: 6,
                                                                backgroundColor: tmpl.badgeBg,
                                                                color: tmpl.badgeColor,
                                                                fontSize: 11,
                                                                fontWeight: 700,
                                                                letterSpacing: "0.04em"
                                                            }}>
                                                                {tmpl.badge}
                                                            </span>
                                                            <span style={{ fontSize: 11.5, color: "var(--color-text-tertiary)", fontFamily: "var(--font-mono, monospace)" }}>{tmpl.type.toUpperCase()} Template</span>
                                                        </div>
                                                        <div style={{ fontSize: 16, fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 6 }}>
                                                            {tmpl.title}
                                                        </div>
                                                        <p style={{ fontSize: 12.5, color: "var(--color-text-secondary)", lineHeight: 1.5, margin: "0 0 16px 0" }}>
                                                            {tmpl.description}
                                                        </p>
                                                    </div>

                                                    <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: "auto", borderTop: "1px solid var(--color-border)", paddingTop: 14 }}>
                                                        <button
                                                            onClick={() => {
                                                                setSelectedCode({ name: tmpl.name, content: tmpl.sampleContent, chatId: activeChatId || 'inspiration' });
                                                                setArtifactPath(`Inspiration / ${tmpl.name}`);
                                                                setRealArtifactPath('');
                                                            }}
                                                            className="glossy"
                                                            style={{
                                                                flex: 1,
                                                                padding: "8px 14px",
                                                                backgroundColor: "var(--color-bg-subtle)",
                                                                border: "1px solid var(--color-border)",
                                                                borderTop: "1px solid var(--glossy-highlight)",
                                                                borderRadius: 8,
                                                                fontSize: 12,
                                                                fontWeight: 600,
                                                                color: "var(--color-text-primary)",
                                                                cursor: "pointer"
                                                            }}
                                                        >
                                                            Preview
                                                        </button>
                                                        <button
                                                            onClick={async () => {
                                                                const chatId = activeChatId || 'general';
                                                                await (window as any).electronAPI?.artifacts?.write?.(chatId, tmpl.name, tmpl.sampleContent, projectPath);
                                                                await loadArtifacts();
                                                                setSelectedCode({ name: tmpl.name, content: tmpl.sampleContent, chatId });
                                                                setActiveTab('yours');
                                                            }}
                                                            className="glossy"
                                                            style={{
                                                                padding: "8px 14px",
                                                                backgroundColor: "var(--color-text-primary)",
                                                                color: "var(--color-bg-base)",
                                                                border: "none",
                                                                borderTop: "1px solid var(--glossy-highlight)",
                                                                borderRadius: 8,
                                                                fontSize: 12,
                                                                fontWeight: 600,
                                                                cursor: "pointer"
                                                            }}
                                                        >
                                                            Use Template
                                                        </button>
                                                    </div>
                                                </motion.div>
                                            </motion.div>
                                        ))}
                                    </motion.div>
                                )}

                                {activeTab === 'terminal' && (
                                    <motion.div
                                        key="terminal"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        transition={{ duration: 0.2 }}
                                    >
                                        {processesLoading && processes.length === 0 ? (
                                            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, color: "var(--color-text-secondary)", fontSize: 14 }}>
                                                Loading processes…
                                            </div>
                                        ) : processes.length === 0 ? (
                                            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 200, gap: 8 }}>
                                                <span style={{ fontSize: 32, opacity: 0.3 }}>▶</span>
                                                <span style={{ color: "var(--color-text-secondary)", fontSize: 14 }}>No active terminal processes.</span>
                                                <span style={{ color: "var(--color-text-tertiary)", fontSize: 12 }}>Processes spawned by the agent will appear here.</span>
                                            </div>
                                        ) : (
                                            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                                                {processes.map((proc, idx) => (
                                                    <motion.div
                                                        key={proc.id}
                                                        initial={{ opacity: 0, y: 12 }}
                                                        animate={{ opacity: 1, y: 0 }}
                                                        transition={{ delay: idx * 0.04 }}
                                                        className="glossy"
                                                        style={{
                                                            display: "flex",
                                                            alignItems: "center",
                                                            gap: 16,
                                                            padding: "14px 20px",
                                                            borderRadius: 14,
                                                            border: "1px solid var(--color-border)",
                                                            borderTop: "1px solid var(--glossy-highlight)",
                                                            boxShadow: "var(--glossy-inner), var(--glossy-outer)",
                                                            backgroundColor: proc.status === 'running' ? "rgba(34,197,94,0.03)" : "var(--color-bg-surface)",
                                                            transition: "background-color 0.2s"
                                                        }}
                                                    >
                                                        {/* Status dot */}
                                                        <div style={{
                                                            width: 10, height: 10, borderRadius: "50%",
                                                            backgroundColor: proc.status === 'running' ? "#22c55e" : "var(--color-text-placeholder)",
                                                            boxShadow: proc.status === 'running' ? "0 0 6px rgba(34,197,94,0.5)" : "none",
                                                            flexShrink: 0
                                                        }} />

                                                        {/* Command info */}
                                                        <div style={{ flex: 1, minWidth: 0 }}>
                                                            <div style={{
                                                                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                                                                fontSize: 13,
                                                                fontWeight: 500,
                                                                color: "var(--color-text-primary)",
                                                                whiteSpace: "nowrap",
                                                                overflow: "hidden",
                                                                textOverflow: "ellipsis"
                                                            }}>
                                                                {proc.commandLine}
                                                            </div>
                                                            <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 3, display: "flex", gap: 12 }}>
                                                                <span>ID: {proc.id.slice(0, 8)}…</span>
                                                                <span>{proc.status === 'running' ? '● Running' : `○ Exited (${proc.exitCode ?? '?'})`}</span>
                                                                <span>{(proc.bufferSize / 1024).toFixed(1)} KB buffered</span>
                                                            </div>
                                                        </div>

                                                        {/* Kill button */}
                                                        {proc.status === 'running' && (
                                                            <button
                                                                onClick={() => handleKillProcess(proc.id)}
                                                                className="glossy"
                                                                style={{
                                                                    background: "rgba(239,68,68,0.08)",
                                                                    border: "1px solid rgba(239,68,68,0.25)",
                                                                    borderTop: "1px solid var(--glossy-highlight)",
                                                                    color: "#ef4444",
                                                                    borderRadius: 8,
                                                                    padding: "6px 14px",
                                                                    fontSize: 12,
                                                                    fontWeight: 600,
                                                                    cursor: "pointer",
                                                                    transition: "all 0.2s",
                                                                    flexShrink: 0
                                                                }}
                                                                onMouseEnter={e => { e.currentTarget.style.background = "rgba(239,68,68,0.15)"; e.currentTarget.style.borderColor = "rgba(239,68,68,0.5)"; }}
                                                                onMouseLeave={e => { e.currentTarget.style.background = "rgba(239,68,68,0.08)"; e.currentTarget.style.borderColor = "rgba(239,68,68,0.25)"; }}
                                                            >
                                                                Kill
                                                            </button>
                                                        )}
                                                    </motion.div>
                                                ))}
                                            </div>
                                        )}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </motion.div>
                    )}

                    {/* New Artifact Modal */}
                    {showNewModal && (
                        <div style={{
                            position: "fixed",
                            inset: 0,
                            backgroundColor: "rgba(0,0,0,0.5)",
                            backdropFilter: "blur(6px)",
                            zIndex: 10000,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: 20
                        }}>
                            <motion.div
                                initial={{ opacity: 0, scale: 0.94, y: 10 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.94, y: 10 }}
                                className="glossy"
                                style={{
                                    backgroundColor: "var(--color-bg-surface)",
                                    borderRadius: 20,
                                    border: "1px solid var(--color-border)",
                                    borderTop: "1px solid var(--glossy-highlight)",
                                    boxShadow: "var(--glossy-inner), 0 20px 50px rgba(0,0,0,0.25)",
                                    width: "100%",
                                    maxWidth: 480,
                                    padding: 28,
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 18
                                }}
                            >
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <div>
                                        <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700, color: "var(--color-text-primary)" }}>Create New Artifact</h2>
                                        <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--color-text-secondary)" }}>Choose a format and start building immediately</p>
                                    </div>
                                    <button onClick={() => setShowNewModal(false)} style={{ background: "transparent", border: "none", color: "var(--color-text-tertiary)", cursor: "pointer" }}>
                                        <XMarkIcon width={20} height={20} />
                                    </button>
                                </div>

                                {/* Type selector */}
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                                    {[
                                        { ext: 'md' as const, label: 'Markdown', icon: '📄', color: '#6366f1' },
                                        { ext: 'pdf' as const, label: 'PDF Report', icon: '📑', color: '#ef4444' },
                                        { ext: 'html' as const, label: 'Web App', icon: '🌐', color: '#8b5cf6' },
                                        { ext: 'csv' as const, label: 'Spreadsheet', icon: '📊', color: '#10b981' },
                                        { ext: 'pptx' as const, label: 'Slides', icon: '📽️', color: '#f59e0b' },
                                        { ext: 'py' as const, label: 'Code Script', icon: '💻', color: '#3b82f6' },
                                    ].map(t => (
                                        <button
                                            key={t.ext}
                                            onClick={() => {
                                                setNewArtifactExt(t.ext);
                                                if (!newArtifactName || newArtifactName.includes('.')) {
                                                    const base = newArtifactName ? newArtifactName.split('.')[0] : 'untitled';
                                                    setNewArtifactName(`${base}.${t.ext}`);
                                                }
                                            }}
                                            style={{
                                                display: "flex",
                                                flexDirection: "column",
                                                alignItems: "center",
                                                gap: 6,
                                                padding: "12px 8px",
                                                borderRadius: 12,
                                                border: newArtifactExt === t.ext ? `2px solid ${t.color}` : "1px solid var(--color-border)",
                                                backgroundColor: newArtifactExt === t.ext ? "var(--color-bg-hover)" : "var(--color-bg-subtle)",
                                                cursor: "pointer",
                                                transition: "all 0.15s"
                                            }}
                                        >
                                            <span style={{ fontSize: 20 }}>{t.icon}</span>
                                            <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--color-text-primary)" }}>{t.label}</span>
                                        </button>
                                    ))}
                                </div>

                                {/* Filename input */}
                                <div>
                                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 6 }}>Artifact Filename</label>
                                    <input
                                        type="text"
                                        value={newArtifactName}
                                        onChange={e => setNewArtifactName(e.target.value)}
                                        placeholder={`new_artifact.${newArtifactExt}`}
                                        style={{
                                            width: "100%",
                                            padding: "10px 14px",
                                            borderRadius: 10,
                                            border: "1px solid var(--color-border)",
                                            backgroundColor: "var(--color-bg-subtle)",
                                            color: "var(--color-text-primary)",
                                            fontSize: 13,
                                            outline: "none",
                                            fontFamily: "var(--font-mono, monospace)",
                                            boxSizing: "border-box"
                                        }}
                                    />
                                </div>

                                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 6 }}>
                                    <button
                                        onClick={() => setShowNewModal(false)}
                                        style={{
                                            padding: "8px 16px",
                                            borderRadius: 8,
                                            border: "1px solid var(--color-border)",
                                            backgroundColor: "transparent",
                                            color: "var(--color-text-primary)",
                                            fontSize: 13,
                                            cursor: "pointer"
                                        }}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={async () => {
                                            const filename = newArtifactName.trim() || `untitled.${newArtifactExt}`;
                                            const finalName = filename.includes('.') ? filename : `${filename}.${newArtifactExt}`;
                                            const initialContent = newArtifactExt === 'md' ? `# ${finalName.replace('.md', '')}\n\nStart writing your document here...\n`
                                                : newArtifactExt === 'html' ? `<!DOCTYPE html>\n<html>\n<head><meta charset="utf-8"/><title>${finalName}</title></head>\n<body style="font-family:sans-serif;padding:32px"><h1>${finalName}</h1><p>Interactive web artifact.</p></body>\n</html>`
                                                : newArtifactExt === 'csv' ? `Column 1,Column 2,Column 3\nData 1,Data 2,Data 3\n`
                                                : newArtifactExt === 'pdf' ? `%PDF-1.4\n1 0 obj << /Title (${finalName}) >>\n`
                                                : newArtifactExt === 'pptx' ? `{"slides":[{"title":"Title Slide","subtitle":"Subtitle","points":["Point 1","Point 2"]}]}`
                                                : `# ${finalName}\n`;
                                            
                                            const chatId = activeChatId || 'general';
                                            await (window as any).electronAPI?.artifacts?.write?.(chatId, finalName, initialContent, projectPath);
                                            await loadArtifacts();
                                            setShowNewModal(false);
                                            setSelectedCode({ name: finalName, content: initialContent, chatId });
                                            setIsEditing(true);
                                            setActiveTab('yours');
                                        }}
                                        className="glossy"
                                        style={{
                                            padding: "8px 18px",
                                            borderRadius: 8,
                                            backgroundColor: "var(--color-text-primary)",
                                            color: "var(--color-bg-base)",
                                            border: "none",
                                            borderTop: "1px solid var(--glossy-highlight)",
                                            fontSize: 13,
                                            fontWeight: 600,
                                            cursor: "pointer"
                                        }}
                                    >
                                        Create Artifact
                                    </button>
                                </div>
                            </motion.div>
                        </div>
                    )}
                </motion.div>
            )}
        </AnimatePresence>
    );
}
