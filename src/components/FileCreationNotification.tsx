"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDownIcon, FolderIcon } from "@heroicons/react/24/outline";

interface FileCreationNotificationProps {
    filename: string;
    content: string;
    size: number;
    isNew: boolean;
    status: 'creating' | 'success' | 'error';
    duration?: number;
    onViewFile?: () => void;
    onOpenInEditor?: () => void;
}

const AntigravityIcon = () => (
    <div className="w-[18px] h-[18px] bg-[#111] rounded-[4px] flex items-center justify-center">
        <span className="text-white text-[10px] font-[900] font-mono">V</span>
    </div>
);

const TiltedFileIcon = ({ extension }: { extension: string }) => {
    return (
        <div className="relative w-[60px] height-[70px] flex items-center justify-center shrink-0">
            {/* Tilted Card Background */}
            <div className="absolute w-[48px] h-[60px] bg-white border-[1.5px] border-[#e8e6d9] rounded-[8px] -rotate-[5deg] shadow-[0_4px_10px_rgba(0,0,0,0.04)] flex flex-col p-[10px_8px] gap-[5px]">
                <div className="w-[60%] h-[4px] bg-[#CCCAC4] rounded-[1px]" />
                <div className="w-[90%] h-[3px] bg-[#DEDAD5] rounded-[1px]" />
                <div className="w-[75%] h-[3px] bg-[#DEDAD5] rounded-[1px]" />
                <div className="w-[85%] h-[3px] bg-[#DEDAD5] rounded-[1px]" />
                <div className="w-[55%] h-[3px] bg-[#DEDAD5] rounded-[1px]" />
                <div className="w-[70%] h-[3px] bg-[#DEDAD5] rounded-[1px]" />
            </div>
        </div>
    );
};

export const FileCreationNotification: React.FC<FileCreationNotificationProps> = ({
    filename,
    content,
    size,
    isNew,
    status,
    duration,
    onViewFile,
    onOpenInEditor
}) => {
    const [isHovered, setIsHovered] = useState(false);
    const [isButtonHovered, setIsButtonHovered] = useState(false);
    const [showDropdown, setShowDropdown] = useState(false);

    const ext = filename.split('.').pop()?.toLowerCase() || '';
    
    const getFileDetails = (extension: string) => {
        let subtitle = extension.toUpperCase();

        if (['js', 'ts', 'jsx', 'tsx', 'html', 'css', 'py', 'json', 'c', 'cpp', 'go', 'rs'].includes(extension)) {
            if (extension === 'js') subtitle = 'JS';
            else if (extension === 'ts') subtitle = 'TS';
            else if (extension === 'json') subtitle = 'Code · JSON';
            else if (extension === 'html') subtitle = 'Code · HTML';
            else if (extension === 'css') subtitle = 'Style · CSS';
            else if (extension === 'py') subtitle = 'Script · Python';
            else subtitle = `Code · ${extension.toUpperCase()}`;
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
            onClick={onViewFile}
            className={`flex flex-row items-center p-[20px_28px] bg-white border border-[#e8e6d9] rounded-[20px] cursor-pointer transition-all duration-300 w-full max-w-[860px] gap-[20px] relative overflow-visible my-[8px] ${
                isHovered ? 'shadow-[0_10px_25px_rgba(0,0,0,0.05)]' : 'shadow-[0_2px_8px_rgba(0,0,0,0.01)]'
            }`}
        >
            {/* Tilted File Icon - Left */}
            <div className="relative w-[60px] h-[70px]">
                <TiltedFileIcon extension={ext} />
                
                {/* Status Indicator */}
                {status === 'creating' && (
                    <motion.div 
                        animate={{ opacity: [0.4, 1, 0.4] }}
                        transition={{ duration: 1.5, repeat: Infinity }}
                        className="absolute top-1 right-1 w-2 h-2 bg-blue-500 rounded-full border-[1.5px] border-white" 
                    />
                )}
            </div>
            
            {/* Text Area - Center */}
            <div className="flex-1 min-w-0 flex flex-col gap-[2px]">
                <div className="text-[16px] font-semibold text-[#111] tracking-[-0.01em]">
                    {filename}
                </div>
                <div className="text-[13px] text-[#8a8886] font-medium">
                    {fileDetails.subtitle}
                </div>
            </div>

            {/* Action Button - Right */}
            <div className="relative">
                <div 
                    onMouseEnter={() => setIsButtonHovered(true)}
                    onMouseLeave={() => setIsButtonHovered(false)}
                    className={`flex items-center border border-[#e8e6d9] rounded-[12px] h-[38px] transition-all duration-200 ${
                        isButtonHovered ? 'bg-[#f9f8f4]' : 'bg-white'
                    }`}
                >
                    <div 
                        onClick={(e) => {
                            e.stopPropagation();
                            onViewFile?.();
                        }}
                        className="flex items-center gap-[8px] px-[14px] h-full border-r border-[#e8e6d9] cursor-pointer"
                    >
                        <AntigravityIcon />
                        <span className="text-[13px] font-semibold text-[#111]">View</span>
                    </div>
                    
                    <div 
                        onClick={(e) => {
                            e.stopPropagation();
                            setShowDropdown(!showDropdown);
                        }}
                        className="flex items-center justify-center w-[34px] h-full text-[#8a8886] cursor-pointer"
                    >
                        <ChevronDownIcon width={14} height={14} />
                    </div>
                </div>

                <AnimatePresence>
                    {showDropdown && (
                        <motion.div
                            initial={{ opacity: 0, y: 8, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 8, scale: 0.95 }}
                            className="absolute top-[calc(100%+6px)] right-0 w-[170px] bg-white border border-[#e8e6d9] rounded-[12px] shadow-[0_10px_25px_rgba(0,0,0,0.1)] z-[100] p-[5px]"
                        >
                            <div 
                                onClick={(e) => { e.stopPropagation(); onViewFile?.(); setShowDropdown(false); }}
                                className="flex items-center gap-[10px] p-[8px_10px] rounded-[8px] cursor-pointer transition-colors duration-200 text-[13px] font-medium text-[#111] hover:bg-[#f5f4f0]"
                            >
                                <AntigravityIcon />
                                Open in View
                            </div>
                            <div 
                                onClick={(e) => { e.stopPropagation(); setShowDropdown(false); }}
                                className="flex items-center gap-[10px] p-[8px_10px] rounded-[8px] cursor-pointer transition-colors duration-200 text-[13px] font-medium text-[#111] hover:bg-[#f5f4f0]"
                            >
                                <FolderIcon width={16} height={16} className="text-[#8a8886]" />
                                Show in Folder
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </motion.div>
    );
};

export default FileCreationNotification;


