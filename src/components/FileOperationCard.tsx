"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    DocumentTextIcon,
    ExclamationTriangleIcon,
    ArrowPathIcon,
    EyeIcon,
    ClipboardDocumentIcon,
    ArrowTopRightOnSquareIcon,
    ChevronDownIcon,
    PencilIcon,
    TrashIcon,
    DocumentDuplicateIcon,
} from "@heroicons/react/24/outline";
import { CheckIcon } from "@heroicons/react/24/solid";

interface FileOperationCardProps {
    operation: "create" | "edit" | "delete" | "move" | "copy";
    filename: string;
    content?: string;
    oldContent?: string;
    targetPath?: string;
    status: "pending" | "in_progress" | "success" | "error";
    progress?: number;
    currentStep?: string;
    duration?: number;
    size?: number;
    error?: string;
    onViewFile?: () => void;
    onOpenInEditor?: () => void;
    onRetry?: () => void;
}

const OP_META = {
    create: { label: ["Create", "Creating", "Created"], Icon: DocumentTextIcon, color: "#2563eb" },
    edit:   { label: ["Edit",   "Editing",   "Edited"],   Icon: PencilIcon,           color: "#d97706" },
    delete: { label: ["Delete", "Deleting",  "Deleted"],  Icon: TrashIcon,            color: "#dc2626" },
    move:   { label: ["Move",   "Moving",    "Moved"],    Icon: ArrowTopRightOnSquareIcon, color: "#7c3aed" },
    copy:   { label: ["Copy",   "Copying",   "Copied"],   Icon: DocumentDuplicateIcon,color: "#059669" },
};

const statusIndex = { pending: 0, in_progress: 1, success: 2, error: 0 } as const;

export const FileOperationCard: React.FC<FileOperationCardProps> = ({
    operation,
    filename,
    content = "",
    oldContent,
    targetPath,
    status,
    progress = 0,
    currentStep,
    duration,
    size,
    error,
    onOpenInEditor,
    onRetry,
}) => {
    const [expanded, setExpanded] = useState(false);
    const [showPreview, setShowPreview] = useState(false);
    const [copied, setCopied] = useState(false);
    const [animatedProgress, setAnimatedProgress] = useState(0);

    const ext = filename.split(".").pop()?.toUpperCase() ?? "FILE";
    const fileSizeKB = ((size ?? content.length) / 1024).toFixed(1);
    const lineCount = content.split("\n").length;
    const meta = OP_META[operation];
    const verb = meta.label[statusIndex[status]];

    useEffect(() => {
        if (status === "in_progress") {
            const t = setTimeout(() => setAnimatedProgress(progress), 80);
            return () => clearTimeout(t);
        }
    }, [progress, status]);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(content);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
        } catch {}
    };

    /* ── Status dot ── */
    const StatusDot = () => {
        if (status === "pending")
            return <span className="w-2 h-2 rounded-full bg-gray-300 inline-block" />;
        if (status === "in_progress")
            return <ArrowPathIcon className="w-3.5 h-3.5 text-blue-500 animate-spin" />;
        if (status === "success")
            return (
                <span className="flex items-center justify-center w-4 h-4 rounded-full bg-emerald-100">
                    <CheckIcon className="w-2.5 h-2.5 text-emerald-600" />
                </span>
            );
        return (
            <span className="flex items-center justify-center w-4 h-4 rounded-full bg-red-100">
                <ExclamationTriangleIcon className="w-2.5 h-2.5 text-red-500" />
            </span>
        );
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden"
        >
            {/* ── Main row ── */}
            <div className="flex items-center gap-3 px-4 py-3">

                {/* File-type chip */}
                <div
                    className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-[10px] font-semibold tracking-wide"
                    style={{ background: `${meta.color}12`, color: meta.color }}
                >
                    {ext}
                </div>

                {/* Text block */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <StatusDot />
                        <span className="text-sm font-medium text-gray-800 truncate">
                            {verb}&nbsp;
                            <span className="font-semibold">
                                {operation === "move" && targetPath
                                    ? `→ ${targetPath}`
                                    : filename}
                            </span>
                        </span>
                    </div>

                    <div className="mt-0.5 flex items-center gap-3 text-[11px] text-gray-400">
                        {operation !== "delete" && <span>{fileSizeKB} KB · {lineCount} lines</span>}
                        {status === "success" && duration && (
                            <span>{(duration / 1000).toFixed(1)}s</span>
                        )}
                        {status === "in_progress" && currentStep && (
                            <span className="text-blue-500">{currentStep}</span>
                        )}
                        {status === "error" && (
                            <span className="text-red-400">{error ?? `Failed to ${operation}`}</span>
                        )}
                    </div>
                </div>

                {/* Action icons */}
                <div className="flex items-center gap-1 shrink-0">
                    {status === "success" && operation !== "delete" && (
                        <>
                            <IconBtn title="Preview" onClick={() => setShowPreview(v => !v)}>
                                <EyeIcon className="w-4 h-4" />
                            </IconBtn>
                            <IconBtn title="Copy" onClick={handleCopy}>
                                <ClipboardDocumentIcon className={`w-4 h-4 ${copied ? "text-emerald-500" : ""}`} />
                            </IconBtn>
                            {onOpenInEditor && (
                                <IconBtn title="Open in editor" onClick={onOpenInEditor}>
                                    <ArrowTopRightOnSquareIcon className="w-4 h-4" />
                                </IconBtn>
                            )}
                        </>
                    )}
                    {status === "error" && onRetry && (
                        <button
                            onClick={onRetry}
                            className="text-xs px-2.5 py-1 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-colors font-medium"
                        >
                            Retry
                        </button>
                    )}
                    {(status === "success" || status === "error") && (
                        <IconBtn title="Details" onClick={() => setExpanded(v => !v)}>
                            <ChevronDownIcon
                                className={`w-4 h-4 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
                            />
                        </IconBtn>
                    )}
                </div>
            </div>

            {/* ── Progress bar ── */}
            {status === "in_progress" && (
                <div className="px-4 pb-3">
                    <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                        <span>Progress</span>
                        <span>{Math.round(animatedProgress)}%</span>
                    </div>
                    <div className="h-1 w-full bg-gray-100 rounded-full overflow-hidden">
                        <motion.div
                            className="h-full rounded-full"
                            style={{ background: meta.color }}
                            initial={{ width: 0 }}
                            animate={{ width: `${animatedProgress}%` }}
                            transition={{ duration: 0.4, ease: "easeOut" }}
                        />
                    </div>
                </div>
            )}

            {/* ── Expanded details ── */}
            <AnimatePresence initial={false}>
                {expanded && (
                    <motion.div
                        key="details"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.18 }}
                        className="overflow-hidden"
                    >
                        <div className="border-t border-gray-100 px-4 py-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-[12px]">
                            {operation !== "delete" && (
                                <>
                                    <Detail label="Size" value={`${fileSizeKB} KB`} />
                                    <Detail label="Lines" value={String(lineCount)} />
                                </>
                            )}
                            <Detail label="Type" value={ext} />
                            {duration && <Detail label="Duration" value={`${(duration / 1000).toFixed(1)}s`} />}
                            {targetPath && (
                                <div className="col-span-2">
                                    <Detail label="Target" value={targetPath} mono />
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── Content preview ── */}
            <AnimatePresence initial={false}>
                {showPreview && status === "success" && content && operation !== "delete" && (
                    <motion.div
                        key="preview"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.18 }}
                        className="overflow-hidden"
                    >
                        <div className="border-t border-gray-100 px-4 py-3">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">
                                    Preview
                                </span>
                                <button
                                    onClick={handleCopy}
                                    className={`text-[11px] px-2 py-0.5 rounded transition-colors ${
                                        copied
                                            ? "bg-emerald-50 text-emerald-600"
                                            : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                                    }`}
                                >
                                    {copied ? "Copied!" : "Copy"}
                                </button>
                            </div>
                            <pre className="text-[11px] bg-gray-50 border border-gray-100 rounded-lg p-3 overflow-x-auto max-h-44 overflow-y-auto font-mono text-gray-700 leading-relaxed">
                                {content.length > 1000 ? content.slice(0, 1000) + "\n…" : content}
                            </pre>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
};

/* ── Helpers ── */

const IconBtn: React.FC<{
    title: string;
    onClick: () => void;
    children: React.ReactNode;
}> = ({ title, onClick, children }) => (
    <button
        onClick={onClick}
        title={title}
        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
    >
        {children}
    </button>
);

const Detail: React.FC<{ label: string; value: string; mono?: boolean }> = ({
    label,
    value,
    mono,
}) => (
    <div className="flex gap-2 text-gray-500">
        <span className="font-medium text-gray-400">{label}</span>
        <span className={`text-gray-700 ${mono ? "font-mono text-[11px]" : ""}`}>{value}</span>
    </div>
);

export default FileOperationCard;
