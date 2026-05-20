import React from 'react';

interface FileIconProps {
    type?: string;
    fileName?: string;
    size?: 'sm' | 'md' | 'lg';
}

export const DocumentIcon = ({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) => {
    const sizeMap = { sm: 16, md: 24, lg: 32 };
    const s = sizeMap[size];

    return (
        <svg
            width={s}
            height={s}
            viewBox="0 0 32 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
        >
            {/* Document background */}
            <defs>
                <linearGradient id="docGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#3B82F6" />
                    <stop offset="100%" stopColor="#2563EB" />
                </linearGradient>
            </defs>

            {/* Main document shape */}
            <path
                d="M8 2C6.89543 2 6 2.89543 6 4V28C6 29.1046 6.89543 30 8 30H24C25.1046 30 26 29.1046 26 28V10L18 2H8Z"
                fill="url(#docGradient)"
            />

            {/* Fold corner */}
            <path
                d="M18 2V10H26"
                fill="#1E40AF"
                opacity="0.3"
            />

            {/* Document lines (text representation) */}
            <line x1="10" y1="14" x2="22" y2="14" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="10" y1="19" x2="22" y2="19" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="10" y1="24" x2="18" y2="24" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
    );
};

export const CodeFileIcon = ({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) => {
    const sizeMap = { sm: 16, md: 24, lg: 32 };
    const s = sizeMap[size];

    return (
        <svg
            width={s}
            height={s}
            viewBox="0 0 32 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
        >
            <defs>
                <linearGradient id="codeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#8B5CF6" />
                    <stop offset="100%" stopColor="#7C3AED" />
                </linearGradient>
            </defs>

            <path
                d="M8 2C6.89543 2 6 2.89543 6 4V28C6 29.1046 6.89543 30 8 30H24C25.1046 30 26 29.1046 26 28V10L18 2H8Z"
                fill="url(#codeGradient)"
            />

            <path d="M18 2V10H26" fill="#6D28D9" opacity="0.3" />

            {/* Code brackets */}
            <path d="M12 16L10 18L12 20" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M20 16L22 18L20 20" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <line x1="15" y1="13" x2="17" y2="23" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
    );
};

export const ImageIcon = ({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) => {
    const sizeMap = { sm: 16, md: 24, lg: 32 };
    const s = sizeMap[size];

    return (
        <svg
            width={s}
            height={s}
            viewBox="0 0 32 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
        >
            <defs>
                <linearGradient id="imageGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#F59E0B" />
                    <stop offset="100%" stopColor="#D97706" />
                </linearGradient>
            </defs>

            <path
                d="M8 2C6.89543 2 6 2.89543 6 4V28C6 29.1046 6.89543 30 8 30H24C25.1046 30 26 29.1046 26 28V10L18 2H8Z"
                fill="url(#imageGradient)"
            />

            <path d="M18 2V10H26" fill="#B45309" opacity="0.3" />

            {/* Image symbol */}
            <circle cx="12" cy="16" r="2" fill="white" />
            <path d="M10 22L16 16L22 24" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
};

export const SpreadsheetIcon = ({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) => {
    const sizeMap = { sm: 16, md: 24, lg: 32 };
    const s = sizeMap[size];

    return (
        <svg
            width={s}
            height={s}
            viewBox="0 0 32 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
        >
            <defs>
                <linearGradient id="excelGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#10B981" />
                    <stop offset="100%" stopColor="#059669" />
                </linearGradient>
            </defs>
            <path d="M8 2C6.89543 2 6 2.89543 6 4V28C6 29.1046 6.89543 30 8 30H24C25.1046 30 26 29.1046 26 28V10L18 2H8Z" fill="url(#excelGradient)" />
            <path d="M18 2V10H26" fill="#047857" opacity="0.3" />
            
            {/* Grid symbol */}
            <rect x="10" y="14" width="12" height="10" stroke="white" strokeWidth="1.5" fill="none" rx="1" />
            <line x1="16" y1="14" x2="16" y2="24" stroke="white" strokeWidth="1.5" />
            <line x1="10" y1="19" x2="22" y2="19" stroke="white" strokeWidth="1.5" />
        </svg>
    );
};

export const PresentationIcon = ({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) => {
    const sizeMap = { sm: 16, md: 24, lg: 32 };
    const s = sizeMap[size];

    return (
        <svg
            width={s}
            height={s}
            viewBox="0 0 32 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
        >
            <defs>
                <linearGradient id="pptGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#F97316" />
                    <stop offset="100%" stopColor="#EA580C" />
                </linearGradient>
            </defs>
            <path d="M8 2C6.89543 2 6 2.89543 6 4V28C6 29.1046 6.89543 30 8 30H24C25.1046 30 26 29.1046 26 28V10L18 2H8Z" fill="url(#pptGradient)" />
            <path d="M18 2V10H26" fill="#C2410C" opacity="0.3" />
            
            {/* Presentation symbol */}
            <rect x="10" y="14" width="12" height="8" stroke="white" strokeWidth="1.5" fill="none" rx="1" />
            <line x1="13" y1="24" x2="19" y2="24" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="16" y1="22" x2="16" y2="24" stroke="white" strokeWidth="1.5" />
        </svg>
    );
};

export default function FileIcon({ type = 'text', fileName = '', size = 'md' }: FileIconProps) {
    const ext = (fileName.split('.').pop() || type).toLowerCase();

    if (['js', 'ts', 'jsx', 'tsx', 'py', 'json', 'html', 'css', 'go', 'rs', 'c', 'cpp', 'java', 'sh', 'bash'].includes(ext)) {
        return <CodeFileIcon size={size} />;
    }

    if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) {
        return <ImageIcon size={size} />;
    }

    if (['xlsx', 'xls', 'csv'].includes(ext)) {
        return <SpreadsheetIcon size={size} />;
    }

    if (['pptx', 'ppt'].includes(ext)) {
        return <PresentationIcon size={size} />;
    }

    return <DocumentIcon size={size} />;
}
