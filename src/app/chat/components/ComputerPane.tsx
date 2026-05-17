"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
    XMarkIcon, 
    GlobeAltIcon, 
    ArrowTopRightOnSquareIcon,
    ChevronLeftIcon,
    ChevronRightIcon,
    ArrowPathIcon,
    MagnifyingGlassIcon,
    CommandLineIcon,
    Squares2X2Icon,
    ClockIcon
} from '@heroicons/react/24/outline';

interface ComputerPaneProps {
    isOpen: boolean;
    onClose: () => void;
    data: {
        agentName?: string;
        url?: string;
        screenshot?: string;
        toolName?: string;
        results?: any[];
        query?: string;
        output?: string;
        args?: any;
    } | null;
}

export const ComputerPane = ({ isOpen, onClose, data }: ComputerPaneProps) => {
    const [viewMode, setViewMode] = useState<'browser' | 'search' | 'terminal'>('browser');

    React.useEffect(() => {
        if (data?.toolName?.includes('search')) setViewMode('search');
        else if (data?.toolName?.includes('bash') || data?.toolName?.includes('command')) setViewMode('terminal');
        else setViewMode('browser');
    }, [data]);

    if (!isOpen) return null;

    const displayUrl = data?.url || data?.args?.url || data?.args?.url_to_visit || "https://www.google.com";
    const agentLabel = data?.agentName || "Fern";

    return (
        <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ 
                width: isOpen ? "45%" : 0, 
                opacity: isOpen ? 1 : 0 
            }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="h-full border-l border-stone-200 bg-white flex flex-col overflow-hidden relative shadow-2xl z-20"
        >
            {/* Main Header */}
            <div className="flex items-center justify-between p-4 border-b border-stone-100 bg-white/80 backdrop-blur-md sticky top-0 z-30">
                <div className="flex items-center gap-2">
                    <Squares2X2Icon className="w-5 h-5 text-stone-900" />
                    <h2 className="text-[15px] font-bold text-stone-900 tracking-tight">Fern's Workspace</h2>
                </div>
                <button 
                    onClick={onClose}
                    className="p-1.5 rounded-full hover:bg-stone-100 transition-colors"
                >
                    <XMarkIcon className="w-5 h-5 text-stone-400" />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto flex flex-col bg-stone-50/30">
                {/* Agent Activity Status */}
                <div className="p-6 pb-2">
                    <div className="flex items-center gap-4 bg-white p-4 rounded-2xl border border-stone-100 shadow-sm">
                        <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center border border-blue-100">
                            {viewMode === 'search' ? (
                                <MagnifyingGlassIcon className="w-6 h-6 text-blue-500" />
                            ) : viewMode === 'terminal' ? (
                                <CommandLineIcon className="w-6 h-6 text-stone-700" />
                            ) : (
                                <GlobeAltIcon className="w-6 h-6 text-blue-500" />
                            )}
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="text-[14px] font-medium text-stone-800">
                                {agentLabel} is {viewMode === 'search' ? 'searching' : viewMode === 'terminal' ? 'executing' : 'browsing'}
                            </div>
                            <div className="inline-flex items-center gap-2 px-2.5 py-1 mt-1.5 rounded-lg bg-stone-50 border border-stone-100 max-w-full">
                                <span className="text-[11px] text-stone-400 font-bold uppercase tracking-wider shrink-0">
                                    {viewMode === 'search' ? 'Query' : viewMode === 'terminal' ? 'Task' : 'URL'}
                                </span>
                                <span className="text-[11px] text-stone-600 font-medium truncate">
                                    {viewMode === 'search' ? (data?.query || data?.args?.query) : viewMode === 'terminal' ? (data?.args?.command || 'Running bash') : displayUrl}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Primary Content Area */}
                <div className="flex-1 p-6 pt-4 flex flex-col min-h-0">
                    <AnimatePresence mode="wait">
                        {viewMode === 'search' ? (
                            <motion.div 
                                key="search"
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                className="flex flex-col gap-4"
                            >
                                <div className="text-[13px] font-bold text-stone-400 uppercase tracking-widest mb-1">Search Results</div>
                                {data?.results?.map((res, i) => (
                                    <div key={i} className="bg-white p-4 rounded-2xl border border-stone-100 shadow-sm hover:border-blue-200 transition-all group cursor-pointer" onClick={() => window.open(res.url, '_blank')}>
                                        <div className="flex items-center gap-2 mb-1.5">
                                            <img src={`https://www.google.com/s2/favicons?domain=${new URL(res.url).hostname}&sz=32`} className="w-4 h-4 rounded-sm" alt="" />
                                            <span className="text-[10px] text-stone-400 font-mono truncate">{new URL(res.url).hostname}</span>
                                        </div>
                                        <div className="text-[14px] font-bold text-stone-900 group-hover:text-blue-600 transition-colors mb-1 leading-tight">{res.title}</div>
                                        <div className="text-[12px] text-stone-500 leading-relaxed line-clamp-2">{res.snippet}</div>
                                    </div>
                                ))}
                                {(!data?.results || data.results.length === 0) && (
                                    <div className="flex flex-col items-center justify-center py-20 text-stone-300">
                                        <MagnifyingGlassIcon className="w-12 h-12 mb-4 animate-pulse" />
                                        <span className="text-sm font-medium">No results to show</span>
                                    </div>
                                )}
                            </motion.div>
                        ) : viewMode === 'terminal' ? (
                            <motion.div 
                                key="terminal"
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                className="bg-stone-900 rounded-2xl p-6 font-mono text-[12px] text-emerald-400 overflow-hidden flex flex-col shadow-2xl min-h-[400px]"
                            >
                                <div className="flex items-center gap-2 mb-4 border-b border-stone-800 pb-3">
                                    <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/50" />
                                    <div className="w-3 h-3 rounded-full bg-amber-500/20 border border-amber-500/50" />
                                    <div className="w-3 h-3 rounded-full bg-emerald-500/20 border border-emerald-500/50" />
                                    <span className="text-stone-500 text-[10px] ml-2 font-bold uppercase tracking-tighter">Terminal Output</span>
                                </div>
                                <div className="flex-1 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                                    <span className="text-stone-500 mr-2">$</span> 
                                    {data?.args?.command || 'Running...'}
                                    <div className="mt-4 text-stone-300">
                                        {data?.output || 'Executing task...'}
                                    </div>
                                    <motion.span 
                                        animate={{ opacity: [1, 0] }}
                                        transition={{ repeat: Infinity, duration: 0.8 }}
                                        className="inline-block w-2 h-4 bg-emerald-500 ml-1 align-middle"
                                    />
                                </div>
                            </motion.div>
                        ) : (
                            <motion.div 
                                key="browser"
                                initial={{ opacity: 0, scale: 0.98 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.98 }}
                                className="flex-1 flex flex-col min-h-0"
                            >
                                <div className="rounded-2xl border border-stone-200 shadow-2xl overflow-hidden flex flex-col bg-white flex-1 min-h-[500px]">
                                    {/* Browser Toolbar */}
                                    <div className="bg-stone-50 border-b border-stone-200 p-3 flex flex-col gap-2.5">
                                        <div className="flex items-center gap-3">
                                            <div className="flex items-center gap-1.5 px-1">
                                                <div className="w-8 h-8 rounded-full hover:bg-stone-200 flex items-center justify-center transition-colors cursor-pointer">
                                                    <ChevronLeftIcon className="w-4 h-4 text-stone-600" />
                                                </div>
                                                <div className="w-8 h-8 rounded-full hover:bg-stone-200 flex items-center justify-center transition-colors cursor-pointer">
                                                    <ChevronRightIcon className="w-4 h-4 text-stone-600" />
                                                </div>
                                                <div className="w-8 h-8 rounded-full hover:bg-stone-200 flex items-center justify-center transition-colors cursor-pointer">
                                                    <ArrowPathIcon className="w-4 h-4 text-stone-600" />
                                                </div>
                                            </div>
                                            <div className="flex-1 bg-white border border-stone-200 rounded-xl py-2 px-4 flex items-center gap-3 shadow-sm group">
                                                <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
                                                <span className="text-[12px] text-stone-600 truncate font-medium flex-1">{displayUrl}</span>
                                                <ArrowTopRightOnSquareIcon className="w-4 h-4 text-stone-300 group-hover:text-stone-500 transition-colors cursor-pointer" onClick={() => window.open(displayUrl, '_blank')} />
                                            </div>
                                            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 border-2 border-white shadow-md flex items-center justify-center text-white text-[10px] font-bold">
                                                F
                                            </div>
                                        </div>
                                    </div>

                                    {/* Viewport */}
                                    <div className="flex-1 bg-stone-100 relative overflow-hidden flex items-center justify-center bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:20px_20px]">
                                        {data?.screenshot ? (
                                            <motion.img 
                                                initial={{ opacity: 0 }}
                                                animate={{ opacity: 1 }}
                                                src={`data:image/jpeg;base64,${data.screenshot}`} 
                                                alt="Browser View" 
                                                className="w-full h-full object-contain shadow-inner"
                                            />
                                        ) : (
                                            <div className="flex flex-col items-center gap-6 text-stone-300">
                                                <div className="relative">
                                                    <GlobeAltIcon className="w-16 h-16 animate-pulse" />
                                                    <motion.div 
                                                        animate={{ rotate: 360 }}
                                                        transition={{ repeat: Infinity, duration: 4, ease: "linear" }}
                                                        className="absolute -inset-4 border-2 border-dashed border-stone-200 rounded-full"
                                                    />
                                                </div>
                                                <div className="flex flex-col items-center gap-2">
                                                    <span className="text-[10px] font-bold uppercase tracking-[0.3em]">Connecting to Virtual Session</span>
                                                    <div className="flex gap-1">
                                                        {[0,1,2].map(i => (
                                                            <motion.div key={i} animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1.5, delay: i * 0.3 }} className="w-1.5 h-1.5 rounded-full bg-stone-300" />
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                        
                                        {/* Dynamic Cursor Overlay */}
                                        <AnimatePresence>
                                            {data?.screenshot && (
                                                <motion.div 
                                                    initial={{ scale: 0 }}
                                                    animate={{ scale: 1 }}
                                                    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none drop-shadow-xl"
                                                >
                                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                                                        <path d="M5 2L19 14L12.5 15L17 21L14.5 22L10 16L5 21V2Z" fill="white" stroke="black" strokeWidth="2"/>
                                                    </svg>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>
        </motion.div>
    );
};
