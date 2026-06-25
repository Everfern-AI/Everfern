'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
    XMarkIcon, 
    MagnifyingGlassIcon, 
    PlusIcon, 
    FolderIcon,
    TrashIcon,
    ArrowRightIcon
} from '@heroicons/react/24/outline';

interface Project {
    id: string;
    name: string;
    path: string;
    createdAt: string;
}

interface ProjectsPageProps {
    onClose: () => void;
    onSelectProject: (project: Project) => void;
    onCreateNew: () => void;
}

export default function ProjectsPage({ onClose, onSelectProject, onCreateNew }: ProjectsPageProps) {
    const [projects, setProjects] = useState<Project[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [isLoading, setIsLoading] = useState(true);

    const fetchProjects = async () => {
        try {
            if ((window as any).electronAPI?.projects?.list) {
                const list = await (window as any).electronAPI.projects.list();
                setProjects(list || []);
            }
        } catch (err) {
            console.error('Failed to fetch projects:', err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchProjects();
        // Poll for updates every 5 seconds in case the DB changes
        const interval = setInterval(fetchProjects, 5000);
        return () => clearInterval(interval);
    }, []);

    const handleDelete = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (!confirm('Are you sure you want to delete this project?')) return;
        
        try {
            if ((window as any).electronAPI?.projects?.delete) {
                await (window as any).electronAPI.projects.delete(id);
                fetchProjects();
            }
        } catch (err) {
            console.error('Failed to delete project:', err);
        }
    };

    const filteredProjects = projects.filter(p => 
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.path.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                padding: '40px 60px',
                backgroundColor: 'var(--color-bg-base)'
            }}
        >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 40 }}>
                <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 32, fontWeight: 400, color: 'var(--color-text-primary)' }}>Projects</h1>
                <div style={{ display: 'flex', gap: 12 }}>
                    <button
                        onClick={onCreateNew}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '10px 20px',
                            backgroundColor: 'var(--color-text-primary)',
                            color: 'var(--color-text-inverse)',
                            borderRadius: 12,
                            border: 'none',
                            fontSize: 14,
                            fontWeight: 600,
                            cursor: 'pointer',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                        }}
                    >
                        <PlusIcon width={18} height={18} />
                        New project
                    </button>
                    <button
                        onClick={onClose}
                        style={{
                            width: 40,
                            height: 40,
                            borderRadius: 12,
                            border: '1px solid var(--color-border)',
                            backgroundColor: 'transparent',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer'
                        }}
                    >
                        <XMarkIcon width={20} height={20} className="text-[var(--color-text-secondary)]" />
                    </button>
                </div>
            </div>

            {/* Search */}
            <div style={{ position: 'relative', marginBottom: 32 }}>
                <MagnifyingGlassIcon 
                    width={20} 
                    height={20} 
                    style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)' }} 
                />
                <input
                    type="text"
                    placeholder="Search projects..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{
                        width: '100%',
                        padding: '16px 16px 16px 48px',
                        borderRadius: 16,
                        border: '1px solid var(--color-border)',
                        fontSize: 16,
                        outline: 'none',
                        backgroundColor: 'var(--color-bg-surface)',
                        color: 'var(--color-text-primary)',
                        transition: 'border-color 0.2s'
                    }}
                />
            </div>

            {/* Project List */}
            <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 40 }}>
                {isLoading ? (
                    <div style={{ textAlign: 'center', color: '#71717a', marginTop: 100 }}>Loading projects...</div>
                ) : filteredProjects.length === 0 ? (
                    <div style={{ textAlign: 'center', color: '#71717a', marginTop: 100 }}>
                        {searchQuery ? 'No projects match your search.' : 'No projects yet. Create your first one!'}
                    </div>
                ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 24 }}>
                        {filteredProjects.map((project) => (
                             <motion.div
                                key={project.id}
                                whileHover={{ y: -4, boxShadow: '0 12px 24px rgba(0,0,0,0.05)' }}
                                onClick={() => onSelectProject(project)}
                                style={{
                                    padding: 24,
                                    borderRadius: 20,
                                    border: '1px solid var(--color-border)',
                                    backgroundColor: 'var(--color-bg-surface)',
                                    cursor: 'pointer',
                                    position: 'relative'
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
                                    <div style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: 'var(--color-bg-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <FolderIcon width={24} height={24} className="text-[var(--color-text-secondary)]" />
                                    </div>
                                    <button
                                        onClick={(e) => handleDelete(e, project.id)}
                                        style={{ background: 'none', border: 'none', padding: 4, cursor: 'pointer', opacity: 0.3 }}
                                        onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                                        onMouseLeave={e => e.currentTarget.style.opacity = '0.3'}
                                    >
                                        <TrashIcon width={16} height={16} color="#ef4444" />
                                    </button>
                                </div>
                                <h3 style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-text-primary)', margin: '0 0 8px 0' }}>{project.name}</h3>
                                <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: 0, wordBreak: 'break-all', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                    {project.path}
                                </p>
                                <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 4, color: 'var(--color-accent)', fontSize: 13, fontWeight: 600 }}>
                                    Open Project <ArrowRightIcon width={14} height={14} />
                                </div>
                            </motion.div>
                        ))}
                    </div>
                )}
            </div>
        </motion.div>
    );
}
