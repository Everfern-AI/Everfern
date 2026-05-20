import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { EyeIcon } from '@heroicons/react/24/outline';
import FileIcon from './FileIcon';

interface FileArtifactProps {
    path: string;
    description: string;
    chatId: string;
    onOpenArtifact?: (name: string) => void;
}

export default function FileArtifact({ path, description, chatId, onOpenArtifact }: FileArtifactProps) {
    const [isHovered, setIsHovered] = useState(false);

    const filename = path.split(/[\\/]/).pop() || 'Unknown File';
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const nameWithoutExt = filename.split('.')[0];

    const getFileType = (extension: string) => {
        if (['js', 'ts', 'jsx', 'tsx', 'html', 'css', 'py', 'json', 'c', 'cpp', 'go', 'rs'].includes(extension)) {
            return 'Code';
        } else if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(extension)) {
            return 'Image';
        } else if (extension === 'pdf') {
            return 'PDF';
        }
        return 'Text';
    };

    const fileType = getFileType(ext);
    const fileSize = '7.58 KB'; // In a real app, this would come from file stats

    const handleClick = () => {
        if (onOpenArtifact) {
            onOpenArtifact(filename);
        }
    };

    return (
        <motion.div
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ y: -2 }}
            style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                padding: '16px 20px',
                backgroundColor: '#ffffff',
                border: '1px solid #e8e6d9',
                borderRadius: 12,
                cursor: 'pointer',
                boxShadow: isHovered ? '0 8px 24px rgba(0,0,0,0.08)' : '0 2px 8px rgba(0,0,0,0.03)',
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                gap: 12,
                position: 'relative',
                width: '100%',
                maxWidth: '480px'
            }}
        >
            {/* File Icon */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <FileIcon type={fileType} fileName={filename} size="md" />
            </div>

            {/* File Info - Center */}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#111', letterSpacing: '-0.01em' }}>
                    {nameWithoutExt}
                </div>
                <div style={{ fontSize: 12, color: '#8a8886', fontWeight: 500 }}>
                    {fileType} · {fileSize}
                </div>
            </div>

            {/* Eye Icon Button - Right */}
            <motion.button
                onClick={(e) => {
                    e.stopPropagation();
                    handleClick();
                }}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    border: '1px solid #e8e6d9',
                    backgroundColor: isHovered ? '#f9f8f4' : '#ffffff',
                    color: '#0891b2',
                    cursor: 'pointer',
                    padding: 0,
                    transition: 'all 0.2s ease',
                    flexShrink: 0
                }}
            >
                <EyeIcon width={16} height={16} />
            </motion.button>
        </motion.div>
    );
}
