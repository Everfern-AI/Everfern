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
            f = f.replace(/`(.*?)`/g, '<code style="background-color: #f1f0ea; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 13px; color: #0891b2;">$1</code>');
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
function PPTViewer({ filename }: { filename: string }) {
    const [activeSlide, setActiveSlide] = useState(0);

    const slides = [
        {
            title: "Project Strategy & Roadmap",
            subtitle: "Delivering Agentic Autonomy",
            points: [
                "Streamlining core workflow capabilities by 35%",
                "Executing sandbox operations with WSL translation tools",
                "Deploying visual state analyzers via Navis engine layers",
                "Optimizing resource consumption patterns across worker nodes"
            ]
        },
        {
            title: "Market Analysis & Performance",
            subtitle: "Benchmarking against Competitors",
            points: [
                "Positioned as top-tier autonomous solution for SMBs",
                "Competitive moats established through local-first execution",
                "User retention metrics showing 45% increase month-over-month",
                "Q4 expansion plans into enterprise sectors"
            ]
        }
    ];

    return (
        <div style={{ display: 'flex', height: '100%', backgroundColor: '#1a1a17' }}>
            <div style={{ width: 180, borderRight: '1px solid #2d2d27', display: 'flex', flexDirection: 'column', gap: 12, padding: 12, overflowY: 'auto' }}>
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
                            transition: 'all 0.15s'
                        }}
                    >
                        <span style={{ fontSize: 9, color: activeSlide === index ? '#0891b2' : '#888', fontWeight: 600 }}>Slide {index + 1}</span>
                        <div style={{ fontSize: 8, color: '#ccc', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {slide.title}
                        </div>
                    </div>
                ))}
            </div>

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 24, justifyContent: 'center', alignItems: 'center', gap: 16 }}>
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
                    fontFamily: 'Inter, sans-serif'
                }}>
                    <div>
                        <div style={{ fontSize: 20, fontWeight: 700, color: '#111', borderBottom: '2px solid #0891b2', paddingBottom: 6 }}>
                            {slides[activeSlide].title}
                        </div>
                        <div style={{ fontSize: 12, color: '#666', marginTop: 4, fontStyle: 'italic' }}>
                            {slides[activeSlide].subtitle}
                        </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: '14px 0', flex: 1, justifyContent: 'center' }}>
                        {slides[activeSlide].points.map((pt, i) => (
                            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                                <div style={{ width: 5, height: 5, borderRadius: '50%', backgroundColor: '#0891b2', marginTop: 6, flexShrink: 0 }} />
                                <div style={{ fontSize: 13, color: '#222', lineHeight: 1.4 }}>{pt}</div>
                            </div>
                        ))}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 9, color: '#888', borderTop: '1px solid #eee', paddingTop: 6 }}>
                        <span>{filename}</span>
                        <span>Slide {activeSlide + 1} of {slides.length}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

// Syntax highlighting helper
const getSyntaxHighlightingColors = (language: string, token: string): string => {
    const colorMap: Record<string, Record<string, string>> = {
        javascript: { keyword: '#d946ef', string: '#16a34a', number: '#2563eb', comment: '#8a8886', function: '#0891b2' },
        typescript: { keyword: '#d946ef', string: '#16a34a', number: '#2563eb', comment: '#8a8886', function: '#0891b2' },
        python: { keyword: '#d946ef', string: '#16a34a', number: '#2563eb', comment: '#8a8886', function: '#0891b2' },
        html: { tag: '#dc2626', attr: '#0891b2', string: '#16a34a', comment: '#8a8886' },
        css: { property: '#d946ef', value: '#2563eb', selector: '#dc2626', comment: '#8a8886' },
        json: { key: '#0891b2', string: '#16a34a', number: '#2563eb', boolean: '#d946ef' },
        sql: { keyword: '#d946ef', string: '#16a34a', number: '#2563eb', comment: '#8a8886' },
    };
    return colorMap[language]?.[token] || '#201e24';
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
            keyword: '#d946ef',
            string: '#16a34a',
            number: '#2563eb',
            comment: '#8a8886',
            function: '#0891b2',
        },
        javascript: {
            keyword: '#d946ef',
            string: '#16a34a',
            number: '#2563eb',
            comment: '#8a8886',
            function: '#0891b2',
        },
        typescript: {
            keyword: '#d946ef',
            string: '#16a34a',
            number: '#2563eb',
            comment: '#8a8886',
            function: '#0891b2',
        },
        html: {
            tag: '#dc2626',
            attr: '#0891b2',
            string: '#16a34a',
            comment: '#8a8886',
        },
        css: {
            property: '#d946ef',
            value: '#2563eb',
            selector: '#dc2626',
            comment: '#8a8886',
        },
        json: {
            key: '#0891b2',
            string: '#16a34a',
            number: '#2563eb',
            boolean: '#d946ef',
        },
    };

    const colors = colorSchemes[language] || {};
    const lines = code.split('\n');

    const highlightLine = (line: string): React.ReactNode[] => {
        if (!colors || Object.keys(colors).length === 0) {
            return [<span key={line} style={{ color: '#201e24' }}>{line}</span>];
        }

        // Comment detection
        const commentMatch = line.match(/^(\s*)(#|\/\/|\/\*|<!--)(.*)/);
        if (commentMatch) {
            return [<span key={line} style={{ color: colors.comment || '#8a8886' }}>{line}</span>];
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
            tokens.push({ type, value: match[0], color: colorMap[type] || '#201e24' });
            lastIndex = match.index! + match[0].length;
        });

        if (lastIndex < line.length) {
            tokens.push({ type: 'text', value: line.slice(lastIndex) });
        }

        return tokens.map((token, idx) => (
            <span key={idx} style={{ color: token.color || '#201e24' }}>
                {token.value}
            </span>
        )) || [<span key={line}>{line}</span>];
    };

    return (
        <>
            {lines.map((line, idx) => (
                <div key={idx} style={{ color: '#201e24', lineHeight: 1.6 }}>
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
            const previewExts = ['html', 'htm', 'xlsx', 'xls', 'csv', 'pptx', 'ppt', 'md'];
            
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
                        backgroundColor: "#fcfcfb",
                        zIndex: 9999,
                        display: "flex",
                        flexDirection: "column",
                        color: "#201e24",
                        overflowY: "auto",
                        padding: "60px 80px"
                    }}
                >
                    <button
                        onClick={onClose}
                        style={{ position: "absolute", top: 30, right: 40, background: "transparent", border: "none", color: "#a1a1aa", cursor: "pointer", padding: 8, borderRadius: "50%" }}
                        onMouseEnter={e => e.currentTarget.style.backgroundColor = "rgba(0,0,0,0.05)"}
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
                                    border: "1px solid #e8e6d9", 
                                    color: "#111111", 
                                    borderRadius: 8, 
                                    padding: "6px 16px", 
                                    cursor: "pointer", 
                                    fontSize: 13, 
                                    fontWeight: 600,
                                    marginBottom: 16,
                                    transition: "all 0.2s"
                                }}
                                onMouseEnter={e => { e.currentTarget.style.backgroundColor = "rgba(0,0,0,0.05)"; }}
                                onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; }}
                            >
                                {"\u2190"} Back
                            </button>

                            {/* Filename and path */}
                            <div style={{ marginBottom: 8 }}>
                                <h1 style={{ margin: "0 0 4px", fontSize: 28, fontWeight: 600 }}>{selectedCode.name}</h1>
                                <p style={{ margin: 0, fontSize: 12, color: "#8a8886", fontFamily: "'JetBrains Mono', 'Fira Code', monospace", wordBreak: "break-all" }}>{artifactPath}</p>
                            </div>

                            {/* Toolbar */}
                            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 24 }}>
                                {!isPlanFile && (
                                    <button
                                        onClick={() => setIsEditing(v => !v)}
                                        style={{ display: "flex", alignItems: "center", gap: 6, background: isEditing ? "rgba(0,0,0,0.05)" : "transparent", border: "1px solid #e8e6d9", color: "#111111", borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 13, transition: "all 0.2s" }}
                                        onMouseEnter={e => { if (!isEditing) e.currentTarget.style.backgroundColor = "rgba(0,0,0,0.04)"; }}
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
                                        style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: "1px solid #e8e6d9", color: "#111111", borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 13, transition: "all 0.2s" }}
                                        onMouseEnter={e => { e.currentTarget.style.backgroundColor = "rgba(0,0,0,0.04)"; }}
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
                                            style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: "1px solid #e8e6d9", borderRight: "none", color: "#111111", borderRadius: "8px 0 0 8px", padding: "6px 14px", cursor: "pointer", fontSize: 13, transition: "all 0.2s" }}
                                            onMouseEnter={e => { e.currentTarget.style.backgroundColor = "rgba(0,0,0,0.04)"; }}
                                            onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; }}
                                            title="Open in default app"
                                        >
                                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
                                                <path d="M3 13L13 3M13 3H7M13 3V9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                                                <rect x="1.5" y="7.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" opacity="0.4"/>
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
                                            style={{ display: "flex", alignItems: "center", background: "transparent", border: "1px solid #e8e6d9", color: "#111111", borderRadius: "0 8px 8px 0", padding: "6px 8px", cursor: "pointer", fontSize: 13, transition: "all 0.2s" }}
                                            onMouseEnter={e => { e.currentTarget.style.backgroundColor = "rgba(0,0,0,0.04)"; }}
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
                                                        backgroundColor: '#fff',
                                                        border: '1px solid #e8e6d9',
                                                        borderRadius: 12,
                                                        boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
                                                        minWidth: 220,
                                                        overflow: 'hidden',
                                                        padding: '6px 0',
                                                    }}
                                                >
                                                    <div style={{ padding: '6px 14px 8px', fontSize: 11, fontWeight: 700, color: '#8a8886', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                                        Open with
                                                    </div>

                                                    {openAppsLoading ? (
                                                        <div style={{ padding: '12px 14px', fontSize: 13, color: '#8a8886' }}>Detecting apps…</div>
                                                    ) : openApps.length === 0 ? (
                                                        <div style={{ padding: '12px 14px', fontSize: 13, color: '#8a8886' }}>No apps detected</div>
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
                                                                color: '#111111',
                                                                textAlign: 'left',
                                                                transition: 'background 0.15s',
                                                            }}
                                                            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.04)'; }}
                                                            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                                                        >
                                                            {app.icon ? (
                                                                <img src={app.icon} alt="" width={18} height={18} style={{ borderRadius: 4, flexShrink: 0 }} />
                                                            ) : (
                                                                <div style={{ width: 18, height: 18, borderRadius: 4, backgroundColor: '#e8e6d9', flexShrink: 0 }} />
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
                                        style={{ display: "flex", alignItems: "center", gap: 6, background: saveSuccess ? "rgba(34,197,94,0.1)" : "rgba(0,0,0,0.04)", border: `1px solid ${saveSuccess ? "#22c55e" : "#e8e6d9"}`, color: saveSuccess ? "#16a34a" : "#111111", borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 13, transition: "all 0.3s" }}
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
                            {!isPlanFile && (['html', 'htm', 'xlsx', 'xls', 'csv', 'pptx', 'ppt', 'md'].includes(selectedCode.name.split('.').pop()?.toLowerCase() || '')) && (
                                <div style={{ display: "flex", gap: 8, marginBottom: 16, backgroundColor: "rgba(0,0,0,0.03)", padding: 4, borderRadius: 10, width: "fit-content" }}>
                                    <button
                                        onClick={() => setViewMode('code')}
                                        style={{ padding: "6px 16px", borderRadius: 8, border: "none", fontSize: 13, fontWeight: 500, cursor: "pointer", backgroundColor: viewMode === 'code' ? "rgba(0,0,0,0.05)" : "transparent", color: viewMode === 'code' ? "#111111" : "#8a8886", transition: "all 0.2s" }}
                                    >
                                        Code
                                    </button>
                                    <button
                                        onClick={() => setViewMode('preview')}
                                        style={{ padding: "6px 16px", borderRadius: 8, border: "none", fontSize: 13, fontWeight: 500, cursor: "pointer", backgroundColor: viewMode === 'preview' ? "rgba(0,0,0,0.05)" : "transparent", color: viewMode === 'preview' ? "#111111" : "#8a8886", transition: "all 0.2s" }}
                                    >
                                        {['xlsx', 'xls', 'csv', 'pptx', 'ppt', 'md'].includes(selectedCode.name.split('.').pop()?.toLowerCase() || '') ? 'Preview' : 'Visual Preview'}
                                    </button>
                                </div>
                            )}

                            {/* Plan notice */}
                            {isPlanFile && (
                                <div style={{ marginBottom: 16, padding: "12px 16px", backgroundColor: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.25)", borderRadius: 10, fontSize: 13, color: "#fbbf24", lineHeight: 1.5 }}>
                                    âœï¸ <strong>Review this plan carefully.</strong> You can edit any step before approving. Click <strong>Approve &amp; Execute</strong> when ready.
                                </div>
                            )}

                            {/* Content area */}
                            {viewMode === 'preview' ? (
                                <motion.div 
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    transition={{ delay: 0.1 }}
                                    style={{ flex: 1, backgroundColor: "#fff", borderRadius: 12, overflow: "hidden", border: "1px solid #e8e6d9", position: "relative", minHeight: 400 }}>
                                    {(() => {
                                        const ext = selectedCode.name.split('.').pop()?.toLowerCase() || '';
                                        if (ext === 'md') {
                                            return <MarkdownViewer content={editedContent || selectedCode.content} />;
                                        }
                                        if (['xlsx', 'xls', 'csv'].includes(ext)) {
                                            return <ExcelViewer filename={selectedCode.name} content={selectedCode.content} />;
                                        }
                                        if (['pptx', 'ppt'].includes(ext)) {
                                            return <PPTViewer filename={selectedCode.name} />;
                                        }
                                        return (
                                            <>
                                                <iframe 
                                                    srcDoc={(editedContent || selectedCode.content)}
                                                    style={{ width: "100%", height: "100%", border: "none" }}
                                                    title="Preview"
                                                    sandbox="allow-scripts allow-forms allow-same-origin"
                                                />
                                                <div style={{ position: "absolute", bottom: 12, right: 12, backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", padding: "4px 10px", borderRadius: 6, fontSize: 10, color: "#fff", pointerEvents: "none" }}>
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
                                        backgroundColor: "#f4f4f4",
                                        border: "1px solid #e8e6d9",
                                        borderRadius: 12,
                                        padding: 24,
                                        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                                        fontSize: 13,
                                        color: "#201e24",
                                        lineHeight: 1.7,
                                        resize: "vertical",
                                        outline: "none",
                                        caretColor: "#111111"
                                    }}
                                    onFocus={(e: React.FocusEvent<HTMLTextAreaElement>) => { (e.target as HTMLTextAreaElement).style.borderColor = "#3f3f46"; }}
                                    onBlur={(e: React.FocusEvent<HTMLTextAreaElement>) => { (e.target as HTMLTextAreaElement).style.borderColor = "#e8e6d9"; }}
                                />
                            ) : (
                                <motion.div 
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    transition={{ delay: 0.05 }}
                                    style={{ backgroundColor: "#f4f4f4", border: "1px solid #e8e6d9", borderRadius: 12, padding: 24, flex: 1, overflow: "auto", fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: 13, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
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
                                <button style={{ backgroundColor: "#201e24", color: "#fcfcfb", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "all 0.2s" }}
                                    onMouseEnter={e => e.currentTarget.style.backgroundColor = "#3f3f46"}
                                    onMouseLeave={e => e.currentTarget.style.backgroundColor = "#201e24"}
                                >
                                    New artifact
                                </button>
                            </div>

                             <div style={{ display: "flex", gap: 32, borderBottom: "1px solid #e8e6d9", marginBottom: 32 }}>
                                <button
                                    onClick={() => setActiveTab('inspiration')}
                                    style={{ background: "transparent", border: "none", borderBottom: activeTab === 'inspiration' ? "2px solid #201e24" : "2px solid transparent", color: activeTab === 'inspiration' ? "#201e24" : "#8a8886", fontSize: 15, fontWeight: 500, paddingBottom: 12, cursor: "pointer", transition: "0.2s" }}
                                >
                                    Inspiration
                                </button>
                                <button
                                    onClick={() => setActiveTab('yours')}
                                    style={{ background: "transparent", border: "none", borderBottom: activeTab === 'yours' ? "2px solid #201e24" : "2px solid transparent", color: activeTab === 'yours' ? "#201e24" : "#8a8886", fontSize: 15, fontWeight: 500, paddingBottom: 12, cursor: "pointer", transition: "0.2s" }}
                                >
                                    Your artifacts
                                </button>
                                <button
                                    onClick={() => setActiveTab('sites')}
                                    style={{ background: "transparent", border: "none", borderBottom: activeTab === 'sites' ? "2px solid #201e24" : "2px solid transparent", color: activeTab === 'sites' ? "#201e24" : "#8a8886", fontSize: 15, fontWeight: 500, paddingBottom: 12, cursor: "pointer", transition: "0.2s", display: "flex", alignItems: "center", gap: 6 }}
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
                                    style={{ background: "transparent", border: "none", borderBottom: activeTab === 'terminal' ? "2px solid #201e24" : "2px solid transparent", color: activeTab === 'terminal' ? "#201e24" : "#8a8886", fontSize: 15, fontWeight: 500, paddingBottom: 12, cursor: "pointer", transition: "0.2s", display: "flex", alignItems: "center", gap: 6 }}
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
                                            <div style={{ backgroundColor: "#fcfbf7", border: "1px dashed #e8e6d9", borderRadius: 16, padding: "40px", textAlign: "center", gridColumn: "1 / -1" }}>
                                                <div style={{ fontSize: 15, fontWeight: 600, color: "#201e24" }}>No artifacts in this chat yet</div>
                                                <p style={{ color: "#8a8886", fontSize: 13, marginTop: 8, maxWidth: 300, margin: "8px auto" }}>Tell the AI to generate a report, dashboard, or code file to see it here.</p>
                                                <button 
                                                    onClick={() => loadArtifacts()}
                                                    style={{ marginTop: 20, padding: "8px 16px", backgroundColor: "#201e24", color: "#fff", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "none" }}
                                                >
                                                    Refresh Artifacts
                                                </button>
                                            </div>
                                        ) : artifacts.map((a, idx) => (
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
                                                    style={{ backgroundColor: a.name === 'execution_plan.md' ? "rgba(234,179,8,0.05)" : "#ffffff", borderRadius: "16px", border: a.name === 'execution_plan.md' ? "1px solid rgba(234,179,8,0.3)" : "1px solid #e8e6d9", height: 220, overflow: "hidden", display: "flex", flexDirection: "column", position: "relative" }}>
                                                    {a.name === 'execution_plan.md' && (
                                                        <div style={{ position: "absolute", top: 10, right: 12, padding: "3px 8px", backgroundColor: "rgba(234,179,8,0.1)", border: "1px solid rgba(234,179,8,0.3)", borderRadius: 6, fontSize: 10, fontWeight: 700, color: "#854d0e", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                                                            Awaiting Approval
                                                        </div>
                                                    )}
                                                    <div style={{ margin: "24px 24px 0 24px", backgroundColor: "#fcfcfb", border: "1px solid #e8e6d9", borderBottom: "none", borderTopLeftRadius: 12, borderTopRightRadius: 12, flex: 1, padding: 16, overflow: "hidden" }}>
                                                        <pre style={{ margin: 0, fontSize: 10, color: "#8a8886", fontFamily: "'JetBrains Mono', 'Fira Code', monospace", opacity: 0.8, whiteSpace: "pre-wrap" }}>
                                                            {a.snippet}
                                                        </pre>
                                                    </div>
                                                    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 60, background: `linear-gradient(transparent, ${a.name === 'execution_plan.md' ? 'rgba(252,250,240,0.95)' : '#ffffff'} 90%)` }}></div>
                                                </motion.div>
                                                <div style={{ marginTop: 12 }}>
                                                    <div style={{ fontSize: 14, fontWeight: 600, color: "#201e24", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</div>
                                                    <div style={{ fontSize: 12, color: "#8a8886", marginTop: 4, display: "flex", gap: 8, alignItems: "center" }}>
                                                        <span>Last edited {timeAgo(a.lastEdited)}</span>
                                                        <span style={{ color: "#d1d5db" }}>·</span>
                                                        <span style={{ color: "#6366f1", fontWeight: 500 }}>Chat {a.chatId.slice(0, 8)}...</span>
                                                    </div>
                                                </div>
                                            </motion.div>
                                        ))}
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
                                            <div style={{ backgroundColor: "#fcfbf7", border: "1px dashed #e8e6d9", borderRadius: 16, padding: "40px", textAlign: "center", gridColumn: "1 / -1" }}>
                                                <GlobeAltIcon className="w-12 h-12 mx-auto mb-4 opacity-30" style={{ color: "#8a8886" }} />
                                                <div style={{ fontSize: 15, fontWeight: 600, color: "#201e24" }}>No websites created yet</div>
                                                <p style={{ color: "#8a8886", fontSize: 13, marginTop: 8, maxWidth: 300, margin: "8px auto" }}>Ask the AI to build a website, dashboard, or HTML report to see it here.</p>
                                                <button 
                                                    onClick={() => activeChatId && loadSites(activeChatId)}
                                                    style={{ marginTop: 20, padding: "8px 16px", backgroundColor: "#201e24", color: "#fff", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "none" }}
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
                                                    style={{ backgroundColor: "#ffffff", borderRadius: "16px", border: "1px solid #e8e6d9", height: 280, overflow: "hidden", display: "flex", flexDirection: "column", position: "relative" }}>
                                                    {/* Site preview */}
                                                    <div style={{ flex: 1, backgroundColor: "#f4f4f4", overflow: "hidden", position: "relative" }}>
                                                        <iframe 
                                                            srcDoc={`<html><head><style>body{margin:0;padding:16px;font-family:system-ui}</style></head><body><p style="color:#8a8886;font-size:12px">Loading preview...</p></body></html>`}
                                                            style={{ width: "100%", height: "100%", border: "none", backgroundColor: "#f4f4f4" }}
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
                                                                style={{ padding: "6px 10px", backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", borderRadius: 6, fontSize: 11, fontWeight: 500, color: "#fff", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
                                                            >
                                                                <PencilSquareIcon className="w-3 h-3" />
                                                                Edit
                                                            </button>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    window.open(`everfern-site://${site.chatId}/index.html`, '_blank');
                                                                }}
                                                                style={{ padding: "6px 10px", backgroundColor: "rgba(139,92,246,0.9)", backdropFilter: "blur(4px)", borderRadius: 6, fontSize: 11, fontWeight: 500, color: "#fff", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
                                                            >
                                                                <ArrowTopRightOnSquareIcon className="w-3 h-3" />
                                                                Open
                                                            </button>
                                                        </div>
                                                    </div>
                                                    <div style={{ padding: "16px 20px", borderTop: "1px solid #e8e6d9" }}>
                                                        <div style={{ fontSize: 14, fontWeight: 600, color: "#201e24", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{site.name}</div>
                                                        <div style={{ fontSize: 12, color: "#8a8886", marginTop: 4 }}>Last edited {timeAgo(site.lastEdited)}</div>
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
                                        style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, color: "#71717a", fontSize: 14 }}>
                                        The community artifact gallery is coming soon.
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
                                            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, color: "#71717a", fontSize: 14 }}>
                                                Loading processes…
                                            </div>
                                        ) : processes.length === 0 ? (
                                            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 200, gap: 8 }}>
                                                <span style={{ fontSize: 32, opacity: 0.3 }}>▶</span>
                                                <span style={{ color: "#71717a", fontSize: 14 }}>No active terminal processes.</span>
                                                <span style={{ color: "#a1a1aa", fontSize: 12 }}>Processes spawned by the agent will appear here.</span>
                                            </div>
                                        ) : (
                                            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                                                {processes.map((proc, idx) => (
                                                    <motion.div
                                                        key={proc.id}
                                                        initial={{ opacity: 0, y: 12 }}
                                                        animate={{ opacity: 1, y: 0 }}
                                                        transition={{ delay: idx * 0.04 }}
                                                        style={{
                                                            display: "flex",
                                                            alignItems: "center",
                                                            gap: 16,
                                                            padding: "14px 20px",
                                                            borderRadius: 12,
                                                            border: "1px solid #e8e6d9",
                                                            backgroundColor: proc.status === 'running' ? "rgba(34,197,94,0.03)" : "#ffffff",
                                                            transition: "background-color 0.2s"
                                                        }}
                                                    >
                                                        {/* Status dot */}
                                                        <div style={{
                                                            width: 10, height: 10, borderRadius: "50%",
                                                            backgroundColor: proc.status === 'running' ? "#22c55e" : "#a1a1aa",
                                                            boxShadow: proc.status === 'running' ? "0 0 6px rgba(34,197,94,0.5)" : "none",
                                                            flexShrink: 0
                                                        }} />

                                                        {/* Command info */}
                                                        <div style={{ flex: 1, minWidth: 0 }}>
                                                            <div style={{
                                                                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                                                                fontSize: 13,
                                                                fontWeight: 500,
                                                                color: "#201e24",
                                                                whiteSpace: "nowrap",
                                                                overflow: "hidden",
                                                                textOverflow: "ellipsis"
                                                            }}>
                                                                {proc.commandLine}
                                                            </div>
                                                            <div style={{ fontSize: 11, color: "#8a8886", marginTop: 3, display: "flex", gap: 12 }}>
                                                                <span>ID: {proc.id.slice(0, 8)}…</span>
                                                                <span>{proc.status === 'running' ? '● Running' : `○ Exited (${proc.exitCode ?? '?'})`}</span>
                                                                <span>{(proc.bufferSize / 1024).toFixed(1)} KB buffered</span>
                                                            </div>
                                                        </div>

                                                        {/* Kill button */}
                                                        {proc.status === 'running' && (
                                                            <button
                                                                onClick={() => handleKillProcess(proc.id)}
                                                                style={{
                                                                    background: "rgba(239,68,68,0.08)",
                                                                    border: "1px solid rgba(239,68,68,0.25)",
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
                </motion.div>
            )}
        </AnimatePresence>
    );
}
