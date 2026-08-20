import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '@/components/ThemeProvider';

interface FileArtifactProps {
    path: string;
    description?: string;
    chatId?: string;
    onOpenArtifact?: (name: string) => void;
}

export default function FileArtifact({ path, description, chatId, onOpenArtifact }: FileArtifactProps) {
    const { theme } = useTheme();
    const isDark = theme === 'dark';

    const [isHovered, setIsHovered] = useState(false);
    const [isDownloadHovered, setIsDownloadHovered] = useState(false);
    const [isArrowHovered, setIsArrowHovered] = useState(false);
    const [showDropdown, setShowDropdown] = useState(false);
    const [apps, setApps] = useState<Array<{ name: string; path: string; icon: string }>>([]);
    const [appsLoading, setAppsLoading] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const filename = path ? path.split(/[\\/]/).pop() || 'Untitled' : 'Untitled';
    const ext = filename.includes('.') ? filename.split('.').pop()?.toLowerCase() || '' : '';

    // Determine type label and badge info
    const getTypeInfo = (extension: string) => {
        if (['xlsx', 'xls', 'csv', 'tsv'].includes(extension)) {
            return { label: 'Spreadsheet', ext: extension.toUpperCase() };
        }
        if (['docx', 'doc', 'rtf', 'odt'].includes(extension)) {
            return { label: 'Document', ext: extension.toUpperCase() };
        }
        if (extension === 'pdf') {
            return { label: 'Document', ext: 'PDF' };
        }
        if (['md', 'markdown'].includes(extension)) {
            return { label: 'Document', ext: 'MD' };
        }
        if (['pptx', 'ppt', 'key'].includes(extension)) {
            return { label: 'Presentation', ext: extension.toUpperCase() };
        }
        if (['js', 'ts', 'jsx', 'tsx', 'html', 'css', 'py', 'json', 'c', 'cpp', 'go', 'rs', 'sh', 'bat', 'ps1', 'sql'].includes(extension)) {
            return { label: 'Code', ext: extension.toUpperCase() };
        }
        if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'avif'].includes(extension)) {
            return { label: 'Image', ext: extension.toUpperCase() };
        }
        return { label: 'Document', ext: extension ? extension.toUpperCase() : 'FILE' };
    };

    const typeInfo = getTypeInfo(ext);

    // Format display title
    const displayTitle = React.useMemo(() => {
        if (description && description.length < 60 && !description.includes('/') && !description.includes('\\')) {
            return description;
        }
        const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');
        if (nameWithoutExt.toLowerCase() === 'system_prompt') {
            return 'Everfern system prompt';
        }
        // Capitalize words nicely
        return nameWithoutExt
            .replace(/[_-]/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase());
    }, [description, filename]);

    // Format subtitle: "Document · PDF"
    const subtitle = `${typeInfo.label} · ${typeInfo.ext}`;

    // Load registered apps for file
    useEffect(() => {
        let isMounted = true;
        setAppsLoading(true);
        (window as any).electronAPI?.system?.getFileApps?.(path)
            .then((res: any[]) => {
                if (isMounted && res) {
                    setApps(res);
                }
                if (isMounted) setAppsLoading(false);
            })
            .catch(() => {
                if (isMounted) setAppsLoading(false);
            });

        return () => {
            isMounted = false;
        };
    }, [path]);

    // Handle outside click for dropdown
    useEffect(() => {
        const handleOutsideClick = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setShowDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleOutsideClick);
        return () => document.removeEventListener('mousedown', handleOutsideClick);
    }, []);

    const handleOpen = () => {
        if (onOpenArtifact) {
            onOpenArtifact(filename);
        } else {
            (window as any).electronAPI?.system?.openFile?.(path).catch(() => {});
        }
    };

    const handleOpenWithApp = async (appPath?: string) => {
        setShowDropdown(false);
        try {
            await (window as any).electronAPI?.system?.openFile?.(path, appPath);
        } catch (err) {
            console.error('Failed to open file:', err);
        }
    };

    const handleShowInFolder = async (e: React.MouseEvent) => {
        e.stopPropagation();
        setShowDropdown(false);
        try {
            await (window as any).electronAPI?.system?.showItemInFolder?.(path);
        } catch {}
    };

    const handleCopyPath = async (e: React.MouseEvent) => {
        e.stopPropagation();
        setShowDropdown(false);
        try {
            await navigator.clipboard.writeText(path);
        } catch {}
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15 }}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onClick={handleOpen}
            style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                backgroundColor: isDark 
                    ? (isHovered ? '#1a1a1a' : '#141414') 
                    : (isHovered ? '#fcfcfc' : '#ffffff'),
                border: isDark 
                    ? (isHovered ? '1px solid rgba(255, 255, 255, 0.14)' : '1px solid rgba(255, 255, 255, 0.08)') 
                    : (isHovered ? '1px solid rgba(0, 0, 0, 0.14)' : '1px solid rgba(0, 0, 0, 0.08)'),
                borderRadius: 14,
                cursor: 'pointer',
                boxShadow: isHovered
                    ? (isDark ? '0 6px 20px rgba(0,0,0,0.4)' : '0 6px 20px rgba(0,0,0,0.06)')
                    : (isDark ? '0 2px 6px rgba(0,0,0,0.2)' : '0 1px 3px rgba(0,0,0,0.02)'),
                transition: 'background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease',
                gap: 14,
                position: 'relative',
                width: '100%',
                maxWidth: '100%',
                boxSizing: 'border-box',
                marginTop: 6,
                marginBottom: 6,
            }}
        >
            {/* Left Section: Thumbnail + Text */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0, flex: 1 }}>
                {/* Vertical Document Silhouette Mockup matching Claude's design */}
                <div
                    style={{
                        width: 44,
                        height: 54,
                        borderRadius: 9,
                        backgroundColor: isDark ? '#191919' : '#f4f4f6',
                        border: isDark ? '1px solid rgba(255, 255, 255, 0.11)' : '1px solid rgba(0, 0, 0, 0.09)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        boxShadow: isDark
                            ? 'inset 0 1px 0 rgba(255,255,255,0.06), 0 2px 5px rgba(0,0,0,0.3)'
                            : 'inset 0 1px 0 rgba(255,255,255,0.8), 0 1px 3px rgba(0,0,0,0.04)',
                        position: 'relative',
                        overflow: 'hidden'
                    }}
                >
                    {/* Document Page SVG matching reference */}
                    <svg
                        width="20"
                        height="22"
                        viewBox="0 0 24 24"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                        style={{
                            opacity: isDark ? 0.7 : 0.6,
                        }}
                    >
                        {/* Page Outline */}
                        <path
                            d="M6 3.5H14.5L19 8V20.5C19 21.0523 18.5523 21.5 18 21.5H6C5.44772 21.5 5 21.0523 5 20.5V4.5C5 3.94772 5.44772 3.5 6 3.5Z"
                            stroke={isDark ? '#e5e5e5' : '#27272a'}
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                        {/* Folded Dog-Ear Corner */}
                        <path
                            d="M14 3.5V8.5H19"
                            stroke={isDark ? '#e5e5e5' : '#27272a'}
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                        {/* Document Content Lines */}
                        <path
                            d="M9 13H15M9 16.5H13"
                            stroke={isDark ? '#e5e5e5' : '#27272a'}
                            strokeWidth="1.5"
                            strokeLinecap="round"
                        />
                    </svg>
                </div>

                {/* Center Metadata */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                    <div
                        style={{
                            fontSize: 14.5,
                            fontWeight: 500,
                            color: isDark ? '#ffffff' : '#18181b',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            letterSpacing: '-0.01em',
                            lineHeight: 1.3
                        }}
                    >
                        {displayTitle}
                    </div>
                    <div
                        style={{
                            fontSize: 12.5,
                            color: isDark ? 'rgba(255, 255, 255, 0.45)' : '#71717a',
                            fontWeight: 400,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            letterSpacing: '-0.005em'
                        }}
                    >
                        {subtitle}
                    </div>
                </div>
            </div>

            {/* Right Action Buttons */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    flexShrink: 0,
                    position: 'relative'
                }}
                ref={dropdownRef}
                onClick={e => e.stopPropagation()}
            >
                {/* Download Pill Button Group */}
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    <button
                        onClick={handleOpen}
                        onMouseEnter={() => setIsDownloadHovered(true)}
                        onMouseLeave={() => setIsDownloadHovered(false)}
                        style={{
                            height: 36,
                            padding: '0 16px',
                            borderRadius: '9px 0 0 9px',
                            backgroundColor: isDark 
                                ? (isDownloadHovered ? '#2c2c2c' : '#222222') 
                                : (isDownloadHovered ? '#e4e4e7' : '#f4f4f5'),
                            border: isDark 
                                ? (isDownloadHovered ? '1px solid rgba(255, 255, 255, 0.16)' : '1px solid rgba(255, 255, 255, 0.08)') 
                                : (isDownloadHovered ? '1px solid rgba(0, 0, 0, 0.14)' : '1px solid rgba(0, 0, 0, 0.08)'),
                            borderRight: 'none',
                            color: isDark ? '#ffffff' : '#18181b',
                            fontSize: 13.5,
                            fontWeight: 500,
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6
                        }}
                    >
                        Download
                    </button>

                    {/* Secondary dropdown trigger for opening with specific apps */}
                    <button
                        onClick={() => setShowDropdown(prev => !prev)}
                        onMouseEnter={() => setIsArrowHovered(true)}
                        onMouseLeave={() => setIsArrowHovered(false)}
                        style={{
                            height: 36,
                            padding: '0 7px',
                            borderRadius: '0 9px 9px 0',
                            backgroundColor: isDark 
                                ? (isArrowHovered ? '#2c2c2c' : '#222222') 
                                : (isArrowHovered ? '#e4e4e7' : '#f4f4f5'),
                            border: isDark 
                                ? (isArrowHovered ? '1px solid rgba(255, 255, 255, 0.16)' : '1px solid rgba(255, 255, 255, 0.08)') 
                                : (isArrowHovered ? '1px solid rgba(0, 0, 0, 0.14)' : '1px solid rgba(0, 0, 0, 0.08)'),
                            borderLeft: isDark ? '1px solid rgba(255, 255, 255, 0.06)' : '1px solid rgba(0, 0, 0, 0.06)',
                            color: isDark 
                                ? (isArrowHovered ? 'rgba(255, 255, 255, 0.95)' : 'rgba(255, 255, 255, 0.6)') 
                                : (isArrowHovered ? '#18181b' : '#71717a'),
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease'
                        }}
                    >
                        <svg
                            width="11"
                            height="11"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            style={{
                                transform: showDropdown ? 'rotate(180deg)' : 'none',
                                transition: 'transform 0.18s ease'
                            }}
                        >
                            <polyline points="6 9 12 15 18 9" />
                        </svg>
                    </button>
                </div>

                {/* Dropdown Menu */}
                <AnimatePresence>
                    {showDropdown && (
                        <motion.div
                            initial={{ opacity: 0, y: 6, scale: 0.96 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 6, scale: 0.96 }}
                            transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                            style={{
                                position: 'absolute',
                                bottom: 'calc(100% + 6px)',
                                right: 0,
                                zIndex: 100,
                                backgroundColor: isDark ? '#1a1a1a' : '#ffffff',
                                border: isDark ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid rgba(0, 0, 0, 0.08)',
                                borderRadius: 12,
                                boxShadow: isDark ? '0 12px 32px rgba(0,0,0,0.6)' : '0 12px 32px rgba(0,0,0,0.12)',
                                minWidth: 200,
                                overflow: 'hidden',
                                padding: '4px 0',
                                boxSizing: 'border-box'
                            }}
                        >
                            <div
                                style={{
                                    padding: '6px 12px 4px',
                                    fontSize: 10,
                                    fontWeight: 700,
                                    color: isDark ? 'rgba(255, 255, 255, 0.4)' : '#8a8886',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.05em'
                                }}
                            >
                                Open with
                            </div>

                            {appsLoading ? (
                                <div style={{ padding: '8px 12px', fontSize: 12, color: isDark ? 'rgba(255,255,255,0.4)' : '#8a8886' }}>
                                    Detecting apps...
                                </div>
                            ) : apps.length === 0 ? (
                                <button
                                    onClick={() => handleOpenWithApp()}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        width: '100%',
                                        padding: '8px 12px',
                                        background: 'transparent',
                                        border: 'none',
                                        cursor: 'pointer',
                                        fontSize: 12,
                                        color: isDark ? '#ffffff' : '#111111',
                                        textAlign: 'left',
                                        fontWeight: 500
                                    }}
                                    onMouseEnter={e => {
                                        e.currentTarget.style.backgroundColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
                                    }}
                                    onMouseLeave={e => {
                                        e.currentTarget.style.backgroundColor = 'transparent';
                                    }}
                                >
                                    Default Application
                                </button>
                            ) : (
                                <>
                                    {apps.map(app => (
                                        <button
                                            key={app.path}
                                            onClick={() => handleOpenWithApp(app.path)}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 8,
                                                width: '100%',
                                                padding: '8px 12px',
                                                background: 'transparent',
                                                border: 'none',
                                                cursor: 'pointer',
                                                fontSize: 12,
                                                color: isDark ? '#ffffff' : '#111111',
                                                textAlign: 'left',
                                                transition: 'background 0.1s'
                                            }}
                                            onMouseEnter={e => {
                                                e.currentTarget.style.backgroundColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
                                            }}
                                            onMouseLeave={e => {
                                                e.currentTarget.style.backgroundColor = 'transparent';
                                            }}
                                        >
                                            {app.icon ? (
                                                <img src={app.icon} alt="" width={16} height={16} style={{ borderRadius: 3, flexShrink: 0 }} />
                                            ) : (
                                                <div
                                                    style={{
                                                        width: 16,
                                                        height: 16,
                                                        borderRadius: 3,
                                                        backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
                                                        flexShrink: 0
                                                    }}
                                                />
                                            )}
                                            <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {app.name}
                                            </span>
                                        </button>
                                    ))}
                                    <button
                                        onClick={() => handleOpenWithApp()}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            width: '100%',
                                            padding: '8px 12px',
                                            background: 'transparent',
                                            border: 'none',
                                            cursor: 'pointer',
                                            fontSize: 12,
                                            color: isDark ? 'rgba(255, 255, 255, 0.65)' : '#555555',
                                            textAlign: 'left',
                                            fontWeight: 500
                                        }}
                                        onMouseEnter={e => {
                                            e.currentTarget.style.backgroundColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
                                        }}
                                        onMouseLeave={e => {
                                            e.currentTarget.style.backgroundColor = 'transparent';
                                        }}
                                    >
                                        Default Application
                                    </button>
                                </>
                            )}

                            <div
                                style={{
                                    height: 1,
                                    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)',
                                    margin: '4px 0'
                                }}
                            />

                            {/* Open in Google Drive */}
                            <button
                                onClick={handleDriveClick}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 8,
                                    width: '100%',
                                    padding: '8px 12px',
                                    background: 'transparent',
                                    border: 'none',
                                    cursor: 'pointer',
                                    fontSize: 12,
                                    color: isDark ? 'rgba(255, 255, 255, 0.85)' : '#333333',
                                    textAlign: 'left',
                                    fontWeight: 500
                                }}
                                onMouseEnter={e => {
                                    e.currentTarget.style.backgroundColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
                                }}
                                onMouseLeave={e => {
                                    e.currentTarget.style.backgroundColor = 'transparent';
                                }}
                            >
                                <svg width="14" height="14" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg">
                                    <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da" />
                                    <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44c-.8 1.4-1.2 2.95-1.2 4.5h27.5z" fill="#00ac47" />
                                    <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335" />
                                    <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d" />
                                    <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc" />
                                    <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00" />
                                </svg>
                                Save to Google Drive
                            </button>

                            {/* Show in folder */}
                            <button
                                onClick={handleShowInFolder}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 8,
                                    width: '100%',
                                    padding: '8px 12px',
                                    background: 'transparent',
                                    border: 'none',
                                    cursor: 'pointer',
                                    fontSize: 12,
                                    color: isDark ? 'rgba(255, 255, 255, 0.7)' : '#555555',
                                    textAlign: 'left',
                                    fontWeight: 500
                                }}
                                onMouseEnter={e => {
                                    e.currentTarget.style.backgroundColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
                                }}
                                onMouseLeave={e => {
                                    e.currentTarget.style.backgroundColor = 'transparent';
                                }}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                                </svg>
                                Show in Folder
                            </button>

                            {/* Copy file path */}
                            <button
                                onClick={handleCopyPath}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 8,
                                    width: '100%',
                                    padding: '8px 12px',
                                    background: 'transparent',
                                    border: 'none',
                                    cursor: 'pointer',
                                    fontSize: 12,
                                    color: isDark ? 'rgba(255, 255, 255, 0.7)' : '#555555',
                                    textAlign: 'left',
                                    fontWeight: 500
                                }}
                                onMouseEnter={e => {
                                    e.currentTarget.style.backgroundColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
                                }}
                                onMouseLeave={e => {
                                    e.currentTarget.style.backgroundColor = 'transparent';
                                }}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                </svg>
                                Copy File Path
                            </button>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </motion.div>
    );
}
