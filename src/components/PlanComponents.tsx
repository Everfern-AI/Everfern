"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    ChevronDownIcon,
    CheckIcon,
    DocumentTextIcon,
    PlayIcon,
} from "@heroicons/react/24/outline";

/**
 * Clean plan review card - shows task title, divider, then steps list
 * Style: simple, modern, light background using Tailwind CSS
 */
const PlanReviewCard = ({ plan, onApprove, onEdit }: { plan: { content: string; chatId: string }; onApprove: (content: string) => void; onEdit: () => void }) => {
    const [expanded, setExpanded] = useState(true);

    const lines = plan.content.split('\n');
    let taskTitle = 'Execution Plan';
    const steps: { id: string; description: string }[] = [];

    for (const line of lines) {
        if (line.startsWith('# Execution Plan:')) {
            taskTitle = line.replace('# Execution Plan:', '').trim();
            break;
        }
        if (line.startsWith('## Steps')) break;
    }

    let inSteps = false;
    for (const line of lines) {
        if (line.startsWith('## Steps')) { inSteps = true; continue; }
        if (inSteps && line.startsWith('### ')) {
            const desc = line.replace('###', '').replace(/\*\*/g, '').replace(/`[^`]*`/g, '').trim();
            const parts = desc.split('—');
            steps.push({
                id: `step_${steps.length + 1}`,
                description: parts[0].trim(),
            });
        }
    }

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.98, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="mt-3 mb-6 bg-white border border-stone-200 rounded-[20px] overflow-hidden shadow-sm"
        >
            {/* Header - task title with expand/collapse */}
            <div
                onClick={() => setExpanded(!expanded)}
                className="p-4 flex items-center gap-3 cursor-pointer border-b border-stone-100 hover:bg-stone-50 transition-colors"
            >
                <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center">
                    <DocumentTextIcon className="w-[18px] h-[18px] text-amber-400" />
                </div>
                <div className="flex-1">
                    <div className="text-sm font-semibold text-stone-800">{taskTitle}</div>
                    <div className="text-xs text-stone-500">{steps.length} steps</div>
                </div>
                <ChevronDownIcon
                    className={`w-4 h-4 text-stone-400 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
                />
            </div>

            {/* Steps section - collapsible */}
            <AnimatePresence>
                {expanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                    >
                        {/* Steps list */}
                        <div className="p-3 pb-4 flex flex-col gap-2">
                            {steps.map((step, idx) => (
                                <div key={step.id} className="flex items-center gap-3">
                                    <div className="w-[22px] h-[22px] rounded-full bg-stone-100 border border-stone-200 flex items-center justify-center flex-shrink-0">
                                        <span className="text-[11px] text-stone-500 font-medium">{idx + 1}</span>
                                    </div>
                                    <span className="text-sm text-stone-700 leading-relaxed">
                                        {step.description}
                                    </span>
                                </div>
                            ))}
                        </div>

                        {/* Action buttons */}
                        <div className="p-3 pb-4 flex gap-2.5 border-t border-stone-100">
                            {onEdit && (
                                <button
                                    onClick={onEdit}
                                    className="flex-1 px-4 py-2.5 rounded-xl border border-stone-200 bg-transparent text-stone-500 text-[13px] font-semibold cursor-pointer transition-all hover:bg-stone-100 hover:text-stone-800"
                                >
                                    View Details
                                </button>
                            )}
                            <button
                                onClick={() => onApprove(plan.content)}
                                className="flex-[2] px-5 py-2.5 rounded-xl border-none bg-green-600 text-white text-[13px] font-bold cursor-pointer flex items-center justify-center gap-2 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-green-600/25"
                            >
                                <PlayIcon className="w-3.5 h-3.5" />
                                Approve & Execute
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
};

const AgentWorkspaceCards = ({ plan, contextItems, setTooltip, currentNode, isLoading }: { plan: any | null; contextItems: any[]; setTooltip: (ts: any) => void; currentNode?: string; isLoading?: boolean }) => {
    const [progressExpanded, setProgressExpanded] = useState(true);
    const [contextExpanded, setContextExpanded] = useState(true);

    if (!plan && contextItems.length === 0) return null;

    const hasComputerUse = contextItems.some((i: any) => i.type === 'app');
    const isDataAnalyst = currentNode === 'data_analyst' && isLoading;

    return (
        <div className="flex flex-col gap-3 mb-4">
            {/* Data Analyst Active Card */}
            {isDataAnalyst && (
                <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="w-full bg-purple-50 border border-purple-200 rounded-xl p-3.5 flex items-center gap-3"
                >
                    <div className="w-8 h-8 rounded-lg bg-purple-100 border border-purple-200 flex items-center justify-center flex-shrink-0">
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="#9333ea" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"></path><path d="M22 12A10 10 0 0 0 12 2v10z"></path></svg>
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold text-purple-800 mb-0.5">Data Analyst</div>
                        <div className="text-xs text-purple-600">Processing data and generating insights...</div>
                    </div>
                    <div className="w-2 h-2 rounded bg-purple-600 animate-pulse flex-shrink-0" />
                </motion.div>
            )}

            {plan && (
                <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="w-full bg-transparent"
                >
                    <div
                        onClick={() => setProgressExpanded(!progressExpanded)}
                        className="py-2 px-0 flex items-center justify-between cursor-pointer"
                    >
                        <span className="text-base font-semibold text-stone-800">Progress</span>
                        <ChevronDownIcon className={`w-4 h-4 text-stone-400 transition-transform duration-200 ${progressExpanded ? 'rotate-180' : ''}`} />
                    </div>
                    <AnimatePresence>
                        {progressExpanded && (
                            <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="overflow-hidden"
                            >
                                <div className="flex flex-col gap-3.5 pt-3 pb-4">
                                    {plan.steps?.map((step: any, index: number) => {
                                        const isDone = step.status === 'done';
                                        const isInProgress = step.status === 'in_progress';
                                        return (
                                            <div key={step.id} className="flex items-start gap-3">
                                                {isDone ? (
                                                    <div className="w-6 h-6 rounded-full bg-green-50 border border-green-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                                                        <CheckIcon className="w-3.5 h-3.5 text-green-600" strokeWidth={3} />
                                                    </div>
                                                ) : isInProgress ? (
                                                    <div className="w-6 h-6 rounded-full border-[2.5px] border-stone-900 flex items-center justify-center flex-shrink-0 mt-0.5">
                                                        <span className="text-[13px] text-stone-900 font-bold">{index + 1}</span>
                                                    </div>
                                                ) : (
                                                    <div className="w-6 h-6 rounded-full bg-stone-100 border border-stone-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                                                        <span className="text-xs text-stone-500 font-medium">{index + 1}</span>
                                                    </div>
                                                )}
                                                <span className={`text-sm leading-relaxed mt-1 ${isInProgress ? 'font-medium text-stone-800' : isDone ? 'text-stone-800' : 'text-stone-500'}`}>
                                                    {step.description}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </motion.div>
            )}

            {contextItems.length > 0 && (
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="w-full bg-white border border-stone-200 rounded-2xl overflow-hidden"
                >
                    {hasComputerUse ? null : (
                        <div
                            onClick={() => setContextExpanded(!contextExpanded)}
                            className="p-3 flex items-center justify-between cursor-pointer border-b border-stone-200 hover:bg-stone-50 transition-colors"
                        >
                            <span className="text-[13px] font-bold text-stone-800 uppercase tracking-wide">Active Context</span>
                            <ChevronDownIcon className={`w-3.5 h-3.5 text-stone-400 transition-transform duration-200 ${contextExpanded ? 'rotate-180' : ''}`} />
                        </div>
                    )}
                    <AnimatePresence>
                        {contextExpanded && (
                            <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="overflow-hidden"
                            >
                                <div className="flex flex-col gap-3.5 p-3 pb-4">
                                    {contextItems.map((item, idx) => {
                                        const isFolder = item.label.startsWith("Folder:");
                                        return (
                                            <div key={idx} className="flex items-start gap-3">
                                                {item.type !== 'app' && (
                                                    <div className="w-6 h-6 rounded-full bg-stone-100 border border-stone-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                                                        {isFolder || item.type === 'file' ? (
                                                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="#717171" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                                                        ) : item.type === 'web' ? (
                                                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="#717171" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1-4-10z"></path></svg>
                                                        ) : (
                                                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="#717171" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>
                                                        )}
                                                    </div>
                                                )}
                                                {item.type === 'app' ? (
                                                    <div className="flex flex-col gap-4 flex-1 min-w-0 pt-1">
                                                        <div className="flex items-center justify-between mb-[-4px]">
                                                            <span className="text-[11px] font-bold text-stone-700 uppercase tracking-wider">CURRENT CONTEXT</span>
                                                            <div className='flex items-center gap-1.5 bg-green-100 px-2 py-1 rounded-md'>
                                                                <span className='text-[11px] font-semibold text-green-600'>Active</span>
                                                                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            {item.appLogo ? (
                                                                <img src={item.appLogo} alt="App Logo" className="w-5.5 h-5.5 rounded-md object-contain" />
                                                            ) : (
                                                                <div className="w-5.5 h-5.5 rounded-md bg-blue-50 flex items-center justify-center">
                                                                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
                                                                </div>
                                                            )}
                                                            <span className='text-stone-600 text-sm font-medium'>{item.label}</span>
                                                        </div>
                                                        {item.base64Image && (
                                                            <div className='rounded-lg overflow-hidden border border-stone-200 relative bg-stone-50 shadow-sm'>
                                                                <img src={`data:image/jpeg;base64,${item.base64Image}`} alt="vision context" className="w-full block" />
                                                            </div>
                                                        )}
                                                        <div className='flex flex-col gap-5'>
                                                            {/* Context Details */}
                                                            <div className='flex flex-col gap-2.5'>
                                                                <div className="text-[11px] font-bold text-stone-700 uppercase tracking-wider">CONTEXT DETAILS</div>
                                                                <div className='flex flex-col gap-2.5 p-1'>
                                                                    <div className='flex items-center'>
                                                                        <div className="w-28 text-stone-500 text-[13px] flex items-center gap-2">
                                                                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>Type
                                                                        </div>
                                                                        <div className='text-stone-900 text-[13px] font-medium flex items-center gap-1.5'>
                                                                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>Computer Use
                                                                        </div>
                                                                    </div>
                                                                    <div className='flex items-center'>
                                                                        <div className="w-28 text-stone-500 text-[13px] flex items-center gap-2">
                                                                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>Status
                                                                        </div>
                                                                        <div className='text-stone-900 text-[13px] font-medium flex items-center gap-1.5'>
                                                                            <span className="w-2 h-2 rounded bg-green-500"></span>Active
                                                                        </div>
                                                                    </div>
                                                                    <div className='flex items-center'>
                                                                        <div className="w-28 text-stone-500 text-[13px] flex items-center gap-2">
                                                                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>Started
                                                                        </div>
                                                                        <div className='text-stone-900 text-[13px] font-medium flex items-center gap-1.5'>
                                                                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>Just now
                                                                        </div>
                                                                    </div>
                                                                    <div className='flex items-center'>
                                                                        <div className="w-28 text-stone-500 text-[13px] flex items-center gap-2">
                                                                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4"></circle><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path></svg>Agent
                                                                        </div>
                                                                        <div className='text-stone-900 text-[13px] font-medium flex items-center gap-1.5'>
                                                                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2"><circle cx="12" cy="8" r="4"></circle><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path></svg>Computer Use Agent
                                                                        </div>
                                                                    </div>
                                                                    <div className='flex items-center'>
                                                                        <div className="w-28 text-stone-500 text-[13px] flex items-center gap-2">
                                                                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>Model
                                                                        </div>
                                                                        <div className='text-stone-900 text-[13px] font-medium flex items-center gap-1.5'>
                                                                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>gemma4:31b-cloud
                                                                        </div>
                                                                    </div>
                                                                    <div className='flex items-center'>
                                                                        <div className="w-28 text-stone-500 text-[13px] flex items-center gap-2">
                                                                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>Permissions
                                                                        </div>
                                                                        <div className='text-stone-900 text-[13px] font-medium flex items-center gap-1.5'>
                                                                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>2 Granted
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            {/* Permissions Array */}
                                                            <div className='flex flex-col gap-2.5'>
                                                                <div className='flex justify-between items-center'>
                                                                    <span className="text-[11px] font-bold text-stone-700 uppercase tracking-wider">PERMISSIONS</span>
                                                                    <span className="text-[11px] font-semibold text-stone-600 border border-stone-200 px-2.5 py-1 rounded-full">Manage</span>
                                                                </div>
                                                                <div className='flex flex-col gap-3 p-1'>
                                                                    <div className='flex justify-between items-center'>
                                                                        <div className='flex items-center gap-2'>
                                                                            <div className='w-6 h-6 rounded-full bg-green-50 flex items-center justify-center'>
                                                                                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
                                                                            </div>
                                                                            <div className='flex flex-col'>
                                                                                <span className='text-[13px] text-stone-900 font-medium'>System Control</span>
                                                                                <span className='text-[11px] text-stone-500'>Control applications and system</span>
                                                                            </div>
                                                                        </div>
                                                                        <span className='text-[11px] font-semibold text-green-600 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full'>Granted</span>
                                                                    </div>
                                                                    <div className='flex justify-between items-center'>
                                                                        <div className='flex items-center gap-2'>
                                                                            <div className='w-6 h-6 rounded-full bg-green-50 flex items-center justify-center'>
                                                                                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
                                                                            </div>
                                                                            <div className='flex flex-col'>
                                                                                <span className='text-[13px] text-stone-900 font-medium'>Window Management</span>
                                                                                <span className='text-[11px] text-stone-500'>Capture and control windows</span>
                                                                            </div>
                                                                        </div>
                                                                        <span className='text-[11px] font-semibold text-green-600 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full'>Granted</span>
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            {/* Recent Actions */}
                                                            <div className='flex flex-col gap-2.5'>
                                                                <div className='flex justify-between items-center'>
                                                                    <span className="text-[11px] font-bold text-stone-700 uppercase tracking-wider">RECENT ACTIONS</span>
                                                                    <span className="text-[11px] font-semibold text-stone-600 border border-stone-200 px-2.5 py-1 rounded-full">View all</span>
                                                                </div>
                                                                <div className='flex flex-col gap-3 p-1'>
                                                                    <div className='flex justify-between items-center'>
                                                                        <div className='flex items-center gap-2'>
                                                                            <div className='w-6 h-6 rounded-full bg-green-50 flex items-center justify-center'>
                                                                                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                                                                            </div>
                                                                            <span className='text-[13px] text-stone-900 font-medium'>{item.label.includes('Wait') ? 'Waited 1s' : item.label.includes('Type') ? `Typed text` : `Launched Application`}</span>
                                                                        </div>
                                                                        <div className='flex items-center gap-3'>
                                                                            <span className='text-[11px] text-stone-400'>2.1s ago</span>
                                                                            <span className='text-[11px] font-semibold text-green-600 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full'>Success</span>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                                                        <span
                                                            onMouseEnter={(e) => setTooltip({ visible: true, x: e.clientX, y: e.clientY, content: item.label.replace(/^(Folder:|File:|URL:)?\s*/i, '') })}
                                                            onMouseMove={(e) => setTooltip({ visible: true, x: e.clientX, y: e.clientY, content: item.label.replace(/^(Folder:|File:|URL:)?\s*/i, '') })}
                                                            onMouseLeave={() => setTooltip({ visible: false, x: 0, y: 0, content: "" })}
                                                            className="text-sm text-stone-800 leading-relaxed mt-1 break-all cursor-default"
                                                        >
                                                            <span className="text-stone-500 font-medium">{isFolder ? "Folder:" : item.type === "web" ? "URL:" : "File:"}</span> {item.label.replace(/^(Folder:|File:|URL:)?\s*/i, '').split(/[/\\]/).pop()}
                                                        </span>
                                                        {item.base64Image && (
                                                            <div className='mt-0.5 rounded-lg overflow-hidden border border-stone-200'>
                                                                <img src={`data:image/jpeg;base64,${item.base64Image}`} alt="vision context" className="w-full block" />
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </motion.div>
            )}
        </div>
    );
};

export { PlanReviewCard, AgentWorkspaceCards };
