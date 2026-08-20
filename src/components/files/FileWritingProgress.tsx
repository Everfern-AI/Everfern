"use client";

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";

interface FileWritingProgressProps {
    filename: string;
    progress: number; // 0-100
    status: 'writing' | 'success' | 'error' | 'validating';
    currentStep?: string;
    estimatedSize?: number;
    writtenBytes?: number;
    onCancel?: () => void;
}

export const FileWritingProgress: React.FC<FileWritingProgressProps> = ({
    filename,
    progress,
    status,
    currentStep,
    estimatedSize,
    writtenBytes,
    onCancel
}) => {
    const [animatedProgress, setAnimatedProgress] = useState(0);

    useEffect(() => {
        const timer = setTimeout(() => {
            setAnimatedProgress(progress);
        }, 100);
        return () => clearTimeout(timer);
    }, [progress]);

    const getStatusIcon = () => {
        switch (status) {
            case 'writing':
                return (
                    <div className="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-600 animate-spin">
                            <path d="M21 12a9 9 0 11-6.219-8.56"/>
                        </svg>
                    </div>
                );
            case 'validating':
                return (
                    <div className="w-5 h-5 rounded-full bg-yellow-100 flex items-center justify-center">
                        <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" />
                    </div>
                );
            case 'success':
                return (
                    <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12"/>
                        </svg>
                    </div>
                );
            case 'error':
                return (
                    <div className="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </div>
                );
        }
    };

    const getStatusText = () => {
        switch (status) {
            case 'writing': return 'Writing file...';
            case 'validating': return 'Validating content...';
            case 'success': return 'File written successfully';
            case 'error': return 'Failed to write file';
        }
    };

    const getStatusColor = () => {
        switch (status) {
            case 'writing': return 'border-blue-200 bg-blue-50';
            case 'validating': return 'border-yellow-200 bg-yellow-50';
            case 'success': return 'border-green-200 bg-green-50';
            case 'error': return 'border-red-200 bg-red-50';
        }
    };

    const fileExtension = filename.split('.').pop()?.toUpperCase() || 'FILE';

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className={`rounded-xl border ${getStatusColor()} overflow-hidden`}
        >
            <div className="px-4 py-3">
                <div className="flex items-center gap-3">
                    {/* File Icon */}
                    <div className="w-8 h-8 rounded-md border border-gray-300 bg-white flex items-center justify-center text-[10px] font-bold text-gray-600 shrink-0 font-mono">
                        {fileExtension}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                        {/* Header */}
                        <div className="flex items-center gap-2">
                            {getStatusIcon()}
                            <span className="text-sm font-medium text-gray-900 truncate">
                                {filename}
                            </span>
                        </div>

                        {/* Status Text */}
                        <div className="text-sm text-gray-700 mt-0.5">
                            {getStatusText()}
                            {currentStep && (
                                <span className="text-gray-500 ml-1">• {currentStep}</span>
                            )}
                        </div>

                        {/* Progress Bar */}
                        {(status === 'writing' || status === 'validating') && (
                            <div className="mt-2">
                                <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                                    <span>Progress</span>
                                    <span>{Math.round(animatedProgress)}%</span>
                                </div>
                                <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                                    <motion.div
                                        className={`h-full rounded-full ${
                                            status === 'writing' ? 'bg-blue-500' : 'bg-yellow-500'
                                        }`}
                                        initial={{ width: 0 }}
                                        animate={{ width: `${animatedProgress}%` }}
                                        transition={{ duration: 0.5, ease: "easeOut" }}
                                    />
                                </div>
                            </div>
                        )}

                        {/* File Size Info */}
                        {(estimatedSize || writtenBytes) && (
                            <div className="flex items-center gap-4 text-xs text-gray-500 mt-1">
                                {writtenBytes && (
                                    <span>
                                        {(writtenBytes / 1024).toFixed(1)} KB written
                                    </span>
                                )}
                                {estimatedSize && (
                                    <span>
                                        of {(estimatedSize / 1024).toFixed(1)} KB estimated
                                    </span>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Cancel Button */}
                    {status === 'writing' && onCancel && (
                        <button
                            onClick={onCancel}
                            className="p-1.5 hover:bg-white/60 rounded-md transition-colors text-gray-400 hover:text-gray-600"
                            title="Cancel"
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18"/>
                                <line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                        </button>
                    )}
                </div>
            </div>
        </motion.div>
    );
};

export default FileWritingProgress;
