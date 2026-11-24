"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MagnifyingGlassIcon, FolderIcon, PlusIcon, XMarkIcon } from "@heroicons/react/24/outline";

interface Project {
    id: string;
    name: string;
    instructions?: string;
    path: string;
    createdAt: string;
    updatedAt: string;
}

interface ProjectsPageProps {
    onClose: () => void;
    onSelectProject: (project: Project) => void;
    onCreateNew: () => void;
}

export default function ProjectsPage({ onClose, onSelectProject, onCreateNew }: ProjectsPageProps) {
    const [projects, setProjects] = useState<Project[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const loadProjects = async () => {
            try {
                if ((window as any).electronAPI?.projects?.list) {
                    const list = await (window as any).electronAPI.projects.list();
                    setProjects(list || []);
                }
            } catch (err) {
                console.error("Failed to load projects:", err);
            } finally {
                setIsLoading(false);
            }
        };
        loadProjects();
        // Set up polling or listen to an event if needed
        const interval = setInterval(loadProjects, 5000);
        return () => clearInterval(interval);
    }, []);

    const filteredProjects = projects.filter(p => 
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
        p.path.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: "var(--color-bg-base)", // Matches sidebar/background
                zIndex: 40,
                display: "flex",
                flexDirection: "column",
                overflowY: "auto",
                padding: "48px"
            }}
        >
            <div style={{ maxWidth: 800, width: "100%", margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
                
                {/* Header Row */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <h1 style={{ fontSize: 32, fontWeight: 700, color: "var(--color-text-primary)", margin: 0, fontFamily: 'var(--font-serif)' }}>Projects</h1>
                    <div style={{ display: "flex", gap: 12 }}>
                        <button
                            onClick={onCreateNew}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                padding: "8px 16px",
                                backgroundColor: "var(--color-text-primary)",
                                color: "var(--color-text-inverse)",
                                border: "none",
                                borderRadius: 8,
                                fontSize: 14,
                                fontWeight: 500,
                                cursor: "pointer",
                                transition: "background-color 0.2s"
                            }}
                            onMouseEnter={e => e.currentTarget.style.backgroundColor = "var(--color-text-secondary)"}
                            onMouseLeave={e => e.currentTarget.style.backgroundColor = "var(--color-text-primary)"}
                        >
                            <PlusIcon width={16} height={16} />
                            New project
                        </button>
                        <button
                            onClick={onClose}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                width: 36,
                                height: 36,
                                backgroundColor: "transparent",
                                color: "var(--color-text-secondary)",
                                border: "1px solid var(--color-border-strong)",
                                borderRadius: 8,
                                cursor: "pointer",
                                transition: "background-color 0.2s"
                            }}
                            title="Close Projects"
                            onMouseEnter={e => { e.currentTarget.style.backgroundColor = "var(--color-bg-hover)"; e.currentTarget.style.color = "var(--color-text-primary)"; }}
                            onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "var(--color-text-secondary)"; }}
                        >
                            <XMarkIcon width={20} height={20} />
                        </button>
                    </div>
                </div>

                {/* Search Bar */}
                <div style={{ position: "relative", width: "100%" }}>
                    <div style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--color-text-tertiary)" }}>
                        <MagnifyingGlassIcon width={18} height={18} />
                    </div>
                    <input 
                        type="text"
                        placeholder="Search projects..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        style={{
                            width: "100%",
                            padding: "12px 16px 12px 40px",
                            backgroundColor: "var(--color-bg-surface)",
                            border: "1px solid var(--color-border)",
                            borderRadius: 12,
                            fontSize: 15,
                            outline: "none",
                            boxShadow: "var(--shadow-xs)",
                            color: "var(--color-text-primary)"
                        }}
                    />
                </div>

                {/* Projects List */}
                <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 16 }}>
                    {isLoading ? (
                        <div style={{ color: "var(--color-text-tertiary)", textAlign: "center", padding: "40px 0" }}>Loading projects...</div>
                    ) : filteredProjects.length === 0 ? (
                        <div style={{ color: "var(--color-text-tertiary)", textAlign: "center", padding: "40px 0" }}>
                            {searchQuery ? "No projects found matching your search." : "No projects yet. Create one to get started!"}
                        </div>
                    ) : (
                        filteredProjects.map(project => (
                            <div 
                                key={project.id}
                                onClick={() => onSelectProject(project)}
                                style={{
                                    display: "flex",
                                    alignItems: "flex-start",
                                    gap: 16,
                                    padding: "16px",
                                    backgroundColor: "transparent",
                                    borderRadius: 12,
                                    cursor: "pointer",
                                    transition: "background-color 0.2s"
                                }}
                                onMouseEnter={e => e.currentTarget.style.backgroundColor = "var(--color-bg-hover)"}
                                onMouseLeave={e => e.currentTarget.style.backgroundColor = "transparent"}
                            >
                                <div style={{ color: "var(--color-text-tertiary)", paddingTop: 2 }}>
                                    <FolderIcon width={24} height={24} />
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                    <span style={{ fontSize: 16, fontWeight: 600, color: "var(--color-text-primary)" }}>{project.name}</span>
                                    <span style={{ fontSize: 13, color: "var(--color-text-tertiary)", wordBreak: "break-all" }}>{project.path}</span>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </motion.div>
    );
}
