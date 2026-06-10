import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { XMarkIcon, ClipboardIcon, ArrowTopRightOnSquareIcon, DocumentDuplicateIcon, ListBulletIcon, DocumentTextIcon, TableCellsIcon, PresentationChartBarIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import FileIcon from '../app/chat/FileIcon';

interface FileViewerModalProps {
    file: { name: string; path: string } | null;
    onClose: () => void;
    chatId: string;
    projectPath?: string;
}

// ── 1. MARKDOWN VIEWER ──────────────────────────────────────────────
export function MarkdownViewer({ content }: { content: string }) {
    const renderMarkdown = (text: string) => {
        const lines = text.split('\n');
        const elements: React.ReactNode[] = [];
        let inCodeBlock = false;
        let codeBlockContent: string[] = [];
        let codeBlockLang = '';

        const formatInline = (text: string) => {
            const codeBlocks: string[] = [];
            let f = text.replace(/`(.*?)`/g, (_, content) => {
                codeBlocks.push(`<code style="background-color: #f1f0ea; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 13px; color: #0891b2;">${content}</code>`);
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
                elements.push(<h1 key={`h1-${i}`} style={{ fontSize: 24, fontWeight: 700, margin: '20px 0 10px 0', borderBottom: '1px solid #e8e6d9', paddingBottom: 6, color: '#111' }}>{line.substring(2)}</h1>);
                continue;
            }
            if (line.startsWith('## ')) {
                elements.push(<h2 key={`h2-${i}`} style={{ fontSize: 20, fontWeight: 600, margin: '18px 0 8px 0', borderBottom: '1px solid #e8e6d9', paddingBottom: 4, color: '#222' }}>{line.substring(3)}</h2>);
                continue;
            }
            if (line.startsWith('### ')) {
                elements.push(<h3 key={`h3-${i}`} style={{ fontSize: 16, fontWeight: 600, margin: '16px 0 6px 0', color: '#333' }}>{line.substring(4)}</h3>);
                continue;
            }
            if (line.startsWith('#### ')) {
                elements.push(<h4 key={`h4-${i}`} style={{ fontSize: 14, fontWeight: 700, margin: '14px 0 4px 0', color: '#444', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{line.substring(5)}</h4>);
                continue;
            }

            // Table support: detect pipe table (line with | followed by separator line with ---)
            if (line.includes('|') && i + 1 < lines.length && lines[i + 1].includes('---')) {
                const headers = line.split('|').map(h => h.trim()).filter(Boolean);
                i += 2; // skip header and separator rows
                const rows: string[][] = [];
                while (i < lines.length && lines[i].includes('|')) {
                    const cells = lines[i].split('|').map(c => c.trim()).filter(Boolean);
                    if (cells.length > 0) rows.push(cells);
                    i++;
                }
                i--; // for loop will increment
                elements.push(
                    <div key={`table-${i}`} style={{ overflowX: 'auto', margin: '12px 0' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                                <tr>
                                    {headers.map((h, j) => (
                                        <th key={j} style={{ padding: '8px 12px', borderBottom: '1px solid rgba(0, 0, 0, 0.12)', textAlign: 'left', color: '#717171', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }} dangerouslySetInnerHTML={{ __html: formatInline(h) }} />
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row, ri) => (
                                    <tr key={ri} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                                        {row.map((cell, ci) => (
                                            <td key={ci} style={{ padding: '8px 12px', color: '#4a4846' }} dangerouslySetInnerHTML={{ __html: formatInline(cell) }} />
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
                    <li key={`li-${i}`} style={{ marginLeft: 20, margin: '4px 0', fontSize: 14, color: '#333' }}
                        dangerouslySetInnerHTML={{ __html: formatInline(content) }}
                    />
                );
                continue;
            }

            if (line.trim() === '---') {
                elements.push(<hr key={`hr-${i}`} style={{ border: 'none', borderTop: '1px solid #e8e6d9', margin: '20px 0' }} />);
                continue;
            }

            if (line.trim() === '') {
                elements.push(<div key={`spacer-${i}`} style={{ height: 10 }} />);
                continue;
            }

            elements.push(
                <p key={`p-${i}`} style={{ fontSize: 14, lineHeight: 1.6, margin: '8px 0', color: '#333' }}
                    dangerouslySetInnerHTML={{ __html: formatInline(line) }}
                />
            );
        }

        return elements;
    };

    return (
        <div style={{ padding: 28, overflowY: 'auto', height: '100%', fontFamily: 'Inter, sans-serif', backgroundColor: '#ffffff', borderTopLeftRadius: 8 }}>
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

    const columns = Array.from({ length: Math.max(parsedData[0]?.length || 10, 10) }, (_, i) => String.fromCharCode(65 + i));

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: '#f9f8f4', minWidth: 0, minHeight: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderBottom: '1px solid #e8e6d9', backgroundColor: '#ffffff' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#0891b2', fontStyle: 'italic', paddingRight: 8 }}>fx</span>
                <div style={{ borderLeft: '1px solid #e8e6d9', height: 16 }} />
                <input 
                    type="text" 
                    readOnly
                    value={parsedData[1] ? `=SUM(${columns[3]}2:${columns[3]}${parsedData.length})` : ''} 
                    style={{ flex: 1, border: 'none', outline: 'none', fontSize: 12, color: '#333', background: 'transparent', fontWeight: 500 }} 
                />
            </div>

            <div className="excel-scrollable" style={{ flex: 1, overflow: 'auto', position: 'relative', maxWidth: '100%', maxHeight: '100%', minHeight: 0, minWidth: 0 }}>
                <style dangerouslySetInnerHTML={{ __html: `
                    .excel-scrollable::-webkit-scrollbar {
                        width: 10px;
                        height: 10px;
                    }
                    .excel-scrollable::-webkit-scrollbar-track {
                        background: #f0efe9;
                        border-left: 1px solid #e8e6d9;
                        border-top: 1px solid #e8e6d9;
                    }
                    .excel-scrollable::-webkit-scrollbar-thumb {
                        background: #d3d3d0;
                        border-radius: 5px;
                        border: 2.5px solid #f0efe9;
                    }
                    .excel-scrollable::-webkit-scrollbar-thumb:hover {
                        background: #b0b0ad;
                    }
                `}} />
                <table style={{ borderCollapse: 'collapse', width: 'max-content', minWidth: '100%', fontSize: 12, backgroundColor: '#ffffff' }}>
                    <thead>
                        <tr>
                            <th style={{ backgroundColor: '#f0efe9', border: '1px solid #e8e6d9', width: 45, height: 28, position: 'sticky', top: 0, left: 0, zIndex: 10 }}></th>
                            {columns.map((col, i) => (
                                <th key={i} style={{ backgroundColor: '#f0efe9', border: '1px solid #e8e6d9', fontWeight: 600, color: '#4a4a40', position: 'sticky', top: 0, zIndex: 9, minWidth: 120, height: 28, textAlign: 'center' }}>
                                    {col}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {parsedData.map((row, rowIndex) => (
                            <tr key={rowIndex}>
                                <td style={{ backgroundColor: '#f0efe9', border: '1px solid #e8e6d9', fontWeight: 600, color: '#4a4a40', textAlign: 'center', width: 45, height: 26, position: 'sticky', left: 0, zIndex: 8 }}>
                                    {rowIndex + 1}
                                </td>
                                {row.map((cell, cellIndex) => (
                                    <td 
                                        key={cellIndex} 
                                        style={{ 
                                            border: '1px solid #e8e6d9', 
                                            padding: '6px 12px', 
                                            whiteSpace: 'nowrap',
                                            fontWeight: rowIndex === 0 ? 600 : 'normal',
                                            backgroundColor: rowIndex === 0 ? '#fbfbfa' : cell.startsWith('-') || cell.includes('Over Budget') || cell === 'High' ? 'rgba(239, 68, 68, 0.05)' : cell.includes('Under Budget') || cell === 'Low' ? 'rgba(16, 185, 129, 0.05)' : '#ffffff',
                                            color: cell.startsWith('-') || cell.includes('Over Budget') || cell === 'High' ? '#dc2626' : cell.includes('Under Budget') || cell === 'Low' ? '#059669' : '#111'
                                        }}
                                    >
                                        {cell}
                                    </td>
                                ))}
                                {Array.from({ length: Math.max(0, columns.length - row.length) }).map((_, i) => (
                                    <td key={row.length + i} style={{ border: '1px solid #e8e6d9', backgroundColor: '#ffffff' }} />
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
            <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8a8886', fontSize: 13, backgroundColor: '#1a1a17', width: '100%', minHeight: 400 }}>
                <div style={{ textAlign: 'center' }}>
                    <div style={{ marginBottom: 12, fontSize: 16, fontWeight: 500, color: '#aaa' }}>Parsing Presentation Slides...</div>
                    <div style={{ fontSize: 12, color: '#777' }}>Extracting text and shapes from the PPTX structure</div>
                </div>
            </div>
        );
    }

    if (error || slides.length === 0) {
        return (
            <div style={{ display: 'flex', flex: 1, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#ef4444', fontSize: 14, backgroundColor: '#1a1a17', padding: 24, textAlign: 'center', width: '100%', minHeight: 400 }}>
                <span style={{ fontSize: 32, marginBottom: 16 }}>⚠️</span>
                <div style={{ fontWeight: 600, marginBottom: 8, color: '#f87171' }}>Failed to View PowerPoint</div>
                <div style={{ fontSize: 12, color: '#a1a1aa', maxWidth: 400, margin: '0 auto' }}>{error || "No slide content found."}</div>
            </div>
        );
    }

    const currentSlide = slides[activeSlide] || { title: "", subtitle: "", points: [] };

    return (
        <div style={{ display: 'flex', height: '100%', backgroundColor: '#1a1a17', width: '100%', minWidth: 0, minHeight: 0 }}>
            {/* Sidebar with slide previews */}
            <div style={{ width: 180, borderRight: '1px solid #2d2d27', display: 'flex', flexDirection: 'column', gap: 12, padding: 12, overflowY: 'auto', flexShrink: 0 }}>
                {slides.map((slide, index) => (
                    <div 
                        key={index}
                        onClick={() => setActiveSlide(index)}
                        style={{
                            border: `2px solid ${activeSlide === index ? '#0891b2' : '#333'}`,
                            borderRadius: 6,
                            padding: 8,
                            backgroundColor: '#23231f',
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
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: '#1e1e1a' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid #2d2d27', backgroundColor: '#1e1e1a' }}>
                <div style={{ display: 'flex', gap: 8, padding: 4, backgroundColor: '#151512', borderRadius: 16, border: '1px solid #333' }}>
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
                                    border: viewMode === 'preview' ? '0.5px solid rgba(0,0,0,0.10)' : '0.5px solid transparent',
                                    backgroundColor: viewMode === 'preview' ? '#ececea' : 'transparent',
                                    color: viewMode === 'preview' ? '#111' : '#888',
                                    boxShadow: viewMode === 'preview' ? [
                                        "inset 0 1px 0 rgba(255,255,255,0.72)",
                                        "inset 0 -1px 0 rgba(0,0,0,0.06)",
                                        "inset 1px 0 rgba(255,255,255,0.50)",
                                        "inset -1px 0 rgba(0,0,0,0.04)",
                                        "0 1px 3px rgba(0,0,0,0.07)",
                                    ].join(", ") : 'none',
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
                                    border: viewMode === 'code' ? '0.5px solid rgba(0,0,0,0.10)' : '0.5px solid transparent',
                                    backgroundColor: viewMode === 'code' ? '#ececea' : 'transparent',
                                    color: viewMode === 'code' ? '#111' : '#888',
                                    boxShadow: viewMode === 'code' ? [
                                        "inset 0 1px 0 rgba(255,255,255,0.72)",
                                        "inset 0 -1px 0 rgba(0,0,0,0.06)",
                                        "inset 1px 0 rgba(255,255,255,0.50)",
                                        "inset -1px 0 rgba(0,0,0,0.04)",
                                        "0 1px 3px rgba(0,0,0,0.07)",
                                    ].join(", ") : 'none',
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
                        borderRadius: 4,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                        border: '1px solid #333',
                        backgroundColor: '#1e1e1a',
                        color: '#ccc',
                        transition: 'all 0.15s'
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = '#0891b2'; e.currentTarget.style.color = '#fff'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = '#333'; e.currentTarget.style.color = '#ccc'; }}
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
                    <div style={{ display: 'flex', fontFamily: 'monospace', fontSize: 13, lineHeight: '20px', color: '#eae9e0', padding: 16 }}>
                        <div style={{ textAlign: 'right', paddingRight: 16, color: '#555', userSelect: 'none', borderRight: '1px solid #2d2d27', marginRight: 16 }}>
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
function FallbackViewer({ file }: { file: { name: string; path: string } }) {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const isImage = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext);

    if (isImage) {
        // Since it's a local file, we can convert path to file:/// URL for Electron
        const src = 'file:///' + file.path.replace(/\\/g, '/');
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', backgroundColor: '#f0efe9', padding: 24 }}>
                <img 
                    src={src} 
                    alt={file.name} 
                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.1)' }} 
                />
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', backgroundColor: '#fcfbfa', padding: 32, gap: 16, textAlign: 'center' }}>
            <FileIcon size="lg" fileName={file.name} />
            <div>
                <h3 style={{ fontSize: 16, fontWeight: 600, color: '#111', margin: '0 0 4px 0' }}>{file.name}</h3>
                <p style={{ fontSize: 13, color: '#666', margin: 0 }}>This file type is not natively previewed, but you can open it externally.</p>
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
                    border: '1px solid #e8e6d9',
                    backgroundColor: '#ffffff',
                    color: '#0891b2',
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

    useEffect(() => {
        if (!file) return;
        setLoading(true);
        setContent(null);

        const readFileContent = async () => {
            try {
                // Try reading from artifacts first
                const res = await (window as any).electronAPI?.artifacts.read(chatId, file.name, projectPath);
                if (res !== null) {
                    setContent(res);
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
    
    // Categorize file viewer
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
        // Construct the file URI from absolute path to trigger a direct download locally
        const fileUrl = 'file:///' + file.path.replace(/\\/g, '/');
        const a = document.createElement('a');
        a.href = fileUrl;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    const handleOpenFolder = () => {
        // Open the parent folder of the file
        const parentPath = file.path.substring(0, file.path.lastIndexOf('\\'));
        (window as any).electronAPI?.system.openExternal('file:///' + parentPath.replace(/\\/g, '/'));
    };

    return (
        <AnimatePresence>
            <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
                {/* Custom Progressive Blur Stylesheet */}
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

                {/* Progressive Blur Layer 1 */}
                <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="progressive-blur-layer-1" 
                    onClick={onClose}
                />
                
                {/* Progressive Blur Layer 2 */}
                <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="progressive-blur-layer-2" 
                    onClick={onClose}
                />

                {/* Progressive Blur Layer 3 */}
                <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="progressive-blur-layer-3" 
                    onClick={onClose}
                />

                {/* Glassmorphic Base Background Overlay */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    style={{
                        position: 'absolute',
                        inset: 0,
                        backgroundColor: 'rgba(23, 23, 20, 0.45)',
                        pointerEvents: 'none'
                    }}
                />

                {/* Modal Container */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 15 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 15 }}
                    transition={{ type: 'spring', damping: 25, stiffness: 220 }}
                    style={{
                        position: 'relative',
                        width: '90%',
                        maxWidth: 1080,
                        height: '85vh',
                        backgroundColor: '#ececea',
                        boxShadow: [
                            "inset 0 1px 0 rgba(255,255,255,0.75)",
                            "inset 0 -1px 0 rgba(0,0,0,0.06)",
                            "inset 1px 0 rgba(255,255,255,0.50)",
                            "inset -1px 0 rgba(0,0,0,0.04)",
                            "0 24px 64px rgba(0,0,0,0.18)",
                        ].join(", "),
                        border: "0.5px solid rgba(0,0,0,0.12)",
                        borderRadius: 16,
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
                        borderBottom: '1px solid rgba(0,0,0,0.08)',
                        backgroundColor: 'rgba(255, 255, 255, 0.15)',
                        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.4)'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <FileIcon size="md" fileName={file.name} />
                            <div>
                                <h2 style={{ fontSize: 15, fontWeight: 700, color: '#111', margin: 0 }}>
                                    {file.name}
                                </h2>
                                <p style={{ fontSize: 11, color: '#8a8886', margin: 0, fontWeight: 500 }}>
                                    {getFileCategoryLabel()}
                                </p>
                            </div>
                        </div>

                        {/* Close button */}
                        <button
                            onClick={onClose}
                            style={{
                                border: 'none',
                                background: 'transparent',
                                color: '#8a8886',
                                cursor: 'pointer',
                                padding: 6,
                                borderRadius: 8,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transition: 'all 0.15s'
                            }}
                            onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#f1f0ea'; e.currentTarget.style.color = '#111'; }}
                            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#8a8886'; }}
                        >
                            <XMarkIcon width={20} height={20} />
                        </button>
                    </div>

                    {/* Content Body split */}
                    <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
                        {/* Left: Viewer Area */}
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, borderRight: '1px solid #e8e6d9' }}>
                            {loading ? (
                                <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#8a8886' }}>
                                    Loading file content...
                                </div>
                            ) : (
                                <>
                                    {viewerType === 'markdown' && <MarkdownViewer content={content || ''} />}
                                    {viewerType === 'excel' && <ExcelViewer filename={file.name} content={content} />}
                                    {viewerType === 'ppt' && <PPTViewer filename={file.name} filePath={file.path} />}
                                    {viewerType === 'code' && <CodeTextViewer filename={file.name} content={content} extension={extension} />}
                                    {viewerType === 'fallback' && <FallbackViewer file={file} />}
                                </>
                            )}
                        </div>

                        {/* Right: Sidebar Panel */}
                        <div style={{ width: 260, backgroundColor: '#ececea', padding: 20, display: 'flex', flexDirection: 'column', gap: 20, flexShrink: 0, overflowY: 'auto', borderLeft: '1px solid rgba(0,0,0,0.08)' }}>
                            {/* File Info */}
                            <div>
                                <h4 style={{ fontSize: 11, fontWeight: 700, color: '#8a8886', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 10px 0' }}>File Info</h4>
                                <div style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 12,
                                    backgroundColor: '#f4f4f2',
                                    padding: 14,
                                    borderRadius: 10,
                                    boxShadow: [
                                        "inset 0 1px 0 rgba(255,255,255,0.7)",
                                        "inset 0 -1px 0 rgba(0,0,0,0.05)",
                                        "inset 1px 0 rgba(255,255,255,0.45)",
                                        "inset -1px 0 rgba(0,0,0,0.03)",
                                        "0 1px 3px rgba(0,0,0,0.04)"
                                    ].join(", "),
                                    border: '0.5px solid rgba(0,0,0,0.08)'
                                }}>
                                    <div>
                                        <div style={{ fontSize: 11, color: '#8a8886' }}>Filename</div>
                                        <div style={{ fontSize: 12, fontWeight: 600, color: '#111', wordBreak: 'break-all' }}>{file.name}</div>
                                    </div>
                                    <div>
                                        <div style={{ fontSize: 11, color: '#8a8886' }}>Extension</div>
                                        <div style={{ fontSize: 12, fontWeight: 600, color: '#111', textTransform: 'uppercase' }}>{extension || 'Unknown'}</div>
                                    </div>
                                    <div>
                                        <div style={{ fontSize: 11, color: '#8a8886' }}>Size</div>
                                        <div style={{ fontSize: 12, fontWeight: 600, color: '#111' }}>
                                            {content ? `${(content.length / 1024).toFixed(2)} KB` : '7.58 KB'}
                                        </div>
                                    </div>
                                    <div>
                                        <div style={{ fontSize: 11, color: '#8a8886' }}>Status</div>
                                        <div style={{ fontSize: 12, fontWeight: 600, color: '#059669', display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#10b981' }} />
                                            Saved to Artifacts
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <hr style={{ border: 'none', borderTop: '1px solid rgba(0,0,0,0.08)', margin: 0 }} />

                            {/* File Location path */}
                            <div>
                                <h4 style={{ fontSize: 11, fontWeight: 700, color: '#8a8886', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 10px 0' }}>Storage Path</h4>
                                <div style={{ 
                                    fontSize: 11, 
                                    fontFamily: 'monospace', 
                                    color: '#555', 
                                    backgroundColor: '#e3e3e0', 
                                    padding: '10px 12px', 
                                    borderRadius: 8, 
                                    border: '0.5px solid rgba(0,0,0,0.12)', 
                                    boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.08)',
                                    wordBreak: 'break-all',
                                    maxHeight: 120,
                                    overflowY: 'auto'
                                }}>
                                    {file.path}
                                </div>
                            </div>

                            {/* Actions List */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 'auto' }}>
                                <button
                                    onClick={handleDownload}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 8,
                                        width: '100%',
                                        padding: '10px 14px',
                                        borderRadius: 8,
                                        border: '0.5px solid rgba(0,0,0,0.12)',
                                        backgroundColor: '#ececea',
                                        color: '#333',
                                        fontSize: 12,
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        boxShadow: [
                                            "inset 0 1px 0 rgba(255,255,255,0.8)",
                                            "inset 0 -1px 0 rgba(0,0,0,0.06)",
                                            "inset 1px 0 rgba(255,255,255,0.5)",
                                            "inset -1px 0 rgba(0,0,0,0.04)",
                                            "0 1px 3px rgba(0,0,0,0.06)",
                                        ].join(", "),
                                        transition: 'all 0.15s'
                                    }}
                                    onMouseEnter={e => {
                                        e.currentTarget.style.backgroundColor = '#f4f4f2';
                                        e.currentTarget.style.boxShadow = [
                                            "inset 0 1px 0 rgba(255,255,255,0.9)",
                                            "inset 0 -1px 0 rgba(0,0,0,0.04)",
                                            "inset 1px 0 rgba(255,255,255,0.6)",
                                            "inset -1px 0 rgba(0,0,0,0.03)",
                                            "0 2px 4px rgba(0,0,0,0.08)",
                                        ].join(", ");
                                    }}
                                    onMouseLeave={e => {
                                        e.currentTarget.style.backgroundColor = '#ececea';
                                        e.currentTarget.style.boxShadow = [
                                            "inset 0 1px 0 rgba(255,255,255,0.8)",
                                            "inset 0 -1px 0 rgba(0,0,0,0.06)",
                                            "inset 1px 0 rgba(255,255,255,0.5)",
                                            "inset -1px 0 rgba(0,0,0,0.04)",
                                            "0 1px 3px rgba(0,0,0,0.06)",
                                        ].join(", ");
                                    }}
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
                                        border: '0.5px solid rgba(0,0,0,0.12)',
                                        backgroundColor: '#ececea',
                                        color: '#333',
                                        fontSize: 12,
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        boxShadow: [
                                            "inset 0 1px 0 rgba(255,255,255,0.8)",
                                            "inset 0 -1px 0 rgba(0,0,0,0.06)",
                                            "inset 1px 0 rgba(255,255,255,0.5)",
                                            "inset -1px 0 rgba(0,0,0,0.04)",
                                            "0 1px 3px rgba(0,0,0,0.06)",
                                        ].join(", "),
                                        transition: 'all 0.15s'
                                    }}
                                    onMouseEnter={e => {
                                        e.currentTarget.style.backgroundColor = '#f4f4f2';
                                        e.currentTarget.style.boxShadow = [
                                            "inset 0 1px 0 rgba(255,255,255,0.9)",
                                            "inset 0 -1px 0 rgba(0,0,0,0.04)",
                                            "inset 1px 0 rgba(255,255,255,0.6)",
                                            "inset -1px 0 rgba(0,0,0,0.03)",
                                            "0 2px 4px rgba(0,0,0,0.08)",
                                        ].join(", ");
                                    }}
                                    onMouseLeave={e => {
                                        e.currentTarget.style.backgroundColor = '#ececea';
                                        e.currentTarget.style.boxShadow = [
                                            "inset 0 1px 0 rgba(255,255,255,0.8)",
                                            "inset 0 -1px 0 rgba(0,0,0,0.06)",
                                            "inset 1px 0 rgba(255,255,255,0.5)",
                                            "inset -1px 0 rgba(0,0,0,0.04)",
                                            "0 1px 3px rgba(0,0,0,0.06)",
                                        ].join(", ");
                                    }}
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
                                        border: '0.5px solid rgba(0,0,0,0.12)',
                                        backgroundColor: '#ececea',
                                        color: '#333',
                                        fontSize: 12,
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        boxShadow: [
                                            "inset 0 1px 0 rgba(255,255,255,0.8)",
                                            "inset 0 -1px 0 rgba(0,0,0,0.06)",
                                            "inset 1px 0 rgba(255,255,255,0.5)",
                                            "inset -1px 0 rgba(0,0,0,0.04)",
                                            "0 1px 3px rgba(0,0,0,0.06)",
                                        ].join(", "),
                                        transition: 'all 0.15s'
                                    }}
                                    onMouseEnter={e => {
                                        e.currentTarget.style.backgroundColor = '#f4f4f2';
                                        e.currentTarget.style.boxShadow = [
                                            "inset 0 1px 0 rgba(255,255,255,0.9)",
                                            "inset 0 -1px 0 rgba(0,0,0,0.04)",
                                            "inset 1px 0 rgba(255,255,255,0.6)",
                                            "inset -1px 0 rgba(0,0,0,0.03)",
                                            "0 2px 4px rgba(0,0,0,0.08)",
                                        ].join(", ");
                                    }}
                                    onMouseLeave={e => {
                                        e.currentTarget.style.backgroundColor = '#ececea';
                                        e.currentTarget.style.boxShadow = [
                                            "inset 0 1px 0 rgba(255,255,255,0.8)",
                                            "inset 0 -1px 0 rgba(0,0,0,0.06)",
                                            "inset 1px 0 rgba(255,255,255,0.5)",
                                            "inset -1px 0 rgba(0,0,0,0.04)",
                                            "0 1px 3px rgba(0,0,0,0.06)",
                                        ].join(", ");
                                    }}
                                >
                                    <ArrowTopRightOnSquareIcon width={16} height={16} />
                                    Show in folder
                                </button>
                            </div>
                        </div>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
