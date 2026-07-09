'use client';
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDownIcon, CheckIcon } from '@heroicons/react/24/outline';

interface Task {
    description: string;
    status: 'pending' | 'in_progress' | 'completed';
}

interface TasksPanelProps {
    tasks: Task[];
    path?: string;
}

export default function TasksPanel({ tasks, path }: TasksPanelProps) {
    const [isExpanded, setIsExpanded] = useState(true);

    if (!tasks || tasks.length === 0) return null;

    return (
        <div 
            className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl shadow-sm transition-colors duration-200"
            style={{ padding: '20px 16px 16px 16px' }}
        >
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full flex items-center justify-between bg-transparent border-none cursor-pointer overflow-visible"
                style={{ padding: 0, margin: 0, marginBottom: isExpanded ? 16 : 0, outline: 'none' }}
            >
                <span 
                    className="text-xs font-semibold text-stone-500 dark:text-stone-400 tracking-wide uppercase"
                    style={{ lineHeight: '1.5', display: 'inline-block' }}
                >
                    Progress
                </span>
                <ChevronDownIcon 
                    width={16} 
                    height={16} 
                    className="text-stone-400 dark:text-stone-500 transition-transform duration-200"
                    style={{ 
                        transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)', 
                    }} 
                />
            </button>

            <AnimatePresence initial={false}>
                {isExpanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
                        className="overflow-hidden"
                    >
                        <div className="flex flex-col gap-3 max-h-[320px] overflow-y-auto pr-2 pb-1">
                            {tasks.map((task, idx) => (
                                <div key={idx} className="flex items-center gap-2.5">
                                    <div className="flex-shrink-0">
                                        {task.status === 'completed' ? (
                                            <div className="w-[22px] h-[22px] rounded-full bg-blue-500 flex items-center justify-center">
                                                <CheckIcon width={12} height={12} className="text-white" strokeWidth={3.5} />
                                            </div>
                                        ) : task.status === 'in_progress' ? (
                                            <div className="w-[22px] h-[22px] rounded-full border-2 border-blue-500 bg-blue-50 dark:bg-blue-950/40 flex items-center justify-center">
                                                <span className="text-[11px] font-bold text-blue-500 dark:text-blue-400">{idx + 1}</span>
                                            </div>
                                        ) : (
                                            <div className="w-[22px] h-[22px] rounded-full bg-stone-100 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 flex items-center justify-center">
                                                <span className="text-[11px] font-bold text-stone-400 dark:text-stone-500">{idx + 1}</span>
                                            </div>
                                        )}
                                    </div>
                                    <div className={`text-[13px] leading-relaxed tracking-tight ${
                                        task.status === 'completed' 
                                            ? 'text-stone-400 dark:text-stone-500 line-through' 
                                            : task.status === 'in_progress' 
                                                ? 'text-stone-900 dark:text-stone-100 font-semibold' 
                                                : 'text-stone-600 dark:text-stone-400 font-normal'
                                    }`}>
                                        {task.description}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
