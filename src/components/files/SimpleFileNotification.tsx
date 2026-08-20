"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { DocumentIcon } from "@heroicons/react/24/outline";


interface SimpleFileNotificationProps {
  filename: string;
  content: string;
  size: number;
  isNew: boolean;
  status: "creating" | "success" | "error";
  onViewFile?: () => void;
  onCopyContent?: () => void;
  onOpenInEditor?: () => void;
  appName?: string;
}

// Simple file icon matching Image 4 style
const SimpleFileIcon = ({ extension }: { extension: string }) => {
    const isCode = ['js', 'ts', 'jsx', 'tsx', 'html', 'css', 'py', 'json', 'c', 'cpp', 'go', 'rs'].includes(extension);
    const isImage = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(extension);
    const isPdf = extension === 'pdf';
    
    return (
        <div className="w-[48px] h-[60px] bg-[var(--color-bg-subtle)] border border-[var(--color-border)] rounded-[8px] flex items-center justify-center flex-shrink-0">
            {isCode ? (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" strokeWidth="2">
                    <polyline points="16 18 22 12 16 6"></polyline>
                    <polyline points="8 6 2 12 8 18"></polyline>
                </svg>
            ) : isImage ? (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                    <circle cx="8.5" cy="8.5" r="1.5"></circle>
                    <polyline points="21 15 16 10 5 21"></polyline>
                </svg>
            ) : isPdf ? (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <path d="M9 13v-2h6v2"></path>
                    <path d="M9 17h6"></path>
                </svg>
            ) : (
                <DocumentIcon width={24} height={24} className="text-[var(--color-text-tertiary)]" />
            )}
        </div>
    );
};

export const SimpleFileNotification: React.FC<SimpleFileNotificationProps> = ({
  filename,
  content,
  size,
  isNew,
  status,
  onViewFile,
  onCopyContent,
  onOpenInEditor,
  appName = "View",
}) => {
  const [isHovered, setIsHovered] = useState(false);

  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  
  const getFileDetails = (extension: string) => {
    let subtitle = extension.toUpperCase();

    if (['js', 'ts', 'jsx', 'tsx', 'html', 'css', 'py', 'json', 'c', 'cpp', 'go', 'rs'].includes(extension)) {
        subtitle = `Code · ${extension.toUpperCase()}`;
    } else if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(extension)) {
        subtitle = 'Image';
    }

    return { subtitle };
  };

  const fileDetails = getFileDetails(ext);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false);
      }}
      className={`group flex flex-row items-center p-[20px_32px] bg-[var(--color-bg-base)] border border-[var(--color-border)] rounded-[24px] cursor-pointer transition-all duration-300 w-full max-w-[820px] gap-[24px] relative overflow-visible ${
          isHovered ? 'shadow-[0_16px_48px_rgba(0,0,0,0.08)] -translate-y-1' : 'shadow-[0_4px_12px_rgba(0,0,0,0.02)]'
      }`}
      onClick={() => {
          onViewFile?.();
      }}
    >
      {/* Background Grid Accent */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none" 
           style={{ backgroundImage: 'linear-gradient(#000 1px, transparent 1px), linear-gradient(90deg, #000 1px, transparent 1px)', backgroundSize: '20px 20px' }} />

      {/* Simple File Icon - Left */}
      <div className="relative flex-shrink-0">
          <SimpleFileIcon extension={ext} />
          
          {/* Status Dot */}
          {status === 'creating' && (
            <motion.div 
              animate={{ opacity: [0.4, 1, 0.4], scale: [1, 1.3, 1] }}
              transition={{ duration: 1.5, repeat: Infinity }}
              className="absolute -top-1 -right-1 w-3 h-3 bg-[var(--color-accent)] rounded-full border-2 border-[var(--color-bg-base)] z-20" 
            />
          )}
      </div>
      
      {/* Text Area - Center */}
      <div className="flex-1 min-w-0 flex flex-col gap-[2px] z-10">
          <div className="text-[20px] font-bold text-[var(--color-text-primary)] tracking-tight truncate">
              {filename}
          </div>
          <div className="flex items-center gap-2">
              <span className="text-[11px] text-[var(--color-text-secondary)] font-bold uppercase tracking-widest leading-none">
                  {fileDetails.subtitle}
              </span>
              <div className="w-1 h-1 bg-[var(--color-border)] rounded-full" />
              <span className="text-[13px] text-[var(--color-text-secondary)] font-medium leading-none">
                  {(size / 1024).toFixed(1)} KB
              </span>
          </div>
      </div>

      {/* Action Button - Right */}
      <div className="relative flex flex-col items-end z-20">
        <button
            onClick={(e) => {
                e.stopPropagation();
                onViewFile?.();
            }}
            className="flex items-center gap-2 px-5 h-[40px] bg-[var(--color-bg-surface)] hover:bg-[var(--color-bg-hover)] border border-[var(--color-border)] rounded-[10px] text-[var(--color-text-primary)] font-medium text-[14px] transition-all duration-200 shadow-sm hover:shadow-md"
        >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            Download
        </button>
      </div>
    </motion.div>
  );
};

export default SimpleFileNotification;
