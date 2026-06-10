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
    const nameWithoutExt = filename.substring(0, filename.lastIndexOf('.')) || filename;

    const getFileTypeLabel = (extension: string) => {
        if (['js', 'ts', 'jsx', 'tsx', 'html', 'css', 'py', 'json', 'c', 'cpp', 'go', 'rs', 'sh', 'bat', 'ps1'].includes(extension)) {
            return 'Code';
        }
        if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'avif'].includes(extension)) {
            return 'Image';
        }
        if (extension === 'pdf') {
            return 'PDF';
        }
        if (['xlsx', 'xls', 'csv'].includes(extension)) {
            return 'Spreadsheet';
        }
        if (['pptx', 'ppt'].includes(extension)) {
            return 'Presentation';
        }
        if (['doc', 'docx', 'rtf'].includes(extension)) {
            return 'Document';
        }
        return 'File';
    };

    const getSymbol = (extension: string) => {
        if (['html', 'js', 'ts', 'jsx', 'tsx', 'py', 'json', 'css', 'go', 'rs', 'cpp', 'c', 'sh'].includes(extension)) {
            return '</>';
        }
        if (['xlsx', 'xls', 'csv'].includes(extension)) {
            return '田';
        }
        if (['pptx', 'ppt'].includes(extension)) {
            return '■';
        }
        return '≡';
    };

    const fileType = getFileTypeLabel(ext);

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
                padding: '12px 18px',
                backgroundColor: isHovered ? '#f9f8f4' : '#ffffff',
                border: isHovered ? '1px solid #d3d2c7' : '1px solid #e8e6d9',
                borderRadius: 12,
                cursor: 'pointer',
                boxShadow: isHovered ? '0 4px 16px rgba(0,0,0,0.06)' : '0 1px 4px rgba(0,0,0,0.02)',
                transition: 'all 0.2s ease',
                gap: 16,
                position: 'relative',
                width: '100%',
                maxWidth: '580px',
                boxSizing: 'border-box'
            }}
        >
            {/* Tilted Document Icon Container */}
            <div style={{
                width: 44,
                height: 44,
                borderRadius: 8,
                backgroundColor: 'rgba(0, 0, 0, 0.02)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                overflow: 'visible',
                flexShrink: 0
            }}>
                <div style={{
                    width: 22,
                    height: 30,
                    borderRadius: 4,
                    border: '1.5px solid #8a8886',
                    backgroundColor: '#ffffff',
                    transform: 'rotate(-8deg)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                    position: 'relative'
                }}>
                    <span style={{
                        fontSize: 9,
                        fontWeight: 700,
                        color: '#717170',
                        fontFamily: 'monospace',
                        transform: 'rotate(8deg)'
                    }}>
                        {getSymbol(ext)}
                    </span>
                </div>
            </div>

            {/* File Info */}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#111111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {nameWithoutExt}
                </div>
                <div style={{ fontSize: 12, color: '#8a8886', fontWeight: 500 }}>
                    {fileType} · {ext.toUpperCase()}
                </div>
            </div>

            {/* Open Action Button Container */}
            <div style={{ position: 'relative' }} ref={dropdownRef}>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        setShowDropdown(prev => !prev);
                    }}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '6px 16px',
                        borderRadius: 8,
                        border: '1px solid #d3d3d0',
                        backgroundColor: '#ffffff',
                        color: '#111111',
                        cursor: 'pointer',
                        fontSize: 13,
                        fontWeight: 600,
                        transition: 'all 0.15s ease',
                        boxSizing: 'border-box'
                    }}
                    onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#f4f4f2'; }}
                    onMouseLeave={e => { e.currentTarget.style.backgroundColor = '#ffffff'; }}
                >
                    Open
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
                                backgroundColor: '#ffffff',
                                border: '1px solid #e8e6d9',
                                borderRadius: 12,
                                boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                                minWidth: 200,
                                overflow: 'hidden',
                                padding: '4px 0',
                                boxSizing: 'border-box'
                            }}
                        >
                            <div style={{ padding: '6px 12px 4px', fontSize: 10, fontWeight: 700, color: '#8a8886', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                Open in
                            </div>

                            {appsLoading ? (
                                <div style={{ padding: '8px 12px', fontSize: 12, color: '#8a8886' }}>Detecting apps...</div>
                            ) : apps.length === 0 ? (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleOpenWithApp();
                                    }}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        width: '100%',
                                        padding: '8px 12px',
                                        background: 'transparent',
                                        border: 'none',
                                        cursor: 'pointer',
                                        fontSize: 12,
                                        color: '#111111',
                                        textAlign: 'left',
                                        fontWeight: 500
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.04)'; }}
                                    onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                                >
                                    Default Application
                                </button>
                            ) : (
                                <>
                                    {apps.map(app => (
                                        <button
                                            key={app.path}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleOpenWithApp(app.path);
                                            }}
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
                                                color: '#111111',
                                                textAlign: 'left',
                                                transition: 'background 0.1s'
                                            }}
                                            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.04)'; }}
                                            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                                        >
                                            {app.icon ? (
                                                <img src={app.icon} alt="" width={16} height={16} style={{ borderRadius: 3, flexShrink: 0 }} />
                                            ) : (
                                                <div style={{ width: 16, height: 16, borderRadius: 3, backgroundColor: '#e8e6d9', flexShrink: 0 }} />
                                            )}
                                            <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{app.name}</span>
                                        </button>
                                    ))}
                                    <div style={{ height: 1, backgroundColor: '#e8e6d9', margin: '4px 0' }} />
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleOpenWithApp();
                                        }}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            width: '100%',
                                            padding: '8px 12px',
                                            background: 'transparent',
                                            border: 'none',
                                            cursor: 'pointer',
                                            fontSize: 12,
                                            color: '#555555',
                                            textAlign: 'left',
                                            fontWeight: 500
                                        }}
                                        onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.04)'; }}
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
