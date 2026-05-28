"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDownIcon, FolderIcon } from "@heroicons/react/24/outline";

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

const AntigravityIcon = () => (
    <div className="w-[18px] h-[18px] bg-[#111] rounded-[5px] flex items-center justify-center shadow-sm">
        <span className="text-white text-[10px] font-black font-sans leading-none" style={{ transform: 'translateY(-0.5px)' }}>V</span>
    </div>
);

const TiltedFileIcon = ({ extension }: { extension: string }) => {
    return (
        <div className="relative w-[120px] h-[100px] shrink-0 pointer-events-none select-none">
            {/* Card 1 — left (Background) */}
            <div className="absolute left-[-12px] top-[14px] w-[80px] h-[80px] bg-white border border-[#dcdad0] rounded-[10px] shadow-[0_2px_10px_rgba(0,0,0,0.04)] p-[12px_10px] flex flex-col gap-[4px] opacity-30 scale-90 -rotate-3 origin-left">
                <div className="w-[45%] h-[4px] bg-[#CCCAC4] rounded-[1px]" />
                <div className="w-[85%] h-[3px] bg-[#DEDAD5] rounded-[1px]" />
                <div className="w-[65%] h-[3px] bg-[#DEDAD5] rounded-[1px]" />
                <div className="w-[75%] h-[3px] bg-[#DEDAD5] rounded-[1px]" />
            </div>

            {/* Card 3 — right (Background) */}
            <div className="absolute left-[52px] top-[14px] w-[80px] h-[80px] bg-white border border-[#dcdad0] rounded-[10px] shadow-[0_2px_10px_rgba(0,0,0,0.04)] p-[12px_10px] flex flex-col gap-[4px] opacity-30 scale-90 rotate-3 origin-right">
                <div className="w-[45%] h-[4px] bg-[#CCCAC4] rounded-[1px]" />
                <div className="w-[85%] h-[3px] bg-[#DEDAD5] rounded-[1px]" />
                <div className="w-[65%] h-[3px] bg-[#DEDAD5] rounded-[1px]" />
                <div className="w-[75%] h-[3px] bg-[#DEDAD5] rounded-[1px]" />
            </div>

            {/* Card 2 — center (Main) */}
            <div className="absolute left-[20px] top-0 w-[84px] h-[94px] bg-white border border-[#dcdad0] rounded-[12px] shadow-[0_8px_24px_rgba(0,0,0,0.08)] p-[14px_12px] flex flex-col gap-[6px] z-10 transition-transform duration-300 group-hover:scale-105">
                <div className="w-[55%] h-[5px] bg-[#CCCAC4] rounded-[1.5px]" />
                <div className="w-[95%] h-[4px] bg-[#DEDAD5] rounded-[1.5px]" />
                <div className="w-[80%] h-[4px] bg-[#DEDAD5] rounded-[1.5px]" />
                <div className="w-[90%] h-[4px] bg-[#DEDAD5] rounded-[1.5px]" />
                <div className="w-[60%] h-[4px] bg-[#DEDAD5] rounded-[1.5px]" />
                <div className="w-[75%] h-[4px] bg-[#DEDAD5] rounded-[1.5px]" />
            </div>
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
  const [showDropdown, setShowDropdown] = useState(false);

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
        setShowDropdown(false);
      }}
      className={`group flex flex-row items-center p-[20px_32px] bg-[#F5F4F0] border border-[#E1E0DA] rounded-[24px] cursor-pointer transition-all duration-300 w-full max-w-[820px] gap-[24px] relative overflow-visible ${
          isHovered ? 'shadow-[0_16px_48px_rgba(0,0,0,0.08)] -translate-y-1' : 'shadow-[0_4px_12px_rgba(0,0,0,0.02)]'
      }`}
      onClick={(e) => {
          if (showDropdown) setShowDropdown(false);
          else onViewFile?.();
      }}
    >
      {/* Background Grid Accent */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none" 
           style={{ backgroundImage: 'linear-gradient(#000 1px, transparent 1px), linear-gradient(90deg, #000 1px, transparent 1px)', backgroundSize: '20px 20px' }} />

      {/* Tilted File Icon - Left */}
      <div className="relative flex-shrink-0">
          <TiltedFileIcon extension={ext} />
          
          {/* Status Dot */}
          {status === 'creating' && (
            <motion.div 
              animate={{ opacity: [0.4, 1, 0.4], scale: [1, 1.3, 1] }}
              transition={{ duration: 1.5, repeat: Infinity }}
              className="absolute top-0 left-4 w-3.5 h-3.5 bg-[#201e24] rounded-full border-[3px] border-[#F5F4F0] z-20 shadow-sm" 
            />
          )}
      </div>
      
      {/* Text Area - Center */}
      <div className="flex-1 min-w-0 flex flex-col gap-[2px] z-10">
          <div className="text-[20px] font-bold text-[#1a1a1a] tracking-tight truncate">
              {filename}
          </div>
          <div className="flex items-center gap-2">
              <span className="text-[11px] text-[#86847F] font-bold uppercase tracking-widest leading-none">
                  {fileDetails.subtitle}
              </span>
              <div className="w-1 h-1 bg-[#DEDAD5] rounded-full" />
              <span className="text-[13px] text-[#86847F] font-medium leading-none">
                  {(size / 1024).toFixed(1)} KB
              </span>
          </div>
      </div>

      {/* Action Button - Right */}
      <div className="relative flex flex-col items-end z-20">
        <div 
            className={`flex items-center border border-[#E1E0DA] rounded-[14px] h-[44px] transition-all duration-200 overflow-hidden shadow-sm hover:shadow-md ${
                showDropdown ? 'bg-white border-[#C8C6BC]' : 'bg-[#FFFFFF]/80 hover:bg-white'
            }`}
        >
            <div 
                onClick={(e) => {
                    e.stopPropagation();
                    onViewFile?.();
                }}
                className="flex items-center gap-[10px] pl-[14px] pr-[12px] h-full border-r border-[#E1E0DA] cursor-pointer hover:bg-black/[0.03] group/btn"
            >
                <AntigravityIcon />
                <div className="flex flex-col">
                    <span className="text-[12.5px] font-bold text-[#111] leading-tight">{appName}</span>
                    <span className="text-[9px] text-[#86847F] font-black uppercase tracking-tight leading-none">Default App</span>
                </div>
            </div>
            
            <div 
                onClick={(e) => {
                    e.stopPropagation();
                    setShowDropdown(!showDropdown);
                }}
                className={`flex items-center justify-center w-[38px] h-full transition-colors duration-200 ${
                    showDropdown ? 'bg-black/[0.05] text-[#111]' : 'text-[#86847F] hover:text-[#111] hover:bg-black/[0.03]'
                }`}
            >
                <ChevronDownIcon width={16} height={16} strokeWidth={3} className={`transition-transform duration-200 ${showDropdown ? 'rotate-180' : ''}`} />
            </div>
        </div>

        <AnimatePresence>
            {showDropdown && (
                <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className="absolute top-[calc(100%+8px)] right-0 w-[200px] bg-white border border-[#E1E0DA] rounded-[16px] shadow-[0_20px_60px_rgba(0,0,0,0.15)] z-[100] p-[6px] overflow-hidden"
                >
                    <DropdownItem 
                        icon={<AntigravityIcon />} 
                        label={`Open in ${appName}`} 
                        onClick={() => { onViewFile?.(); setShowDropdown(false); }} 
                    />
                    <DropdownItem 
                        icon={<FolderIcon width={18} height={18} className="text-[#86847F]" />} 
                        label="Show in Folder" 
                        onClick={() => { setShowDropdown(false); }} 
                    />
                    <div className="h-[1px] bg-[#F5F4F0] mx-2 my-1" />
                    <DropdownItem 
                        label="Copy Path" 
                        onClick={() => { setShowDropdown(false); }} 
                    />
                </motion.div>
            )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
};

const DropdownItem: React.FC<{ icon?: React.ReactNode, label: string, onClick: () => void }> = ({ icon, label, onClick }) => (
    <div 
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        className="flex items-center gap-[10px] p-[10px_12px] rounded-[10px] cursor-pointer transition-colors duration-150 text-[13px] font-bold text-[#111] hover:bg-[#F5F4F0]"
    >
        {icon}
        <span className="flex-1">{label}</span>
    </div>
);

export default SimpleFileNotification;
