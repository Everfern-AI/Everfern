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
                if (!isVisible) setIsVisible(true);
            });
        }

        if (api.system?.onUpdateDownloaded) {
            api.system.onUpdateDownloaded((info: any) => {
                setStatus('downloaded');
                if (!isVisible) setIsVisible(true);
            });
        }

        if (api.system?.onUpdateError) {
            api.system.onUpdateError((err: string) => {
                setStatus('error');
                setErrorMsg(err);
                if (!isVisible) setIsVisible(true);
            });
        }

    }, []);

    const handleRestart = () => {
        if (typeof window !== 'undefined' && (window as any).electronAPI?.system?.restartAndUpdate) {
            (window as any).electronAPI.system.restartAndUpdate();
        }
    };

    if (!isVisible) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0, y: 50, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 20, scale: 0.95 }}
                className="fixed bottom-6 right-6 z-[9999] bg-white dark:bg-[#1a1a1a] border border-neutral-200 dark:border-neutral-800 rounded-2xl shadow-xl overflow-hidden w-[340px]"
            >
                <div className="p-4 flex flex-col gap-3">
                    <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                                {status === 'downloading' ? (
                                    <ArrowPathIcon className="w-5 h-5 text-blue-500 animate-spin" />
                                ) : status === 'error' ? (
                                    <ExclamationTriangleIcon className="w-5 h-5 text-red-500" />
                                ) : (
                                    <ArrowDownTrayIcon className="w-5 h-5 text-blue-500" />
                                )}
                            </div>
                            <div>
                                <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
                                    {status === 'available' && (version ? `Update Available (${version})` : 'Update Available')}
                                    {status === 'downloading' && 'Downloading Update...'}
                                    {status === 'downloaded' && 'Update Ready to Install'}
                                    {status === 'error' && 'Update Failed'}
                                </h3>
                                <p className="text-[13px] text-neutral-500 dark:text-neutral-400 leading-snug mt-0.5">
                                    {status === 'available' && 'A new version is downloading in the background.'}
                                    {status === 'downloading' && progress && `${progress.percent.toFixed(0)}% completed`}
                                    {status === 'downloaded' && 'Restart EverFern to apply the latest features.'}
                                    {status === 'error' && (errorMsg || 'Please try again later.')}
                                </p>
                            </div>
                        </div>
                        <button 
                            onClick={() => setIsVisible(false)}
                            className="p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-md text-neutral-400 hover:text-neutral-600 transition-colors"
                        >
                            <XMarkIcon className="w-5 h-5" />
                        </button>
                    </div>

                    {status === 'downloading' && progress && (
                        <div className="w-full h-1.5 bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden">
                            <div 
                                className="h-full bg-blue-500 transition-all duration-300"
                                style={{ width: `${progress.percent}%` }}
                            />
                        </div>
                    )}

                    {status === 'downloaded' && (
                        <button
                            onClick={handleRestart}
                            className="w-full py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-xl transition-colors"
                        >
                            Restart and Update
                        </button>
                    )}
                </div>
            </motion.div>
        </AnimatePresence>
    );
}
