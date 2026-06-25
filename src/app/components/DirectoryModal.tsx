"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    XMarkIcon,
    MagnifyingGlassIcon,
    ChevronDownIcon,
    PlusIcon,
    WrenchIcon,
    PuzzlePieceIcon,
    CpuChipIcon,
    CheckIcon,
    TrashIcon,
    FolderIcon
} from "@heroicons/react/24/outline";

interface DirectoryModalProps {
    isOpen: boolean;
    onClose: () => void;
}

type TabType = 'skills' | 'mcp' | 'plugins';

interface MCPConnector {
    id: string;
    name: string;
    description: string;
    domain: string;
    logo?: string;
    fields: { key: string; label: string; type: string; placeholder?: string }[];
}

const MCP_CONNECTORS: MCPConnector[] = [
    {
        id: "github",
        name: "GitHub",
        description: "Access repositories, pull requests, issues, and actions in GitHub",
        domain: "github.com",
        logo: "github.png",
        fields: [{ key: "apiKey", label: "Personal Access Token", type: "password", placeholder: "ghp_..." }]
    },
    {
        id: "slack",
        name: "Slack",
        description: "Read messages, channels, and post to Slack workspaces",
        domain: "slack.com",
        logo: "slack.png",
        fields: [{ key: "apiKey", label: "Bot User OAuth Token", type: "password", placeholder: "xoxb-..." }]
    },
    {
        id: "atlassian_rovo",
        name: "Atlassian Rovo (Jira)",
        description: "Access Jira & Confluence from Claude",
        domain: "atlassian.com",
        fields: [
            { key: "domain", label: "Atlassian Domain", type: "text", placeholder: "your-domain.atlassian.net" },
            { key: "email", label: "Email Address", type: "text", placeholder: "you@example.com" },
            { key: "apiToken", label: "API Token", type: "password", placeholder: "..." }
        ]
    },
    {
        id: "ticket_tailor",
        name: "Ticket Tailor",
        description: "Event platform for managing tickets, orders & more",
        domain: "tickettailor.com",
        fields: [{ key: "apiKey", label: "API Key", type: "password", placeholder: "sk_..." }]
    },
    {
        id: "linear",
        name: "Linear",
        description: "Manage issues, projects & team workflows in Linear",
        domain: "linear.app",
        logo: "linear.png",
        fields: [{ key: "apiKey", label: "API Key", type: "password", placeholder: "lin_api_..." }]
    },
    {
        id: "hugging_face",
        name: "Hugging Face",
        description: "Access the Hugging Face Hub and thousands of Gradio Apps",
        domain: "huggingface.co",
        logo: "huggingface.png",
        fields: [{ key: "token", label: "Access Token", type: "password", placeholder: "hf_..." }]
    },
    {
        id: "amplitude",
        name: "Amplitude",
        description: "Search, access, and get insights on your Amplitude data",
        domain: "amplitude.com",
        logo: "amplitude.png",
        fields: [
            { key: "apiKey", label: "API Key", type: "password", placeholder: "..." },
            { key: "secretKey", label: "Secret Key", type: "password", placeholder: "..." }
        ]
    },
    {
        id: "blockscout",
        name: "Blockscout",
        description: "Access and analyze blockchain data",
        domain: "blockscout.com",
        fields: [{ key: "apiKey", label: "API Key", type: "password", placeholder: "..." }]
    },
    {
        id: "close",
        name: "Close",
        description: "Connect Claude to Close CRM to securely access and act on data",
        domain: "close.com",
        fields: [{ key: "apiKey", label: "API Key", type: "password", placeholder: "..." }]
    },
    {
        id: "cloudflare",
        name: "Cloudflare Developer Platform",
        description: "Access Cloudflare Workers and Pages",
        domain: "cloudflare.com",
        logo: "cloudflare.png",
        fields: [
            { key: "accountId", label: "Account ID", type: "text", placeholder: "..." },
            { key: "apiToken", label: "API Token", type: "password", placeholder: "..." }
        ]
    }
];

const SKILLS = [
    { id: "csv", name: "/csv", author: "EverFern", downloads: "Built-in", description: "Use this skill any time a CSV file is the primary input or output. This includes reading, parsing, cleaning, and transforming.", isBuiltIn: true },
    { id: "data_analysis", name: "/data-analysis", author: "EverFern", downloads: "Built-in", description: "Expert instructions for analyzing tabular data, statistics, and machine learning using python libraries like pandas.", isBuiltIn: true },
    { id: "docx", name: "/docx", author: "EverFern", downloads: "Built-in", description: "Use this skill any time a .docx file is involved. Read, extract text, or create new Word documents.", isBuiltIn: true },
    { id: "frontend_design", name: "/frontend-design", author: "EverFern", downloads: "Built-in", description: "Expert instructions for creating beautiful visual art, UI/UX, HTML landing pages, and frontend layouts.", isBuiltIn: true },
    { id: "html_dashboard", name: "/html-dashboard", author: "EverFern", downloads: "Built-in", description: "Instructions for building comprehensive interactive HTML dashboards with modern libraries.", isBuiltIn: true },
    { id: "json", name: "/json", author: "EverFern", downloads: "Built-in", description: "Use this skill to read, write, parse, and analyze JSON data or interact with JSON APIs.", isBuiltIn: true },
    { id: "pdf", name: "/pdf", author: "EverFern", downloads: "Built-in", description: "Use this skill any time a PDF file is involved. Read, extract text, split/merge pages, or create PDFs.", isBuiltIn: true },
    { id: "pptx", name: "/pptx", author: "EverFern", downloads: "Built-in", description: "Use this skill any time a PowerPoint presentation (.pptx) is involved. Extract text or create slides.", isBuiltIn: true },
    { id: "txt", name: "/txt", author: "EverFern", downloads: "Built-in", description: "Use this skill for basic text file manipulation, parsing logs, or unstructured text operations.", isBuiltIn: true },
    { id: "xlsx", name: "/xlsx", author: "EverFern", downloads: "Built-in", description: "Use this skill any time an Excel file (.xlsx) is involved. Extract sheets, modify cells, or create new workbooks.", isBuiltIn: true },
];

export default function DirectoryModal({ isOpen, onClose }: DirectoryModalProps) {
    const [activeTab, setActiveTab] = useState<TabType>('mcp');
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedMCP, setSelectedMCP] = useState<MCPConnector | null>(null);
    const [formValues, setFormValues] = useState<Record<string, string>>({});
    const [customJsonConfig, setCustomJsonConfig] = useState<string>("");
    
    // Custom skills state
    const [customSkills, setCustomSkills] = useState<{ name: string; description: string }[]>([]);
    const [isAddingSkill, setIsAddingSkill] = useState(false);
    const [newSkillName, setNewSkillName] = useState("");
    const [newSkillDesc, setNewSkillDesc] = useState("");
    const [newSkillFileName, setNewSkillFileName] = useState("");
    const [newSkillFileContent, setNewSkillFileContent] = useState("");
    const [isDragOver, setIsDragOver] = useState(false);
    const [isSavingSkill, setIsSavingSkill] = useState(false);
    const [skillResult, setSkillResult] = useState<{ success?: boolean; error?: string } | null>(null);

    // Load custom skills on mount
    useEffect(() => {
        const loadCustomSkills = async () => {
            try {
                const skills = await (window as any).electronAPI?.skills?.listCustom?.();
                setCustomSkills(skills || []);
            } catch (e) { console.error('Failed to load custom skills:', e); }
        };
        loadCustomSkills();
    }, []);

    const openCustomSkillsFolder = async () => {
        try {
            const path = await (window as any).electronAPI?.skills?.getCustomPath?.();
            if (path) await (window as any).electronAPI?.system?.openFolder?.(path);
        } catch (e) { console.error('Failed to open folder:', e); }
    };

    const handleAddSkill = async () => {
        if (!newSkillName.trim() || !newSkillDesc.trim() || !newSkillFileContent.trim()) return;
        setIsSavingSkill(true);
        setSkillResult(null);
        try {
            const result = await (window as any).electronAPI?.skills?.saveCustom?.({
                name: newSkillName.trim(),
                description: newSkillDesc.trim(),
                content: newSkillFileContent.trim()
            });
            if (result?.success) {
                setSkillResult({ success: true });
                const skills = await (window as any).electronAPI?.skills?.listCustom?.();
                setCustomSkills(skills || []);
                setNewSkillName("");
                setNewSkillDesc("");
                setNewSkillFileName("");
                setNewSkillFileContent("");
                setTimeout(() => { setIsAddingSkill(false); setSkillResult(null); }, 1000);
            } else {
                setSkillResult({ error: result?.error || 'Failed to save skill' });
            }
        } catch (e) { setSkillResult({ error: String(e) }); }
        setIsSavingSkill(false);
    };

    const handleFileDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);
        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
            const file = files[0];
            if (file.name.endsWith('.md')) {
                const content = await file.text();
                setNewSkillFileName(file.name);
                setNewSkillFileContent(content);
            } else {
                alert('Please drop a .md file');
            }
        }
    };

    const handleFileSelect = async () => {
        try {
            const result = await (window as any).electronAPI?.system?.openFilePicker?.({ filters: [{ name: 'Markdown', extensions: ['md'] }] });
            if (result?.success && result.content) {
                setNewSkillFileName(result.name || 'SKILL.md');
                setNewSkillFileContent(result.content);
            }
        } catch (e) { console.error('Failed to select file:', e); }
    };

    const handleDeleteSkill = async (name: string) => {
        try {
            await (window as any).electronAPI?.skills?.deleteCustom?.(name);
            setCustomSkills(prev => prev.filter(s => s.name !== name));
        } catch (e) { console.error('Failed to delete skill:', e); }
    };

    // Light theme styling constants
    const colors = {
        overlay: "rgba(0, 0, 0, 0.2)",
        background: 'var(--color-bg-surface)',
        sidebarBg: 'var(--color-bg-subtle)',
        border: 'var(--color-border)',
        textPrimary: 'var(--color-text-primary)',
        textSecondary: 'var(--color-text-secondary)',
        textMuted: 'var(--color-text-tertiary)',
        accent: "#000000",
        accentHover: "rgba(0,0,0,0.05)",
        cardBg: 'var(--color-bg-surface)',
        cardHover: 'var(--color-bg-subtle)',
        inputBg: 'var(--color-bg-surface)',
        buttonBg: 'var(--color-bg-surface)',
        buttonHover: 'var(--color-bg-base)',
        primaryButton: 'var(--color-text-primary)',
        primaryButtonText: 'var(--color-bg-surface)',
        primaryButtonHover: "#333333"
    };

    const handleAddClick = (mcp: MCPConnector) => {
        setSelectedMCP(mcp);
        setFormValues({});
    };

    const handleSaveMCP = (e: React.FormEvent) => {
        e.preventDefault();

        if (selectedMCP?.id === 'custom') {
            try {
                const parsedJson = JSON.parse(customJsonConfig);
                console.log("Saving Custom MCP configuration", parsedJson);
                // Here you would typically save to the backend/electron store
                setSelectedMCP(null);
            } catch (err) {
                console.error("Invalid JSON configuration", err);
                alert("Invalid JSON configuration. Please check for syntax errors.");
            }
        } else {
            console.log("Saving MCP configuration for", selectedMCP?.name, formValues);
            // Here you would typically save to the backend/electron store
            setSelectedMCP(null);
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        style={{ position: "absolute", inset: 0, backgroundColor: colors.overlay, backdropFilter: "blur(2px)" }}
                    />

                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 10 }}
                        transition={{ type: "spring", damping: 25, stiffness: 300 }}
                        style={{
                            position: "relative",
                            width: "900px",
                            height: "600px",
                            backgroundColor: colors.background,
                            borderRadius: "16px",
                            boxShadow: "0 20px 40px rgba(0,0,0,0.1), 0 0 0 1px rgba(0,0,0,0.05)",
                            display: "flex",
                            overflow: "hidden"
                        }}
                    >
                        {/* Sidebar */}
                        <div style={{ width: "240px", backgroundColor: colors.sidebarBg, borderRight: `1px solid ${colors.border}`, display: "flex", flexDirection: "column", padding: "20px" }}>
                            <div style={{ fontSize: "20px", fontWeight: 600, color: colors.textPrimary, marginBottom: "24px", fontFamily: 'var(--font-serif, Georgia, serif)' }}>
                                Directory
                            </div>

                            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                {[
                                    { id: 'skills', label: 'Skills', icon: WrenchIcon },
                                    { id: 'mcp', label: 'MCP', icon: CpuChipIcon },
                                    { id: 'plugins', label: 'Plugins', icon: PuzzlePieceIcon },
                                ].map((tab) => (
                                    <button
                                        key={tab.id}
                                        onClick={() => setActiveTab(tab.id as TabType)}
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "12px",
                                            padding: "8px 12px",
                                            borderRadius: "8px",
                                            border: "none",
                                            backgroundColor: activeTab === tab.id ? colors.accentHover : "transparent",
                                            color: activeTab === tab.id ? colors.textPrimary : colors.textSecondary,
                                            fontWeight: activeTab === tab.id ? 600 : 500,
                                            fontSize: "14px",
                                            cursor: "pointer",
                                            transition: "all 0.2s"
                                        }}
                                        onMouseEnter={(e) => {
                                            if (activeTab !== tab.id) {
                                                e.currentTarget.style.backgroundColor = "rgba(0,0,0,0.02)";
                                                e.currentTarget.style.color = colors.textPrimary;
                                            }
                                        }}
                                        onMouseLeave={(e) => {
                                            if (activeTab !== tab.id) {
                                                e.currentTarget.style.backgroundColor = "transparent";
                                                e.currentTarget.style.color = colors.textSecondary;
                                            }
                                        }}
                                    >
                                        <tab.icon width={18} height={18} />
                                        {tab.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Main Content Area */}
                        <div style={{ flex: 1, display: "flex", flexDirection: "column", position: "relative" }}>
                            {/* Close Button */}
                            <button
                                onClick={onClose}
                                style={{
                                    position: "absolute",
                                    top: "16px",
                                    right: "16px",
                                    width: "32px",
                                    height: "32px",
                                    borderRadius: "8px",
                                    border: "none",
                                    backgroundColor: 'transparent',
                                    color: colors.textSecondary,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    cursor: "pointer",
                                    zIndex: 10,
                                    transition: "all 0.2s"
                                }}
                                onMouseEnter={e => {
                                    e.currentTarget.style.backgroundColor = colors.accentHover;
                                    e.currentTarget.style.color = colors.textPrimary;
                                }}
                                onMouseLeave={e => {
                                    e.currentTarget.style.backgroundColor = "transparent";
                                    e.currentTarget.style.color = colors.textSecondary;
                                }}
                            >
                                <XMarkIcon width={20} height={20} />
                            </button>

                            {/* Content Header */}
                            <div style={{ padding: "24px 32px 0", display: "flex", flexDirection: "column", gap: "16px" }}>
                                <div style={{ position: "relative", marginRight: "40px" }}>
                                    <MagnifyingGlassIcon
                                        width={18}
                                        height={18}
                                        style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", color: colors.textMuted }}
                                    />
                                    <input
                                        type="text"
                                        placeholder={`Search ${activeTab === 'mcp' ? 'MCP connectors' : activeTab}...`}
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        style={{
                                            width: "100%",
                                            padding: "10px 14px 10px 40px",
                                            borderRadius: "10px",
                                            border: `1px solid ${colors.border}`,
                                            backgroundColor: colors.inputBg,
                                            color: colors.textPrimary,
                                            fontSize: "14px",
                                            outline: "none",
                                            transition: "border-color 0.2s"
                                        }}
                                        onFocus={e => e.target.style.borderColor = "#cccccc"}
                                        onBlur={e => e.target.style.borderColor = colors.border}
                                    />
                                </div>

                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                                        <div style={{
                                            padding: "4px 12px",
                                            borderRadius: "100px",
                                            backgroundColor: 'var(--color-text-primary)',
                                            color: 'var(--color-bg-surface)',
                                            fontSize: "13px",
                                            fontWeight: 500
                                        }}>
                                            Recent
                                        </div>
                                    </div>
                                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                        {activeTab === 'skills' && (
                                            <>
                                                <button
                                                    onClick={() => { setIsAddingSkill(true); setSkillResult(null); }}
                                                    style={{
                                                        display: "flex", alignItems: "center", gap: "6px",
                                                        padding: "6px 12px", borderRadius: "8px",
                                                        border: `1px solid ${colors.border}`, backgroundColor: 'transparent',
                                                        color: colors.textPrimary, fontSize: "13px", cursor: "pointer",
                                                        fontWeight: 500
                                                    }}>
                                                    <PlusIcon width={14} height={14} /> Add Custom Skill
                                                </button>
                                                <button
                                                    onClick={openCustomSkillsFolder}
                                                    style={{
                                                        display: "flex", alignItems: "center", gap: "6px",
                                                        padding: "6px 12px", borderRadius: "8px",
                                                        border: `1px solid ${colors.border}`, backgroundColor: 'transparent',
                                                        color: colors.textSecondary, fontSize: "13px", cursor: "pointer"
                                                    }}>
                                                    <FolderIcon width={14} height={14} /> Open Folder
                                                </button>
                                            </>
                                        )}
                                        {activeTab === 'mcp' && (
                                            <button
                                                onClick={() => {
                                                    setSelectedMCP({ id: 'custom', name: 'Custom MCP Server', description: 'Configure custom MCP server via JSON', domain: 'custom', fields: [] });
                                                    setCustomJsonConfig(JSON.stringify({
                                                        "mcp": {
                                                            "inputs": [
                                                                {
                                                                    "type": "promptString",
                                                                    "id": "maps_api_key",
                                                                    "description": "Google Maps API Key",
                                                                    "password": true
                                                                }
                                                            ],
                                                            "servers": {
                                                                "google-maps": {
                                                                    "command": "npx",
                                                                    "args": ["-y", "@modelcontextprotocol/server-google-maps"],
                                                                    "env": {
                                                                        "GOOGLE_MAPS_API_KEY": "${input:maps_api_key}"
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    }, null, 2));
                                                }}
                                                style={{
                                                display: "flex", alignItems: "center", gap: "6px",
                                                padding: "6px 12px", borderRadius: "8px",
                                                border: `1px solid ${colors.border}`, backgroundColor: 'transparent',
                                                color: colors.textPrimary, fontSize: "13px", cursor: "pointer",
                                                fontWeight: 500
                                            }}>
                                                <PlusIcon width={14} height={14} /> Add Custom
                                            </button>
                                        )}
                                        <button style={{
                                            display: "flex", alignItems: "center", gap: "6px",
                                            padding: "6px 12px", borderRadius: "8px",
                                            border: `1px solid ${colors.border}`, backgroundColor: 'transparent',
                                            color: colors.textSecondary, fontSize: "13px", cursor: "pointer"
                                        }}>
                                            Filter by <ChevronDownIcon width={14} height={14} />
                                        </button>
                                        <button style={{
                                            display: "flex", alignItems: "center", gap: "6px",
                                            padding: "6px 12px", borderRadius: "8px",
                                            border: `1px solid ${colors.border}`, backgroundColor: 'transparent',
                                            color: colors.textSecondary, fontSize: "13px", cursor: "pointer"
                                        }}>
                                            Sort by <ChevronDownIcon width={14} height={14} />
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Grid Area */}
                            <div style={{ flex: 1, overflowY: "auto", padding: "24px 32px" }}>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                                    {activeTab === 'mcp' && MCP_CONNECTORS.filter(m => m.name.toLowerCase().includes(searchQuery.toLowerCase())).map((mcp) => (
                                        <div key={mcp.id} style={{
                                            border: `1px solid ${colors.border}`,
                                            borderRadius: "12px",
                                            padding: "16px",
                                            backgroundColor: colors.cardBg,
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: "12px",
                                            transition: "all 0.2s",
                                            cursor: "pointer"
                                        }}
                                        onMouseEnter={e => {
                                            e.currentTarget.style.backgroundColor = colors.cardHover;
                                            e.currentTarget.style.borderColor = "#d0d0d0";
                                            e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.03)";
                                        }}
                                        onMouseLeave={e => {
                                            e.currentTarget.style.backgroundColor = colors.cardBg;
                                            e.currentTarget.style.borderColor = colors.border;
                                            e.currentTarget.style.boxShadow = "none";
                                        }}
                                        onClick={() => handleAddClick(mcp)}
                                        >
                                            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                                                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                                                    <div style={{
                                                        width: "36px", height: "36px",
                                                        borderRadius: "8px",
                                                        backgroundColor: 'var(--color-bg-subtle)',
                                                        display: "flex", alignItems: "center", justifyContent: "center",
                                                        overflow: "hidden"
                                                    }}>
                                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                                        <img
                                                            src={mcp.logo ? `/images/integrations/${mcp.logo}` : `https://logo.clearbit.com/${mcp.domain}`}
                                                            alt={mcp.name}
                                                            style={{ width: "24px", height: "24px", objectFit: "contain" }}
                                                            onError={(e) => {
                                                                (e.target as HTMLImageElement).src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="%23999999"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>';
                                                            }}
                                                        />
                                                    </div>
                                                    <div style={{ fontSize: "14px", fontWeight: 600, color: colors.textPrimary }}>
                                                        {mcp.name}
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); handleAddClick(mcp); }}
                                                    style={{
                                                        width: "28px", height: "28px", borderRadius: "8px",
                                                        border: "none", backgroundColor: 'transparent', color: colors.textSecondary,
                                                        display: "flex", alignItems: "center", justifyContent: "center",
                                                        cursor: "pointer", transition: "all 0.2s"
                                                    }}
                                                    onMouseEnter={e => {
                                                        e.currentTarget.style.backgroundColor = colors.buttonHover;
                                                        e.currentTarget.style.color = colors.textPrimary;
                                                    }}
                                                    onMouseLeave={e => {
                                                        e.currentTarget.style.backgroundColor = "transparent";
                                                        e.currentTarget.style.color = colors.textSecondary;
                                                    }}
                                                >
                                                    <PlusIcon width={16} height={16} />
                                                </button>
                                            </div>
                                            <div style={{ fontSize: "13px", color: colors.textSecondary, lineHeight: 1.5 }}>
                                                {mcp.description}
                                            </div>
                                        </div>
                                    ))}

                                    {activeTab === 'skills' && SKILLS.filter(s => s.name.toLowerCase().includes(searchQuery.toLowerCase())).map((skill) => (
                                        <div key={skill.id} style={{
                                            border: `1px solid ${colors.border}`,
                                            borderRadius: "12px",
                                            padding: "16px",
                                            backgroundColor: colors.cardBg,
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: "12px",
                                            transition: "all 0.2s",
                                            cursor: "pointer"
                                        }}
                                        onMouseEnter={e => {
                                            e.currentTarget.style.backgroundColor = colors.cardHover;
                                            e.currentTarget.style.borderColor = "#d0d0d0";
                                            e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.03)";
                                        }}
                                        onMouseLeave={e => {
                                            e.currentTarget.style.backgroundColor = colors.cardBg;
                                            e.currentTarget.style.borderColor = colors.border;
                                            e.currentTarget.style.boxShadow = "none";
                                        }}
                                        >
                                            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                                                <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                                    <div style={{ fontSize: "14px", fontWeight: 600, color: colors.textPrimary }}>
                                                        {skill.name}
                                                    </div>
                                                    <div style={{ fontSize: "12px", color: colors.textMuted, display: "flex", alignItems: "center", gap: "6px" }}>
                                                        <span>{skill.author}</span>
                                                        <span>•</span>
                                                        <span style={{ display: "flex", alignItems: "center", gap: "2px" }}>
                                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                                            {skill.downloads}
                                                        </span>
                                                    </div>
                                                </div>
                                                {skill.isBuiltIn ? (
                                                    <div style={{
                                                        display: "flex", alignItems: "center", gap: "4px",
                                                        padding: "4px 8px", borderRadius: "6px",
                                                        backgroundColor: "rgba(0,0,0,0.04)", color: colors.textSecondary,
                                                        fontSize: "12px", fontWeight: 500
                                                    }}>
                                                        <CheckIcon width={14} height={14} />
                                                        Installed
                                                    </div>
                                                ) : (
                                                    <button
                                                        style={{
                                                            width: "28px", height: "28px", borderRadius: "8px",
                                                            border: "none", backgroundColor: 'transparent', color: colors.textSecondary,
                                                            display: "flex", alignItems: "center", justifyContent: "center",
                                                            cursor: "pointer", transition: "all 0.2s"
                                                        }}
                                                        onMouseEnter={e => {
                                                            e.currentTarget.style.backgroundColor = colors.buttonHover;
                                                            e.currentTarget.style.color = colors.textPrimary;
                                                        }}
                                                        onMouseLeave={e => {
                                                            e.currentTarget.style.backgroundColor = "transparent";
                                                            e.currentTarget.style.color = colors.textSecondary;
                                                        }}
                                                    >
                                                        <TrashIcon width={16} height={16} />
                                                    </button>
                                                )}
                                            </div>
                                            <div style={{ fontSize: "13px", color: colors.textSecondary, lineHeight: 1.5 }}>
                                                {skill.description}
                                            </div>
                                        </div>
                                    ))}

                                    {/* Custom Skills Section */}
                                    {activeTab === 'skills' && customSkills.length > 0 && (
                                        <>
                                            <div style={{ gridColumn: "1 / -1", fontSize: "13px", fontWeight: 600, color: colors.textSecondary, marginTop: "16px", paddingBottom: "8px", borderBottom: `1px solid ${colors.border}` }}>
                                                Custom Skills
                                            </div>
                                            {customSkills.map(skill => (
                                                <div key={skill.name} style={{
                                                    border: `1px solid ${colors.border}`,
                                                    borderRadius: "12px",
                                                    padding: "16px",
                                                    backgroundColor: colors.cardBg,
                                                    display: "flex",
                                                    flexDirection: "column",
                                                    gap: "12px",
                                                    cursor: "default"
                                                }}>
                                                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                                                        <div style={{ fontSize: "14px", fontWeight: 600, color: colors.textPrimary }}>
                                                            {skill.name}
                                                        </div>
                                                        <button
                                                            onClick={() => handleDeleteSkill(skill.name)}
                                                            style={{
                                                                width: "28px", height: "28px", borderRadius: "8px",
                                                                border: "none", backgroundColor: 'transparent', color: colors.textSecondary,
                                                                display: "flex", alignItems: "center", justifyContent: "center",
                                                                cursor: "pointer", transition: "all 0.2s"
                                                            }}
                                                            onMouseEnter={e => {
                                                                e.currentTarget.style.backgroundColor = colors.buttonHover;
                                                                e.currentTarget.style.color = colors.textPrimary;
                                                            }}
                                                            onMouseLeave={e => {
                                                                e.currentTarget.style.backgroundColor = "transparent";
                                                                e.currentTarget.style.color = colors.textSecondary;
                                                            }}
                                                        >
                                                            <TrashIcon width={16} height={16} />
                                                        </button>
                                                    </div>
                                                    <div style={{ fontSize: "13px", color: colors.textSecondary, lineHeight: 1.5 }}>
                                                        {skill.description}
                                                    </div>
                                                </div>
                                            ))}
                                        </>
                                    )}

                                    {activeTab === 'plugins' && (
                                        <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "40px 0", color: colors.textMuted, fontSize: "14px" }}>
                                            No plugins available.
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Add MCP Config Modal / Overlay */}
                        <AnimatePresence>
                            {selectedMCP && (
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    style={{
                                        position: "absolute",
                                        inset: 0,
                                        backgroundColor: "rgba(255, 255, 255, 0.8)",
                                        backdropFilter: "blur(4px)",
                                        zIndex: 20,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center"
                                    }}
                                >
                                    <motion.div
                                        initial={{ scale: 0.95, y: 20 }}
                                        animate={{ scale: 1, y: 0 }}
                                        exit={{ scale: 0.95, y: 20 }}
                                        style={{
                                            width: "480px",
                                            backgroundColor: 'var(--color-bg-surface)',
                                            borderRadius: "16px",
                                            boxShadow: "0 24px 48px rgba(0,0,0,0.1), 0 0 0 1px rgba(0,0,0,0.05)",
                                            overflow: "hidden",
                                            display: "flex",
                                            flexDirection: "column"
                                        }}
                                    >
                                        <div style={{
                                            padding: "20px 24px",
                                            borderBottom: `1px solid ${colors.border}`,
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "space-between"
                                        }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                                                <div style={{
                                                    width: "32px", height: "32px",
                                                    borderRadius: "8px",
                                                    backgroundColor: 'var(--color-bg-subtle)',
                                                    display: "flex", alignItems: "center", justifyContent: "center",
                                                    overflow: "hidden"
                                                }}>
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <img
                                                        src={selectedMCP.logo ? `/images/integrations/${selectedMCP.logo}` : `https://logo.clearbit.com/${selectedMCP.domain}`}
                                                        alt={selectedMCP.name}
                                                        style={{ width: "20px", height: "20px", objectFit: "contain" }}
                                                        onError={(e) => {
                                                            (e.target as HTMLImageElement).src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="%23999999"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>';
                                                        }}
                                                    />
                                                </div>
                                                <div style={{ fontSize: "16px", fontWeight: 600, color: colors.textPrimary }}>
                                                    Add {selectedMCP.name}
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => setSelectedMCP(null)}
                                                style={{
                                                    width: "28px", height: "28px", borderRadius: "8px",
                                                    border: "none", backgroundColor: 'transparent', color: colors.textSecondary,
                                                    display: "flex", alignItems: "center", justifyContent: "center",
                                                    cursor: "pointer", transition: "all 0.2s"
                                                }}
                                                onMouseEnter={e => {
                                                    e.currentTarget.style.backgroundColor = colors.buttonHover;
                                                    e.currentTarget.style.color = colors.textPrimary;
                                                }}
                                                onMouseLeave={e => {
                                                    e.currentTarget.style.backgroundColor = "transparent";
                                                    e.currentTarget.style.color = colors.textSecondary;
                                                }}
                                            >
                                                <XMarkIcon width={18} height={18} />
                                            </button>
                                        </div>

                                        <form onSubmit={handleSaveMCP} style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "16px" }}>
                                            <div style={{ fontSize: "13px", color: colors.textSecondary, marginBottom: "8px" }}>
                                                Provide configuration details to connect with {selectedMCP.name}.
                                            </div>

                                            {selectedMCP.id === 'custom' ? (
                                                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                                    <label style={{ fontSize: "13px", fontWeight: 500, color: colors.textPrimary }}>
                                                        Configuration (JSON)
                                                    </label>
                                                    <textarea
                                                        value={customJsonConfig}
                                                        onChange={(e) => setCustomJsonConfig(e.target.value)}
                                                        style={{
                                                            padding: "10px 12px",
                                                            borderRadius: "8px",
                                                            border: `1px solid ${colors.border}`,
                                                            backgroundColor: colors.inputBg,
                                                            color: colors.textPrimary,
                                                            fontSize: "13px",
                                                            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                                                            outline: "none",
                                                            transition: "border-color 0.2s",
                                                            minHeight: "200px",
                                                            resize: "vertical"
                                                        }}
                                                        onFocus={e => e.target.style.borderColor = "#cccccc"}
                                                        onBlur={e => e.target.style.borderColor = colors.border}
                                                    />
                                                </div>
                                            ) : (
                                                selectedMCP.fields.map(field => (
                                                    <div key={field.key} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                                        <label style={{ fontSize: "13px", fontWeight: 500, color: colors.textPrimary }}>
                                                            {field.label}
                                                        </label>
                                                        <input
                                                            type={field.type}
                                                            placeholder={field.placeholder}
                                                            value={formValues[field.key] || ''}
                                                            onChange={(e) => setFormValues({ ...formValues, [field.key]: e.target.value })}
                                                            required
                                                            style={{
                                                                padding: "10px 12px",
                                                                borderRadius: "8px",
                                                                border: `1px solid ${colors.border}`,
                                                                backgroundColor: colors.inputBg,
                                                                color: colors.textPrimary,
                                                                fontSize: "14px",
                                                                outline: "none",
                                                                transition: "border-color 0.2s"
                                                            }}
                                                            onFocus={e => e.target.style.borderColor = "#cccccc"}
                                                            onBlur={e => e.target.style.borderColor = colors.border}
                                                        />
                                                    </div>
                                                ))
                                            )}

                                            <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", marginTop: "16px" }}>
                                                <button
                                                    type="button"
                                                    onClick={() => setSelectedMCP(null)}
                                                    style={{
                                                        padding: "8px 16px",
                                                        borderRadius: "8px",
                                                        border: `1px solid ${colors.border}`,
                                                        backgroundColor: 'transparent',
                                                        color: colors.textPrimary,
                                                        fontSize: "13px",
                                                        fontWeight: 500,
                                                        cursor: "pointer",
                                                        transition: "all 0.2s"
                                                    }}
                                                    onMouseEnter={e => e.currentTarget.style.backgroundColor = colors.buttonHover}
                                                    onMouseLeave={e => e.currentTarget.style.backgroundColor = "transparent"}
                                                >
                                                    Cancel
                                                </button>
                                                <button
                                                    type="submit"
                                                    style={{
                                                        padding: "8px 16px",
                                                        borderRadius: "8px",
                                                        border: "none",
                                                        backgroundColor: colors.primaryButton,
                                                        color: colors.primaryButtonText,
                                                        fontSize: "13px",
                                                        fontWeight: 500,
                                                        cursor: "pointer",
                                                        transition: "all 0.2s"
                                                    }}
                                                    onMouseEnter={e => e.currentTarget.style.backgroundColor = colors.primaryButtonHover}
                                                    onMouseLeave={e => e.currentTarget.style.backgroundColor = colors.primaryButton}
                                                >
                                                    Connect
                                                </button>
                                            </div>
                                        </form>
                                    </motion.div>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Add Custom Skill Modal */}
                        <AnimatePresence>
                            {isAddingSkill && (
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    style={{
                                        position: "absolute",
                                        inset: 0,
                                        backgroundColor: "rgba(255, 255, 255, 0.8)",
                                        backdropFilter: "blur(4px)",
                                        zIndex: 30,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center"
                                    }}
                                >
                                    <motion.div
                                        initial={{ scale: 0.95, y: 20 }}
                                        animate={{ scale: 1, y: 0 }}
                                        exit={{ scale: 0.95, y: 20 }}
                                        style={{
                                            width: "480px",
                                            backgroundColor: 'var(--color-bg-surface)',
                                            borderRadius: "16px",
                                            boxShadow: "0 24px 48px rgba(0,0,0,0.1)",
                                            overflow: "hidden",
                                            display: "flex",
                                            flexDirection: "column"
                                        }}
                                    >
                                        <div style={{
                                            padding: "20px 24px",
                                            borderBottom: `1px solid ${colors.border}`,
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "space-between"
                                        }}>
                                            <div style={{ fontSize: "16px", fontWeight: 600, color: colors.textPrimary }}>
                                                Create Custom Skill
                                            </div>
                                            <button
                                                onClick={() => setIsAddingSkill(false)}
                                                style={{
                                                    width: "28px", height: "28px", borderRadius: "8px",
                                                    border: "none", backgroundColor: 'transparent', color: colors.textSecondary,
                                                    display: "flex", alignItems: "center", justifyContent: "center",
                                                    cursor: "pointer"
                                                }}
                                            >
                                                <XMarkIcon width={18} height={18} />
                                            </button>
                                        </div>
                                        <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "16px" }}>
                                            <div style={{ fontSize: "13px", color: colors.textSecondary }}>
                                                Create a custom skill that EverFern can use for specific tasks.
                                            </div>
                                            <div>
                                                <label style={{ fontSize: "13px", fontWeight: 500, color: colors.textPrimary, display: "block", marginBottom: "6px" }}>
                                                    Skill Name
                                                </label>
                                                <input
                                                    type="text"
                                                    placeholder="e.g., my-analysis-skill"
                                                    value={newSkillName}
                                                    onChange={e => setNewSkillName(e.target.value)}
                                                    style={{
                                                        width: "100%",
                                                        padding: "10px 12px",
                                                        borderRadius: "8px",
                                                        border: `1px solid ${colors.border}`,
                                                        backgroundColor: colors.inputBg,
                                                        color: colors.textPrimary,
                                                        fontSize: "14px",
                                                        outline: "none"
                                                    }}
                                                />
                                            </div>
                                            <div>
                                                <label style={{ fontSize: "13px", fontWeight: 500, color: colors.textPrimary, display: "block", marginBottom: "6px" }}>
                                                    Description
                                                </label>
                                                <input
                                                    type="text"
                                                    placeholder="Use this skill for..."
                                                    value={newSkillDesc}
                                                    onChange={e => setNewSkillDesc(e.target.value)}
                                                    style={{
                                                        width: "100%",
                                                        padding: "10px 12px",
                                                        borderRadius: "8px",
                                                        border: `1px solid ${colors.border}`,
                                                        backgroundColor: colors.inputBg,
                                                        color: colors.textPrimary,
                                                        fontSize: "14px",
                                                        outline: "none"
                                                    }}
                                                />
                                            </div>
                                            <div onClick={handleFileSelect} onDrop={handleFileDrop} onDragOver={e => { e.preventDefault(); setIsDragOver(true); }} onDragLeave={() => setIsDragOver(false)}
                                                style={{
                                                    width: "100%",
                                                    minHeight: "150px",
                                                    padding: "24px",
                                                    borderRadius: "8px",
                                                    border: `2px dashed ${isDragOver ? colors.accent : colors.border}`,
                                                    backgroundColor: isDragOver ? 'rgba(0,0,0,0.04)' : colors.inputBg,
                                                    color: colors.textSecondary,
                                                    fontSize: "14px",
                                                    display: "flex",
                                                    flexDirection: "column",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                    gap: "10px",
                                                    cursor: "pointer",
                                                    transition: "all 0.2s"
                                                }}
                                                >
                                                    {newSkillFileName ? (
                                                        <React.Fragment>
                                                            <CheckIcon width={24} height={24} style={{ color: '#22c55e' }} />
                                                            <div style={{ color: colors.textPrimary, fontWeight: 500 }}>{newSkillFileName}</div>
                                                            <div style={{ fontSize: "12px" }}>Click to change or drag a different file</div>
                                                        </React.Fragment>
                                                    ) : (
                                                        <React.Fragment>
                                                        <WrenchIcon width={24} height={24} />
                                                        <div>Drop SKILL.md file here</div>
                                                        <div style={{ fontSize: "12px" }}>or click to browse</div>
                                                        </React.Fragment>
                                                )}
                                            </div>
                                            {skillResult && (
                                                <div style={{ padding: "10px 14px", borderRadius: 8, backgroundColor: skillResult.success ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)', color: skillResult.success ? '#16a34a' : '#dc2626', fontSize: 13 }}>
                                                    {skillResult.success ? '✓ Skill saved! It will be available in the Skills tab.' : skillResult.error}
                                                </div>
                                            )}
                                            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                                                <button
                                                    onClick={() => { setIsAddingSkill(false); setNewSkillName(''); setNewSkillDesc(''); setNewSkillFileName(''); setNewSkillFileContent(''); setSkillResult(null); }}
                                                    style={{
                                                        padding: "8px 16px",
                                                        borderRadius: "8px",
                                                        border: `1px solid ${colors.border}`,
                                                        backgroundColor: 'transparent',
                                                        color: colors.textPrimary,
                                                        fontSize: "13px",
                                                        fontWeight: 500,
                                                        cursor: "pointer"
                                                    }}
                                                >
                                                    Cancel
                                                </button>
                                                <button
                                                    onClick={handleAddSkill}
                                                    disabled={isSavingSkill || !newSkillName.trim() || !newSkillDesc.trim() || !newSkillFileContent.trim()}
                                                    style={{
                                                        padding: "8px 16px",
                                                        borderRadius: "8px",
                                                        border: "none",
                                                        backgroundColor: colors.primaryButton,
                                                        color: colors.primaryButtonText,
                                                        fontSize: "13px",
                                                        fontWeight: 500,
                                                        cursor: isSavingSkill ? "not-allowed" : "pointer",
                                                        opacity: isSavingSkill ? 0.6 : 1
                                                    }}
                                                >
                                                    {isSavingSkill ? 'Saving...' : 'Save Skill'}
                                                </button>
                                            </div>
                                        </div>
                                    </motion.div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
