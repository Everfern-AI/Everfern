"use client";

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowPathIcon, XMarkIcon, ArrowDownTrayIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';

export default function UpdateNotification() {
    const [status, setStatus] = useState<'idle' | 'available' | 'downloading' | 'downloaded' | 'error'>('idle');
    const [progress, setProgress] = useState<{ percent: number } | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [version, setVersion] = useState<string>('');
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        if (typeof window === 'undefined' || !(window as any).electronAPI) return;
        
        const api = (window as any).electronAPI;

        // Query initial status on mount
        api.system?.getUpdateStatus?.().then((res: any) => {
            if (res && res.status !== 'idle') {
                setStatus(res.status);
                if (res.version) setVersion(res.version);
                if (res.progress) setProgress(res.progress);
                if (res.errorMsg) setErrorMsg(res.errorMsg);
                setIsVisible(true);
            }
        });

        if (api.system?.onUpdateAvailable) {
            api.system.onUpdateAvailable((info: any) => {
                setStatus('available');
                setVersion(info.version || '');
                setIsVisible(true);
            });
        }

        if (api.system?.onUpdateProgress) {
            api.system.onUpdateProgress((prog: any) => {
                setStatus('downloading');
                setProgress(prog);
                setIsVisible(true);
            });
        }

        if (api.system?.onUpdateDownloaded) {
            api.system.onUpdateDownloaded((info: any) => {
                setStatus('downloaded');
                setVersion(info.version || '');
                setIsVisible(true);
            });
        }

        if (api.system?.onUpdateError) {
            api.system.onUpdateError((err: string) => {
                setStatus('error');
                setErrorMsg(err);
                setIsVisible(true);
            });
        }

    }, []);

    const handleRestart = () => {
        if (typeof window !== 'undefined' && (window as any).electronAPI?.system?.restartAndUpdate) {
            (window as any).electronAPI.system.restartAndUpdate();
        }
    };

    return (
        <AnimatePresence>
            {isVisible && status !== 'idle' && (
                <motion.div
                    initial={{ opacity: 0, y: 40, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 20, scale: 0.95 }}
                    transition={{ type: 'spring', stiffness: 320, damping: 26 }}
                    className="fixed bottom-6 right-6 z-[9999] w-[350px] overflow-hidden rounded-[24px] border border-neutral-200 bg-white p-4 shadow-2xl backdrop-blur-md dark:border-white/10 dark:bg-[#0A0A0A] text-black dark:text-white"
                >
                    <div className="flex items-start gap-3">
                        {/* Icon Status */}
                        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-neutral-100 dark:bg-neutral-900">
                            {status === 'downloading' ? (
                                <ArrowPathIcon className="h-5 w-5 text-black dark:text-white animate-spin" />
                            ) : status === 'error' ? (
                                <ExclamationTriangleIcon className="h-5 w-5 text-black dark:text-white" />
                            ) : status === 'downloaded' ? (
                                <ArrowDownTrayIcon className="h-5 w-5 text-black dark:text-white" />
                            ) : (
                                <ArrowDownTrayIcon className="h-5 w-5 text-black dark:text-white" />
                            )}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0 pr-2">
                            <h3 className="text-[13px] font-medium tracking-tight">
                                {status === 'available' && (version ? `Update Available (v${version})` : 'Update Available')}
                                {status === 'downloading' && 'Downloading Update...'}
                                {status === 'downloaded' && 'Update Ready to Install'}
                                {status === 'error' && 'Update Failed'}
                            </h3>
                            <p className="mt-1 text-[12px] leading-relaxed text-neutral-500 dark:text-neutral-400 font-light">
                                {status === 'available' && 'A new version is downloading in the background.'}
                                {status === 'downloading' && progress && `EverFern v${version || ''} (${progress.percent.toFixed(0)}% completed)`}
                                {status === 'downloading' && !progress && `Preparing download...`}
                                {status === 'downloaded' && 'Restart EverFern to apply the latest features.'}
                                {status === 'error' && (errorMsg || 'Please try again later.')}
                            </p>
                        </div>

                        {/* Close button */}
                        <button 
                            onClick={() => setIsVisible(false)}
                            className="flex-shrink-0 rounded-full p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-black dark:text-neutral-500 dark:hover:bg-white/10 dark:hover:text-white transition-colors"
                        >
                            <XMarkIcon className="h-4 w-4" />
                        </button>
                    </div>

                    {/* Action buttons or custom elements */}
                    {status === 'downloaded' && (
                        <div className="mt-4 flex justify-end">
                            <button
                                onClick={handleRestart}
                                className="w-full rounded-2xl bg-black dark:bg-white hover:bg-neutral-800 dark:hover:bg-neutral-200 py-2.5 text-center text-[13px] font-normal text-white dark:text-black transition-all cursor-pointer border border-transparent dark:hover:border-neutral-300"
                            >
                                Restart and Update
                            </button>
                        </div>
                    )}

                    {/* Seamless progress line at the very bottom */}
                    {status === 'downloading' && progress && (
                        <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-neutral-100 dark:bg-neutral-800">
                            <div 
                                className="h-full bg-black dark:bg-white transition-all duration-300 ease-out"
                                style={{ width: `${progress.percent}%` }}
                            />
                        </div>
                    )}
                </motion.div>
            )}
        </AnimatePresence>
    );
}
