'use client';
import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { 
    WindowIcon, 
    ArrowTopRightOnSquareIcon, 
    FolderIcon,
    ChevronUpIcon,
    ChevronDownIcon
} from '@heroicons/react/24/outline';

interface SitePreviewProps {
    chatId: string;
    filename: string;
    onOpenFolder?: () => void;
}

export default function SitePreview({ chatId, filename, onOpenFolder }: SitePreviewProps) {
    const [isExpanded, setIsExpanded] = useState(true);
    const siteUrl = `everfern-site://${chatId}/${filename}`;

    const handleOpenInBrowser = () => {
        // Since it's a file, we can just open it with system default
        (window as any).electronAPI.sites.openFolder(chatId);
    };

    return (
        <div style={{ 
            marginTop: 16, 
            marginBottom: 8, 
            borderRadius: 16, 
            overflow: "hidden", 
            border: "1px solid rgba(255, 255, 255, 0.08)",
            backgroundColor: "rgba(25, 24, 23, 0.5)",
            backdropFilter: "blur(12px)"
        }}>
            {/* Header */}
            <div style={{ 
                padding: "10px 16px", 
                backgroundColor: "rgba(255, 255, 255, 0.03)", 
                borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
                display: "flex", 
                alignItems: "center", 
                justifyContent: "space-between" 
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ 
                        width: 28, height: 28, borderRadius: 8, 
                        background: "linear-gradient(135deg, rgba(74, 222, 128, 0.15), rgba(34, 197, 94, 0.1))",
                        border: "1px solid rgba(74, 222, 128, 0.3)",
                        display: "flex", alignItems: "center", justifyContent: "center"
                    }}>
                        <WindowIcon width={16} height={16} color="#4ade80" />
                    </div>
                    <div>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "#e8e5e3", display: "block" }}>Report: {filename}</span>
                        <span style={{ fontSize: 10, color: "#a1a1aa", }}>Interactive Local Site</span>
                    </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button 
                        onClick={() => (window as any).electronAPI.sites.openFolder(chatId)}
                        title="Open Source Folder"
                        style={{ background: "transparent", border: "none", color: "#a5a3a0", cursor: "pointer", padding: 6, borderRadius: 6 }}
                        onMouseEnter={e => e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.05)"}
                        onMouseLeave={e => e.currentTarget.style.backgroundColor = "transparent"}
                    >
                        <FolderIcon width={18} height={18} />
                    </button>
                    <button 
                        onClick={() => setIsExpanded(!isExpanded)}
                        style={{ background: "transparent", border: "none", color: "#a5a3a0", cursor: "pointer", padding: 6, borderRadius: 6 }}
                        onMouseEnter={e => e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.05)"}
                        onMouseLeave={e => e.currentTarget.style.backgroundColor = "transparent"}
                    >
                        {isExpanded ? <ChevronUpIcon width={18} height={18} /> : <ChevronDownIcon width={18} height={18} />}
                    </button>
                </div>
            </div>

            {/* Preview Frame */}
            {isExpanded && (
                <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 400, opacity: 1 }}
                    style={{ position: "relative", backgroundColor: "#fff", height: 400 }}
                >
                    <iframe 
                        src={siteUrl} 
                        style={{ 
                            width: "100%", 
                            height: "100%", 
                            border: "none", 
                            backgroundColor: "white" 
                        }}
                        sandbox="allow-scripts allow-forms allow-same-origin"
                    />
                </motion.div>
            )}
            
            {/* Status Bar */}
            <div style={{ 
                padding: "8px 16px", 
                backgroundColor: "rgba(255, 255, 255, 0.02)", 
                display: "flex", 
                alignItems: "center", 
                gap: 8,
                fontSize: 11,
                color: "#71717a"
            }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: "#4ade80" }} />
                Successfully rendered from local sandbox
            </div>
        </div>
    );
}
