import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

interface DocumentCardProps {
    path: string;
    description: string;
    chatId: string;
    onOpenArtifact?: (name: string) => void;
}

export default function DocumentCard({ path, description, chatId, onOpenArtifact }: DocumentCardProps) {
    const [isHovered, setIsHovered] = useState(false);
    const [content, setContent] = useState<string | null>(null);
    const [csvGrid, setCsvGrid] = useState<string[][] | null>(null);
    const [loading, setLoading] = useState(true);

    const filename = path.split(/[\\/]/).pop() || 'Untitled Document';
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const nameWithoutExt = filename.substring(0, filename.lastIndexOf('.')) || filename;
    
    const isExcel = ['xlsx', 'xls', 'csv'].includes(ext);

    useEffect(() => {
        let isMounted = true;
        setLoading(true);
        setContent(null);
        setCsvGrid(null);

        const loadContent = async () => {
            try {
                const lastSlash = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
                const dir = lastSlash !== -1 ? path.substring(0, lastSlash) : '';
                const name = lastSlash !== -1 ? path.substring(lastSlash + 1) : path;

                if (ext === 'md' || ext === 'csv' || ext === 'txt') {
                    const res = await (window as any).electronAPI?.projects.readFile(dir, name);
                    if (!isMounted) return;
                    if (res !== null) {
                        setContent(res);
                        if (ext === 'csv') {
                            parseCsvToGrid(res);
                        }
                    }
                } else if (ext === 'docx' || ext === 'doc') {
                    const res = await (window as any).electronAPI?.system.parseDocx(path);
                    if (!isMounted) return;
                    if (res && res.success && res.text) {
                        setContent(res.text);
                    } else {
                        setContent(`[Word Document] ${description}`);
                    }
                } else if (ext === 'xlsx' || ext === 'xls') {
                    const res = await (window as any).electronAPI?.system.parseXlsx(path);
                    if (!isMounted) return;
                    if (res && res.success && res.csv) {
                        setContent(res.csv);
                        parseCsvToGrid(res.csv);
                    } else {
                        setContent(`[Spreadsheet Ledger] ${description}`);
                    }
                }
            } catch (err) {
                console.error("Error reading file preview:", err);
            } finally {
                if (isMounted) setLoading(false);
            }
        };

        const parseCsvToGrid = (csvText: string) => {
            const lines = csvText.split('\n');
            const grid: string[][] = [];
            for (let i = 0; i < Math.min(lines.length, 6); i++) {
                const line = lines[i].trim();
                if (!line) continue;
                
                // Parse CSV cell values keeping quotes in mind
                const rowCells: string[] = [];
                let insideQuote = false;
                let currentCell = '';
                for (let j = 0; j < line.length; j++) {
                    const char = line[j];
                    if (char === '"') {
                        insideQuote = !insideQuote;
                    } else if (char === ',' && !insideQuote) {
                        rowCells.push(currentCell.replace(/^"|"$/g, '').trim());
                        currentCell = '';
                    } else {
                        currentCell += char;
                    }
                }
                rowCells.push(currentCell.replace(/^"|"$/g, '').trim());
                grid.push(rowCells.slice(0, 5)); // cap columns
            }
            setCsvGrid(grid);
        };

        loadContent();
        return () => { isMounted = false; };
    }, [path, ext]);

    const handleClick = () => {
        if (onOpenArtifact) {
            onOpenArtifact(filename);
        }
    };

    const formatInline = (text: string) => {
        let f = text;
        // Escape HTML
        f = f.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        // Inline code
        f = f.replace(/`(.*?)`/g, '<code style="background-color: rgba(255,255,255,0.08); padding: 2px 4px; border-radius: 4px; font-family: monospace; font-size: 12px; color: #3b82f6;">$1</code>');
        // Inline bold
        f = f.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        return f;
    };

    const renderPreviewContent = () => {
        if (loading) {
            return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 0' }}>
                    <div style={{ height: 16, width: '40%', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 4, animation: 'pulse 1.5s infinite' }} />
                    <div style={{ height: 12, width: '90%', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 3, animation: 'pulse 1.5s infinite' }} />
                    <div style={{ height: 12, width: '75%', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 3, animation: 'pulse 1.5s infinite' }} />
                    <style dangerouslySetInnerHTML={{ __html: `
                        @keyframes pulse {
                            0%, 100% { opacity: 0.3; }
                            50% { opacity: 0.6; }
                        }
                    `}} />
                </div>
            );
        }

        if (csvGrid && csvGrid.length > 0) {
            // Render Mini spreadsheet
            return (
                <div style={{ overflowX: 'auto', margin: '10px 0 0 0', borderRadius: 6, border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, color: '#e3e3e6', fontFamily: 'monospace' }}>
                        <tbody>
                            {csvGrid.map((row, ri) => (
                                <tr key={ri} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', backgroundColor: ri === 0 ? 'rgba(255,255,255,0.03)' : 'transparent' }}>
                                    {row.map((cell, ci) => (
                                        <td key={ci} style={{
                                            padding: '6px 10px',
                                            borderRight: '1px solid rgba(255,255,255,0.05)',
                                            fontWeight: ri === 0 ? 600 : 'normal',
                                            color: ri === 0 ? '#ffffff' : '#b0b0b5',
                                            whiteSpace: 'nowrap',
                                            textOverflow: 'ellipsis',
                                            overflow: 'hidden',
                                            maxWidth: 120
                                        }}>
                                            {cell}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            );
        }

        if (!content) {
            return (
                <div style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.3)', padding: '12px 0', fontStyle: 'italic' }}>
                    Document content empty or loading...
                </div>
            );
        }

        // Render formatted Markdown preview snippet
        const lines = content.split('\n').filter(l => l.trim().length > 0).slice(0, 6);
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 0', fontFamily: 'Inter, sans-serif' }}>
                {lines.map((line, idx) => {
                    const trimmed = line.trim();
                    if (trimmed.startsWith('#')) {
                        const level = (trimmed.match(/^#+/) || ['#'])[0].length;
                        const text = trimmed.replace(/^#+\s*/, '');
                        return (
                            <div key={idx} style={{
                                fontSize: level === 1 ? 16 : level === 2 ? 14 : 13,
                                fontWeight: 700,
                                color: '#ffffff',
                                marginTop: idx > 0 ? 8 : 2,
                                marginBottom: 2
                            }} dangerouslySetInnerHTML={{ __html: formatInline(text) }} />
                        );
                    }
                    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
                        return (
                            <div key={idx} style={{
                                display: 'flex',
                                fontSize: 12,
                                color: '#c9c9cf',
                                paddingLeft: 8,
                                lineHeight: 1.5
                            }}>
                                <span style={{ marginRight: 6, color: '#3b82f6' }}>•</span>
                                <span dangerouslySetInnerHTML={{ __html: formatInline(trimmed.substring(2)) }} />
                            </div>
                        );
                    }
                    if (/^\d+\.\s+/.test(trimmed)) {
                        const num = (trimmed.match(/^\d+\.\s+/) || ['1. '])[0];
                        const text = trimmed.replace(/^\d+\.\s+/, '');
                        return (
                            <div key={idx} style={{
                                display: 'flex',
                                fontSize: 12,
                                color: '#c9c9cf',
                                paddingLeft: 8,
                                lineHeight: 1.5
                            }}>
                                <span style={{ marginRight: 6, color: '#3b82f6', fontWeight: 600 }}>{num}</span>
                                <span dangerouslySetInnerHTML={{ __html: formatInline(text) }} />
                            </div>
                        );
                    }
                    return (
                        <p key={idx} style={{
                            fontSize: 12,
                            color: '#b0b0b5',
                            lineHeight: 1.5,
                            margin: 0
                        }} dangerouslySetInnerHTML={{ __html: formatInline(trimmed) }} />
                    );
                })}
            </div>
        );
    };

    return (
        <motion.div
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onClick={handleClick}
            animate={{ scale: isHovered ? 1.01 : 1 }}
            transition={{ duration: 0.15 }}
            style={{
                display: 'flex',
                flexDirection: 'column',
                padding: '16px 20px',
                backgroundColor: isHovered ? '#1f1f23' : '#141416',
                border: isHovered ? '1px solid rgba(59, 130, 246, 0.4)' : '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: 16,
                cursor: 'pointer',
                boxShadow: isHovered ? '0 12px 32px rgba(0,0,0,0.3)' : '0 4px 16px rgba(0,0,0,0.15)',
                transition: 'border 0.2s ease, background-color 0.2s ease',
                position: 'relative',
                width: '100%',
                maxWidth: '620px',
                boxSizing: 'border-box',
                marginTop: 12,
                marginBottom: 4,
                overflow: 'hidden'
            }}
        >
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    {/* Color-coded Icon */}
                    <div style={{
                        width: 32,
                        height: 32,
                        borderRadius: 6,
                        backgroundColor: isExcel ? 'rgba(16, 185, 129, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                        border: `1px solid ${isExcel ? 'rgba(16, 185, 129, 0.3)' : 'rgba(59, 130, 246, 0.3)'}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0
                    }}>
                        {isExcel ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="3" y="3" width="18" height="18" rx="2" />
                                <line x1="3" y1="9" x2="21" y2="9" />
                                <line x1="3" y1="15" x2="21" y2="15" />
                                <line x1="10" y1="3" x2="10" y2="21" />
                            </svg>
                        ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                <polyline points="14 2 14 8 20 8" />
                                <line x1="16" y1="13" x2="8" y2="13" />
                                <line x1="16" y1="17" x2="8" y2="17" />
                                <line x1="10" y1="9" x2="8" y2="9" />
                            </svg>
                        )}
                    </div>
                    
                    {/* Document Title */}
                    <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                        <div style={{
                            fontSize: 14,
                            fontWeight: 600,
                            color: '#ffffff',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            letterSpacing: '-0.01em'
                        }}>
                            {description || nameWithoutExt}
                        </div>
                    </div>
                </div>

                {/* More options button */}
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                    }}
                    style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'rgba(255,255,255,0.4)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 4
                    }}
                >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="1" />
                        <circle cx="19" cy="12" r="1" />
                        <circle cx="5" cy="12" r="1" />
                    </svg>
                </button>
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid rgba(255, 255, 255, 0.08)', margin: '12px 0 6px 0' }} />

            {/* Document Preview Area (Max Height + bottom fade gradient) */}
            <div style={{ position: 'relative', maxHeight: 150, overflow: 'hidden' }}>
                {renderPreviewContent()}
                
                {/* Bottom Blur Fade Overlay */}
                <div style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: 40,
                    background: isHovered 
                        ? 'linear-gradient(to bottom, transparent, #1f1f23)' 
                        : 'linear-gradient(to bottom, transparent, #141416)',
                    pointerEvents: 'none',
                    transition: 'background-color 0.2s ease'
                }} />
            </div>
        </motion.div>
    );
}
