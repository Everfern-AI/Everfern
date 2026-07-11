import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface FileArtifactProps {
    path: string;
    description: string;
    chatId: string;
    onOpenArtifact?: (name: string) => void;
}

export default function FileArtifact({ path, description, chatId, onOpenArtifact }: FileArtifactProps) {
    const [isHovered, setIsHovered] = useState(false);
    const [apps, setApps] = useState<Array<{ name: string; path: string; icon: string }>>([]);
    const [appsLoading, setAppsLoading] = useState(false);
    const [showDropdown, setShowDropdown] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const filename = path.split(/[\\/]/).pop() || 'Unknown File';
    const ext = filename.split('.').pop()?.toLowerCase() || '';

    const getFileTypeInfo = (extension: string) => {
        if (['xlsx', 'xls', 'csv'].includes(extension)) {
            return {
                label: 'Spreadsheet',
                color: '#107c41',
                bgColor: 'rgba(16, 124, 65, 0.08)',
                icon: (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="3" y="3" width="18" height="18" rx="4" fill="#107C41" />
                        <path d="M8 8h3v3H8V8zm0 5h3v3H8v-3zm5-5h3v3h-3V8zm0 5h3v3h-3v-3z" fill="white" />
                        <path d="M6 6h12v12H6V6zm1-1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H7z" fill="#0c5e31" opacity="0.3" />
                    </svg>
                )
            };
        }
        if (['docx', 'doc'].includes(extension)) {
            return {
                label: 'Document',
                color: '#2b579a',
                bgColor: 'rgba(43, 87, 154, 0.08)',
                icon: (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="3" y="3" width="18" height="18" rx="4" fill="#2B579A" />
                        <path d="M7 8h10M7 12h10M7 16h6" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
                    </svg>
                )
            };
        }
        if (extension === 'pdf') {
            return {
                label: 'PDF Document',
                color: '#d9381e',
                bgColor: 'rgba(217, 56, 30, 0.08)',
                icon: (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="3" y="3" width="18" height="18" rx="4" fill="#D9381E" />
                        <path d="M9 16V8h3a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H9zm1.5-1.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-1v2z" fill="white" />
                    </svg>
                )
            };
        }
        if (['js', 'ts', 'jsx', 'tsx', 'html', 'css', 'py', 'json', 'c', 'cpp', 'go', 'rs', 'sh', 'bat', 'ps1'].includes(extension)) {
            return {
                label: 'Code',
                color: '#007acc',
                bgColor: 'rgba(0, 122, 204, 0.08)',
                icon: (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="3" y="3" width="18" height="18" rx="4" fill="#007ACC" />
                        <path d="M8 9.5L5.5 12 8 14.5M16 9.5L18.5 12 16 14.5M13 7l-2 10" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                )
            };
        }
        if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'avif'].includes(extension)) {
            return {
                label: 'Image',
                color: '#e28743',
                bgColor: 'rgba(226, 135, 67, 0.08)',
                icon: (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="3" y="3" width="18" height="18" rx="4" fill="#E28743" />
                        <circle cx="8.5" cy="8.5" r="1.5" fill="white" />
                        <path d="M5 19l4-4 3 3 5-7 3 3v4H5z" fill="white" />
                    </svg>
                )
            };
        }
        return {
            label: 'File',
            color: '#71717a',
            bgColor: 'rgba(113, 113, 122, 0.08)',
            icon: (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="3" y="3" width="18" height="18" rx="4" fill="#71717A" />
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" fill="#71717A" />
                    <path d="M14 2v6h6" fill="#52525b" opacity="0.5" />
                </svg>
            )
        };
    };

    const fileTypeInfo = getFileTypeInfo(ext);

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
            .catch((err: any) => {
                console.error("Error fetching file apps in FileArtifact:", err);
                if (isMounted) setAppsLoading(false);
            });

        return () => {
            isMounted = false;
        };
    }, [path]);

    useEffect(() => {
        const handleOutsideClick = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setShowDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleOutsideClick);
        return () => document.removeEventListener('mousedown', handleOutsideClick);
    }, []);

    const handleClick = () => {
        if (onOpenArtifact) {
            onOpenArtifact(filename);
        }
    };

    const handleOpenWithApp = async (appPath?: string) => {
        setShowDropdown(false);
        try {
            await (window as any).electronAPI?.system?.openFile?.(path, appPath);
        } catch (err) {
            console.error("Failed to open file:", err);
        }
    };

    return (
        <div
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onClick={handleClick}
            style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                padding: '12px 20px',
                backgroundColor: 'var(--color-bg-surface, #ffffff)',
                border: '1px solid var(--color-border, rgba(0, 0, 0, 0.08))',
                borderRadius: 20,
                cursor: 'pointer',
                boxShadow: isHovered ? '0 10px 25px rgba(0,0,0,0.06)' : '0 2px 8px rgba(0,0,0,0.02)',
                transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                gap: 16,
                position: 'relative',
                width: '100%',
                maxWidth: '680px',
                boxSizing: 'border-box',
                marginTop: 8,
                marginBottom: 8,
            }}
        >
            {/* File Icon Container */}
            <div style={{
                width: 42,
                height: 42,
                borderRadius: 10,
                backgroundColor: fileTypeInfo.bgColor,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
            }}>
                {fileTypeInfo.icon}
            </div>

            {/* File Info */}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{
                    fontSize: 14.5,
                    fontWeight: 600,
                    color: 'var(--color-text-primary, #111111)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                }}>
                    {filename}
                </div>
                <div style={{
                    fontSize: 12,
                    color: 'var(--color-text-tertiary, #8a8886)',
                    fontWeight: 500
                }}>
                    {fileTypeInfo.label} · {ext.toUpperCase()}
                </div>
            </div>

            {/* Split Button Container */}
            <div
                style={{
                    position: 'relative',
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                    borderRadius: 10,
                    border: '1px solid var(--color-border, rgba(0, 0, 0, 0.12))',
                    overflow: 'hidden',
                    height: 34,
                }}
                ref={dropdownRef}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Left Part: Open Action */}
                <button
                    onClick={handleClick}
                    style={{
                        padding: '0 14px',
                        height: '100%',
                        backgroundColor: 'var(--color-bg-surface, #ffffff)',
                        color: 'var(--color-text-primary, #111111)',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: 13,
                        fontWeight: 600,
                        transition: 'background-color 0.15s ease',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--color-bg-hover, rgba(0,0,0,0.03))'; }}
                    onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'var(--color-bg-surface, #ffffff)'; }}
                >
                    Open
                </button>

                {/* Vertical Divider */}
                <div style={{
                    width: 1,
                    height: '100%',
                    backgroundColor: 'var(--color-border, rgba(0, 0, 0, 0.12))',
                }} />

                {/* Right Part: Dropdown Arrow */}
                <button
                    onClick={() => setShowDropdown(prev => !prev)}
                    style={{
                        padding: '0 10px',
                        height: '100%',
                        backgroundColor: 'var(--color-bg-surface, #ffffff)',
                        color: 'var(--color-text-secondary, #555555)',
                        border: 'none',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'background-color 0.15s ease',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--color-bg-hover, rgba(0,0,0,0.03))'; }}
                    onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'var(--color-bg-surface, #ffffff)'; }}
                >
                    <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{
                            transform: showDropdown ? 'rotate(180deg)' : 'none',
                            transition: 'transform 0.2s ease',
                        }}
                    >
                        <polyline points="6 9 12 15 18 9" />
                    </svg>
                </button>

                {/* Dropdown Menu */}
                <AnimatePresence>
                    {showDropdown && (
                        <motion.div
                            initial={{ opacity: 0, y: 6, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 6, scale: 0.95 }}
                            transition={{ type: 'spring', stiffness: 350, damping: 25 }}
                            style={{
                                position: 'absolute',
                                bottom: 'calc(100% + 6px)',
                                right: 0,
                                zIndex: 99,
                                backgroundColor: 'var(--color-bg-surface, #ffffff)',
                                border: '1px solid var(--color-border, rgba(0, 0, 0, 0.08))',
                                borderRadius: 12,
                                boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                                minWidth: 180,
                                overflow: 'hidden',
                                padding: '4px 0',
                                boxSizing: 'border-box'
                            }}
                        >
                            <div style={{ padding: '6px 12px 4px', fontSize: 10, fontWeight: 700, color: 'var(--color-text-tertiary, #8a8886)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                Open in
                            </div>

                            {appsLoading ? (
                                <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--color-text-tertiary, #8a8886)' }}>Detecting apps...</div>
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
                                        color: 'var(--color-text-primary, #111111)',
                                        textAlign: 'left',
                                        fontWeight: 500
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--color-bg-hover, rgba(0,0,0,0.03))'; }}
                                    onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
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
                                                color: 'var(--color-text-primary, #111111)',
                                                textAlign: 'left',
                                                transition: 'background 0.1s'
                                            }}
                                            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--color-bg-hover, rgba(0,0,0,0.03))'; }}
                                            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                                        >
                                            {app.icon ? (
                                                <img src={app.icon} alt="" width={16} height={16} style={{ borderRadius: 3, flexShrink: 0 }} />
                                            ) : (
                                                <div style={{ width: 16, height: 16, borderRadius: 3, backgroundColor: 'var(--color-bg-hover, rgba(0,0,0,0.05))', flexShrink: 0 }} />
                                            )}
                                            <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{app.name}</span>
                                        </button>
                                    ))}
                                    <div style={{ height: 1, backgroundColor: 'var(--color-border, rgba(0, 0, 0, 0.08))', margin: '4px 0' }} />
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
                                            color: 'var(--color-text-secondary, #555555)',
                                            textAlign: 'left',
                                            fontWeight: 500
                                        }}
                                        onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--color-bg-hover, rgba(0,0,0,0.03))'; }}
                                        onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                                    >
                                        Default Application
                                    </button>
                                </>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}
