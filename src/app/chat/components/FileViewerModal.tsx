import React, { useState, useEffect } from 'react';
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
    ChevronDownIcon
} from '@heroicons/react/24/outline';
import FileIcon from '../FileIcon';

interface FileViewerModalProps {
    file: { name: string; path: string } | null;
    onClose: () => void;
    chatId: string;
    projectPath?: string;
}

// ── 1. MARKDOWN VIEWER ──────────────────────────────────────────────
export function MarkdownViewer({ content, theme = 'light' }: { content: string; theme?: 'light' | 'dark' }) {
    const isDark = theme === 'dark';
    
    const renderMarkdown = (text: string) => {
        const lines = text.split('\n');
        const elements: React.ReactNode[] = [];
        let inCodeBlock = false;
        let codeBlockContent: string[] = [];
        let codeBlockLang = '';

        const formatInline = (text: string) => {
            let f = text;
            f = f.replace(/`(.*?)`/g, `<code style="background-color: ${isDark ? 'rgba(255,255,255,0.08)' : '#f1f0ea'}; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 13px; color: ${isDark ? '#60a5fa' : '#0891b2'};">$1</code>`);
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
                            backgroundColor: '#111113', 
                            color: '#f8f7f2', 
                            padding: 16, 
                            borderRadius: 8, 
                            overflowX: 'auto', 
                            fontSize: 13, 
                            fontFamily: 'monospace', 
                            margin: '12px 0',
                            border: '1px solid rgba(255,255,255,0.05)'
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
                elements.push(<h1 key={`h1-${i}`} style={{ fontSize: 24, fontWeight: 700, margin: '24px 0 12px 0', borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : '#e8e6d9'}`, paddingBottom: 6, color: isDark ? '#ffffff' : '#111' }}>{line.substring(2)}</h1>);
                continue;
            }
            if (line.startsWith('## ')) {
                elements.push(<h2 key={`h2-${i}`} style={{ fontSize: 20, fontWeight: 600, margin: '20px 0 10px 0', borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : '#e8e6d9'}`, paddingBottom: 4, color: isDark ? '#f3f4f6' : '#222' }}>{line.substring(3)}</h2>);
                continue;
            }
            if (line.startsWith('### ')) {
                elements.push(<h3 key={`h3-${i}`} style={{ fontSize: 16, fontWeight: 600, margin: '18px 0 8px 0', color: isDark ? '#e5e7eb' : '#333' }}>{line.substring(4)}</h3>);
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
                    <div key={`table-${i}`} style={{ overflowX: 'auto', margin: '12px 0' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                                <tr>
                                    {headers.map((h, j) => (
                                        <th key={j} style={{ padding: '8px 12px', borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0, 0, 0, 0.12)'}`, textAlign: 'left', color: isDark ? '#9ca3af' : '#717171', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }} dangerouslySetInnerHTML={{ __html: formatInline(h) }} />
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row, ri) => (
                                    <tr key={ri} style={{ borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}` }}>
                                        {row.map((cell, ci) => (
                                            <td key={ci} style={{ padding: '8px 12px', color: isDark ? '#d1d5db' : '#4a4846' }} dangerouslySetInnerHTML={{ __html: formatInline(cell) }} />
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
                    <li key={`li-${i}`} style={{ marginLeft: 20, margin: '6px 0', fontSize: 14, color: isDark ? '#d1d5db' : '#333', lineHeight: 1.6 }}
                        dangerouslySetInnerHTML={{ __html: formatInline(content) }}
                    />
                );
                continue;
            }

            if (line.trim() === '---') {
                elements.push(<hr key={`hr-${i}`} style={{ border: 'none', borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : '#e8e6d9'}`, margin: '20px 0' }} />);
                continue;
            }

            if (line.trim() === '') {
                elements.push(<div key={`spacer-${i}`} style={{ height: 12 }} />);
                continue;
            }

            elements.push(
                <p key={`p-${i}`} style={{ fontSize: 14, lineHeight: 1.7, margin: '10px 0', color: isDark ? '#d1d5db' : '#333' }}
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
            backgroundColor: isDark ? '#18181c' : '#ffffff',
            color: isDark ? '#e3e3e6' : '#222',
            borderTopLeftRadius: 8 
        }}>
            <div style={{ maxWidth: 720, margin: '0 auto', paddingBottom: 80 }}>
                {renderMarkdown(content)}
            </div>
        </div>
    );
}

// ── 2. EXCEL (XLSX/CSV) VIEWER ──────────────────────────────────────
function ExcelViewer({ filename, content, theme = 'light' }: { filename: string; content: string | null; theme?: 'light' | 'dark' }) {
    const isDark = theme === 'dark';
    let parsedData: string[][] = [];
    if (content && (filename.endsWith('.csv') || content.includes(','))) {
        parsedData = content.split('\n')
            .map(row => {
                // Keep quoted values intact
                const cells: string[] = [];
                let insideQuote = false;
                let currentCell = '';
                for (let i = 0; i < row.length; i++) {
                    const char = row[i];
                    if (char === '"') insideQuote = !insideQuote;
                    else if (char === ',' && !insideQuote) {
                        cells.push(currentCell.replace(/^"|"$/g, '').trim());
                        currentCell = '';
                    } else {
                        currentCell += char;
                    }
                }
                cells.push(currentCell.replace(/^"|"$/g, '').trim());
                return cells;
            })
            .filter(row => row.length > 1 || row[0] !== '');
    }

    const columns = Array.from({ length: Math.max(parsedData[0]?.length || 10, 10) }, (_, i) => String.fromCharCode(65 + i));

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: isDark ? '#131316' : '#f9f8f4', minWidth: 0, minHeight: 0 }}>
            {/* fx formula bar */}
            <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 8, 
                padding: '10px 16px', 
                borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : '#e8e6d9'}`, 
                backgroundColor: isDark ? '#18181c' : '#ffffff' 
            }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#10b981', fontStyle: 'italic', paddingRight: 8 }}>fx</span>
                <div style={{ borderLeft: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : '#e8e6d9'}`, height: 16 }} />
                <input 
                    type="text" 
                    readOnly
                    value={parsedData[1] ? `=SUM(${columns[3]}2:${columns[3]}${parsedData.length})` : ''} 
                    style={{ flex: 1, border: 'none', outline: 'none', fontSize: 12, color: isDark ? '#ffffff' : '#333', background: 'transparent', fontWeight: 500 }} 
                />
            </div>

            <div className="excel-scrollable" style={{ flex: 1, overflow: 'auto', position: 'relative', maxWidth: '100%', maxHeight: '100%', minHeight: 0, minWidth: 0 }}>
                <style dangerouslySetInnerHTML={{ __html: `
                    .excel-scrollable::-webkit-scrollbar {
                        width: 10px;
                        height: 10px;
                    }
                    .excel-scrollable::-webkit-scrollbar-track {
                        background: ${isDark ? '#141416' : '#f0efe9'};
                        border-left: 1px solid ${isDark ? 'rgba(255,255,255,0.05)' : '#e8e6d9'};
                        border-top: 1px solid ${isDark ? 'rgba(255,255,255,0.05)' : '#e8e6d9'};
                    }
                    .excel-scrollable::-webkit-scrollbar-thumb {
                        background: ${isDark ? 'rgba(255,255,255,0.1)' : '#d3d3d0'};
                        border-radius: 5px;
                        border: 2.5px solid ${isDark ? '#141416' : '#f0efe9'};
                    }
                    .excel-scrollable::-webkit-scrollbar-thumb:hover {
                        background: ${isDark ? 'rgba(255,255,255,0.2)' : '#b0b0ad'};
                    }
                `}} />
                <table style={{ borderCollapse: 'collapse', width: 'max-content', minWidth: '100%', fontSize: 12, backgroundColor: isDark ? '#18181c' : '#ffffff' }}>
                    <thead>
                        <tr>
                            <th style={{ backgroundColor: isDark ? '#1e1e24' : '#f0efe9', border: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : '#e8e6d9'}`, width: 45, height: 28, position: 'sticky', top: 0, left: 0, zIndex: 10 }}></th>
                            {columns.map((col, i) => (
                                <th key={i} style={{ backgroundColor: isDark ? '#1e1e24' : '#f0efe9', border: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : '#e8e6d9'}`, fontWeight: 600, color: isDark ? '#a1a1aa' : '#4a4a40', position: 'sticky', top: 0, zIndex: 9, minWidth: 120, height: 28, textAlign: 'center' }}>
                                    {col}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {parsedData.map((row, rowIndex) => (
                            <tr key={rowIndex}>
                                <td style={{ backgroundColor: isDark ? '#1e1e24' : '#f0efe9', border: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : '#e8e6d9'}`, fontWeight: 600, color: isDark ? '#a1a1aa' : '#4a4a40', textAlign: 'center', width: 45, height: 26, position: 'sticky', left: 0, zIndex: 8 }}>
                                    {rowIndex + 1}
                                </td>
                                {row.map((cell, cellIndex) => (
                                    <td 
                                        key={cellIndex} 
                                        style={{ 
                                            border: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : '#e8e6d9'}`, 
                                            padding: '6px 12px', 
                                            whiteSpace: 'nowrap',
                                            fontWeight: rowIndex === 0 ? 600 : 'normal',
                                            backgroundColor: rowIndex === 0 
                                                ? (isDark ? '#1c1c21' : '#fbfbfa') 
                                                : cell.startsWith('-') || cell.includes('Over Budget') || cell === 'High' 
                                                    ? 'rgba(239, 68, 68, 0.08)' 
                                                    : cell.includes('Under Budget') || cell === 'Low' 
                                                        ? 'rgba(16, 185, 129, 0.08)' 
                                                        : (isDark ? '#18181c' : '#ffffff'),
                                            color: cell.startsWith('-') || cell.includes('Over Budget') || cell === 'High' 
                                                ? '#f87171' 
                                                : cell.includes('Under Budget') || cell === 'Low' 
                                                    ? '#34d399' 
                                                    : (isDark ? '#e3e3e6' : '#111')
                                        }}
                                    >
                                        {cell}
                                    </td>
                                ))}
                                {Array.from({ length: Math.max(0, columns.length - row.length) }).map((_, i) => (
                                    <td key={row.length + i} style={{ border: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : '#e8e6d9'}`, backgroundColor: isDark ? '#18181c' : '#ffffff' }} />
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
function PPTViewer({ filename, filePath, theme = 'light' }: { filename: string; filePath?: string; theme?: 'light' | 'dark' }) {
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
            <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8a8886', fontSize: 13, backgroundColor: isDark ? '#18181c' : '#1a1a17', width: '100%', minHeight: 400 }}>
                <div style={{ textAlign: 'center' }}>
                    <div style={{ marginBottom: 12, fontSize: 16, fontWeight: 500, color: isDark ? '#e3e3e6' : '#aaa' }}>Parsing Presentation Slides...</div>
                    <div style={{ fontSize: 12, color: '#777' }}>Extracting text and shapes from the PPTX structure</div>
                </div>
            </div>
        );
    }

    if (error || slides.length === 0) {
        return (
            <div style={{ display: 'flex', flex: 1, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#ef4444', fontSize: 14, backgroundColor: isDark ? '#18181c' : '#1a1a17', padding: 24, textAlign: 'center', width: '100%', minHeight: 400 }}>
                <span style={{ fontSize: 32, marginBottom: 16 }}>⚠️</span>
                <div style={{ fontWeight: 600, marginBottom: 8, color: '#f87171' }}>Failed to View PowerPoint</div>
                <div style={{ fontSize: 12, color: '#a1a1aa', maxWidth: 400, margin: '0 auto' }}>{error || "No slide content found."}</div>
            </div>
        );
    }

    const currentSlide = slides[activeSlide] || { title: "", subtitle: "", points: [] };

    return (
        <div style={{ display: 'flex', height: '100%', backgroundColor: isDark ? '#18181c' : '#1a1a17', width: '100%', minWidth: 0, minHeight: 0 }}>
            {/* Sidebar with slide previews */}
            <div style={{ width: 180, borderRight: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : '#2d2d27'}`, display: 'flex', flexDirection: 'column', gap: 12, padding: 12, overflowY: 'auto', flexShrink: 0 }}>
                {slides.map((slide, index) => (
                    <div 
                        key={index}
                        onClick={() => setActiveSlide(index)}
                        style={{
                            border: `2px solid ${activeSlide === index ? '#0891b2' : isDark ? '#2d2d35' : '#333'}`,
                            borderRadius: 6,
                            padding: 8,
                            backgroundColor: isDark ? '#1c1c21' : '#23231f',
                            cursor: 'pointer',
                            aspectRatio: '16/9',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                            transition: 'all 0.15s',
                            flexShrink: 0
                        }}
                    >
                        <span style={{ fontSize: 9, color: activeSlide === index ? '#0891b2' : '#888', fontWeight: 600 }}>Slide {index + 1}</span>
                        <div style={{ fontSize: 8, color: '#ccc', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                    backgroundColor: '#ffffff',
                    boxShadow: '0 16px 40px rgba(0,0,0,0.3)',
                    borderRadius: 8,
                    padding: '28px 40px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    fontFamily: 'Inter, sans-serif',
                    boxSizing: 'border-box'
                }}>
                    <div>
                        <div style={{ fontSize: 20, fontWeight: 700, color: '#111', borderBottom: '2px solid #0891b2', paddingBottom: 6, wordBreak: 'break-word' }}>
                            {currentSlide.title || "Untitled Slide"}
                        </div>
                        {currentSlide.subtitle && (
                            <div style={{ fontSize: 12, color: '#666', marginTop: 4, fontStyle: 'italic', wordBreak: 'break-word' }}>
                                {currentSlide.subtitle}
                            </div>
                        )}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: '14px 0', flex: 1, justifyContent: 'center', overflowY: 'auto' }}>
                        {currentSlide.points.map((pt, i) => (
                            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                                <div style={{ width: 5, height: 5, borderRadius: '50%', backgroundColor: '#0891b2', marginTop: 6, flexShrink: 0 }} />
                                <div style={{ fontSize: 13, color: '#222', lineHeight: 1.4, wordBreak: 'break-word' }}>{pt}</div>
                            </div>
                        ))}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 9, color: '#888', borderTop: '1px solid #eee', paddingTop: 6 }}>
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
                            border: '1px solid #444',
                            backgroundColor: '#2d2d27',
                            color: activeSlide === 0 ? '#555' : '#fff',
                            cursor: activeSlide === 0 ? 'not-allowed' : 'pointer',
                            fontSize: 12,
                            fontWeight: 600
                        }}
                    >
                        Prev
                    </button>
                    <span style={{ fontSize: 12, color: '#aaa', fontWeight: 500 }}>
                        {activeSlide + 1} / {slides.length}
                    </span>
                    <button 
                        onClick={() => setActiveSlide(prev => Math.min(slides.length - 1, prev + 1))}
                        disabled={activeSlide === slides.length - 1}
                        style={{
                            padding: '4px 14px',
                            borderRadius: 6,
                            border: '1px solid #444',
                            backgroundColor: '#2d2d27',
                            color: activeSlide === slides.length - 1 ? '#555' : '#fff',
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

// ── 4. CODE & TEXT VIEWER ───────────────────────────────────────────
function CodeTextViewer({ filename, content, extension }: { filename: string; content: string | null; extension: string }) {
    const isHtml = extension === 'html' || extension === 'htm';
    const [viewMode, setViewMode] = useState<'code' | 'preview'>(isHtml ? 'preview' : 'code');
    const [copySuccess, setCopySuccess] = useState(false);

    const handleCopy = () => {
        if (!content) return;
        navigator.clipboard.writeText(content);
        setViewMode('code');
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
    };

    if (content === null) {
        return (
            <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8a8886', fontSize: 13 }}>
                Loading file content...
            </div>
        );
    }

    const lines = content.split('\n');

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: '#18181c' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)', backgroundColor: '#18181c' }}>
                <div style={{ display: 'flex', gap: 8, padding: 4, backgroundColor: '#121214', borderRadius: 16, border: '1px solid rgba(255,255,255,0.08)' }}>
                    {isHtml && (
                        <>
                            <button
                                onClick={() => setViewMode('preview')}
                                style={{
                                    padding: '6px 14px',
                                    borderRadius: 14,
                                    fontSize: 12,
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    border: 'none',
                                    backgroundColor: viewMode === 'preview' ? 'rgba(255,255,255,0.1)' : 'transparent',
                                    color: viewMode === 'preview' ? '#ffffff' : '#888',
                                    transition: 'all 0.15s'
                                }}
                            >
                                Live Preview
                            </button>
                            <button
                                onClick={() => setViewMode('code')}
                                style={{
                                    padding: '6px 14px',
                                    borderRadius: 14,
                                    fontSize: 12,
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    border: 'none',
                                    backgroundColor: viewMode === 'code' ? 'rgba(255,255,255,0.1)' : 'transparent',
                                    color: viewMode === 'code' ? '#ffffff' : '#888',
                                    transition: 'all 0.15s'
                                }}
                            >
                                Source Code
                            </button>
                        </>
                    )}
                </div>

                <button
                    onClick={handleCopy}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '4px 12px',
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                        border: '1px solid rgba(255,255,255,0.1)',
                        backgroundColor: '#18181c',
                        color: '#ccc',
                        transition: 'all 0.15s'
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.color = '#fff'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = '#ccc'; }}
                >
                    <ClipboardIcon width={14} height={14} />
                    {copySuccess ? 'Copied!' : 'Copy Code'}
                </button>
            </div>

            <div style={{ flex: 1, overflow: 'auto' }}>
                {viewMode === 'preview' && isHtml ? (
                    <iframe
                        title="HTML Preview"
                        srcDoc={content}
                        sandbox="allow-scripts"
                        style={{ width: '100%', height: '100%', border: 'none', backgroundColor: '#ffffff' }}
                    />
                ) : (
                    <div style={{ display: 'flex', fontFamily: 'monospace', fontSize: 13, lineHeight: '20px', color: '#e3e3e6', padding: 16 }}>
                        <div style={{ textAlign: 'right', paddingRight: 16, color: '#555', userSelect: 'none', borderRight: '1px solid rgba(255,255,255,0.05)', marginRight: 16 }}>
                            {lines.map((_, i) => (
                                <div key={i}>{i + 1}</div>
                            ))}
                        </div>
                        <pre style={{ margin: 0, overflowX: 'auto', flex: 1, whiteSpace: 'pre-wrap' }}>
                            <code>{content}</code>
                        </pre>
                    </div>
                )}
            </div>
        </div>
    );
}

// ── 5. FALLBACK / IMAGE VIEWER ─────────────────────────────────────
function FallbackViewer({ file, theme = 'light' }: { file: { name: string; path: string }; theme?: 'light' | 'dark' }) {
    const isDark = theme === 'dark';
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const isImage = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext);

    if (isImage) {
        const src = 'file:///' + file.path.replace(/\\/g, '/');
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', backgroundColor: isDark ? '#131316' : '#f0efe9', padding: 24 }}>
                <img 
                    src={src} 
                    alt={file.name} 
                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }} 
                />
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', backgroundColor: isDark ? '#18181c' : '#fcfbfa', padding: 32, gap: 16, textAlign: 'center' }}>
            <FileIcon size="lg" fileName={file.name} />
            <div>
                <h3 style={{ fontSize: 16, fontWeight: 600, color: isDark ? '#ffffff' : '#111', margin: '0 0 4px 0' }}>{file.name}</h3>
                <p style={{ fontSize: 13, color: '#888', margin: 0 }}>This file type is not natively previewed, but you can open it externally.</p>
            </div>
            <button
                onClick={() => {
                    (window as any).electronAPI?.system.openExternal('file:///' + file.path.replace(/\\/g, '/'));
                }}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 16px',
                    borderRadius: 6,
                    border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : '#e8e6d9'}`,
                    backgroundColor: isDark ? '#232329' : '#ffffff',
                    color: '#3b82f6',
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
    const [content, setContent] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [copyPathSuccess, setCopyPathSuccess] = useState(false);
    const [showSidebar, setShowSidebar] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [lastModifiedText, setLastModifiedText] = useState('Just now');

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

                // 2. If null, try reading from absolute path using projects.readFile
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
                    const list = await (window as any).electronAPI?.artifacts.list(chatId);
                    const art = list?.find((a: any) => a.name === file.name);
                    if (art && art.lastEdited) {
                        const diffMins = Math.round((Date.now() - art.lastEdited) / 60000);
                        if (diffMins < 1) setLastModifiedText('Just now');
                        else if (diffMins === 1) setLastModifiedText('Last modified: 1 minute ago');
                        else if (diffMins < 60) setLastModifiedText(`Last modified: ${diffMins} minutes ago`);
                        else setLastModifiedText(`Last modified: ${new Date(art.lastEdited).toLocaleTimeString()}`);
                    } else {
                        setLastModifiedText('Last modified: 2 minutes ago');
                    }
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
    
    const getViewerType = () => {
        if (extension === 'md') return 'markdown';
        if (['xlsx', 'xls', 'csv'].includes(extension)) return 'excel';
        if (['pptx', 'ppt'].includes(extension)) return 'ppt';
        if (['py', 'java', 'html', 'css', 'js', 'ts', 'tsx', 'jsx', 'json', 'txt', 'sh', 'bash', 'yaml', 'yml'].includes(extension)) {
            return 'code';
        }
        return 'fallback';
    };

    const viewerType = getViewerType();

    const getFileCategoryLabel = () => {
        switch (viewerType) {
            case 'markdown': return 'Markdown Document';
            case 'excel': return 'Spreadsheet Ledger';
            case 'ppt': return 'PowerPoint Presentation';
            case 'code': return 'Source Code / Text';
            default: return 'Asset File';
        }
    };

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

    const handleOpenFolder = () => {
        const parentPath = file.path.substring(0, file.path.lastIndexOf('\\'));
        (window as any).electronAPI?.system.openExternal('file:///' + parentPath.replace(/\\/g, '/'));
    };

    // Determine floating pill text & action based on content and file type
    const getFloatingPillDetails = () => {
        const lowerName = file.name.toLowerCase();
        if (viewerType === 'excel') {
            return {
                text: "📊 Turn this spreadsheet into a dashboard?",
                btnText: "Generate Dashboard",
                query: `Generate a dashboard for the spreadsheet ${file.name}`
            };
        }
        if (lowerName.includes('comment') || lowerName.includes('suggest') || content?.toLowerCase().includes('comment')) {
            return {
                text: "💬 Great comment ideas here! Turn this into a shareable discussion hub?",
                btnText: "Create website",
                query: `Create a website for the document ${file.name}`
            };
        }
        return {
            text: "✨ Turn this document into a shareable web page?",
            btnText: "Create website",
            query: `Create a website for the document ${file.name}`
        };
    };

    const pillDetails = getFloatingPillDetails();

    const handlePillAction = () => {
        window.dispatchEvent(new CustomEvent('send-chat-message', { detail: pillDetails.query }));
        onClose();
    };

    const handleShareAction = () => {
        window.dispatchEvent(new CustomEvent('send-chat-message', { detail: `Can you help me share this file: ${file.name}?` }));
        onClose();
    };

    return (
        <AnimatePresence>
            <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: isFullscreen ? 0 : 24 }}>
                {/* Progressive Blur Overlay */}
                <style dangerouslySetInnerHTML={{ __html: `
                    .progressive-blur-layer-1 {
                        position: absolute;
                        inset: 0;
                        backdrop-filter: blur(4px);
                        -webkit-backdrop-filter: blur(4px);
                        mask-image: radial-gradient(circle, black 35%, transparent 75%);
                        -webkit-mask-image: radial-gradient(circle, black 35%, transparent 75%);
                    }
                    .progressive-blur-layer-2 {
                        position: absolute;
                        inset: 0;
                        backdrop-filter: blur(8px);
                        -webkit-backdrop-filter: blur(8px);
                        mask-image: radial-gradient(circle, transparent 35%, black 60%, transparent 90%);
                        -webkit-mask-image: radial-gradient(circle, transparent 35%, black 60%, transparent 90%);
                    }
                    .progressive-blur-layer-3 {
                        position: absolute;
                        inset: 0;
                        backdrop-filter: blur(16px);
                        -webkit-backdrop-filter: blur(16px);
                        mask-image: radial-gradient(circle, transparent 60%, black 100%);
                        -webkit-mask-image: radial-gradient(circle, transparent 60%, black 100%);
                    }
                `}} />

                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="progressive-blur-layer-1" onClick={onClose} />
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="progressive-blur-layer-2" onClick={onClose} />
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="progressive-blur-layer-3" onClick={onClose} />

                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    style={{
                        position: 'absolute',
                        inset: 0,
                        backgroundColor: 'rgba(10, 10, 12, 0.65)',
                        pointerEvents: 'none'
                    }}
                />

                {/* Modal Container */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.96, y: 12 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.96, y: 12 }}
                    transition={{ type: 'spring', damping: 26, stiffness: 210 }}
                    style={{
                        position: 'relative',
                        width: isFullscreen ? '100vw' : '90%',
                        maxWidth: isFullscreen ? '100vw' : 1200,
                        height: isFullscreen ? '100vh' : '85vh',
                        backgroundColor: '#121214',
                        boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
                        border: isFullscreen ? 'none' : "1px solid rgba(255,255,255,0.08)",
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
                        padding: '16px 24px',
                        borderBottom: '1px solid rgba(255,255,255,0.05)',
                        backgroundColor: '#141416'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            {/* Blue/Green Docs Icon */}
                            <div style={{
                                width: 36,
                                height: 36,
                                borderRadius: 8,
                                backgroundColor: ['xlsx', 'xls', 'csv'].includes(extension) ? 'rgba(16, 185, 129, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                                border: `1px solid ${['xlsx', 'xls', 'csv'].includes(extension) ? 'rgba(16, 185, 129, 0.3)' : 'rgba(59, 130, 246, 0.3)'}`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0
                            }}>
                                {['xlsx', 'xls', 'csv'].includes(extension) ? (
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5">
                                        <rect x="3" y="3" width="18" height="18" rx="2" />
                                        <line x1="3" y1="9" x2="21" y2="9" />
                                        <line x1="3" y1="15" x2="21" y2="15" />
                                        <line x1="10" y1="3" x2="10" y2="21" />
                                    </svg>
                                ) : (
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2.5">
                                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                        <polyline points="14 2 14 8 20 8" />
                                        <line x1="16" y1="13" x2="8" y2="13" />
                                        <line x1="16" y1="17" x2="8" y2="17" />
                                        <line x1="10" y1="9" x2="8" y2="9" />
                                    </svg>
                                )}
                            </div>
                            
                            <div>
                                <h2 style={{ fontSize: 14, fontWeight: 600, color: '#ffffff', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                                    {file.name}
                                </h2>
                                <p style={{ fontSize: 11, color: '#88888d', margin: 0, fontWeight: 500, marginTop: 1 }}>
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
                                    color: 'rgba(255,255,255,0.6)',
                                    cursor: 'pointer',
                                    padding: '6px 8px',
                                    borderRadius: 6,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    transition: 'all 0.15s'
                                }}
                                onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = '#fff'; }}
                                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; }}
                            >
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                                    <polyline points="16 6 12 2 8 6" />
                                    <line x1="12" y1="2" x2="12" y2="15" />
                                </svg>
                            </button>

                            {/* Download */}
                            <button
                                onClick={handleDownload}
                                title="Download document"
                                style={{
                                    border: 'none',
                                    background: 'transparent',
                                    color: 'rgba(255,255,255,0.6)',
                                    cursor: 'pointer',
                                    padding: '6px 8px',
                                    borderRadius: 6,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    transition: 'all 0.15s'
                                }}
                                onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = '#fff'; }}
                                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; }}
                            >
                                <ArrowDownTrayIcon width={20} height={20} />
                            </button>

                            {/* More Options */}
                            <button
                                title="More options"
                                style={{
                                    border: 'none',
                                    background: 'transparent',
                                    color: 'rgba(255,255,255,0.6)',
                                    cursor: 'pointer',
                                    padding: '6px 8px',
                                    borderRadius: 6,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    transition: 'all 0.15s'
                                }}
                                onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = '#fff'; }}
                                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; }}
                            >
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <circle cx="12" cy="12" r="1" />
                                    <circle cx="12" cy="5" r="1" />
                                    <circle cx="12" cy="19" r="1" />
                                </svg>
                            </button>

                            {/* Columns / Sidebar Layout toggle */}
                            <button
                                onClick={() => setShowSidebar(!showSidebar)}
                                title="Toggle File Details Sidebar"
                                style={{
                                    border: 'none',
                                    background: showSidebar ? 'rgba(255,255,255,0.1)' : 'transparent',
                                    color: showSidebar ? '#3b82f6' : 'rgba(255,255,255,0.6)',
                                    cursor: 'pointer',
                                    padding: '6px 8px',
                                    borderRadius: 6,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    transition: 'all 0.15s'
                                }}
                                onMouseEnter={e => { if(!showSidebar) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)'; }}
                                onMouseLeave={e => { if(!showSidebar) e.currentTarget.style.backgroundColor = 'transparent'; }}
                            >
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <rect x="3" y="3" width="18" height="18" rx="2" />
                                    <line x1="9" y1="3" x2="9" y2="21" />
                                </svg>
                            </button>

                            {/* Fullscreen */}
                            <button
                                onClick={() => setIsFullscreen(!isFullscreen)}
                                title="Toggle Fullscreen"
                                style={{
                                    border: 'none',
                                    background: 'transparent',
                                    color: 'rgba(255,255,255,0.6)',
                                    cursor: 'pointer',
                                    padding: '6px 8px',
                                    borderRadius: 6,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    transition: 'all 0.15s'
                                }}
                                onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = '#fff'; }}
                                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; }}
                            >
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    {isFullscreen ? (
                                        <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7" />
                                    ) : (
                                        <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3M10 21v-6H4M14 3v6h6" />
                                    )}
                                </svg>
                            </button>

                            <div style={{ height: 16, borderLeft: '1px solid rgba(255,255,255,0.1)', margin: '0 8px' }} />

                            {/* Close */}
                            <button
                                onClick={onClose}
                                style={{
                                    border: 'none',
                                    background: 'transparent',
                                    color: 'rgba(255,255,255,0.5)',
                                    cursor: 'pointer',
                                    padding: '6px 8px',
                                    borderRadius: 6,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    transition: 'all 0.15s'
                                }}
                                onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#ef4444'; e.currentTarget.style.color = '#ffffff'; }}
                                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.5)'; }}
                            >
                                <XMarkIcon width={20} height={20} />
                            </button>
                        </div>
                    </div>

                    {/* Content Split Pane */}
                    <div style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative' }}>
                        {/* Left: Centered Content Area */}
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative' }}>
                            {loading ? (
                                <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', fontSize: 13, color: 'rgba(255,255,255,0.4)', backgroundColor: '#18181c' }}>
                                    Loading file content...
                                </div>
                            ) : (
                                <>
                                    {viewerType === 'markdown' && <MarkdownViewer content={content || ''} theme="dark" />}
                                    {viewerType === 'excel' && <ExcelViewer filename={file.name} content={content} theme="dark" />}
                                    {viewerType === 'ppt' && <PPTViewer filename={file.name} filePath={file.path} theme="dark" />}
                                    {viewerType === 'code' && <CodeTextViewer filename={file.name} content={content} extension={extension} />}
                                    {viewerType === 'fallback' && <FallbackViewer file={file} theme="dark" />}
                                </>
                            )}

                            {/* Floating bottom pill overlay */}
                            {!loading && (
                                <motion.div
                                    initial={{ y: 24, x: '-50%', opacity: 0 }}
                                    animate={{ y: 0, x: '-50%', opacity: 1 }}
                                    transition={{ delay: 0.3, type: 'spring', damping: 18 }}
                                    style={{
                                        position: 'absolute',
                                        bottom: 24,
                                        left: '50%',
                                        zIndex: 50,
                                        backgroundColor: '#1b1b1f',
                                        border: '1px solid rgba(255,255,255,0.08)',
                                        borderRadius: 24,
                                        padding: '6px 6px 6px 18px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 16,
                                        boxShadow: '0 10px 32px rgba(0,0,0,0.45)',
                                        maxWidth: '90%',
                                        whiteSpace: 'nowrap'
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <span style={{ fontSize: 14 }}>{viewerType === 'excel' ? '📊' : '💬'}</span>
                                        <span style={{ fontSize: 12.5, color: '#e3e3e6', fontWeight: 500 }}>
                                            {pillDetails.text}
                                        </span>
                                    </div>
                                    <button
                                        onClick={handlePillAction}
                                        style={{
                                            backgroundColor: '#ffffff',
                                            color: '#111111',
                                            border: 'none',
                                            borderRadius: 18,
                                            padding: '8px 16px',
                                            fontSize: 12,
                                            fontWeight: 600,
                                            cursor: 'pointer',
                                            transition: 'all 0.15s'
                                        }}
                                        onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#f1f1f3'; }}
                                        onMouseLeave={e => { e.currentTarget.style.backgroundColor = '#ffffff'; }}
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
                                        backgroundColor: '#141416',
                                        borderLeft: '1px solid rgba(255,255,255,0.05)',
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
                                        <h4 style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 10px 0' }}>File Info</h4>
                                        <div style={{
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: 12,
                                            backgroundColor: '#1b1b1f',
                                            padding: 14,
                                            borderRadius: 10,
                                            border: '1px solid rgba(255,255,255,0.05)'
                                        }}>
                                            <div>
                                                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Filename</div>
                                                <div style={{ fontSize: 12, fontWeight: 600, color: '#ffffff', wordBreak: 'break-all', marginTop: 2 }}>{file.name}</div>
                                            </div>
                                            <div>
                                                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Extension</div>
                                                <div style={{ fontSize: 12, fontWeight: 600, color: '#ffffff', textTransform: 'uppercase', marginTop: 2 }}>{extension || 'Unknown'}</div>
                                            </div>
                                            <div>
                                                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Size</div>
                                                <div style={{ fontSize: 12, fontWeight: 600, color: '#ffffff', marginTop: 2 }}>
                                                    {content ? `${(content.length / 1024).toFixed(2)} KB` : 'Loading...'}
                                                </div>
                                            </div>
                                            <div>
                                                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Status</div>
                                                <div style={{ fontSize: 12, fontWeight: 600, color: '#34d399', display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                                                    <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#10b981' }} />
                                                    Saved to Artifacts
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.05)', margin: 0 }} />

                                    {/* File Location path */}
                                    <div style={{ minWidth: 240 }}>
                                        <h4 style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 10px 0' }}>Storage Path</h4>
                                        <div style={{ 
                                            fontSize: 11, 
                                            fontFamily: 'monospace', 
                                            color: '#b0b0b5', 
                                            backgroundColor: '#1b1b1f', 
                                            padding: '10px 12px', 
                                            borderRadius: 8, 
                                            border: '1px solid rgba(255,255,255,0.05)', 
                                            wordBreak: 'break-all',
                                            maxHeight: 120,
                                            overflowY: 'auto'
                                        }}>
                                            {file.path}
                                        </div>
                                    </div>

                                    {/* Actions List */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 'auto', minWidth: 240 }}>
                                        <button
                                            onClick={handleDownload}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 8,
                                                width: '100%',
                                                padding: '10px 14px',
                                                borderRadius: 8,
                                                border: '1px solid rgba(255,255,255,0.08)',
                                                backgroundColor: '#1b1b1f',
                                                color: '#ffffff',
                                                fontSize: 12,
                                                fontWeight: 600,
                                                cursor: 'pointer',
                                                transition: 'all 0.15s'
                                            }}
                                            onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#232329'; }}
                                            onMouseLeave={e => { e.currentTarget.style.backgroundColor = '#1b1b1f'; }}
                                        >
                                            <ArrowDownTrayIcon width={16} height={16} />
                                            Download File
                                        </button>
                                        <button
                                            onClick={handleCopyPath}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 8,
                                                width: '100%',
                                                padding: '10px 14px',
                                                borderRadius: 8,
                                                border: '1px solid rgba(255,255,255,0.08)',
                                                backgroundColor: '#1b1b1f',
                                                color: '#ffffff',
                                                fontSize: 12,
                                                fontWeight: 600,
                                                cursor: 'pointer',
                                                transition: 'all 0.15s'
                                            }}
                                            onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#232329'; }}
                                            onMouseLeave={e => { e.currentTarget.style.backgroundColor = '#1b1b1f'; }}
                                        >
                                            <DocumentDuplicateIcon width={16} height={16} />
                                            {copyPathSuccess ? 'Copied path!' : 'Copy absolute path'}
                                        </button>

                                        <button
                                            onClick={handleOpenFolder}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 8,
                                                width: '100%',
                                                padding: '10px 14px',
                                                borderRadius: 8,
                                                border: '1px solid rgba(255,255,255,0.08)',
                                                backgroundColor: '#1b1b1f',
                                                color: '#ffffff',
                                                fontSize: 12,
                                                fontWeight: 600,
                                                cursor: 'pointer',
                                                transition: 'all 0.15s'
                                            }}
                                            onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#232329'; }}
                                            onMouseLeave={e => { e.currentTarget.style.backgroundColor = '#1b1b1f'; }}
                                        >
                                            <ArrowTopRightOnSquareIcon width={16} height={16} />
                                            Show in folder
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
