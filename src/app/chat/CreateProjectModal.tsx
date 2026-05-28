"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeftIcon, FolderIcon, PlusIcon } from "@heroicons/react/24/outline";

interface CreateProjectModalProps {
    isOpen: boolean;
    onClose: () => void;
    onCreated: (project: any) => void;
}

export default function CreateProjectModal({ isOpen, onClose, onCreated }: CreateProjectModalProps) {
    const [name, setName] = useState("");
    const [instructions, setInstructions] = useState("");
    const [path, setPath] = useState("");
    const [isCreating, setIsCreating] = useState(false);

    const handleSelectPath = async () => {
        if ((window as any).electronAPI?.system?.openFolderPicker) {
            const folder = await (window as any).electronAPI?.system.openFolderPicker();
            if (folder && folder.success && folder.path) {
                setPath(folder.path);
                // If name is empty and they picked a folder, default name to folder name
                if (!name && folder.name) {
                    setName(folder.name);
                }
            }
        }
    };

    const handleCreate = async () => {
        if (!name.trim() || !path.trim()) return;
        setIsCreating(true);
        try {
            if ((window as any).electronAPI?.projects?.create) {
                const res = await (window as any).electronAPI.projects.create({
                    name: name.trim(),
                    instructions: instructions.trim() || undefined,
                    path: path.trim()
                });
                if (res.success && res.project) {
                    onCreated(res.project);
                    // Reset form
                    setName("");
                    setInstructions("");
                    setPath("");
                    onClose();
                } else {
                    console.error("Failed to create project:", res.error);
                }
            }
        } catch (err) {
            console.error("Error creating project:", err);
        } finally {
            setIsCreating(false);
        }
    };

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <div style={{
                position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
                backgroundColor: "rgba(0,0,0,0.4)", zIndex: 100,
                display: "flex", alignItems: "center", justifyContent: "center",
                backdropFilter: "blur(2px)"
            }}>
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    style={{
                        backgroundColor: "#fff",
                        borderRadius: 16,
                        width: "100%",
                        maxWidth: 500,
                        boxShadow: "0 10px 40px rgba(0,0,0,0.1)",
                        display: "flex",
                        flexDirection: "column",
                        overflow: "hidden"
                    }}
                >
                    <div style={{ padding: "20px 24px" }}>
                        <button 
                            onClick={onClose}
                            style={{ 
                                background: "none", border: "none", cursor: "pointer", 
                                color: "#666", padding: 0, marginBottom: 12,
                                display: "flex", alignItems: "center" 
                            }}
                        >
                            <ArrowLeftIcon width={20} height={20} />
                        </button>
                        
                        <h2 style={{ fontSize: 22, fontWeight: 700, color: "#111", margin: "0 0 24px 0" }}>Start a new project</h2>
                        
                        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                            {/* Name */}
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                <label style={{ fontSize: 13, fontWeight: 600, color: "#333" }}>Name <span style={{ color: "#e53e3e" }}>*</span></label>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={e => setName(e.target.value)}
                                    placeholder="Project name"
                                    style={{
                                        width: "100%", padding: "10px 14px",
                                        border: "1px solid #0066ff", borderRadius: 8,
                                        fontSize: 14, outline: "none",
                                        boxShadow: "0 0 0 2px rgba(0, 102, 255, 0.1)"
                                    }}
                                />
                            </div>

                            {/* Instructions */}
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                <label style={{ fontSize: 13, fontWeight: 600, color: "#333" }}>Instructions</label>
                                <textarea
                                    value={instructions}
                                    onChange={e => setInstructions(e.target.value)}
                                    placeholder="Tell the AI how to work in this project (optional)"
                                    rows={3}
                                    style={{
                                        width: "100%", padding: "10px 14px",
                                        border: "1px solid #dcdad0", borderRadius: 8,
                                        fontSize: 14, outline: "none", resize: "none"
                                    }}
                                />
                            </div>

                            {/* Add files (visual only for now as requested by user context) */}
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                <label style={{ fontSize: 13, fontWeight: 600, color: "#333" }}>Add files</label>
                                <div style={{
                                    border: "1px dashed #dcdad0", borderRadius: 8,
                                    padding: "20px", display: "flex", alignItems: "center", justifyContent: "center",
                                    color: "#666", cursor: "pointer", backgroundColor: "#faf9f7"
                                }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                        <PlusIcon width={16} height={16} />
                                        <span style={{ fontSize: 14 }}>Drop files here or click to browse</span>
                                    </div>
                                </div>
                            </div>

                            {/* Project location */}
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                <label style={{ fontSize: 13, fontWeight: 600, color: "#333", display: "flex", justifyContent: "space-between" }}>
                                    <span>Choose project location</span>
                                    <span style={{ cursor: "pointer", color: "#888" }}>ⓘ</span>
                                </label>
                                <div 
                                    onClick={handleSelectPath}
                                    style={{
                                        display: "flex", alignItems: "center", gap: 10,
                                        width: "100%", padding: "10px 14px",
                                        border: "1px solid #dcdad0", borderRadius: 8,
                                        fontSize: 14, cursor: "pointer",
                                        backgroundColor: "#faf9f7"
                                    }}
                                >
                                    <FolderIcon width={18} height={18} color="#666" />
                                    <span style={{ color: path ? "#111" : "#888", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {path || "Select a folder..."}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div style={{ 
                        padding: "16px 24px", 
                        borderTop: "1px solid #f0eee1", 
                        display: "flex", 
                        justifyContent: "space-between",
                        alignItems: "center",
                        backgroundColor: "#faf9f7"
                    }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#0066ff", fontSize: 13, fontWeight: 500 }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.59-9.5" />
                            </svg>
                            Memory is on
                        </div>
                        <div style={{ display: "flex", gap: 12 }}>
                            <button
                                onClick={onClose}
                                style={{
                                    padding: "8px 16px", background: "transparent", border: "1px solid #dcdad0",
                                    borderRadius: 8, fontSize: 14, fontWeight: 500, color: "#333", cursor: "pointer"
                                }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleCreate}
                                disabled={!name.trim() || !path.trim() || isCreating}
                                style={{
                                    padding: "8px 16px", backgroundColor: (!name.trim() || !path.trim() || isCreating) ? "#ccc" : "#666",
                                    border: "none", borderRadius: 8, fontSize: 14, fontWeight: 500, color: "#fff", cursor: (!name.trim() || !path.trim() || isCreating) ? "not-allowed" : "pointer",
                                    transition: "background-color 0.2s"
                                }}
                            >
                                {isCreating ? "Creating..." : "Create"}
                            </button>
                        </div>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
