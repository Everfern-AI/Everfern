"use client";

import React, { useCallback, useEffect, useState } from "react";
import { ChevronRight, Plus, FileJson, RotateCw, Pencil, Trash2 } from "lucide-react";

type Kind = "command" | "url" | "docker";

interface McpConfig {
    name: string;
    command?: string;
    args?: string[];
    docker?: string;
    url?: string;
    headers?: Record<string, string>;
    env?: Record<string, string>;
    enabled?: boolean;
}

interface McpStatus {
    config: McpConfig;
    state: "connecting" | "connected" | "error" | "disabled";
    error?: string;
    tools: { name: string; agentName: string; description: string }[];
}

interface Draft {
    previousName?: string;
    name: string;
    kind: Kind;
    target: string;
    pairs: string;
}

const api = () => (typeof window !== "undefined" ? (window as any).electronAPI?.mcp : undefined);

const EMPTY_DRAFT: Draft = { name: "", kind: "command", target: "", pairs: "" };

const IMPORT_EXAMPLE = `{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:/Users/me/Documents"]
    }
  }
}`;

function toPairs(map?: Record<string, string>): string {
    return Object.entries(map || {}).map(([k, v]) => `${k}=${v}`).join("\n");
}

function fromPairs(text: string, sep: "=" | ":"): Record<string, string> | undefined {
    const out: Record<string, string> = {};
    for (const line of text.split("\n")) {
        const t = line.trim();
        if (!t) continue;
        const i = t.indexOf(sep) > 0 ? t.indexOf(sep) : t.indexOf("=");
        if (i <= 0) continue;
        out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
    return Object.keys(out).length ? out : undefined;
}

function draftFrom(s: McpStatus): Draft {
    const c = s.config;
    if (c.url) return { previousName: c.name, name: c.name, kind: "url", target: c.url, pairs: toPairs(c.headers) };
    if (c.docker) return { previousName: c.name, name: c.name, kind: "docker", target: c.docker, pairs: toPairs(c.env) };
    const target = [c.command, ...(c.args || []).map(a => (/\s/.test(a) ? `"${a}"` : a))].filter(Boolean).join(" ");
    return { previousName: c.name, name: c.name, kind: "command", target, pairs: toPairs(c.env) };
}

function configFrom(d: Draft, enabled: boolean | undefined): McpConfig {
    const name = d.name.trim();
    const target = d.target.trim();
    if (d.kind === "url") return { name, url: target, headers: fromPairs(d.pairs, ":"), enabled };
    if (d.kind === "docker") return { name, docker: target, env: fromPairs(d.pairs, "="), enabled };
    return { name, command: target, env: fromPairs(d.pairs, "="), enabled };
}

function summary(c: McpConfig): string {
    if (c.url) return c.url;
    if (c.docker) return `docker ${c.docker}`;
    return [c.command, ...(c.args || [])].filter(Boolean).join(" ");
}

function stateText(s: McpStatus): string {
    switch (s.state) {
        case "connected": return s.tools.length === 1 ? "1 tool" : `${s.tools.length} tools`;
        case "connecting": return "Connecting…";
        case "disabled": return "Off";
        default: return "Not connected";
    }
}

export default function McpServersSection() {
    const [servers, setServers] = useState<McpStatus[] | null>(null);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [importText, setImportText] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [formError, setFormError] = useState("");
    const [open, setOpen] = useState<string | null>(null);
    const available = !!api();

    const refresh = useCallback(async () => {
        try { setServers(await api()?.list?.() ?? []); } catch { setServers([]); }
    }, []);

    useEffect(() => {
        if (!available) { setServers([]); return; }
        refresh();
        const off = api()?.onChange?.((s: McpStatus[]) => setServers(s));
        return () => { if (typeof off === "function") off(); };
    }, [available, refresh]);

    const save = async () => {
        if (!draft) return;
        const name = draft.name.trim();
        if (!name) return setFormError("Give the server a name.");
        if (!draft.target.trim()) return setFormError(draft.kind === "url" ? "Enter the server URL." : draft.kind === "docker" ? "Enter the Docker image." : "Enter the command that starts the server.");
        if (draft.kind === "url" && !/^https?:\/\//i.test(draft.target.trim())) return setFormError("The URL must start with http:// or https://.");
        if (name !== draft.previousName && servers?.some(s => s.config.name === name)) return setFormError(`A server named "${name}" already exists.`);
        const prev = servers?.find(s => s.config.name === draft.previousName);
        setBusy(true); setFormError("");
        const res = await api()?.save?.(configFrom(draft, prev?.config.enabled), draft.previousName);
        setBusy(false);
        if (res && !res.success) return setFormError(res.error || "Could not save the server.");
        setDraft(null);
        setOpen(name);
        refresh();
    };

    const doImport = async () => {
        if (importText === null) return;
        try { JSON.parse(importText); } catch (e: any) { return setFormError(`That is not valid JSON: ${e?.message || e}`); }
        setBusy(true); setFormError("");
        const res = await api()?.importJson?.(importText);
        setBusy(false);
        if (res && !res.success) return setFormError(res.error || "Nothing was imported.");
        setImportText(null);
        refresh();
    };

    const remove = async (name: string) => {
        if (!window.confirm(`Remove the "${name}" MCP server? Its tools will no longer be available to the agent.`)) return;
        await api()?.remove?.(name);
        refresh();
    };

    const editing = draft !== null || importText !== null;

    return (
        <div className="mcp">
            <h2 className="mcp-title">MCP servers</h2>
            <p className="mcp-sub">
                Connect Model Context Protocol servers to give the agent new tools. Servers start with EverFern, and their tools are offered in every chat. Ask in chat to connect one too.
            </p>

            {!available && (
                <div className="mcp-note">MCP servers run in the desktop app. Open EverFern on your computer to manage them.</div>
            )}

            {available && !editing && (
                <div className="mcp-bar">
                    <button className="mcp-btn is-primary" onClick={() => { setFormError(""); setDraft({ ...EMPTY_DRAFT }); }}><Plus size={13} /> Add server</button>
                    <button className="mcp-btn" onClick={() => { setFormError(""); setImportText(""); }}><FileJson size={13} /> Import JSON</button>
                </div>
            )}

            {draft && (
                <div className="mcp-form">
                    <div className="mcp-form-head">{draft.previousName ? `Edit ${draft.previousName}` : "Add a server"}</div>
                    <label className="mcp-field">
                        <span>Name</span>
                        <input value={draft.name} autoFocus placeholder="github" onChange={e => setDraft({ ...draft, name: e.target.value })} />
                    </label>
                    <div className="mcp-field">
                        <span>Runs as</span>
                        <div className="mcp-kind" role="radiogroup" aria-label="How the server runs">
                            {([["command", "Local command"], ["url", "Remote URL"], ["docker", "Docker image"]] as [Kind, string][]).map(([k, label]) => (
                                <button key={k} role="radio" aria-checked={draft.kind === k} className={draft.kind === k ? "is-on" : ""} onClick={() => setDraft({ ...draft, kind: k })}>{label}</button>
                            ))}
                        </div>
                    </div>
                    <label className="mcp-field">
                        <span>{draft.kind === "url" ? "URL" : draft.kind === "docker" ? "Image and flags" : "Command"}</span>
                        <input
                            className="is-mono"
                            value={draft.target}
                            placeholder={draft.kind === "url" ? "https://mcp.example.com/mcp" : draft.kind === "docker" ? "ghcr.io/github/github-mcp-server" : "npx -y @modelcontextprotocol/server-filesystem C:/Users/me/Documents"}
                            onChange={e => setDraft({ ...draft, target: e.target.value })}
                            onKeyDown={e => { if (e.key === "Enter") save(); }}
                        />
                    </label>
                    <label className="mcp-field">
                        <span>{draft.kind === "url" ? "Headers" : "Environment variables"} <em>optional, one per line</em></span>
                        <textarea
                            className="is-mono"
                            rows={3}
                            value={draft.pairs}
                            placeholder={draft.kind === "url" ? "Authorization: Bearer …" : "GITHUB_TOKEN=…"}
                            onChange={e => setDraft({ ...draft, pairs: e.target.value })}
                        />
                    </label>
                    {formError && <div className="mcp-error" role="alert">{formError}</div>}
                    <div className="mcp-form-actions">
                        <button className="mcp-btn" onClick={() => { setDraft(null); setFormError(""); }} disabled={busy}>Cancel</button>
                        <button className="mcp-btn is-primary" onClick={save} disabled={busy}>{busy ? "Connecting…" : draft.previousName ? "Save and reconnect" : "Save and connect"}</button>
                    </div>
                </div>
            )}

            {importText !== null && (
                <div className="mcp-form">
                    <div className="mcp-form-head">Import from JSON</div>
                    <p className="mcp-hint">Paste an <code>mcpServers</code> block from Claude Desktop, Cursor or a server&rsquo;s README. Servers with the same name are replaced.</p>
                    <textarea className="is-mono" rows={9} autoFocus value={importText} placeholder={IMPORT_EXAMPLE} onChange={e => setImportText(e.target.value)} />
                    {formError && <div className="mcp-error" role="alert">{formError}</div>}
                    <div className="mcp-form-actions">
                        <button className="mcp-btn" onClick={() => { setImportText(null); setFormError(""); }} disabled={busy}>Cancel</button>
                        <button className="mcp-btn is-primary" onClick={doImport} disabled={busy || !importText.trim()}>{busy ? "Connecting…" : "Import and connect"}</button>
                    </div>
                </div>
            )}

            {available && servers === null && <div className="mcp-empty">Loading servers…</div>}

            {available && servers?.length === 0 && !editing && (
                <div className="mcp-empty">
                    No servers yet. Add one by command or URL, or import the JSON a server&rsquo;s README gives you.
                </div>
            )}

            {servers && servers.length > 0 && (
                <ul className="mcp-list">
                    {servers.map(s => {
                        const name = s.config.name;
                        const isOpen = open === name;
                        const on = s.config.enabled !== false;
                        return (
                            <li key={name} className={`mcp-row is-${s.state}`}>
                                <div className="mcp-row-main">
                                    <button className="mcp-expand" aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} ${name} tools`} onClick={() => setOpen(isOpen ? null : name)}>
                                        <ChevronRight size={14} className={isOpen ? "is-open" : ""} />
                                    </button>
                                    <div className="mcp-row-text" onClick={() => setOpen(isOpen ? null : name)}>
                                        <div className="mcp-row-name">
                                            <span className="mcp-dot" aria-hidden="true" />
                                            {name}
                                            <span className="mcp-state">{stateText(s)}</span>
                                        </div>
                                        <div className="mcp-row-cmd" title={summary(s.config)}>{summary(s.config)}</div>
                                    </div>
                                    <div className="mcp-row-actions">
                                        <button className="mcp-icon" title="Reconnect" aria-label={`Reconnect ${name}`} disabled={!on || s.state === "connecting"} onClick={() => api()?.reconnect?.(name)}><RotateCw size={13} /></button>
                                        <button className="mcp-icon" title="Edit" aria-label={`Edit ${name}`} onClick={() => { setFormError(""); setImportText(null); setDraft(draftFrom(s)); }}><Pencil size={13} /></button>
                                        <button className="mcp-icon" title="Remove" aria-label={`Remove ${name}`} onClick={() => remove(name)}><Trash2 size={13} /></button>
                                        <button
                                            role="switch"
                                            aria-checked={on}
                                            aria-label={`${on ? "Turn off" : "Turn on"} ${name}`}
                                            className={`mcp-switch${on ? " is-on" : ""}`}
                                            onClick={() => api()?.setEnabled?.(name, !on)}
                                        ><span /></button>
                                    </div>
                                </div>
                                {s.state === "error" && s.error && <div className="mcp-row-error">{s.error}</div>}
                                {isOpen && (
                                    <div className="mcp-tools">
                                        {s.tools.length === 0 ? (
                                            <div className="mcp-tools-empty">{s.state === "connected" ? "This server exposes no tools." : "Tools appear once the server connects."}</div>
                                        ) : s.tools.map(t => (
                                            <div key={t.agentName} className="mcp-tool">
                                                <code>{t.name}</code>
                                                {t.description && <span>{t.description}</span>}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
