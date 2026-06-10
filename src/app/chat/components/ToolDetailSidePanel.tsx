'use client';

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { diffLines, diffWords } from 'diff';
import Ansi from 'ansi-to-react';
import {
  X, Terminal, Search, Globe, CameraOff, Maximize2, Copy, Check,
  Clock, CheckCircle, ExternalLink,
  Braces, ChevronDown, AlertCircle, Play, Pause,
  BookOpen, Shield, Image, File as FileIcon, Plus, PanelRightOpen,
  Files, Folder, ChevronRight, MoreHorizontal
} from 'lucide-react';
import { FolderOpenIcon } from '@heroicons/react/24/outline';
import { MarkdownViewer } from './FileViewerModal';

/* ============================================================
   ANIMATIONS & STYLES
   ============================================================ */
const animationStyles = `
  @keyframes pulse {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.4;
    }
  }

  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
`;

// Inject animation styles
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = animationStyles;
  document.head.appendChild(style);
}

/* ============================================================
   TYPES
   ============================================================ */
export const ToolType = {
  MCP_REGISTRY: 'mcp_registry',
  WEB_SEARCH: 'web_search',
  FERN: 'fern',
  TERMINAL: 'terminal',
  SKILL: 'skill',
  FILE_SYSTEM: 'file_system',
  FILE_EDITOR: 'file_editor',
  LOCAL_PERMISSION: 'local_permission',
  TODO_WRITE: 'todo_write',
  PLAN: 'plan',
  PRESENTATION: 'presentation',
  IMAGE_ANALYSIS: 'image_analysis',
  LIVE_PREVIEW: 'live_preview',
  GENERIC: 'generic',
};

/* ============================================================
   TOKENS — single source of truth
   ============================================================ */
const T = {
  // Surfaces
  bg: '#fafafa',
  surface: '#fff',
  surfaceRaised: '#f5f5f4',
  border: '#e8e8e6',
  borderSubtle: '#f0f0ee',

  // Text
  text: '#141412',
  textSecondary: '#6b6b67',
  textMuted: '#a8a8a3',
  textPlaceholder: '#c8c8c3',

  // Ink (terminal / code) - Updated to be friendlier and match app design
  inkBg: '#f8f7f5',
  inkSurface: '#faf9f7',
  inkBorder: '#e8e6d9',
  inkText: '#2d2d2a',
  inkMuted: '#a8a8a3',

  // Semantic
  green: '#22c55e',
  greenFaint: 'rgba(34,197,94,0.08)',
  red: '#ef4444',
  redFaint: 'rgba(239,68,68,0.07)',
  amber: '#f59e0b',
  blue: '#3b82f6',
  blueFaint: 'rgba(59,130,246,0.08)',

  // Radius
  r4: 4, r6: 6, r8: 8, r10: 10, r12: 12, r14: 14, r16: 16,

  // Font stacks
  sans: '"Geist", "DM Sans", ui-sans-serif, system-ui, sans-serif',
  mono: '"Geist Mono", "Berkeley Mono", ui-monospace, "SF Mono", Menlo, monospace',
};

/* ============================================================
   UTILITIES
   ============================================================ */
export function detectToolType(toolName: string | undefined | null): string {
  if (!toolName) return ToolType.GENERIC;
  const n = toolName.toLowerCase();
  if (n === 'skill') return ToolType.SKILL;
  if (n === 'show_user_url' || n.includes('preview_live_url')) return ToolType.LIVE_PREVIEW;
  if (n === 'search_mcp_registry' || n.includes('mcp_registry')) return ToolType.MCP_REGISTRY;
  if (n === 'ls' || n === 'grep' || n === 'find' || n.includes('grep_search') || n.includes('list_dir') || n.includes('system_files')) return ToolType.FILE_SYSTEM;
  if (n.includes('web_search') || n.includes('remote_web_search')) return ToolType.WEB_SEARCH;
  if (n.includes('fern') || n.includes('navis') || n.includes('browser') || n.includes('computer_use')) return ToolType.FERN;
  if (n.includes('run_command') || n.includes('bash') || n.includes('run_terminal') || n.includes('execute')) return ToolType.TERMINAL;
  if (n === 'create_plan' || n === 'execution_plan' || n === 'update_plan' || n === 'update_plan_step') return ToolType.PLAN;
  if (n === 'pptx_generator') return ToolType.PRESENTATION;
  if (n === 'todo_write' || n.includes('todo_write')) return ToolType.TODO_WRITE;
  if (n === 'read' || n === 'read_file' || n === 'view_file' || n.includes('write') || n.includes('replace') || n.includes('edit')) return ToolType.FILE_EDITOR;
  if (n === 'local_permission') return ToolType.LOCAL_PERMISSION;
  if (n === 'analyze_image' || n.includes('analyze_image') || n === 'visual_classification_sheet') return ToolType.IMAGE_ANALYSIS;
  return ToolType.GENERIC;
}

function shouldRenderLocalPermissionAsTerminal(toolCall: any): boolean {
  if ((toolCall?.toolName || '').toLowerCase() !== 'local_permission') return false;
  const output = String(toolCall?.output || toolCall?.result?.output || '');
  return toolCall?.status === 'done' || toolCall?.status === 'error' || /local command (completed|failed)|command:|output:/i.test(output);
}

export function formatTimestamp(ts: any): string {
  return new Date(ts).toLocaleString();
}
export function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
}
export function truncateText(t: string, max: number): string {
  return t.length <= max ? t : t.substring(0, max) + '…';
}
export function getFaviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
}

function extractOutputText(tc: any): string {
  const candidates = [
    tc?.output,
    tc?.result?.output,
    tc?.result?.error,
    tc?.error,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.length > 0) return value;
  }

  const contentBlocks = Array.isArray(tc?.result?.content)
    ? tc.result.content
    : Array.isArray(tc?.content)
      ? tc.content
      : [];
  if (contentBlocks.length > 0) {
    return contentBlocks
      .map((block: any) => typeof block === 'string' ? block : block?.text || block?.content || '')
      .filter(Boolean)
      .join('\n');
  }

  if (typeof tc?.data?.content === 'string') return tc.data.content;
  return '';
}

function getToolMeta(toolName: string | undefined | null) {
  const n = (toolName || "").toLowerCase();
  if (n === 'skill') return { Icon: BookOpen, label: 'Skill Tool' };
  if (n === 'show_user_url') return { Icon: Globe, label: 'Browser' };
  if (n.includes('preview_live_url')) return { Icon: Globe, label: 'Live Preview' };
  if (n === 'search_mcp_registry' || n.includes('mcp_registry')) return { Icon: Braces, label: 'MCP Registry' };
  if (n === 'ls' || n === 'grep' || n === 'find' || n.includes('grep_search') || n.includes('list_dir') || n.includes('system_files')) return { Icon: FolderOpenIcon, label: 'File System', iconSize: 12 };
  if (n.includes('web_search') || n.includes('remote_web_search')) return { Icon: Search, label: 'Web Search' };
  if (n.includes('fern') || n.includes('navis') || n.includes('browser') || n.includes('computer_use')) return { Icon: Globe, label: 'Browser' };
  if (n.includes('run_command') || n.includes('bash') || n.includes('terminal')) return { Icon: Terminal, label: 'Terminal' };
  if (n === 'create_plan' || n === 'execution_plan' || n === 'update_plan' || n === 'update_plan_step') return { Icon: CheckCircle, label: 'Plan' };
  if (n === 'pptx_generator') return { Icon: FileIcon, label: 'Presentation' };
  if (n === 'todo_write' || n.includes('todo_write')) return { Icon: CheckCircle, label: 'Todo List' };
  if (n === 'local_permission') return { Icon: Shield, label: 'Permission' };
  if (n === 'visual_classification_sheet') return { Icon: Image, label: 'Visual Sheet' };
  if (n === 'analyze_image' || n.includes('analyze_image')) return { Icon: Image, label: 'Image Analysis' };
  return { Icon: Braces, label: 'Generic Tool' };
}

const VS = {
  bg: '#f5f4f0',
  bg2: '#faf9f7',
  tab: '#f0eee7',
  tabActive: '#ffffff',
  border: '#e7e2d6',
  borderStrong: '#d8d1c2',
  text: '#201e24',
  muted: '#77716b',
  dim: '#aaa39a',
  green: '#22c55e',
  red: '#ef4444',
  yellow: '#f59e0b',
  blue: '#6366f1',
};

const CLAY = {
  card: '#ffffff',
  cardMuted: '#faf9f7',
  hover: '#efede6',
  active: '#ffffff',
  shadow: '0 1px 2px rgba(32,30,36,0.05), inset 0 1px 0 rgba(255,255,255,0.72)',
  panelShadow: '-12px 0 30px rgba(32,30,36,0.08)',
};

function getToolPath(toolCall: any): string {
  const args = toolCall?.args || toolCall?.arguments || {};
  const data = toolCall?.data || toolCall?.result?.data || {};
  return String(args.path || data.path || args.outputPath || data.outputPath || args.filePath || args.file || args.TargetFile || args.DirectoryPath || args.cwd || '');
}

function getToolTabLabel(toolCall: any): string {
  const toolName = String(toolCall?.toolName || 'Tool');
  if (toolName.toLowerCase() === 'search_mcp_registry') {
    const keyword = toolCall?.args?.keyword || toolCall?.args?.query || toolCall?.data?.keyword || toolCall?.result?.data?.keyword;
    return keyword ? `MCP: ${String(keyword).replace(/\s+/g, ' ').slice(0, 28)}` : 'MCP Registry';
  }
  const url = toolCall?.args?.url || toolCall?.data?.url || toolCall?.result?.data?.url;
  if (url) {
    try {
      const normalized = normalizePanelUrl(String(url));
      return new URL(normalized).host || String(url).slice(0, 28);
    } catch {
      return String(url).replace(/\s+/g, ' ').slice(0, 28);
    }
  }
  const path = getToolPath(toolCall);
  if (path) return path.split(/[/\\]/).pop() || path;
  const title = toolCall?.args?.title || toolCall?.result?.data?.title || toolCall?.data?.title;
  if (title) return String(title).replace(/\s+/g, ' ').slice(0, 28);
  const command = toolCall?.args?.command || toolCall?.args?.CommandLine;
  if (command) return String(command).replace(/\s+/g, ' ').slice(0, 28);
  return toolName;
}

function getToolSubtitle(toolCall: any): string {
  if (String(toolCall?.toolName || '').toLowerCase() === 'search_mcp_registry') {
    const keyword = toolCall?.args?.keyword || toolCall?.args?.query || toolCall?.data?.keyword || toolCall?.result?.data?.keyword;
    return keyword ? `MCP Registry search: ${keyword}` : 'MCP Registry search';
  }
  const url = toolCall?.args?.url || toolCall?.data?.url || toolCall?.result?.data?.url;
  if (url) return normalizePanelUrl(String(url));
  const path = getToolPath(toolCall);
  if (path) return path;
  const title = toolCall?.args?.title || toolCall?.result?.data?.title || toolCall?.data?.title;
  if (title) return String(title);
  const command = toolCall?.args?.command || toolCall?.args?.CommandLine;
  if (command) return String(command);
  return String(toolCall?.toolName || 'Tool call');
}

function ToolTabIcon({ toolName }: { toolName?: string }) {
  const n = (toolName || '').toLowerCase();
  if (n.includes('terminal') || n.includes('execute') || n.includes('bash')) return <Terminal size={13} />;
  if (n === 'search_mcp_registry' || n.includes('mcp_registry')) return <Braces size={13} />;
  if (n === 'ls' || n === 'grep' || n === 'find' || n.includes('grep_search') || n.includes('list_dir') || n.includes('system_files')) return <FolderOpenIcon style={{ width: 13, height: 13 }} />;
  if (n.includes('web_search') || n.includes('remote_web_search')) return <Search size={13} />;
  if (n === 'pptx_generator') return <FileIcon size={13} />;
  if (n === 'visual_classification_sheet') return <Image size={13} />;
  if (n.includes('plan')) return <CheckCircle size={13} />;
  if (n.includes('todo')) return <CheckCircle size={13} />;
  return <FileIcon size={13} />;
}

function normalizePanelUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^(https?:|file:)/i.test(trimmed)) return trimmed;

  const hostCandidate = trimmed.split('/')[0].replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  const isLocal =
    hostCandidate === 'localhost' ||
    hostCandidate.startsWith('localhost:') ||
    hostCandidate === '127.0.0.1' ||
    hostCandidate.startsWith('127.0.0.1:') ||
    hostCandidate === '0.0.0.0' ||
    hostCandidate.startsWith('0.0.0.0:') ||
    hostCandidate === '::1' ||
    hostCandidate.startsWith('::1:');

  return `${isLocal ? 'http' : 'https'}://${trimmed}`;
}

const DEFAULT_TOOL_DETAIL_ROOT = 'C:\\Users\\srini\\Downloads\\EverFern\\everfern-desktop\\apps\\desktop';

function isMacPlatform() {
  if (typeof navigator === 'undefined') return false;
  return /mac|iphone|ipad|ipod/i.test(navigator.platform || '');
}

function shouldIgnoreToolPanelShortcut(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  if (!target) return false;
  const tag = target.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || target.isContentEditable;
}

function normalizeFsPath(value?: string) {
  return String(value || '').replace(/\//g, '\\').replace(/\\+$/g, '');
}

function isWindowsAbsolutePath(value?: string) {
  return /^[A-Za-z]:[\\/]/.test(String(value || '')) || String(value || '').startsWith('\\\\');
}

function extractCdPathFromCommand(command?: string) {
  const cmd = String(command || '');
  const patterns = [
    /(?:^|[;&|]\s*)Set-Location\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/i,
    /(?:^|[;&|]\s*)cd\s+\/d\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/i,
    /(?:^|[;&|]\s*)cd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/i,
  ];
  for (const pattern of patterns) {
    const match = cmd.match(pattern);
    const value = match?.[1] || match?.[2] || match?.[3] || '';
    if (value) return normalizeFsPath(value);
  }
  return '';
}

function extractPrintedCwdFromTerminalOutput(output?: string) {
  const text = String(output || '');
  const outputOnly = text.includes('Output:')
    ? text.slice(text.lastIndexOf('Output:') + 'Output:'.length)
    : text;

  const powershellPathTable = outputOnly.match(/(?:^|\n)\s*Path\s*\r?\n\s*-+\s*\r?\n\s*([A-Za-z]:\\[^\r\n]+)/i);
  if (powershellPathTable?.[1]) return normalizeFsPath(powershellPathTable[1].trim());

  const absolutePathLines = Array.from(outputOnly.matchAll(/(?:^|\n)\s*([A-Za-z]:\\[^\r\n]+?)\s*(?=\r?\n|$)/g))
    .map(match => normalizeFsPath(match[1].trim()))
    .filter(Boolean);
  if (absolutePathLines.length > 0) return absolutePathLines[absolutePathLines.length - 1];
  return '';
}

function extractPromptCwdFromTerminalOutput(output?: string) {
  const text = String(output || '');
  const psPromptMatch = text.match(/(?:^|\n)\s*PS\s+([A-Za-z]:\\[^>\r\n]+)>/i);
  if (psPromptMatch?.[1]) return normalizeFsPath(psPromptMatch[1].trim());

  const cmdPromptMatch = text.match(/(?:^|\n)\s*([A-Za-z]:\\[^>\r\n]+)>/i);
  if (cmdPromptMatch?.[1]) return normalizeFsPath(cmdPromptMatch[1].trim());

  return '';
}

function extractHostContextCwdFromTerminalOutput(output?: string) {
  const text = String(output || '');
  const contextMatch = text.match(/Current working directory:\s*([^\r\n]+)/i);
  if (contextMatch?.[1]) return normalizeFsPath(contextMatch[1].trim());
  return '';
}

function extractCwdFromTerminalOutput(output?: string) {
  return (
    extractPrintedCwdFromTerminalOutput(output) ||
    extractPromptCwdFromTerminalOutput(output) ||
    extractHostContextCwdFromTerminalOutput(output)
  );
}

function inferTerminalCwd(toolCall: any, output?: string, command?: string) {
  const args = toolCall?.args || toolCall?.arguments || {};
  const data = toolCall?.data || toolCall?.result?.data || {};
  const candidates = [
    extractPrintedCwdFromTerminalOutput(output),
    extractCdPathFromCommand(command),
    args.cwd,
    args.workingDirectory,
    extractPromptCwdFromTerminalOutput(output),
    data.currentCwd,
    data.workingDirectory,
    toolCall?.result?.cwd,
    toolCall?.cwd,
    data.cwd,
    extractHostContextCwdFromTerminalOutput(output),
  ];
  for (const candidate of candidates) {
    const normalized = normalizeFsPath(candidate);
    if (normalized && (isWindowsAbsolutePath(normalized) || normalized.startsWith('/') || normalized.startsWith('~'))) {
      return normalized;
    }
  }
  return '';
}

function inferProjectRootFromPath(value?: string) {
  const normalized = normalizeFsPath(value);
  if (!normalized) return '';
  const lower = normalized.toLowerCase();
  const rootMarkers = ['\\src\\', '\\app\\', '\\main\\', '\\preload\\', '\\public\\', '\\scripts\\', '\\operator_docs\\', '\\components\\'];
  for (const marker of rootMarkers) {
    const idx = lower.indexOf(marker);
    if (idx > 2) return normalized.slice(0, idx);
  }
  const fileLike = /\.[a-z0-9]{1,8}$/i.test(normalized.split('\\').pop() || '');
  if (fileLike) {
    const slash = normalized.lastIndexOf('\\');
    return slash > 2 ? normalized.slice(0, slash) : normalized;
  }
  return normalized;
}

function inferToolProjectRoot(toolCall: any, toolData: any, tabs: any[] = []) {
  const args = toolCall?.args || toolCall?.arguments || {};
  const data = toolCall?.data || toolCall?.result?.data || toolData || {};
  const recentFileTabs = [...tabs].reverse().filter(tab => {
    const n = String(tab?.toolName || '').toLowerCase();
    return n.includes('write') || n.includes('edit') || n.includes('replace') || n === 'read' || n.includes('read_file') || n.includes('view_file');
  });
  const candidates = [
    data.cwd,
    args.cwd,
    data.projectPath,
    args.projectPath,
    getToolPath(toolCall),
    toolData?.path,
    ...recentFileTabs.flatMap(tab => {
      const tabArgs = tab?.args || tab?.arguments || {};
      const tabData = tab?.data || tab?.result?.data || {};
      return [tabData.cwd, tabArgs.cwd, getToolPath(tab), tabData.path];
    }),
  ];
  let everfernFallback = '';
  for (const candidate of candidates) {
    const root = inferProjectRootFromPath(candidate);
    if (!root) continue;
    if (root.toLowerCase().includes('\\.everfern')) {
      everfernFallback ||= root;
      continue;
    }
    return root;
  }
  return everfernFallback || DEFAULT_TOOL_DETAIL_ROOT;
}

type FileTreeNode = {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children: Map<string, FileTreeNode>;
};

function createFileTree(files: string[]) {
  const root: FileTreeNode = { name: '', path: '', type: 'folder', children: new Map() };
  for (const file of files) {
    const parts = file.replace(/\\/g, '/').split('/').filter(Boolean);
    let current = root;
    parts.forEach((part, idx) => {
      const isFile = idx === parts.length - 1;
      const path = parts.slice(0, idx + 1).join('/');
      if (!current.children.has(part)) {
        current.children.set(part, { name: part, path, type: isFile ? 'file' : 'folder', children: new Map() });
      }
      current = current.children.get(part)!;
    });
  }
  return root;
}

function sortedTreeChildren(node: FileTreeNode) {
  return Array.from(node.children.values()).sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

const ICONIFY_FILE_ICON_MAP: Record<string, string> = {
  env: 'dotenv',
  gitignore: 'git',
  git: 'git',
  log: 'log',
  ts: 'typescript',
  tsx: 'reactts',
  js: 'javascript',
  jsx: 'reactjs',
  json: 'json',
  css: 'css',
  scss: 'sass',
  html: 'html',
  md: 'markdown',
  mdx: 'mdx',
  py: 'python',
  ps1: 'powershell',
  bat: 'powershell',
  mjs: 'javascript',
  cjs: 'javascript',
  yml: 'yaml',
  yaml: 'yaml',
  sql: 'database',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  bmp: 'image',
  avif: 'image',
  svg: 'svg',
  ico: 'image',
  pdf: 'pdf',
  mp3: 'audio',
  wav: 'audio',
  ogg: 'audio',
  m4a: 'audio',
  mp4: 'video',
  webm: 'video',
  mov: 'video',
  lock: 'lock',
  gitmodules: 'git',
  npmrc: 'npm',
  txt: 'text',
  xml: 'xml',
  toml: 'config',
  ini: 'config',
  config: 'config',
};

const FILE_COLOR_MAP: Record<string, string> = {
  env: '#ecd46f',
  gitignore: '#f05033',
  git: '#f05033',
  log: '#9ca3af',
  ts: '#4da3ff',
  tsx: '#58c7ff',
  js: '#f7df1e',
  jsx: '#61dafb',
  json: '#fdbc2e',
  css: '#6aa9ff',
  scss: '#ff77b7',
  html: '#ff8a4c',
  md: '#60a5fa',
  mdx: '#60a5fa',
  py: '#ffd45a',
  ps1: '#7aa2f7',
  bat: '#7aa2f7',
  yml: '#cb9eff',
  yaml: '#cb9eff',
  sql: '#7dd3fc',
  png: '#059669',
  jpg: '#059669',
  jpeg: '#059669',
  gif: '#059669',
  webp: '#059669',
  bmp: '#059669',
  avif: '#059669',
  svg: '#f59e0b',
  ico: '#059669',
  pdf: '#ff6b6b',
  mp3: '#d8b4fe',
  wav: '#d8b4fe',
  ogg: '#d8b4fe',
  m4a: '#d8b4fe',
  mp4: '#93c5fd',
  webm: '#93c5fd',
  mov: '#93c5fd',
  mjs: '#f7df1e',
  npmrc: '#cb3837',
  gitmodules: '#f05033',
  txt: '#94a3b8',
  xml: '#fb923c',
  toml: '#94a3b8',
  ini: '#94a3b8',
  config: '#94a3b8',
};

const EXACT_FILE_ICON_MAP: Record<string, string> = {
  'package.json': 'npm',
  'package-lock.json': 'npm',
  'pnpm-lock.yaml': 'pnpm',
  'yarn.lock': 'yarn',
  'bun.lockb': 'bun',
  'tsconfig.json': 'tsconfig',
  'jsconfig.json': 'jsconfig',
  'next.config.ts': 'next',
  'next.config.js': 'next',
  'next.config.mjs': 'next',
  'vite.config.ts': 'vite',
  'vite.config.js': 'vite',
  'tailwind.config.ts': 'tailwind',
  'tailwind.config.js': 'tailwind',
  'postcss.config.js': 'postcss',
  'eslint.config.js': 'eslint',
  'eslint.config.mjs': 'eslint',
  '.eslintrc': 'eslint',
  '.eslintrc.js': 'eslint',
  '.eslintrc.json': 'eslint',
  '.prettierrc': 'prettier',
  '.prettierrc.json': 'prettier',
  '.prettierrc.js': 'prettier',
  'prettier.config.js': 'prettier',
  'components.json': 'json',
  'readme.md': 'readme',
  'license': 'license',
  'license.txt': 'license',
  '.gitignore': 'git',
  '.gitmodules': 'git',
  '.npmrc': 'npm',
};

function getFileVisual(fileName: string) {
  const base = fileName.replace(/\\/g, '/').split('/').pop() || fileName;
  const lower = base.toLowerCase();
  const dotfile = lower.startsWith('.') ? lower.slice(1) : '';
  const ext = dotfile && !dotfile.includes('.') ? dotfile : lower.split('.').pop() || '';
  const exact = lower === '.env' || lower.startsWith('.env.')
    ? 'dotenv'
    : EXACT_FILE_ICON_MAP[lower] || '';
  const colorKey =
    lower === '.gitignore' ? 'gitignore' :
    lower === '.npmrc' ? 'npmrc' :
    lower === '.gitmodules' ? 'gitmodules' :
    lower.startsWith('.env') ? 'env' :
    ext;
  const icon = exact || ICONIFY_FILE_ICON_MAP[ext] || 'default-file';
  return {
    color: FILE_COLOR_MAP[colorKey] || VS.muted,
    iconUrl: `https://api.iconify.design/vscode-icons:file-type-${icon}.svg`,
    ext: colorKey,
  };
}

function isTextLikeFile(path?: string) {
  const { ext } = getFileVisual(path || '');
  return ['env', 'gitignore', 'git', 'gitmodules', 'npmrc', 'log', 'json', 'mjs', 'js', 'jsx', 'ts', 'tsx', 'css', 'scss', 'html', 'md', 'txt', 'yaml', 'yml', 'svg', 'sql', 'py', 'ps1', 'bat', 'cjs'].includes(ext);
}

const IMAGE_FILE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'ico'];
const AUDIO_FILE_EXTS = ['mp3', 'wav', 'ogg', 'm4a'];
const VIDEO_FILE_EXTS = ['mp4', 'webm', 'mov'];
const DATA_PREVIEW_EXTS = [...IMAGE_FILE_EXTS, ...AUDIO_FILE_EXTS, ...VIDEO_FILE_EXTS, 'pdf'];

function isImageFile(path?: string) {
  return IMAGE_FILE_EXTS.includes(getFileVisual(path || '').ext);
}

function isAudioFile(path?: string) {
  return AUDIO_FILE_EXTS.includes(getFileVisual(path || '').ext);
}

function isVideoFile(path?: string) {
  return VIDEO_FILE_EXTS.includes(getFileVisual(path || '').ext);
}

function isDataPreviewFile(path?: string) {
  return DATA_PREVIEW_EXTS.includes(getFileVisual(path || '').ext);
}

function joinFsPath(rootPath: string, filePath: string) {
  if (!filePath) return rootPath;
  if (/^[A-Za-z]:[\\/]/.test(filePath) || filePath.startsWith('\\\\') || filePath.startsWith('/')) {
    return normalizeFsPath(filePath);
  }
  const root = normalizeFsPath(rootPath);
  const rel = normalizeFsPath(filePath).replace(/^\\+/, '');
  return root ? `${root}\\${rel}` : rel;
}

function parentFsPath(filePath: string) {
  const normalized = normalizeFsPath(filePath);
  const idx = normalized.lastIndexOf('\\');
  return idx > 2 ? normalized.slice(0, idx) : normalized;
}

function splitBreadcrumb(filePath: string) {
  return normalizeFsPath(filePath).split('\\').filter(Boolean);
}

function FileTreeRow({
  node,
  depth,
  activePath,
  onOpen,
}: {
  node: FileTreeNode;
  depth: number;
  activePath?: string;
  onOpen: (path: string) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  const isFolder = node.type === 'folder';
  const isActive = activePath === node.path;
  const children = sortedTreeChildren(node);
  const fileVisual = isFolder ? null : getFileVisual(node.name);

  return (
    <>
      <button
        type="button"
        onClick={() => isFolder ? setOpen(v => !v) : onOpen(node.path)}
        title={node.path}
        style={{
          width: '100%',
          height: 28,
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          padding: `0 10px 0 ${12 + depth * 18}px`,
          border: 'none',
          background: isActive ? CLAY.active : 'transparent',
          color: isActive ? VS.text : VS.text,
          cursor: 'pointer',
          textAlign: 'left',
          fontFamily: T.sans,
          fontSize: 12.5,
        }}
        onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = CLAY.hover; }}
        onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
      >
        {isFolder ? (
          <ChevronRight
            size={15}
            style={{
              color: VS.muted,
              flexShrink: 0,
              transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
              transition: 'transform 120ms ease',
            }}
          />
        ) : (
          <span style={{ width: 15, flexShrink: 0 }} />
        )}
        {isFolder ? (
          <Folder size={15} style={{ color: open ? '#dcb67a' : '#9b8b72', flexShrink: 0 }} />
        ) : fileVisual ? (
          <img
            src={fileVisual.iconUrl}
            alt=""
            style={{ width: 15, height: 15, flexShrink: 0 }}
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        ) : (
          <FileIcon size={14} style={{ color: '#8b8b8b', flexShrink: 0 }} />
        )}
        <span style={{
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: isFolder ? VS.text : (fileVisual?.color || VS.text),
        }}>
          {node.name}
        </span>
      </button>
      {isFolder && open && children.map(child => (
        <FileTreeRow key={child.path} node={child} depth={depth + 1} activePath={activePath} onOpen={onOpen} />
      ))}
    </>
  );
}

function FileExplorerPane({
  rootPath,
  activePath,
  onOpenFile,
  onRootPathChange,
}: {
  rootPath: string;
  activePath?: string;
  onOpenFile: (filePath: string) => void;
  onRootPathChange: (rootPath: string) => void;
}) {
  const [files, setFiles] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [rootDraft, setRootDraft] = useState(rootPath);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setRootDraft(rootPath);
  }, [rootPath]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!rootPath) return;
      setLoading(true);
      try {
        const result = await (window as any).electronAPI?.projects?.listFiles?.(rootPath);
        if (!cancelled) setFiles(Array.isArray(result?.files) ? result.files : []);
      } catch {
        if (!cancelled) setFiles([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [rootPath]);

  const filteredFiles = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return files;
    return files.filter(file => file.toLowerCase().includes(q));
  }, [files, filter]);
  const tree = useMemo(() => createFileTree(filteredFiles.slice(0, 600)), [filteredFiles]);

  return (
    <aside style={{
      width: 286,
      minWidth: 286,
      height: '100%',
      borderLeft: `1px solid ${VS.border}`,
      background: VS.bg2,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <div style={{ padding: '9px', borderBottom: `1px solid ${VS.border}`, display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div style={{
          minHeight: 30,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 9px',
          borderRadius: 8,
          border: `1px solid ${VS.borderStrong}`,
          background: CLAY.card,
          boxShadow: CLAY.shadow,
          color: VS.muted,
        }}>
          <FolderOpenIcon style={{ width: 15, height: 15, flexShrink: 0 }} />
          <input
            value={rootDraft}
            onChange={(e) => setRootDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRootPathChange(rootDraft.trim());
            }}
            onBlur={() => {
              if (rootDraft.trim() && rootDraft.trim() !== rootPath) onRootPathChange(rootDraft.trim());
            }}
            title={rootDraft}
            placeholder="Project path..."
            style={{
              flex: 1,
              minWidth: 0,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: VS.text,
              fontSize: 11.5,
              fontFamily: T.mono,
            }}
          />
        </div>
        <div style={{
          height: 31,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 10px',
          borderRadius: 9,
          border: `1px solid ${VS.borderStrong}`,
          background: CLAY.card,
          boxShadow: CLAY.shadow,
          color: VS.muted,
        }}>
          <Search size={15} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter files..."
            style={{
              flex: 1,
              minWidth: 0,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: VS.text,
              fontSize: 12.5,
              fontFamily: T.sans,
            }}
          />
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0 12px' }}>
        {loading ? (
          <div style={{ color: VS.muted, fontSize: 12, padding: 14, fontFamily: T.sans }}>Loading files...</div>
        ) : filteredFiles.length === 0 ? (
          <div style={{ color: VS.muted, fontSize: 12, padding: 14, fontFamily: T.sans }}>No files found</div>
        ) : (
          sortedTreeChildren(tree).map(node => (
            <FileTreeRow key={node.path} node={node} depth={0} activePath={activePath} onOpen={onOpenFile} />
          ))
        )}
      </div>
    </aside>
  );
}

function PlusMenu({
  onOpenFile,
  onTerminal,
  onBrowser,
  shortcutPrefix,
}: {
  onOpenFile: () => void;
  onTerminal: () => void;
  onBrowser: () => void;
  shortcutPrefix: string;
}) {
  const item = (Icon: any, label: string, shortcut: string, onClick?: () => void) => (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: '100%',
        height: 36,
        display: 'grid',
        gridTemplateColumns: '20px 1fr auto',
        alignItems: 'center',
        gap: 9,
        padding: '0 14px',
        border: 'none',
        background: 'transparent',
        color: VS.text,
        cursor: 'pointer',
        textAlign: 'left',
        fontFamily: T.sans,
        fontSize: 15,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = CLAY.hover; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <Icon size={16} color={VS.muted} />
      <span>{label}</span>
      <span style={{ color: VS.dim, fontSize: 14 }}>{shortcut}</span>
    </button>
  );

  const shortcut = (key: string) => `${shortcutPrefix}+${key}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: -4, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4, scale: 0.98 }}
      transition={{ duration: 0.12 }}
      style={{
        position: 'absolute',
        top: 41,
        right: 76,
        width: 352,
        padding: '8px 0',
        borderRadius: 14,
        background: CLAY.card,
        border: `1px solid ${VS.border}`,
        boxShadow: '0 18px 45px rgba(32,30,36,0.14)',
        zIndex: 10,
      }}
    >
      {item(Files, 'Files', shortcut('P'), onOpenFile)}
      {item(Globe, 'Browser', shortcut('T'), onBrowser)}
      {item(Terminal, 'Terminal', shortcut('`'), onTerminal)}
    </motion.div>
  );
}

function FileContentBody({
  path,
  content,
  mode = 'normal',
  previewError,
}: {
  path?: string;
  content?: string;
  mode?: 'normal' | 'add' | 'diff';
  previewError?: string;
}) {
  const visual = getFileVisual(path || '');
  const safeContent = content || '';

  if (visual.ext === 'md') {
    return (
      <div style={{ flex: 1, overflow: 'auto', background: '#101010', padding: 18 }}>
        <div style={{ background: '#f8f7f3', borderRadius: 10, padding: '8px 22px 22px', border: '1px solid rgba(255,255,255,0.08)' }}>
          <MarkdownViewer content={safeContent} />
        </div>
      </div>
    );
  }

  if (isImageFile(path)) {
    return (
      <div style={{ flex: 1, minHeight: 0, background: EDITOR_COLORS.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}>
        {safeContent ? (
          <img
            src={safeContent}
            alt={path?.split(/[/\\]/).pop() || 'Preview'}
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              borderRadius: 8,
              border: `1px solid ${EDITOR_COLORS.border}`,
              background: '#0f0f10',
            }}
          />
        ) : (
          <PreviewUnavailable path={path} message={previewError || 'Image preview is not available.'} />
        )}
      </div>
    );
  }

  if (visual.ext === 'pdf') {
    return (
      <div style={{ flex: 1, minHeight: 0, background: EDITOR_COLORS.bg, padding: 12 }}>
        {safeContent ? (
          <iframe
            title="PDF preview"
            src={safeContent}
            style={{ width: '100%', height: '100%', border: `1px solid ${EDITOR_COLORS.border}`, borderRadius: 8, background: '#111' }}
          />
        ) : (
          <PreviewUnavailable path={path} message={previewError || 'PDF preview is not available.'} />
        )}
      </div>
    );
  }

  if (isAudioFile(path)) {
    return (
      <div style={{ flex: 1, minHeight: 0, background: EDITOR_COLORS.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}>
        {safeContent ? (
          <div style={{ width: 'min(520px, 100%)', padding: 18, borderRadius: 10, border: `1px solid ${EDITOR_COLORS.border}`, background: '#17171a' }}>
            <audio src={safeContent} controls style={{ width: '100%' }} />
          </div>
        ) : (
          <PreviewUnavailable path={path} message={previewError || 'Audio preview is not available.'} />
        )}
      </div>
    );
  }

  if (isVideoFile(path)) {
    return (
      <div style={{ flex: 1, minHeight: 0, background: EDITOR_COLORS.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}>
        {safeContent ? (
          <video
            src={safeContent}
            controls
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              borderRadius: 8,
              border: `1px solid ${EDITOR_COLORS.border}`,
              background: '#000',
            }}
          />
        ) : (
          <PreviewUnavailable path={path} message={previewError || 'Video preview is not available.'} />
        )}
      </div>
    );
  }

  if (visual.ext === 'svg') {
    return (
      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateRows: 'minmax(220px, 42%) 1fr', background: EDITOR_COLORS.bg }}>
        <div style={{ margin: 12, border: `1px solid ${EDITOR_COLORS.border}`, borderRadius: 8, background: '#ffffff', overflow: 'hidden' }}>
          <iframe
            title="SVG preview"
            sandbox=""
            srcDoc={safeContent}
            style={{ width: '100%', height: '100%', border: 'none', background: '#ffffff' }}
          />
        </div>
        <div style={{ overflow: 'auto', paddingBottom: 18 }}>
          {safeContent.split('\n').map((line, idx) => (
            <CodeLine key={idx} type={mode === 'add' ? 'add' : 'normal'} content={line} lineNumber={idx + 1} ext="svg" />
          ))}
        </div>
      </div>
    );
  }

  if (!isTextLikeFile(path) && !safeContent) {
    return (
      <div style={{ flex: 1, minHeight: 0, background: EDITOR_COLORS.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}>
        <PreviewUnavailable path={path} message={previewError || 'This file type can be opened with a system app.'} />
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', background: EDITOR_COLORS.bg, paddingTop: 6, paddingBottom: 18 }}>
      {safeContent.split('\n').map((line, idx) => (
        <CodeLine
          key={idx}
          type={mode === 'add' ? 'add' : 'normal'}
          content={line}
          lineNumber={idx + 1}
          ext={visual.ext}
        />
      ))}
    </div>
  );
}

function PreviewUnavailable({ path, message }: { path?: string; message: string }) {
  const visual = getFileVisual(path || '');
  return (
    <div style={{
      width: 'min(420px, 100%)',
      borderRadius: 10,
      border: `1px solid ${EDITOR_COLORS.border}`,
      background: '#17171a',
      padding: 18,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 10,
      color: VS.muted,
      fontFamily: T.sans,
      textAlign: 'center',
    }}>
      <img src={visual.iconUrl} alt="" style={{ width: 30, height: 30 }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
      <div style={{ fontSize: 13, color: VS.text, fontWeight: 400 }}>{path?.split(/[/\\]/).pop() || 'File preview'}</div>
      <div style={{ fontSize: 12, lineHeight: 1.45 }}>{message}</div>
    </div>
  );
}

function OpenFileSurface({
  selectedPath,
  content,
  previewError,
}: {
  selectedPath?: string;
  content?: string;
  previewError?: string;
}) {
  if (!selectedPath) {
    return (
      <div style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: VS.bg,
        color: VS.text,
        fontFamily: T.sans,
      }}>
        <FolderOpenIcon style={{ width: 34, height: 34, color: VS.muted, marginBottom: 14 }} />
        <div style={{ fontSize: 17, fontWeight: 400, marginBottom: 14 }}>Open file</div>
        <div style={{ fontSize: 15, color: VS.muted }}>Select a file from the workspace tree</div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, background: VS.bg, color: VS.text, display: 'flex', flexDirection: 'column' }}>
      <FileContentBody path={selectedPath} content={content || ''} previewError={previewError} />
    </div>
  );
}

function BrowserSurface({ url, onUrlChange }: { url: string; onUrlChange: (url: string) => void }) {
  const [draft, setDraft] = useState(url);
  useEffect(() => setDraft(url), [url]);

  const normalizeBrowserUrl = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (/^(https?:|file:)/i.test(trimmed)) return trimmed;

    const hostCandidate = trimmed.split('/')[0].replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
    const isLocal =
      hostCandidate === 'localhost' ||
      hostCandidate.startsWith('localhost:') ||
      hostCandidate === '127.0.0.1' ||
      hostCandidate.startsWith('127.0.0.1:') ||
      hostCandidate === '0.0.0.0' ||
      hostCandidate.startsWith('0.0.0.0:') ||
      hostCandidate === '::1' ||
      hostCandidate.startsWith('::1:');

    return `${isLocal ? 'http' : 'https'}://${trimmed}`;
  };

  const commit = () => {
    const normalized = normalizeBrowserUrl(draft);
    if (!normalized) return;
    onUrlChange(normalized);
  };

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: VS.bg }}>
      <div style={{ height: 44, display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', borderBottom: `1px solid ${VS.border}` }}>
        <Globe size={15} color={VS.muted} />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
          onBlur={commit}
          placeholder="https://example.com"
          style={{
            flex: 1,
            height: 30,
            border: `1px solid ${VS.borderStrong}`,
            borderRadius: 8,
            background: CLAY.card,
            boxShadow: CLAY.shadow,
            color: VS.text,
            padding: '0 10px',
            outline: 'none',
            fontFamily: T.sans,
            fontSize: 13,
          }}
        />
      </div>
      {url ? (
        <iframe
          title="Browser"
          src={url}
          style={{ flex: 1, border: 'none', background: '#ffffff' }}
        />
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: VS.muted, fontFamily: T.sans }}>
          Enter a URL to open a browser tab
        </div>
      )}
    </div>
  );
}

function getBrowserFallbackMeta(url?: string) {
  const fallback = { title: 'Browser', favicon: '', url: url || '' };
  if (!url) return fallback;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'file:') {
      const fileName = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || 'File');
      return { title: fileName || 'File', favicon: '', url };
    }
    const host = parsed.hostname.replace(/^www\./, '');
    return {
      title: host || parsed.href,
      favicon: host ? getFaviconUrl(host) : '',
      url,
    };
  } catch {
    return { title: url.replace(/^https?:\/\//i, '').split('/')[0] || 'Browser', favicon: '', url };
  }
}

type OpenWithApp = {
  name: string;
  path?: string;
  icon?: string;
};

function FileBreadcrumbHeader({
  filePath,
  apps,
  appsLoading,
}: {
  filePath: string;
  apps: OpenWithApp[];
  appsLoading: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const parts = splitBreadcrumb(filePath);
  const primaryApp = apps[0] || { name: 'Open', path: '', icon: '' };

  const openWith = async (appPath?: string) => {
    if (!filePath) return;
    setMenuOpen(false);
    try {
      const api = (window as any).electronAPI?.system;
      if (api?.openFile) {
        await api.openFile(filePath, appPath || undefined);
        return;
      }
      await api?.openExternal?.(`file:///${filePath.replace(/\\/g, '/')}`);
    } catch {
      // Best effort: native open failures should not break the panel.
    }
  };

  const openFolder = async () => {
    const parent = parentFsPath(filePath);
    try {
      const api = (window as any).electronAPI?.system;
      if (api?.openFile) await api.openFile(parent);
      else await api?.openExternal?.(`file:///${parent.replace(/\\/g, '/')}`);
    } catch {
      // Best effort.
    }
  };

  return (
    <div style={{
      height: 42,
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '0 12px 0 20px',
      borderBottom: `1px solid ${VS.border}`,
      background: VS.bg2,
      color: VS.muted,
      fontFamily: T.sans,
      minWidth: 0,
    }}>
      <div
        title={filePath}
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
        }}
      >
        {parts.map((part, idx) => {
          const isLast = idx === parts.length - 1;
          return (
            <React.Fragment key={`${part}-${idx}`}>
              {idx > 0 && <ChevronRight size={13} style={{ color: '#6b6b6b', flexShrink: 0 }} />}
              <span style={{
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                color: isLast ? VS.text : VS.muted,
                fontSize: isLast ? 13 : 12.5,
                fontWeight: 400,
              }}>
                {part}
              </span>
            </React.Fragment>
          );
        })}
      </div>

      <MoreHorizontal size={17} style={{ color: VS.muted, flexShrink: 0 }} />

      <div style={{ position: 'relative', flexShrink: 0 }}>
        <div style={{
          display: 'flex',
          height: 32,
          borderRadius: 10,
          overflow: 'hidden',
          border: `1px solid ${VS.borderStrong}`,
          background: CLAY.card,
          boxShadow: CLAY.shadow,
        }}>
          <button
            type="button"
            onClick={() => openWith(primaryApp.path)}
            title={primaryApp.path || 'Open with default app'}
            style={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              padding: '0 9px',
              border: 'none',
              background: 'transparent',
              color: VS.text,
              cursor: 'pointer',
              fontFamily: T.sans,
              fontSize: 13,
              maxWidth: 142,
            }}
          >
            {primaryApp.icon ? (
              <img src={primaryApp.icon} alt="" style={{ width: 16, height: 16, flexShrink: 0 }} />
            ) : (
              <ExternalLink size={15} color="#7aa2f7" />
            )}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {appsLoading ? 'Loading...' : primaryApp.name}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setMenuOpen(v => !v)}
            aria-label="Choose app"
            style={{
              width: 30,
              border: 'none',
              borderLeft: `1px solid ${VS.borderStrong}`,
              background: 'transparent',
              color: VS.muted,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <ChevronDown size={14} />
          </button>
        </div>

        <AnimatePresence>
          {menuOpen && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12 }}
              style={{
                position: 'absolute',
                top: 38,
                right: 0,
                width: 260,
                padding: 6,
                borderRadius: 10,
                border: `1px solid ${VS.borderStrong}`,
                background: CLAY.card,
                boxShadow: '0 18px 36px rgba(32,30,36,0.14)',
                zIndex: 14,
              }}
            >
              <OpenWithMenuItem app={{ name: 'Default app', path: '', icon: '' }} onOpen={openWith} />
              {apps.map((app) => (
                <OpenWithMenuItem key={`${app.name}-${app.path}`} app={app} onOpen={openWith} />
              ))}
              {apps.length === 0 && !appsLoading && (
                <div style={{ padding: '8px 10px', fontSize: 12, color: VS.muted, fontFamily: T.sans }}>
                  No extra apps found
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <button
        type="button"
        title="Open containing folder"
        onClick={openFolder}
        style={{
          width: 34,
          height: 32,
          border: `1px solid ${VS.borderStrong}`,
          borderRadius: 10,
          background: CLAY.card,
          boxShadow: CLAY.shadow,
          color: VS.muted,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        <FolderOpenIcon style={{ width: 17, height: 17 }} />
      </button>
    </div>
  );
}

function OpenWithMenuItem({ app, onOpen }: { app: OpenWithApp; onOpen: (appPath?: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(app.path || undefined)}
      title={app.path || 'Use the OS default app'}
      style={{
        width: '100%',
        height: 34,
        display: 'grid',
        gridTemplateColumns: '20px 1fr',
        alignItems: 'center',
        gap: 8,
        padding: '0 9px',
        border: 'none',
        borderRadius: 7,
        background: 'transparent',
        color: VS.text,
        cursor: 'pointer',
        textAlign: 'left',
        fontFamily: T.sans,
        fontSize: 12.5,
        transition: 'background 120ms ease, color 120ms ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = CLAY.hover;
        e.currentTarget.style.color = VS.text;
      }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      {app.icon ? (
        <img src={app.icon} alt="" style={{ width: 17, height: 17 }} />
      ) : (
        <ExternalLink size={15} color={VS.blue} />
      )}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{app.name}</span>
    </button>
  );
}

/* ============================================================
   MICRO: PULSE DOT
   ============================================================ */
function PulseDot({ color = T.green }: { color?: string }) {
  return (
    <motion.span
      style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }}
      animate={{ opacity: [1, 0.3, 1] }}
      transition={{ repeat: Infinity, duration: 2.4, ease: 'easeInOut' }}
    />
  );
}

/* ============================================================
   COPY BUTTON
   ============================================================ */
function CopyBtn({ text, dark }: { text: string; dark?: boolean }) {
  const [copied, setCopied] = useState(false);
  const handle = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { }
  };
  const base: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6,
    border: `1px solid ${dark ? VS.borderStrong : T.border}`,
    borderRadius: T.r8, padding: '5px 12px', cursor: 'pointer',
    background: dark ? CLAY.card : 'transparent',
    fontSize: 11, fontWeight: 400, letterSpacing: '0.02em',
    color: copied ? VS.green : (dark ? VS.muted : T.textMuted),
    fontFamily: T.sans, transition: 'color 0.15s, border-color 0.15s',
  };
  return (
    <button onClick={handle} style={base}>
      {copied ? <Check size={11} strokeWidth={2.5} /> : <Copy size={11} strokeWidth={2} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

/* ============================================================
   PANEL HEADER
   ============================================================ */
function PanelHeader({ agentName, toolName, onClose }: { agentName?: string; toolName?: string; onClose: () => void }) {
  const { Icon, label, iconSize = 16 } = getToolMeta(toolName);

  return (
    <header style={{
      background: T.surface,
      borderBottom: `1px solid ${T.border}`,
      padding: '20px 24px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexShrink: 0,
    }}>
      {/* Left */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 13, minWidth: 0 }}>
        {/* Icon */}
        <div style={{
          width: 36, height: 36, borderRadius: T.r10, flexShrink: 0,
          background: '#ececea', border: '0.5px solid rgba(0,0,0,0.1)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.72), inset 0 -1px 0 rgba(0,0,0,0.06), inset 1px 0 rgba(255,255,255,0.50), inset -1px 0 rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.08)',
        }}>
          <Icon size={iconSize} color={'#333'} strokeWidth={1.75} />
        </div>

        {/* Text stack */}
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginBottom: 2 }}>
            {agentName && (
              <>
                <span style={{ fontSize: 13, fontWeight: 400, color: T.text, letterSpacing: '-0.015em', fontFamily: T.sans }}>Fern</span>
                <span style={{ color: T.textMuted, fontSize: 12 }}>→</span>
              </>
            )}
            <code style={{
              fontSize: 11.5, fontFamily: T.mono, fontWeight: 400, color: '#111',
              background: '#ececea', border: '0.5px solid rgba(0,0,0,0.1)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.72), inset 0 -1px 0 rgba(0,0,0,0.06), inset 1px 0 rgba(255,255,255,0.50), inset -1px 0 rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.05)',
              padding: '2px 8px', borderRadius: T.r6,
            }}>
              {toolName}
            </code>
          </div>
          <p style={{ fontSize: 10.5, color: T.textMuted, margin: 0, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 400, fontFamily: T.sans }}>
            {label}
          </p>
        </div>
      </div>

      {/* Right */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <PulseDot />
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            width: 32, height: 32, borderRadius: T.r8, border: '0.5px solid rgba(0,0,0,0.1)',
            background: '#ececea', display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.72), inset 0 -1px 0 rgba(0,0,0,0.06), inset 1px 0 rgba(255,255,255,0.50), inset -1px 0 rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.05)',
            cursor: 'pointer', color: '#333', transition: 'all 0.1s ease',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.transform = 'scale(1.05)';
            e.currentTarget.style.color = '#000';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.color = '#333';
          }}
          onMouseDown={e => {
            e.currentTarget.style.transform = 'scale(0.95)';
          }}
          onMouseUp={e => {
            e.currentTarget.style.transform = 'scale(1.05)';
          }}
        >
          <X size={14} strokeWidth={2.5} />
        </button>
      </div>
    </header>
  );
}

/* ============================================================
   SECTION LABEL (sticky)
   ============================================================ */
function SectionLabel({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{
      padding: '16px 24px 12px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      position: 'sticky', top: 0, zIndex: 10,
      background: 'rgba(250,250,250,0.94)',
      backdropFilter: 'blur(10px)',
      borderBottom: `1px solid ${T.borderSubtle}`,
    }}>
      <span style={{
        fontSize: 10, fontWeight: 400, color: T.textMuted,
        letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: T.sans,
      }}>
        {children}
      </span>
      {right && (
        <span style={{
          fontSize: 10.5, fontWeight: 400, color: '#111',
          background: '#ececea',
          border: '0.5px solid rgba(0,0,0,0.1)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.72), inset 0 -1px 0 rgba(0,0,0,0.06), inset 1px 0 rgba(255,255,255,0.50), inset -1px 0 rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.05)',
          padding: '3px 12px', borderRadius: 100, fontFamily: T.mono,
        }}>
          {right}
        </span>
      )}
    </div>
  );
}

/* ============================================================
   EMPTY STATE
   ============================================================ */
function EmptyState({
  icon: IconSvg, title, description, note,
}: {
  icon: React.ComponentType;
  title: string;
  description: string;
  note?: string;
}) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '64px 40px', background: T.bg,
    }}>
      {/* Icon */}
      <motion.div
        style={{
          width: 72, height: 72, borderRadius: 18,
          background: T.surface, border: `1px solid ${T.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: T.textMuted, marginBottom: 24,
          boxShadow: '0 2px 8px rgba(0,0,0,0.03), inset 0 1px 0 rgba(255,255,255,0.9)',
        }}
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.4, type: 'spring', stiffness: 260, damping: 22 }}
      >
        <IconSvg />
      </motion.div>

      <motion.h3
        style={{ fontSize: 14, fontWeight: 400, color: T.text, margin: '0 0 8px', textAlign: 'center', letterSpacing: '-0.02em', fontFamily: T.sans }}
        initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.35 }}
      >
        {title}
      </motion.h3>
      <motion.p
        style={{ fontSize: 13, color: T.textMuted, margin: '0 0 28px', textAlign: 'center', maxWidth: 280, lineHeight: 1.65, fontFamily: T.sans }}
        initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18, duration: 0.35 }}
      >
        {description}
      </motion.p>

      {note && (
        <motion.div
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            background: T.surface, border: `1px solid ${T.border}`,
            borderRadius: T.r12, padding: '14px 18px', maxWidth: 320,
          }}
          initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.26, duration: 0.35 }}
        >
          <Globe size={13} color={T.textMuted} style={{ marginTop: 2, flexShrink: 0 }} strokeWidth={1.75} />
          <span style={{ fontSize: 12, color: T.textSecondary, lineHeight: 1.65, fontFamily: T.sans }}>{note}</span>
        </motion.div>
      )}
    </div>
  );
}

/* ============================================================
   MINIMAL SVGs for empty states
   ============================================================ */
function IconCamera() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
      <rect x="2" y="9" width="28" height="20" rx="3" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <circle cx="16" cy="19" r="5" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <path d="M11 9 L13.5 5 H18.5 L21 9" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="4" y1="4" x2="28" y2="28" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity={0.4} />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
      <circle cx="14" cy="14" r="9" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <line x1="21" y1="21" x2="29" y2="29" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <line x1="10" y1="14" x2="18" y2="14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity={0.4} />
      <line x1="10" y1="17" x2="15" y2="17" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity={0.25} />
    </svg>
  );
}

/* ============================================================
   SCREENSHOT CARD
   ============================================================ */
function ScreenshotCard({ screenshot, index, onZoom }: { screenshot: any; index: number; onZoom: (s: any) => void }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);

  return (
    <motion.div
      onClick={() => onZoom(screenshot)}
      style={{
        borderRadius: T.r12, overflow: 'hidden', background: T.surface,
        border: `1px solid ${T.border}`, cursor: 'pointer',
        boxShadow: '0 1px 4px rgba(0,0,0,0.03)',
      }}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, type: 'spring', stiffness: 260, damping: 24 }}
      whileHover={{ borderColor: T.textMuted, y: -1, boxShadow: '0 6px 20px rgba(0,0,0,0.06)' }}
    >
      {/* Image */}
      <div style={{ position: 'relative', background: T.surfaceRaised, aspectRatio: '16/9', overflow: 'hidden' }}>
        {loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <motion.div
              style={{ width: 18, height: 18, border: `2px solid ${T.border}`, borderTopColor: T.textMuted, borderRadius: '50%' }}
              animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.75, ease: 'linear' }}
            />
          </div>
        )}
        {!err ? (
          <img
            src={`data:image/png;base64,${screenshot.base64}`}
            alt={`Capture ${index + 1}`}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: loading ? 'none' : 'block' }}
            onLoad={() => setLoading(false)}
            onError={() => { setLoading(false); setErr(true); }}
          />
        ) : (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: T.textMuted, gap: 6 }}>
            <CameraOff size={20} strokeWidth={1.5} />
            <span style={{ fontSize: 11, fontFamily: T.sans }}>Failed to load</span>
          </div>
        )}

        {/* Expand overlay */}
        <motion.div
          style={{
            position: 'absolute', inset: 0, background: 'rgba(0,0,0,0)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          whileHover={{ background: 'rgba(0,0,0,0.2)' }}
        >
          <div style={{
            padding: '7px', background: 'rgba(255,255,255,0.92)', borderRadius: T.r8,
            opacity: 0, transition: 'opacity 0.15s',
            boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
          }}
            onMouseEnter={e => e.currentTarget.style.opacity = '1'}
          >
            <Maximize2 size={13} color={T.text} />
          </div>
        </motion.div>

        {/* Index badge */}
        <div style={{
          position: 'absolute', top: 10, left: 10,
          fontSize: 9.5, fontWeight: 400, color: 'rgba(255,255,255,0.9)',
          background: 'rgba(14,14,12,0.6)', padding: '2px 7px', borderRadius: T.r4,
          letterSpacing: '0.08em', backdropFilter: 'blur(4px)', fontFamily: T.mono,
        }}>
          {String(index + 1).padStart(2, '0')}
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding: '13px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: `1px solid ${T.borderSubtle}` }}>
        <span style={{ fontSize: 12.5, fontWeight: 400, color: T.text, fontFamily: T.sans }}>Frame {index + 1}</span>
        <span style={{ fontSize: 10.5, color: T.textMuted, fontFamily: T.mono }}>
          {formatTimestamp(screenshot.timestamp).split(',')[1]?.trim() || ''}
        </span>
      </div>
    </motion.div>
  );
}

/* ============================================================
   ZOOM MODAL
   ============================================================ */
const CursorOverlayOnImage = ({ coordinate, action }: { coordinate: any, action: string }) => {
  let x = 0;
  let y = 0;
  if (Array.isArray(coordinate)) {
    x = Number(coordinate[0]);
    y = Number(coordinate[1]);
  } else if (coordinate && typeof coordinate === 'object') {
    x = Number(coordinate.x);
    y = Number(coordinate.y);
  } else {
    return null;
  }
  if (isNaN(x) || isNaN(y)) return null;

  const maxVal = Math.max(x, y);
  const scaleWidth = maxVal <= 1000 ? 1000 : 1920;
  const scaleHeight = maxVal <= 1000 ? 1000 : 1080;

  const leftPercent = (x / scaleWidth) * 100;
  const topPercent = (y / scaleHeight) * 100;

  return (
    <motion.div
      style={{
        position: 'absolute',
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      animate={{
        left: `${leftPercent}%`,
        top: `${topPercent}%`,
      }}
      transition={{
        type: 'spring',
        stiffness: 400,
        damping: 28
      }}
    >
      {(action?.toLowerCase().includes('click') || action?.toLowerCase().includes('tap') || action?.toLowerCase().includes('drag')) && (
        <div
          style={{
            position: 'absolute',
            width: 40,
            height: 40,
            borderRadius: '50%',
            border: '2.5px solid rgba(59, 130, 246, 0.8)',
            animation: 'ripple-ping 1s cubic-bezier(0, 0, 0.2, 1) infinite',
            pointerEvents: 'none',
          }}
        />
      )}

      <svg
        width="26"
        height="26"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{
          filter: 'drop-shadow(0 2px 8px rgba(0, 0, 0, 0.25)) drop-shadow(0 0 2px rgba(255, 255, 255, 0.5))',
        }}
      >
        <rect
          x="6"
          y="6"
          width="12"
          height="12"
          rx="3"
          ry="3"
          fill="rgba(255, 255, 255, 0.95)"
          stroke="rgba(0, 0, 0, 0.15)"
          strokeWidth="0.5"
        />
        <rect
          x="8"
          y="8"
          width="8"
          height="8"
          rx="2"
          ry="2"
          fill="none"
          stroke="rgba(0, 0, 0, 0.08)"
          strokeWidth="0.5"
        />
      </svg>

      <style>{`
        @keyframes ripple-ping {
          0% { transform: scale(0.5); opacity: 1; }
          100% { transform: scale(1.8); opacity: 0; }
        }
      `}</style>
    </motion.div>
  );
};

function ZoomModal({ screenshot, onClose }: { screenshot: any; onClose: () => void }) {
  return (
    <motion.div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(9,9,9,0.88)',
        backdropFilter: 'blur(20px)', display: 'flex', alignItems: 'center',
        justifyContent: 'center', zIndex: 100, padding: 24,
      }}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ position: 'relative', maxWidth: '90vw', width: '100%', display: 'flex', justifyContent: 'center' }}>
        <button
          onClick={onClose}
          style={{
            position: 'absolute', top: -44, right: 24,
            background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: T.r8, width: 32, height: 32, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.7)',
            transition: 'background 0.15s',
            zIndex: 110,
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.13)'}
          onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.07)'}
        >
          <X size={14} />
        </button>
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <motion.img
            src={`data:image/png;base64,${screenshot.base64}`}
            alt="Full screenshot"
            style={{
              width: '100%', maxHeight: '84vh', objectFit: 'contain',
              borderRadius: T.r12, border: '1px solid rgba(255,255,255,0.08)',
              boxShadow: '0 32px 64px rgba(0,0,0,0.6)',
              display: 'block',
            }}
            initial={{ scale: 0.96, y: 16 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96, y: 16 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
          />
          {screenshot.action?.params?.coordinate && (
            <CursorOverlayOnImage
              coordinate={screenshot.action.params.coordinate}
              action={screenshot.action.type}
            />
          )}
        </div>
      </div>
    </motion.div>
  );
}

/* ============================================================
   NAVIS VIEW
   ============================================================ */
function NavisThinkingRail({ events = [] }: { events?: any[] }) {
  const safe = Array.isArray(events) ? events : [];
  if (safe.length === 0) return null;

  const titleFor = (event: any) => {
    if (event.type === 'reasoning') return 'Thinking';
    if (event.type === 'action') return event.action?.description || 'Action';
    if (event.type === 'screenshot') return 'Captured frame';
    if (event.type === 'complete') return 'Complete';
    if (event.type === 'abort' || event.type === 'error') return 'Stopped';
    return 'Step';
  };

  const contentFor = (event: any) => {
    if (event.type === 'action') return event.action?.description || '';
    return event.content || event.metadata?.title || event.metadata?.url || '';
  };

  return (
    <aside style={{
      width: 290,
      minWidth: 250,
      borderLeft: `1px solid ${T.border}`,
      background: 'linear-gradient(180deg, #fbfaf7 0%, #f4f2ec 100%)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <div style={{ padding: '14px 16px', borderBottom: `1px solid ${T.border}`, background: 'rgba(255,255,255,0.58)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{
            width: 12,
            height: 12,
            borderRadius: '50%',
            background: 'radial-gradient(circle at 32% 28%, #ffffff 0%, #8ee7ff 18%, #3b82f6 48%, #7c3aed 100%)',
            boxShadow: '0 0 14px rgba(59,130,246,0.45), inset 0 0 4px rgba(255,255,255,0.65)',
            flexShrink: 0,
          }} />
          <div>
            <p style={{ margin: 0, color: T.text, fontSize: 13, fontWeight: 500, fontFamily: T.sans }}>Navis thinking</p>
            <p style={{ margin: '2px 0 0', color: T.textMuted, fontSize: 11.5, fontFamily: T.sans }}>{safe.length} live event{safe.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 18px' }}>
        {safe.map((event, index) => (
          <div key={`${event.timestamp}-${index}`} style={{ display: 'flex', gap: 10, paddingBottom: index === safe.length - 1 ? 0 : 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 3 }}>
              <span style={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                background: event.type === 'complete'
                  ? T.green
                  : event.type === 'abort' || event.type === 'error'
                    ? T.red
                    : 'radial-gradient(circle at 35% 30%, #ffffff 0%, #8ee7ff 20%, #3b82f6 55%, #7c3aed 100%)',
                boxShadow: event.type === 'reasoning' ? '0 0 12px rgba(59,130,246,0.38)' : 'none',
              }} />
              {index !== safe.length - 1 && <span style={{ width: 1, flex: 1, minHeight: 26, background: 'rgba(32,30,36,0.08)', marginTop: 5 }} />}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <p style={{ margin: 0, color: T.text, fontSize: 12.3, fontWeight: 500, fontFamily: T.sans }}>
                  {titleFor(event)}
                </p>
                {event.stepNumber && (
                  <span style={{ color: T.textMuted, fontSize: 10.5, fontFamily: T.mono }}>
                    {event.stepNumber}{event.totalSteps ? `/${event.totalSteps}` : ''}
                  </span>
                )}
              </div>
              {contentFor(event) && (
                <p style={{ margin: '4px 0 0', color: T.textSecondary, fontSize: 11.7, lineHeight: 1.45, fontFamily: T.sans }}>
                  {truncateText(String(contentFor(event)), 220)}
                </p>
              )}
              {event.metadata?.url && (
                <p style={{ margin: '5px 0 0', color: T.textMuted, fontSize: 10.5, lineHeight: 1.4, fontFamily: T.mono, wordBreak: 'break-all' }}>
                  {truncateText(String(event.metadata.url), 120)}
                </p>
              )}
              <p style={{ margin: '5px 0 0', color: T.textPlaceholder, fontSize: 10.5, fontFamily: T.mono }}>
                {formatTimestamp(event.timestamp).split(',')[1]?.trim() || ''}
              </p>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

function NavisView({ screenshots = [], toolName, thinkingEvents = [] }: { screenshots: any[]; toolName: string; thinkingEvents?: any[] }) {
  const [zoomed, setZoomed] = useState<any>(null);
  const safe = Array.isArray(screenshots) ? screenshots : [];
  const thoughts = Array.isArray(thinkingEvents) ? thinkingEvents : [];

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true); // Autoplay by default
  const prevLengthRef = useRef(safe.length);

  useEffect(() => {
    let interval: any;
    if (isPlaying && safe.length > 0) {
      interval = setInterval(() => {
        setCurrentIndex((prev) => {
          if (prev >= safe.length - 1) {
            // Stay at the end and wait for next frame
            return prev;
          }
          return prev + 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isPlaying, safe.length]);

  // Live update: automatically track the latest frame when new ones arrive
  useEffect(() => {
    if (safe.length > prevLengthRef.current) {
      setCurrentIndex(safe.length - 1);
    }
    prevLengthRef.current = safe.length;
  }, [safe.length]);

  useEffect(() => {
    if (currentIndex >= safe.length && safe.length > 0) {
      setCurrentIndex(safe.length - 1);
    }
  }, [safe.length, currentIndex]);

  if (safe.length === 0) {
    return (
      <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
          <SectionLabel>Browser session</SectionLabel>
          <EmptyState
            icon={CameraOff}
            title={thoughts.length > 0 ? 'DOM-first run' : 'No captures yet'}
            description={thoughts.length > 0 ? `${toolName} is using extension DOM control, so screenshots appear only when visual fallback is needed.` : `${toolName} ran but didn't produce screenshots during this session.`}
            note={thoughts.length > 0 ? 'Watch the live thinking rail for current page state and actions.' : 'Frames appear here in real-time as the browser navigates.'}
          />
        </div>
        <NavisThinkingRail events={thoughts} />
      </div>
    );
  }

  const currentScreenshot = safe[currentIndex] || safe[0];

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, overflow: 'hidden' }}>
      <SectionLabel right={`${currentIndex + 1} / ${safe.length} frame${safe.length !== 1 ? 's' : ''}`}>Execution history</SectionLabel>
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column' }}>
        <div style={{
          background: T.surface,
          borderRadius: T.r12,
          border: `1px solid ${T.border}`,
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16
        }}>
          {/* Main Image */}
          <div
            style={{
              width: '100%',
              background: T.surfaceRaised,
              borderRadius: T.r8,
              border: `1px solid ${T.borderSubtle}`,
              overflow: 'hidden',
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 300
            }}
          >
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <img
                src={`data:image/jpeg;base64,${currentScreenshot.base64}`}
                alt="Navis frame"
                style={{ width: '100%', height: 'auto', maxHeight: '60vh', objectFit: 'contain', display: 'block', cursor: 'zoom-in' }}
                onClick={() => setZoomed(currentScreenshot)}
              />
              {currentScreenshot.action?.params?.coordinate && (
                <CursorOverlayOnImage
                  coordinate={currentScreenshot.action.params.coordinate}
                  action={currentScreenshot.action.type}
                />
              )}
            </div>
            <div style={{
              position: 'absolute', bottom: 12, left: 12,
              background: 'rgba(0,0,0,0.6)', color: '#fff',
              padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 400,
              backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.1)',
              zIndex: 10
            }}>
              Step {currentScreenshot.sequenceNumber ?? (currentIndex + 1)}
            </div>
            <div style={{
              position: 'absolute', bottom: 12, right: 12,
              background: 'rgba(0,0,0,0.6)', color: '#fff',
              padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 400,
              backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.1)',
              zIndex: 10
            }}>
              {formatTimestamp(currentScreenshot.timestamp).split(',')[1]?.trim() || ''}
            </div>
          </div>

          {/* Slider and Controls */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '6px 16px 6px 6px',
            background: "#ececea",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.72), inset 0 -1px 0 rgba(0,0,0,0.06), inset 1px 0 rgba(255,255,255,0.50), inset -1px 0 rgba(0,0,0,0.04), 0 2px 5px rgba(0,0,0,0.05)",
            border: "0.5px solid rgba(0,0,0,0.10)",
            borderRadius: 100,
            marginTop: 4
          }}>
            <button
              onClick={() => {
                if (!isPlaying && currentIndex >= safe.length - 1) {
                  setCurrentIndex(0);
                }
                setIsPlaying(!isPlaying);
              }}
              style={{
                width: 34, height: 34, borderRadius: '50%',
                background: isPlaying ? '#111' : '#f9f9f9',
                color: isPlaying ? '#fff' : '#111',
                boxShadow: isPlaying
                  ? 'inset 0 1px 3px rgba(0,0,0,0.3)'
                  : 'inset 0 1px 0 rgba(255,255,255,1), 0 1px 2px rgba(0,0,0,0.05)',
                border: isPlaying ? 'none' : '0.5px solid rgba(0,0,0,0.1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', flexShrink: 0,
                transition: 'all 0.15s ease'
              }}
            >
              {isPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" style={{ marginLeft: 2 }} />}
            </button>

            <input
              type="range"
              className="gallium-slider"
              min={0}
              max={safe.length - 1}
              value={currentIndex}
              onChange={(e) => {
                setIsPlaying(false);
                setCurrentIndex(Number(e.target.value));
              }}
              style={{ flex: 1, cursor: 'pointer' }}
            />
            <style>{`
              .gallium-slider { -webkit-appearance: none; background: transparent; height: 24px; }
              .gallium-slider:focus { outline: none; }
              .gallium-slider::-webkit-slider-runnable-track {
                width: 100%; height: 6px; border-radius: 4px;
                background: rgba(0,0,0,0.06);
                box-shadow: inset 0 1px 2px rgba(0,0,0,0.1);
                border: 0.5px solid rgba(255,255,255,0.4);
              }
              .gallium-slider::-webkit-slider-thumb {
                -webkit-appearance: none;
                height: 20px; width: 20px; border-radius: 50%;
                background: #fafafa;
                box-shadow: inset 0 1px 0 rgba(255,255,255,1), inset 0 -1px 0 rgba(0,0,0,0.1), 0 2px 4px rgba(0,0,0,0.15);
                border: 0.5px solid rgba(0,0,0,0.15);
                margin-top: -7.5px;
                transition: transform 0.1s;
              }
              .gallium-slider::-webkit-slider-thumb:hover {
                transform: scale(1.05);
              }
              .gallium-slider::-webkit-slider-thumb:active {
                transform: scale(0.95);
                background: #f0f0f0;
              }
            `}</style>
          </div>
        </div>
      </div>
      <AnimatePresence>
        {zoomed && <ZoomModal screenshot={zoomed} onClose={() => setZoomed(null)} />}
      </AnimatePresence>
      </div>
      <NavisThinkingRail events={thoughts} />
    </div>
  );
}
/* ============================================================
   TERMINAL VIEW — drop-in replacement
   ============================================================ */

const TERM = {
  bg:       '#0c0c0c',
  border:   'rgba(255,255,255,0.08)',
  divider:  'rgba(255,255,255,0.05)',

  textCmd:  'rgba(255,255,255,0.88)',
  textOut:  'rgba(238,242,247,0.86)',
  textErr:  '#ff5f57',
  textDim:  'rgba(255,255,255,0.2)',
  textMeta: 'rgba(255,255,255,0.3)',

  psUser:   '#5af78e',
  psAt:     'rgba(255,255,255,0.25)',
  psHost:   '#57c7ff',
  psSep:    'rgba(255,255,255,0.2)',
  psPath:   '#f3f99d',
  psDollar: 'rgba(255,255,255,0.4)',

  okBg:     'rgba(40,201,64,0.1)',
  okBorder: 'rgba(40,201,64,0.18)',
  okText:   '#28c940',
  errBg:    'rgba(255,95,87,0.1)',
  errBorder:'rgba(255,95,87,0.18)',
  errText:  '#ff5f57',
};

const monoStack = '"Geist Mono","Berkeley Mono",ui-monospace,"SF Mono",Menlo,monospace';

const ansiControlRegex = /\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]/g;

function normalizeTerminalOutput(output?: string, command?: string) {
  let normalized = (output || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Strip host execution context boilerplate if present at start
  if (/^(success|error): (local )?command (completed|failed)/i.test(normalized.trim())) {
    const lines = normalized.split('\n');
    const outputIndex = lines.findIndex(line => line.trim().toLowerCase() === 'output:');
    if (outputIndex !== -1) {
      normalized = lines.slice(outputIndex + 1).join('\n');
    }
  }

  const cmd = (command || '').trim();
  if (cmd) {
    normalized = normalized
      .split('\n')
      .filter(line => {
        const trimmed = line.trim();
        if (!trimmed.toLowerCase().startsWith('command:')) return true;
        const rest = trimmed.slice('command:'.length).trim();
        return rest && rest !== cmd;
      })
      .join('\n');
  }
  return normalized.replace(/\n{3,}/g, '\n\n').trim();
}

function hasVisibleTerminalOutput(output?: string) {
  return normalizeTerminalOutput(output).replace(ansiControlRegex, '').trim().length > 0;
}

function TerminalChrome({
  children,
}: {
  title: string;
  tint: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: '#151515',
      overflow: 'hidden',
      fontFamily: monoStack,
    }}>
      <style>{`
        .everfern-terminal-output code {
          background: transparent !important;
          color: inherit;
          font: inherit;
          white-space: inherit;
        }
        .everfern-terminal-output span {
          font-family: inherit;
        }
        .everfern-terminal-output ::selection {
          background: rgba(110, 168, 254, 0.35);
        }
      `}</style>
      {children}
    </div>
  );
}

function TerminalAnsiOutput({
  output,
  isError,
  palette,
}: {
  output: string;
  isError: boolean;
  palette: { textOut: string; textErr: string };
}) {
  return (
    <pre
      className="everfern-terminal-output"
      style={{
        fontSize: 12,
        lineHeight: 1.56,
        color: isError ? palette.textErr : palette.textOut,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        margin: '0 0 8px',
        fontFamily: monoStack,
        tabSize: 2,
      }}
    >
      <Ansi>{normalizeTerminalOutput(output)}</Ansi>
    </pre>
  );
}

function PS1({ user = 'ubuntu', host = 'localhost', path = '~' }: { user?: string; host?: string; path?: string }) {
  return (
    <span style={{ flexShrink: 0, whiteSpace: 'nowrap', fontFamily: monoStack, fontSize: 13 }}>
      {path !== '~' ? (
        <span style={{ color: TERM.psPath }}>{path}</span>
      ) : (
        <>
          <span style={{ color: TERM.psUser }}>{user}</span>
          <span style={{ color: TERM.psAt }}>@</span>
          <span style={{ color: TERM.psHost }}>{host}</span>
          <span style={{ color: TERM.psSep }}>:</span>
          <span style={{ color: TERM.psPath }}>{path}</span>
        </>
      )}
      <span style={{ color: TERM.psDollar, margin: '0 8px 0 4px' }}>$</span>
    </span>
  );
}

function BlinkCursor() {
  return (
    <motion.span
      style={{
        display: 'inline-block', width: 7, height: 14,
        background: 'rgba(255,255,255,0.6)', borderRadius: 1,
        verticalAlign: 'text-bottom', marginLeft: 1,
      }}
      animate={{ opacity: [1, 1, 0, 0] }}
      transition={{ repeat: Infinity, duration: 1.1, times: [0, 0.45, 0.5, 0.95], ease: 'linear' }}
    />
  );
}

export function TerminalView({
  command,
  output,
  exitCode,
  duration,
  shellType,
  cwd,
}: {
  command: string;
  output: string;
  exitCode?: number;
  duration?: number;
  shellType?: 'windows' | 'linux';
  cwd?: string;
}) {
  const isError = exitCode !== undefined && exitCode !== 0;
  const cleanOutput = normalizeTerminalOutput(output, command);
  const hasOutput = hasVisibleTerminalOutput(cleanOutput);
  const isWindows = shellType === 'windows';

  // Detect if command looks like a PowerShell command
  const looksLikePS = isWindows || /powershell\.exe/i.test(command) || /^pwsh/i.test(command);

  const showExit = exitCode !== undefined || duration !== undefined;

  // ── Windows/PowerShell Terminal Style ──
  if (looksLikePS) {
    const WIN = {
      bg:       '#151515',
      border:   '#2b2b2b',
      divider:  '#242424',
      textCmd:  '#f8f8f2',
      textOut:  '#f1f1f1',
      textErr:  '#ff7b72',
      textDim:  '#777777',
      textMeta: '#9b9b9b',
      psPrefix: '#f8f8f2',
      psPath:   '#ffffff',
      psChevron:'#f8f8f2',
    };
    const promptCwd = cwd || DEFAULT_TOOL_DETAIL_ROOT;

    return (
      <TerminalChrome title="Windows PowerShell" tint="#58a6ff">
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px 20px', display: 'flex', flexDirection: 'column', background: WIN.bg }}>
          <div style={{ fontSize: 13, color: WIN.textOut, fontFamily: monoStack, marginBottom: 18 }}>
            PowerShell 7.5.5
          </div>

          {/* Prompt + command */}
          <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: hasOutput ? 12 : 0 }}>
            <span style={{ flexShrink: 0, whiteSpace: 'nowrap', fontFamily: monoStack, fontSize: 12.5 }}>
              <span style={{ color: WIN.psPrefix }}>PS </span>
              <span style={{ color: WIN.psPath }}>{promptCwd}</span>
              <span style={{ color: WIN.psChevron, margin: '0 8px 0 4px' }}>&gt;</span>
            </span>
            {command ? (
              <code style={{ fontSize: 12.5, color: WIN.textCmd, lineHeight: 1.5, wordBreak: 'break-word', whiteSpace: 'pre-wrap', fontFamily: monoStack }}>
                {command}
              </code>
            ) : (
              <BlinkCursor />
            )}
          </div>

          {/* Output */}
          {hasOutput ? (
            <TerminalAnsiOutput output={cleanOutput} isError={isError} palette={WIN} />
          ) : null}

          {/* Idle prompt with cursor */}
          {showExit ? (
            <div style={{ display: 'flex', alignItems: 'flex-start', marginTop: hasOutput ? 18 : 0 }}>
              <span style={{ flexShrink: 0, whiteSpace: 'nowrap', fontFamily: monoStack, fontSize: 12.5 }}>
                <span style={{ color: WIN.psPrefix }}>PS </span>
                <span style={{ color: WIN.psPath }}>{promptCwd}</span>
                <span style={{ color: WIN.psChevron, margin: '0 8px 0 4px' }}>&gt;</span>
              </span>
              <BlinkCursor />
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'flex-start', marginTop: 18, color: WIN.textDim, fontSize: 16, fontFamily: monoStack, letterSpacing: '2px' }}>
              <span style={{ animation: 'pulse 1.5s infinite' }}>.</span>
              <span style={{ animation: 'pulse 1.5s infinite', animationDelay: '0.2s' }}>.</span>
              <span style={{ animation: 'pulse 1.5s infinite', animationDelay: '0.4s' }}>.</span>
              <span style={{ animation: 'pulse 1.5s infinite', animationDelay: '0.6s' }}>.</span>
            </div>
          )}
        </div>
      </TerminalChrome>
    );
  }

  // ── Linux Terminal Style (original) ──
  const user = 'ubuntu';
  const host = 'localhost';
  const path = cwd || '~';

  return (
    <TerminalChrome title="Terminal" tint="#5af78e">
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px 20px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 10 }}>
          <PS1 user={user} host={host} path={path} />
          <code style={{ fontSize: 12.5, color: TERM.textCmd, lineHeight: 1.52, wordBreak: 'break-all', whiteSpace: 'pre-wrap', fontFamily: monoStack }}>
            {command}
          </code>
        </div>
        {hasOutput ? (
          <TerminalAnsiOutput output={cleanOutput} isError={isError} palette={TERM} />
        ) : (
          <pre style={{ margin: '0 0 8px', fontSize: 12.5, color: TERM.textDim, fontStyle: 'italic', fontFamily: monoStack }}>
            (no output)
          </pre>
        )}
        {showExit && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, paddingTop: 12, borderTop: `1px solid ${TERM.divider}` }}>
            {exitCode !== undefined && (
              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, fontFamily: monoStack, letterSpacing: '0.03em', background: isError ? TERM.errBg : TERM.okBg, border: `1px solid ${isError ? TERM.errBorder : TERM.okBorder}`, color: isError ? TERM.errText : TERM.okText }}>
                {isError ? `exit ${exitCode}` : 'ok'}
              </span>
            )}
            {duration !== undefined && (
              <span style={{ fontSize: 11, color: TERM.textDim, fontFamily: monoStack, marginLeft: 'auto' }}>
                {formatDuration(duration)}
              </span>
            )}
          </div>
        )}
        {showExit ? (
          <div style={{ display: 'flex', alignItems: 'flex-start', marginTop: 14 }}>
            <PS1 user={user} host={host} path={path} />
            <BlinkCursor />
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-start', marginTop: 14, color: TERM.textDim, fontSize: 16, fontFamily: monoStack, letterSpacing: '2px' }}>
            <span style={{ animation: 'pulse 1.5s infinite' }}>.</span>
            <span style={{ animation: 'pulse 1.5s infinite', animationDelay: '0.2s' }}>.</span>
            <span style={{ animation: 'pulse 1.5s infinite', animationDelay: '0.4s' }}>.</span>
            <span style={{ animation: 'pulse 1.5s infinite', animationDelay: '0.6s' }}>.</span>
          </div>
        )}
      </div>
    </TerminalChrome>
  );
}
/* ============================================================
   SEARCH RESULT CARD
   ============================================================ */
function ResultCard({ title, url, snippet, description: initialDescription, domain, favicon: initialFavicon }: { title: string; url: string; snippet?: string; description?: string; domain: string; favicon?: string }) {
  const [description, setDescription] = useState(initialDescription);
  const [favicon, setFavicon] = useState(initialFavicon);
  const [displayTitle, setDisplayTitle] = useState(title || '');

  useEffect(() => {
    // If we're missing rich info, try to fetch it lazily
    const isTitleURLOrDomain = !title || title.startsWith('http') || (title.includes('.') && !title.includes(' '));
    if (!initialDescription || !initialFavicon || isTitleURLOrDomain) {
      const fetchMeta = async () => {
        try {
          const api = (window as any).electronAPI;
          if (!api?.system?.fetchMetadata) return;

          const meta = await api.system.fetchMetadata(url);
          if (meta) {
            if (!initialDescription && meta.description) setDescription(meta.description);
            if (!initialFavicon && meta.favicon) setFavicon(meta.favicon);
            if (meta.title) setDisplayTitle(meta.title);
          }
        } catch { /* ignore */ }
      };
      fetchMeta();
    }
  }, [url, initialDescription, initialFavicon, title]);

  const content = description || snippet || '';
  const displayFavicon = favicon || getFaviconUrl(domain);
  const finalTitle = displayTitle?.trim() || domain || url || 'Search Result';
  let displayDomain = domain || 'Unknown';
  if (displayDomain === 'Unknown' && url) {
    try {
      displayDomain = new URL(url).hostname;
    } catch { /* ignore */ }
  }

  return (
    <motion.article
      onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
      role="button" tabIndex={0}
      onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && window.open(url, '_blank')}
      style={{
        padding: '16px 18px',
        background: CLAY.card,
        backgroundColor: CLAY.card,
        backgroundImage: 'none',
        border: `1px solid ${VS.border}`,
        borderRadius: 12,
        color: VS.text,
        cursor: 'pointer',
        boxShadow: CLAY.shadow,
        position: 'relative',
        overflow: 'hidden',
        flexShrink: 0,
      }}
      whileHover={{ borderColor: VS.borderStrong, y: -1, background: CLAY.cardMuted, backgroundColor: CLAY.cardMuted }}
      transition={{ duration: 0.12 }}
    >
      {/* Domain */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9 }}>
        {displayFavicon && (
          <img src={displayFavicon} alt="" width={13} height={13} style={{ borderRadius: 3, opacity: 0.7, flexShrink: 0 }}
            onError={e => e.currentTarget.style.display = 'none'} />
        )}
        <span style={{ fontSize: 10, fontWeight: 400, color: VS.muted, letterSpacing: '0.07em', textTransform: 'uppercase', fontFamily: T.sans }}>
          {displayDomain}
        </span>
      </div>

      {/* Title */}
      <h3 style={{
        fontSize: 13.5, fontWeight: 400, color: VS.text, margin: content ? '0 0 8px' : 0,
        lineHeight: 1.45, letterSpacing: '-0.015em', fontFamily: T.sans,
      }}>
        {finalTitle}
      </h3>

      {/* Snippet / Description */}
      {content && (
        <p style={{
          fontSize: 12.5, color: VS.muted, lineHeight: 1.7, margin: 0,
          display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          fontFamily: T.sans,
        }}>
          {content}
        </p>
      )}
    </motion.article>
  );
}

/* ============================================================
   LIVE PREVIEW VIEW
   ============================================================ */
function extractLivePreviewData(tc: any) {
  const url = normalizePanelUrl(String(tc.args?.url || tc.data?.url || tc.result?.data?.url || tc.output || ''));
  return { url };
}

function LivePreviewView({ url }: { url: string }) {
  const [currentUrl, setCurrentUrl] = useState(url);
  const [iframeUrl, setIframeUrl] = useState(url);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    setCurrentUrl(url);
    setIframeUrl(url);
  }, [url]);

  const handleReload = () => {
    if (iframeRef.current) {
      iframeRef.current.src = iframeUrl;
    }
  };

  const handleNavigate = (e: React.FormEvent) => {
    e.preventDefault();
    let target = currentUrl.trim();
    if (target && !/^https?:\/\//i.test(target)) {
      target = 'http://' + target;
    }
    setIframeUrl(target);
    setCurrentUrl(target);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: T.bg }}>
      {/* Browser Address Bar / Header */}
      <div style={{
        padding: '8px 16px',
        background: T.surface,
        borderBottom: `1px solid ${T.border}`,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexShrink: 0
      }}>
        {/* Nav Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button 
            disabled 
            style={{
              background: 'transparent',
              border: 'none',
              padding: 4,
              color: T.textPlaceholder,
              cursor: 'not-allowed',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <button 
            disabled 
            style={{
              background: 'transparent',
              border: 'none',
              padding: 4,
              color: T.textPlaceholder,
              cursor: 'not-allowed',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
          <button 
            onClick={handleReload}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 4,
              color: T.textSecondary,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center'
            }}
            className="hover:text-zinc-900 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 11-.57-8.38l5.67-5.67" />
            </svg>
          </button>
        </div>

        {/* Address Input */}
        <form onSubmit={handleNavigate} style={{ flex: 1, display: 'flex' }}>
          <div style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: T.bg,
            border: `1px solid ${T.border}`,
            borderRadius: T.r6,
            padding: '4px 12px',
            height: 28
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={T.green} strokeWidth="3">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
            <input
              type="text"
              value={currentUrl}
              onChange={(e) => setCurrentUrl(e.target.value)}
              style={{
                background: 'transparent',
                border: 'none',
                outline: 'none',
                fontSize: 12,
                color: T.text,
                fontFamily: T.sans,
                width: '100%'
              }}
            />
          </div>
        </form>

        {/* Open External */}
        <a 
          href={iframeUrl} 
          target="_blank" 
          rel="noopener noreferrer"
          style={{
            background: 'transparent',
            border: 'none',
            padding: 4,
            color: T.textSecondary,
            display: 'flex',
            alignItems: 'center',
            textDecoration: 'none'
          }}
          className="hover:text-zinc-900 transition-colors"
          title="Open in new tab"
        >
          <ExternalLink size={14} />
        </a>
      </div>

      {/* Frame wrapper */}
      <div style={{ flex: 1, position: 'relative', background: '#fff' }}>
        <iframe
          ref={iframeRef}
          src={iframeUrl}
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
            background: '#fff'
          }}
          sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
        />
      </div>
    </div>
  );
}

/* ============================================================
   WEB SEARCH VIEW
   ============================================================ */
function WebSearchView({ query, results = [], totalResults = 0 }: { query: string; results?: any[]; totalResults?: number }) {
  const safe = Array.isArray(results) ? results : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: VS.bg, color: VS.text }}>
      {/* Query pill */}
      <div style={{ padding: '14px 18px', background: VS.bg, borderBottom: `1px solid ${VS.border}`, flexShrink: 0 }}>
        <div style={{ background: CLAY.card, border: `1px solid ${VS.border}`, borderRadius: 12, padding: '12px 14px', boxShadow: CLAY.shadow }}>
          <p style={{ fontSize: 9.5, fontWeight: 400, color: VS.muted, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 6px', fontFamily: T.sans }}>
            Query
          </p>
          <p style={{ fontSize: 13.5, fontWeight: 400, color: VS.text, margin: 0, letterSpacing: '-0.01em', lineHeight: 1.5, fontFamily: T.sans }}>
            "{query}"
          </p>
        </div>
      </div>

      {safe.length === 0 ? (
        <EmptyState icon={IconSearch} title="No results" description="The search didn't return any matches for this query." />
      ) : (
        <>
          <div style={{
            height: 42,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 18px',
            borderBottom: `1px solid ${VS.border}`,
            color: VS.muted,
            fontFamily: T.sans,
            fontSize: 10.5,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}>
            <span>Results</span>
            <span style={{
              minWidth: 26,
              height: 24,
              padding: '0 8px',
              borderRadius: 999,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: VS.text,
              background: CLAY.card,
              border: `1px solid ${VS.border}`,
              fontSize: 11,
              letterSpacing: 0,
              textTransform: 'none',
            }}>{totalResults}</span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px 24px', display: 'flex', flexDirection: 'column', gap: 10, background: VS.bg }}>
            {safe.map((r, i) => <ResultCard key={`${r.url}-${i}`} {...r} />)}
          </div>
        </>
      )}
    </div>
  );
}

type McpRegistryConnector = {
  name: string;
  description?: string;
  status?: string;
  connectSnippet?: string;
};

function parseMcpRegistryConnectors(output: string): McpRegistryConnector[] {
  const text = String(output || '');
  const connectors: McpRegistryConnector[] = [];
  const sectionRegex = /^###\s+(.+?)\s*$([\s\S]*?)(?=^###\s+|\s*$)/gm;
  let match: RegExpExecArray | null;

  while ((match = sectionRegex.exec(text)) !== null) {
    const name = match[1]?.trim();
    const body = match[2] || '';
    if (!name) continue;
    const line = (label: string) => {
      const lineMatch = body.match(new RegExp(`-\\s*\\*\\*${label}\\*\\*:\\s*([^\\n]+)`, 'i'));
      return lineMatch?.[1]?.trim() || '';
    };
    const connect = body.match(/connect_mcp_server\([\s\S]*?\)/)?.[0] || line('To Connect');
    connectors.push({
      name,
      description: line('Description'),
      status: line('Status'),
      connectSnippet: connect.replace(/^Use\s+/i, '').trim(),
    });
  }

  return connectors;
}

function McpRegistryView({
  keyword,
  connectors = [],
  totalResults = 0,
  output,
}: {
  keyword: string;
  connectors?: McpRegistryConnector[];
  totalResults?: number;
  output?: string;
}) {
  const safe = Array.isArray(connectors) ? connectors : [];
  const copyText = output || safe.map(connector => `${connector.name}\n${connector.description || ''}\n${connector.connectSnippet || ''}`).join('\n\n');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: VS.bg, color: VS.text }}>
      <div style={{ padding: '14px 18px', background: VS.bg, borderBottom: `1px solid ${VS.border}`, flexShrink: 0 }}>
        <div style={{ background: CLAY.card, border: `1px solid ${VS.border}`, borderRadius: 12, padding: '12px 14px', boxShadow: CLAY.shadow }}>
          <p style={{ fontSize: 9.5, fontWeight: 400, color: VS.muted, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 6px', fontFamily: T.sans }}>
            MCP Registry
          </p>
          <p style={{ fontSize: 13.5, fontWeight: 400, color: VS.text, margin: 0, letterSpacing: '-0.01em', lineHeight: 1.5, fontFamily: T.sans }}>
            {keyword ? `Searching connectors for "${keyword}"` : 'Searching available connectors'}
          </p>
        </div>
      </div>

      {safe.length === 0 ? (
        <EmptyState icon={IconSearch} title="No MCP connectors" description={output || "The registry didn't return a connector for this software."} />
      ) : (
        <>
          <div style={{
            height: 42,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 18px',
            borderBottom: `1px solid ${VS.border}`,
            color: VS.muted,
            fontFamily: T.sans,
            fontSize: 10.5,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}>
            <span>Connectors</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {copyText && <CopyBtn text={copyText} />}
              <span style={{
                minWidth: 26,
                height: 24,
                padding: '0 8px',
                borderRadius: 999,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: VS.text,
                background: CLAY.card,
                border: `1px solid ${VS.border}`,
                fontSize: 11,
                letterSpacing: 0,
                textTransform: 'none',
              }}>{totalResults || safe.length}</span>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px 24px', display: 'flex', flexDirection: 'column', gap: 10, background: VS.bg }}>
            {safe.map((connector, index) => (
              <div key={`${connector.name}-${index}`} style={{
                background: CLAY.card,
                border: `1px solid ${VS.border}`,
                borderRadius: 12,
                padding: '13px 14px',
                boxShadow: CLAY.shadow,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <div style={{
                      width: 24,
                      height: 24,
                      borderRadius: 8,
                      background: 'rgba(6,182,212,0.10)',
                      border: '1px solid rgba(6,182,212,0.24)',
                      color: '#0891b2',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      <Braces size={13} />
                    </div>
                    <p style={{ margin: 0, color: VS.text, fontFamily: T.sans, fontSize: 13.5, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {connector.name}
                    </p>
                  </div>
                  {connector.status && (
                    <span style={{
                      color: '#16a34a',
                      border: '1px solid rgba(34,197,94,0.24)',
                      borderRadius: 999,
                      padding: '3px 8px',
                      fontSize: 10.5,
                      lineHeight: 1,
                      fontFamily: T.sans,
                      flexShrink: 0,
                    }}>
                      {connector.status}
                    </span>
                  )}
                </div>
                {connector.description && (
                  <p style={{ margin: 0, color: VS.muted, fontFamily: T.sans, fontSize: 12.5, lineHeight: 1.5 }}>
                    {connector.description}
                  </p>
                )}
                {connector.connectSnippet && (
                  <code style={{
                    display: 'block',
                    marginTop: 10,
                    color: VS.text,
                    background: CLAY.cardMuted,
                    border: `1px solid ${VS.border}`,
                    borderRadius: 9,
                    padding: '9px 10px',
                    fontFamily: T.mono,
                    fontSize: 11.5,
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}>
                    {connector.connectSnippet}
                  </code>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ============================================================
   GENERIC TOOL VIEW
   ============================================================ */
function CollapsibleSection({
  icon: Icon, label, badge, defaultOpen = false, dark = false, children,
}: {
  icon: React.ComponentType<{ size: number; color: string; strokeWidth: number }>;
  label: string;
  badge?: string;
  defaultOpen?: boolean;
  dark?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div style={{ borderBottom: `1px solid ${dark ? VS.border : T.borderSubtle}`, background: dark ? VS.bg : T.surface }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', padding: '16px 24px', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', background: 'transparent', border: 'none',
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 30, height: 30, borderRadius: T.r8, background: dark ? CLAY.card : T.surfaceRaised,
            border: `1px solid ${dark ? VS.borderStrong : T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: dark ? CLAY.shadow : 'inset 0 1px 0 rgba(255,255,255,0.8)',
          }}>
            <Icon size={13} color={dark ? VS.muted : T.textSecondary} strokeWidth={1.75} />
          </div>
          <span style={{ fontSize: 13, fontWeight: 400, color: dark ? VS.text : T.text, fontFamily: T.sans }}>{label}</span>
          {badge && (
            <span style={{
              fontSize: 10, fontWeight: 400, color: dark ? VS.muted : T.textMuted, background: dark ? CLAY.card : T.surfaceRaised,
              border: `1px solid ${dark ? VS.borderStrong : T.border}`, padding: '2px 8px', borderRadius: 20, fontFamily: T.mono,
            }}>
              {badge}
            </span>
          )}
        </div>
        <motion.div animate={{ rotate: open ? 0 : -90 }} transition={{ duration: 0.16 }}>
          <ChevronDown size={13} color={dark ? VS.muted : T.textMuted} strokeWidth={2} />
        </motion.div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18, ease: 'easeInOut' }}
            style={{ overflow: 'hidden', borderTop: `1px solid ${dark ? VS.border : T.borderSubtle}`, background: dark ? VS.bg : T.bg }}
          >
            <div style={{ padding: '16px 24px 20px' }}>{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function GenericView({ args, output, result }: { toolName: string; args?: any; output?: string; result?: any }) {
  const argEntries = Object.entries(args || {});

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflowY: 'auto', background: T.bg }}>
        {argEntries.length > 0 && (
          <CollapsibleSection icon={Braces} label="Arguments" badge={`${argEntries.length}`}>
            <div style={{
              margin: 0, fontFamily: T.mono, fontSize: 12, lineHeight: 1.8,
              background: T.inkBg, color: T.inkText,
              padding: '18px 20px', borderRadius: T.r10,
              border: `1px solid ${T.inkBorder}`, maxHeight: 280, overflowY: 'auto',
              boxShadow: '0 1px 3px rgba(0,0,0,0.03), inset 0 1px 0 rgba(255,255,255,0.5)',
            }}>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                <code>{JSON.stringify(args, null, 2)}</code>
              </pre>
            </div>
          </CollapsibleSection>
        )}

        {output && (
          <CollapsibleSection icon={Terminal} label="Output" defaultOpen>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8 }}>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                {/* Execution Status Indicator */}
                <div style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: result?.exitCode === 0 ? T.green : (result?.exitCode ? T.red : T.amber),
                  animation: !result ? 'pulse 2s infinite' : 'none'
                }} />
                <span style={{ fontSize: 11, color: T.textMuted, fontFamily: T.sans }}>
                  {!result ? 'Running...' : result.exitCode === 0 ? 'Success' : `Exit Code: ${result.exitCode}`}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {result?.duration && (
                  <span style={{ fontSize: 11, color: T.textMuted, fontFamily: T.mono, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Clock size={12} /> {(result.duration / 1000).toFixed(2)}s
                  </span>
                )}
                <CopyBtn text={output} />
              </div>
            </div>
            <div style={{
              margin: 0, fontFamily: T.mono, fontSize: 12, lineHeight: 1.85,
              background: T.inkBg, color: T.inkText,
              padding: '18px 20px', borderRadius: T.r10,
              border: `1px solid ${T.inkBorder}`, maxHeight: 420, overflowY: 'auto',
              boxShadow: '0 1px 3px rgba(0,0,0,0.03), inset 0 1px 0 rgba(255,255,255,0.5)',
              position: 'relative'
            }}>
              {/* Live Streaming Indicator */}
              {!result && (
                <div style={{
                  position: 'absolute', top: 12, right: 12,
                  display: 'flex', alignItems: 'center', gap: 6,
                  fontSize: 11, color: T.amber, fontFamily: T.sans,
                  background: 'rgba(251, 191, 36, 0.1)', padding: '4px 8px',
                  borderRadius: 4, border: `1px solid rgba(251, 191, 36, 0.2)`
                }}>
                  <div style={{ width: 6, height: 6, background: T.amber, borderRadius: '50%', animation: 'pulse 1s infinite' }} />
                  LIVE
                </div>
              )}
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', paddingRight: 60 }}>
                <code>{output}</code>
              </pre>
            </div>
          </CollapsibleSection>
        )}
      </div>
    </div>
  );
}

function TodoWriteView({
  tasks,
  path,
  output,
}: {
  tasks: Array<{ description: string; status: string }>;
  path?: string;
  output?: string;
}) {
  const counts = {
    completed: tasks.filter(t => t.status === 'completed').length,
    inProgress: tasks.filter(t => t.status === 'in_progress').length,
    pending: tasks.filter(t => t.status === 'pending').length,
  };

  const statusMeta = (status: string) => {
    if (status === 'completed') return { label: 'Done', color: '#4ade80', border: 'rgba(74,222,128,0.32)', mark: '✓' };
    if (status === 'in_progress') return { label: 'Active', color: '#7aa2f7', border: 'rgba(122,162,247,0.32)', mark: '•' };
    return { label: 'Pending', color: VS.muted, border: 'rgba(255,255,255,0.12)', mark: '○' };
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: VS.bg, color: VS.text }}>
      <div style={{ padding: '16px 18px', borderBottom: `1px solid ${VS.border}`, background: VS.bg, flexShrink: 0 }}>
        <h3 style={{ fontSize: 13.5, fontWeight: 400, color: VS.text, margin: '0 0 4px', letterSpacing: '-0.015em', fontFamily: T.sans }}>
          Todo Write
        </h3>
        <p style={{ fontSize: 12, color: VS.muted, margin: 0, fontFamily: T.sans }}>
          {tasks.length} tasks · {counts.completed} done · {counts.inProgress} active · {counts.pending} pending
        </p>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px 24px', display: 'flex', flexDirection: 'column', gap: 12, background: VS.bg }}>
        {path && (
          <div style={{ background: CLAY.card, border: `1px solid ${VS.border}`, borderRadius: 12, padding: '12px 14px', boxShadow: CLAY.shadow }}>
            <p style={{ fontSize: 10, fontWeight: 400, color: VS.muted, letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 6px', fontFamily: T.sans }}>
              Saved To
            </p>
            <code style={{ fontSize: 12, color: VS.text, fontFamily: T.mono, wordBreak: 'break-all' }}>{path}</code>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tasks.map((task, index) => {
            const meta = statusMeta(task.status);
            return (
              <div key={`${task.description}-${index}`} style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                padding: '11px 12px',
                background: CLAY.card,
                border: `1px solid ${VS.border}`,
                boxShadow: CLAY.shadow,
                borderRadius: 10,
              }}>
                <span style={{
                  width: 20,
                  height: 20,
                  borderRadius: 999,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'transparent',
                  border: `1px solid ${meta.border}`,
                  color: meta.color,
                  fontSize: 12,
                  fontWeight: 400,
                  fontFamily: T.sans,
                }}>
                  {meta.mark}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p style={{ margin: 0, color: VS.text, fontSize: 13, lineHeight: 1.45, fontFamily: T.sans }}>
                    {task.description}
                  </p>
                  <span style={{ display: 'inline-block', marginTop: 5, color: meta.color, fontSize: 10.5, fontWeight: 400, letterSpacing: '0.05em', textTransform: 'uppercase', fontFamily: T.sans }}>
                    {meta.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {output && (
          <div style={{
            color: VS.muted,
            background: CLAY.card,
            border: `1px solid ${VS.border}`,
            borderRadius: 10,
            padding: '12px 14px',
            fontSize: 12,
            lineHeight: 1.5,
            fontFamily: T.sans
          }}>
            {output}
          </div>
        )}
      </div>
    </div>
  );
}

function PlanView({
  title,
  summary,
  steps,
  path,
  output,
}: {
  title: string;
  summary?: string;
  steps: Array<{ id: string; title: string; description?: string; status: string; tool?: string }>;
  path?: string;
  output?: string;
}) {
  const statusMeta = (status: string) => {
    const normalized = status.replace('-', '_').toLowerCase();
    if (normalized === 'completed' || normalized === 'done') return { label: 'Done', color: '#4ade80', border: 'rgba(74,222,128,0.32)', mark: '✓' };
    if (normalized === 'in_progress' || normalized === 'active') return { label: 'Active', color: '#7aa2f7', border: 'rgba(122,162,247,0.32)', mark: '•' };
    if (normalized === 'failed' || normalized === 'blocked') return { label: status, color: '#ff5f57', border: 'rgba(255,95,87,0.34)', mark: '!' };
    return { label: status || 'Pending', color: VS.muted, border: 'rgba(255,255,255,0.12)', mark: '○' };
  };

  const rawFallback = output && steps.length === 0 && !summary;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: VS.bg, color: VS.text }}>
      <div style={{ padding: '16px 18px', borderBottom: `1px solid ${VS.border}`, background: VS.bg, flexShrink: 0 }}>
        <h3 style={{ fontSize: 13.5, fontWeight: 400, color: VS.text, margin: '0 0 4px', letterSpacing: '-0.015em', fontFamily: T.sans }}>
          {title || 'Execution Plan'}
        </h3>
        <p style={{ fontSize: 12, color: VS.muted, margin: 0, fontFamily: T.sans }}>
          {steps.length ? `${steps.length} step${steps.length === 1 ? '' : 's'}` : 'Plan tool call'}
        </p>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px 24px', display: 'flex', flexDirection: 'column', gap: 12, background: VS.bg }}>
        {path && (
          <div style={{ background: CLAY.card, border: `1px solid ${VS.border}`, borderRadius: 12, padding: '12px 14px', boxShadow: CLAY.shadow }}>
            <p style={{ fontSize: 10, fontWeight: 400, color: VS.muted, letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 6px', fontFamily: T.sans }}>
              Plan Path
            </p>
            <code style={{ fontSize: 12, color: VS.text, fontFamily: T.mono, wordBreak: 'break-all' }}>{path}</code>
          </div>
        )}

        {summary && (
          <div style={{ background: CLAY.card, border: `1px solid ${VS.border}`, borderRadius: 12, padding: '12px 14px', boxShadow: CLAY.shadow }}>
            <p style={{ margin: 0, color: VS.text, fontSize: 12.5, lineHeight: 1.55, fontFamily: T.sans, whiteSpace: 'pre-wrap' }}>
              {summary}
            </p>
          </div>
        )}

        {steps.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {steps.map((step, index) => {
              const meta = statusMeta(step.status);
              return (
                <div key={`${step.id}-${index}`} style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  padding: '11px 12px',
                  background: CLAY.card,
                  border: `1px solid ${VS.border}`,
                  boxShadow: CLAY.shadow,
                  borderRadius: 10,
                }}>
                  <span style={{
                    width: 20,
                    height: 20,
                    borderRadius: 999,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'transparent',
                    border: `1px solid ${meta.border}`,
                    color: meta.color,
                    fontSize: 12,
                    fontWeight: 400,
                    fontFamily: T.sans,
                  }}>
                    {meta.mark}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p style={{ margin: 0, color: VS.text, fontSize: 13, lineHeight: 1.45, fontFamily: T.sans }}>
                      {step.title}
                    </p>
                    {step.description && step.description !== step.title && (
                      <p style={{ margin: '5px 0 0', color: VS.muted, fontSize: 12, lineHeight: 1.45, fontFamily: T.sans }}>
                        {step.description}
                      </p>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                      <span style={{ color: meta.color, fontSize: 10.5, fontWeight: 400, letterSpacing: '0.05em', textTransform: 'uppercase', fontFamily: T.sans }}>
                        {meta.label}
                      </span>
                      {step.tool && (
                        <code style={{ color: VS.dim, fontSize: 10.5, fontFamily: T.mono }}>
                          {step.tool}
                        </code>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {rawFallback && (
          <div style={{
            color: VS.muted,
            background: CLAY.card,
            border: `1px solid ${VS.border}`,
            borderRadius: 10,
            padding: '12px 14px',
            fontSize: 12,
            lineHeight: 1.5,
            fontFamily: T.sans,
            whiteSpace: 'pre-wrap',
          }}>
            {output}
          </div>
        )}
      </div>
    </div>
  );
}

function PresentationView({
  title,
  outputPath,
  deckGoal,
  audience,
  visualDirection,
  designMode,
  deckType,
  slideCount,
  slideIntents,
  slides,
  output,
}: {
  title: string;
  outputPath?: string;
  deckGoal?: string;
  audience?: string;
  visualDirection?: string;
  designMode?: string;
  deckType?: string;
  slideCount?: number;
  slideIntents: string[];
  slides: Array<{ title: string; intent?: string; visualIdea?: string; speakerNotes?: string; notes?: string }>;
  output?: string;
}) {
  const summaryItems = [
    { label: 'Mode', value: designMode || 'adaptive' },
    { label: 'Type', value: deckType || 'presentation' },
    { label: 'Slides', value: slideCount ? String(slideCount) : String(slides.length || slideIntents.length || 0) },
  ];

  const intentColor = (intent: string, index: number) => {
    const colors = ['#7aa2f7', '#4ade80', '#fdbc2e', '#c084fc', '#fb7185', '#22d3ee'];
    return colors[index % colors.length];
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: VS.bg, color: VS.text }}>
      <div style={{ padding: '16px 18px', borderBottom: `1px solid ${VS.border}`, background: VS.bg, flexShrink: 0 }}>
        <h3 style={{ fontSize: 13.5, fontWeight: 400, color: VS.text, margin: '0 0 4px', letterSpacing: '-0.015em', fontFamily: T.sans }}>
          {title || 'Generated Presentation'}
        </h3>
        <p style={{ fontSize: 12, color: VS.muted, margin: 0, fontFamily: T.sans }}>
          {visualDirection || 'Adaptive presentation deck'}
        </p>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px 24px', display: 'flex', flexDirection: 'column', gap: 12, background: VS.bg }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
          {summaryItems.map((item) => (
            <div key={item.label} style={{ background: CLAY.card, border: `1px solid ${VS.border}`, borderRadius: 12, padding: '10px 12px', boxShadow: CLAY.shadow }}>
              <p style={{ fontSize: 10, fontWeight: 400, color: VS.muted, letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 6px', fontFamily: T.sans }}>
                {item.label}
              </p>
              <p style={{ margin: 0, color: VS.text, fontSize: 13, lineHeight: 1.25, fontFamily: T.sans, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.value}
              </p>
            </div>
          ))}
        </div>

        {outputPath && (
          <div style={{ background: CLAY.card, border: `1px solid ${VS.border}`, borderRadius: 12, padding: '12px 14px', boxShadow: CLAY.shadow }}>
            <p style={{ fontSize: 10, fontWeight: 400, color: VS.muted, letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 6px', fontFamily: T.sans }}>
              Output Path
            </p>
            <code style={{ fontSize: 12, color: VS.text, fontFamily: T.mono, wordBreak: 'break-all' }}>{outputPath}</code>
          </div>
        )}

        {(deckGoal || audience) && (
          <div style={{ background: CLAY.card, border: `1px solid ${VS.border}`, borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10, boxShadow: CLAY.shadow }}>
            {deckGoal && (
              <div>
                <p style={{ fontSize: 10, fontWeight: 400, color: VS.muted, letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 5px', fontFamily: T.sans }}>
                  Goal
                </p>
                <p style={{ margin: 0, color: VS.text, fontSize: 12.5, lineHeight: 1.5, fontFamily: T.sans }}>{deckGoal}</p>
              </div>
            )}
            {audience && (
              <div>
                <p style={{ fontSize: 10, fontWeight: 400, color: VS.muted, letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 5px', fontFamily: T.sans }}>
                  Audience
                </p>
                <p style={{ margin: 0, color: VS.text, fontSize: 12.5, lineHeight: 1.5, fontFamily: T.sans }}>{audience}</p>
              </div>
            )}
          </div>
        )}

        {slideIntents.length > 0 && (
          <div style={{ background: CLAY.card, border: `1px solid ${VS.border}`, borderRadius: 12, padding: '12px 14px', boxShadow: CLAY.shadow }}>
            <p style={{ fontSize: 10, fontWeight: 400, color: VS.muted, letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 9px', fontFamily: T.sans }}>
              Slide Rhythm
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
              {slideIntents.map((intent, index) => (
                <span key={`${intent}-${index}`} style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 8px',
                  borderRadius: 999,
                  border: `1px solid ${intentColor(intent, index)}44`,
                  color: intentColor(intent, index),
                  fontSize: 11,
                  fontFamily: T.sans,
                  background: 'transparent',
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: 999, background: intentColor(intent, index), boxShadow: `0 0 10px ${intentColor(intent, index)}88` }} />
                  {intent}
                </span>
              ))}
            </div>
          </div>
        )}

        {slides.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {slides.map((slide, index) => (
              <div key={`${slide.title}-${index}`} style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                padding: '11px 12px',
                background: CLAY.card,
                border: `1px solid ${VS.border}`,
                boxShadow: CLAY.shadow,
                borderRadius: 10,
              }}>
                <span style={{
                  width: 22,
                  height: 22,
                  borderRadius: 7,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'transparent',
                  border: `1px solid ${intentColor(slide.intent || '', index)}55`,
                  color: intentColor(slide.intent || '', index),
                  fontSize: 11,
                  fontFamily: T.mono,
                }}>
                  {index + 1}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p style={{ margin: 0, color: VS.text, fontSize: 13, lineHeight: 1.45, fontFamily: T.sans }}>
                    {slide.title}
                  </p>
                  {slide.intent && (
                    <span style={{ display: 'inline-block', marginTop: 5, color: intentColor(slide.intent, index), fontSize: 10.5, fontWeight: 400, letterSpacing: '0.05em', textTransform: 'uppercase', fontFamily: T.sans }}>
                      {slide.intent}
                    </span>
                  )}
                  {slide.visualIdea && (
                    <p style={{ margin: '6px 0 0', color: VS.muted, fontSize: 12, lineHeight: 1.45, fontFamily: T.sans }}>
                      {slide.visualIdea}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {output && (
          <div style={{
            color: VS.muted,
            background: CLAY.card,
            border: `1px solid ${VS.border}`,
            borderRadius: 10,
            padding: '12px 14px',
            fontSize: 12,
            lineHeight: 1.5,
            fontFamily: T.sans,
            whiteSpace: 'pre-wrap',
          }}>
            {output}
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   SKILL VIEW
   ============================================================ */
function SkillView({ skillName, name, path, content }: { skillName: string; name: string; path: string; content: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Subtitle bar */}
      <div style={{ padding: '18px 24px', borderBottom: `1px solid ${T.border}`, background: T.surface, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <h3 style={{ fontSize: 13.5, fontWeight: 400, color: T.text, margin: 0, letterSpacing: '-0.015em', fontFamily: T.sans }}>
            {name}
          </h3>
          <span style={{
            fontSize: 9.5, fontWeight: 400, color: T.green, background: T.greenFaint,
            border: `1px solid rgba(34,197,94,0.15)`, padding: '2px 8px', borderRadius: 20, fontFamily: T.sans
          }}>
            Skill Loaded
          </span>
        </div>
        {path && <p style={{ fontSize: 11.5, color: T.textSecondary, fontFamily: T.mono, wordBreak: 'break-all', margin: 0 }}>{path}</p>}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', background: T.bg, padding: '20px 24px 28px' }}>
        {content && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', paddingBottom: 10 }}>
              <CopyBtn text={content} />
            </div>
            <div style={{
              background: T.surface,
              border: `1px solid ${T.border}`,
              borderRadius: T.r10,
              overflow: 'hidden'
            }}>
              <MarkdownViewer content={content} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function extractSkillData(tc: any) {
  try {
    const args = tc.args || tc.arguments || {};
    const skillName = args.name || args.skill || '';
    const skill = tc.data?.skill || null;
    return {
      skillName,
      name: skill?.name || skillName || 'Skill',
      path: skill?.path || '',
      content: skill?.content || tc.output || '',
    };
  } catch {
    return null;
  }
}

/* ============================================================
   DATA EXTRACTION
   ============================================================ */
export function extractWebSearchData(tc: any) {
  try {
    const args = tc.args || tc.arguments || {};
    const data = tc.data || tc.result?.data || tc.result || {};
    const output = extractOutputText(tc);
    let parsedOutput: any = null;
    try {
      parsedOutput = output.trim().startsWith('{') || output.trim().startsWith('[') ? JSON.parse(output) : null;
    } catch { /* ignore non-json output */ }
    const query = args.query || args.q || data.query || parsedOutput?.query || '';
    const raw = data.results || data.items || data.searchResults || parsedOutput?.results || parsedOutput?.items;
    const results = Array.isArray(raw) ? raw : [];

    // Process results to include domain and ensure favicon fallback
    const processed = results.map(r => {
      let domain = r.domain || '';
      if (!domain && r.url) {
        try {
          domain = new URL(r.url).hostname;
        } catch { /* ignore */ }
      }
      return {
        ...r,
        domain,
        description: r.description || r.snippet || '',
      };
    });

    return { query, results: processed.slice(0, 50), totalResults: results.length };
  } catch { return null; }
}

function extractMcpRegistryData(tc: any) {
  try {
    const args = tc.args || tc.arguments || {};
    const data = tc.data || tc.result?.data || tc.result || {};
    const output = extractOutputText(tc);
    const keyword = String(args.keyword || args.query || data.keyword || data.query || '').trim();
    const rawConnectors = data.connectors || data.results || data.items;
    const connectors = Array.isArray(rawConnectors)
      ? rawConnectors.map((item: any) => ({
        name: String(item.name || item.id || item.title || 'Connector'),
        description: item.description ? String(item.description) : '',
        status: item.status ? String(item.status) : '',
        connectSnippet: item.command ? `connect_mcp_server({ name: "${item.name || item.id}", command: "${item.command}" })` : String(item.connectSnippet || item.connect || ''),
      }))
      : parseMcpRegistryConnectors(output);

    return {
      keyword,
      connectors,
      totalResults: connectors.length,
      output,
    };
  } catch { return null; }
}

export function extractFernData(tc: any, progressEvents: any[] = []) {
  try {
    const screenshots: any[] = [];
    const screenshotPaths: string[] = [];
    const thinkingEvents: any[] = [];
    const seen = new Set();
    const seenPaths = new Set<string>();

    const add = (b64: string, ts: any, seq: number, actionInfo?: any, filePath?: string) => {
      if (!b64 && !filePath) return;
      const clean = b64 ? (b64.startsWith('data:image') ? b64.substring(b64.indexOf(',') + 1) : b64) : '';
      // Deduplicate by base64 content if present, else by file path
      const key = clean || filePath || '';
      if (key && seen.has(key)) return;
      if (key) seen.add(key);
      screenshots.push({ base64: clean, screenshotPath: filePath, timestamp: ts, sequenceNumber: seq, action: actionInfo });
    };

    const addPath = (filePath: string) => {
      if (filePath && !seenPaths.has(filePath)) {
        seenPaths.add(filePath);
        screenshotPaths.push(filePath);
      }
    };

    let lastAction: any = null;

    // 1. Process real-time progress events first (higher priority for live view)
    if (Array.isArray(progressEvents)) {
      progressEvents.forEach((e: any, i: number) => {
        if (['reasoning', 'action', 'step', 'complete', 'abort', 'error'].includes(e.type)) {
          thinkingEvents.push({
            type: e.type,
            timestamp: e.timestamp || Date.now(),
            stepNumber: e.stepNumber,
            totalSteps: e.totalSteps,
            content: e.content,
            action: e.action,
            metadata: e.metadata || {},
          });
        }
        if (e.type === 'action') {
          lastAction = e.action;
        } else if (e.type === 'screenshot') {
          const b64 = e.screenshot?.base64 || e.content || e.base64;
          const filePath = e.screenshotPath || e.screenshot?.screenshotPath;
          if (b64 || filePath) add(b64 || '', e.timestamp || Date.now(), i, lastAction, filePath);
          if (filePath) addPath(filePath);
        }
      });
    }

    // 2. Extract data source
    const dataSource = tc.data || tc.result?.data || tc.result || {};

    // 2. Process screenshot(s)
    let sData = dataSource.screenshot || dataSource.base64_image;

    // Handle Anthropic/OpenAI content block arrays
    if (Array.isArray(dataSource)) {
      for (const block of dataSource) {
        if (block.type === 'image_url' && block.image_url?.url) {
          sData = block.image_url.url;
          break;
        } else if (block.type === 'image' && block.source?.data) {
          sData = block.source.data;
          break;
        }
      }
    }

    if (Array.isArray(sData)) {
      sData.forEach((s: any, i: number) => {
        if (typeof s === 'string') add(s, Date.now(), i, lastAction);
        else if (s?.base64) add(s.base64, s.timestamp || Date.now(), s.sequenceNumber ?? i, s.action || lastAction, s.screenshotPath);
      });
    } else if (typeof sData === 'string') {
      add(sData, Date.now(), 0, lastAction);
    }

    // 3. Process historical screenshots
    if (Array.isArray(dataSource.screenshots)) {
      dataSource.screenshots.forEach((s: any, i: number) => {
        if (s?.base64) add(s.base64, s.timestamp || Date.now(), s.sequenceNumber ?? i, s.action || lastAction, s.screenshotPath);
        else if (typeof s === 'string') add(s, Date.now(), i, lastAction);
      });
    }

    if (typeof dataSource.base64Image === 'string') add(dataSource.base64Image, Date.now(), screenshots.length, lastAction);
    if (typeof dataSource.base64_image === 'string') add(dataSource.base64_image, Date.now(), screenshots.length, lastAction);

    // 4. Process persisted screenshotPaths (for reloading after page refresh)
    if (Array.isArray(dataSource.screenshotPaths)) {
      dataSource.screenshotPaths.forEach((p: string, i: number) => {
        if (!p) return;
        // Only add a placeholder if no existing screenshot entry covers this path
        const alreadyHave = screenshots.some(s => s.screenshotPath === p);
        if (!alreadyHave) {
          // Placeholder: no base64 yet — the async loader effect will fill it in
          add('', Date.now(), screenshots.length + i, lastAction, p);
        }
        addPath(p);
      });
    }

    // 5. Attach tool call action if no event action was found
    if (screenshots.length > 0) {
      const toolCallAction = tc.args?.coordinate || tc.args?.action ? {
        type: tc.args.action || tc.args.type || 'click',
        params: tc.args,
        description: tc.args.text || tc.args.query || ''
      } : null;

      if (toolCallAction) {
        screenshots.forEach((s) => {
          if (!s.action) {
            s.action = toolCallAction;
          }
        });
      }
    }

    // Ensure correct chronological order for video playback
    screenshots.sort((a, b) => (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0));
    const slicedScreenshots = screenshots.slice(-12);
    return { screenshots: slicedScreenshots, screenshotPaths, thinkingEvents: thinkingEvents.slice(-80), url: tc.args?.url, action: tc.args?.action };
  } catch { return null; }
}

function extractTerminalData(tc: any) {
  const command = tc.args?.command || tc.args?.CommandLine || '';
  const output = extractOutputText(tc);
  const toolName = (tc.toolName || '').toLowerCase();
  const args = tc.args || tc.arguments || {};
  const data = tc.data || tc.result?.data || {};
  const cwd = inferTerminalCwd(tc, output, command);
  const requestedShell = String(args.shellType || data.shellType || data.shell || '').toLowerCase();
  const target = String(args.target || data.target || '').toLowerCase();
  const isWindows = target !== 'vm' && (
    requestedShell.includes('powershell') ||
    requestedShell.includes('pwsh') ||
    requestedShell === 'cmd' ||
    toolName.includes('pwsh') ||
    toolName.includes('powershell') ||
    isWindowsAbsolutePath(cwd) ||
    command.includes('powershell.exe') ||
    command.includes('pwsh') ||
    command.startsWith('powershell')
  );
  return {
    command,
    output,
    exitCode: tc.data?.exitCode ?? tc.result?.data?.exitCode,
    duration: tc.duration ?? tc.result?.duration,
    shellType: isWindows ? 'windows' : 'linux',
    cwd
  };
}

function extractFileSystemData(tc: any) {
  const args = tc.args || tc.arguments || {};
  const data = tc.data || tc.result?.data || {};
  const toolName = String(tc.toolName || '');
  return {
    toolName,
    path: args.path || data.path || args.TargetFile || args.SearchPath || args.DirectoryPath || args.AbsolutePath || args.filePath || args.file || args.target_file || args.pattern || args.query || '',
    args,
    data,
    output: extractOutputText(tc)
  };
}

function extractGenericData(tc: any) {
  const args = tc.args || tc.arguments || {};
  const output = extractOutputText(tc);
  return { toolName: tc.toolName, args, output, result: tc.result || tc.data || (output ? { exitCode: 0 } : null) };
}

function extractTodoWriteData(tc: any) {
  const args = tc.args || tc.arguments || {};
  const data = tc.data || tc.result?.data || {};
  const output = extractOutputText(tc);
  let parsedOutput: any = null;
  try {
    parsedOutput = output.trim().startsWith('{') || output.trim().startsWith('[') ? JSON.parse(output) : null;
  } catch { /* ignore */ }
  const tasks = Array.isArray(data.tasks)
    ? data.tasks
    : Array.isArray(args.tasks)
      ? args.tasks
      : Array.isArray(parsedOutput?.tasks)
        ? parsedOutput.tasks
        : [];
  return {
    tasks: tasks.map((task: any) => ({
      description: String(task.description || task.content || task.title || ''),
      status: String(task.status || 'pending'),
    })).filter((task: any) => task.description),
    path: data.path || args.planPath || '',
    output,
  };
}

function extractPlanData(tc: any) {
  const args = tc.args || tc.arguments || {};
  const data = tc.data || tc.result?.data || {};
  const output = extractOutputText(tc);
  let parsedOutput: any = null;
  try {
    parsedOutput = output.trim().startsWith('{') || output.trim().startsWith('[') ? JSON.parse(output) : null;
  } catch { /* ignore */ }

  const source = data.plan || data.executionPlan || data || parsedOutput || args;
  const rawSteps = Array.isArray(source.steps)
    ? source.steps
    : Array.isArray(source.tasks)
      ? source.tasks
      : Array.isArray(args.steps)
        ? args.steps
        : Array.isArray(args.tasks)
          ? args.tasks
          : [];

  const steps = rawSteps.map((step: any, index: number) => ({
    id: String(step.id || step.stepId || index + 1),
    title: String(step.title || step.name || step.description || step.content || `Step ${index + 1}`),
    description: String(step.description || step.content || step.title || step.name || ''),
    status: String(step.status || step.state || 'pending'),
    tool: String(step.tool || step.toolName || ''),
  }));

  return {
    toolName: tc.toolName,
    title: String(source.title || args.title || data.title || (tc.toolName === 'update_plan_step' ? 'Plan step update' : 'Execution plan')),
    summary: String(source.summary || source.content || args.content || data.content || ''),
    steps,
    path: String(source.path || data.path || args.path || args.planPath || ''),
    output,
  };
}

function extractPresentationData(tc: any) {
  try {
    const args = tc.args || tc.arguments || {};
    const data = tc.data || tc.result?.data || {};
    const output = extractOutputText(tc);
    const outputPath = args.outputPath || data.path || data.outputPath || (() => {
      const match = output.match(/(?:Path|at):\s*([A-Z]:\\[^\n]+?\.pptx)/i);
      return match?.[1]?.trim() || '';
    })();
    const rawSlides = Array.isArray(args.slides) ? args.slides : [];
    const slideIntents = Array.isArray(data.slideIntents)
      ? data.slideIntents.map((intent: any) => String(intent)).filter(Boolean)
      : rawSlides.map((slide: any) => slide?.intent || slide?.layout).filter(Boolean).map(String);

    return {
      title: String(args.title || data.title || 'Generated Presentation'),
      outputPath: String(outputPath || ''),
      deckGoal: args.deckGoal ? String(args.deckGoal) : '',
      audience: args.audience ? String(args.audience) : '',
      visualDirection: String(data.designDirection || args.visualDirection || ''),
      designMode: String(data.designMode || args.designMode || 'adaptive'),
      deckType: String(data.deckType || ''),
      slideCount: typeof data.slideCount === 'number' ? data.slideCount : (rawSlides.length || slideIntents.length),
      slideIntents,
      slides: rawSlides.map((slide: any, index: number) => ({
        title: String(slide?.title || `Slide ${index + 1}`),
        intent: String(slide?.intent || slide?.layout || slideIntents[index] || ''),
        visualIdea: slide?.visualIdea ? String(slide.visualIdea) : '',
        speakerNotes: slide?.speakerNotes ? String(slide.speakerNotes) : '',
        notes: slide?.notes ? String(slide.notes) : '',
      })),
      output,
    };
  } catch {
    return null;
  }
}

type FileSystemListRow = {
  name: string;
  path: string;
  relativePath?: string;
  type?: 'file' | 'folder';
  size?: number;
  modifiedAt?: string;
  raw?: string;
};

function formatFileSize(bytes?: number) {
  if (!bytes || !Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function parseLsRowsFromOutput(output: string, rootPath: string): FileSystemListRow[] {
  return String(output || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => {
      if (!line) return false;
      if (/^(success|path|output|host execution context|command):/i.test(line)) return false;
      if (/^\- /.test(line)) return false;
      if (/^\[.*\]$/.test(line)) return false;
      return true;
    })
    .map((line) => {
      const isFolder = line.endsWith('/');
      const clean = line.replace(/[\\/]+$/g, '');
      const normalized = normalizeFsPath(clean);
      const absolute = isWindowsAbsolutePath(normalized) ? normalized : joinFsPath(rootPath, normalized);
      return {
        name: normalized.split('\\').pop() || normalized,
        path: absolute,
        relativePath: normalized,
        type: isFolder ? 'folder' : 'file',
        raw: line,
      };
    });
}

function normalizeFileSystemRows(rows: any[], output: string, rootPath: string, isListOperation: boolean): FileSystemListRow[] {
  const sourceRows = rows.length > 0
    ? rows
    : isListOperation
      ? parseLsRowsFromOutput(output, rootPath)
      : [];

  return sourceRows.map((row: any) => {
    if (typeof row === 'string') {
      const isFolder = row.endsWith('/');
      const clean = normalizeFsPath(row.replace(/[\\/]+$/g, ''));
      return {
        name: clean.split('\\').pop() || clean,
        path: isWindowsAbsolutePath(clean) ? clean : joinFsPath(rootPath, clean),
        relativePath: clean,
        type: isFolder ? 'folder' : 'file',
        raw: row,
      } as FileSystemListRow;
    }

    const rawName = String(row.name || row.file || row.path || row.relativePath || row.relative_path || '');
    const rowPath = normalizeFsPath(row.path || row.absolutePath || row.absolute_path || '');
    const relPath = normalizeFsPath(row.relativePath || row.relative_path || (!isWindowsAbsolutePath(rawName) ? rawName : ''));
    const absolute = rowPath || (relPath ? joinFsPath(rootPath, relPath) : joinFsPath(rootPath, rawName));
    const name = String(row.name || normalizeFsPath(rawName || absolute).split('\\').pop() || rawName || absolute);
    const type = String(row.type || row.kind || '').toLowerCase();

    return {
      name,
      path: absolute,
      relativePath: relPath || name,
      type: type.includes('dir') || type.includes('folder') || row.isDirectory ? 'folder' : 'file',
      size: typeof row.size === 'number' ? row.size : typeof row.length === 'number' ? row.length : undefined,
      modifiedAt: row.modifiedAt || row.mtime || row.modified || '',
      raw: row.raw || '',
    } as FileSystemListRow;
  }).filter(row => row.name || row.path);
}

function FileSystemList({ rows }: { rows: FileSystemListRow[] }) {
  return (
    <div style={{
      background: CLAY.card,
      border: `1px solid ${VS.border}`,
      borderRadius: 12,
      boxShadow: CLAY.shadow,
      overflow: 'hidden',
    }}>
      {rows.map((row, index) => {
        const isFolder = row.type === 'folder';
        const visual = isFolder ? null : getFileVisual(row.name);
        return (
          <div
            key={`${row.path}-${index}`}
            title={row.path || row.relativePath || row.name}
            style={{
              height: 34,
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) auto',
              alignItems: 'center',
              gap: 12,
              padding: '0 12px',
              borderTop: index === 0 ? 'none' : `1px solid ${VS.border}`,
              color: VS.text,
              fontFamily: T.sans,
              fontSize: 12.5,
            }}
          >
            <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              {isFolder ? (
                <Folder size={15} style={{ color: '#dcb67a', flexShrink: 0 }} />
              ) : (
                <img
                  src={visual?.iconUrl}
                  alt=""
                  style={{ width: 15, height: 15, flexShrink: 0 }}
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              )}
              <span style={{
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: isFolder ? VS.text : (visual?.color || VS.text),
              }}>
                {row.relativePath || row.name}
              </span>
            </div>
            <span style={{
              color: VS.muted,
              fontFamily: T.mono,
              fontSize: 11,
              whiteSpace: 'nowrap',
            }}>
              {isFolder ? 'folder' : formatFileSize(row.size)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function FileSystemView({ toolName, path, args, output, data }: { toolName: string; path: string; args: any; output: string; data?: any }) {
  const argEntries = Object.entries(args || {});
  const n = String(toolName || '').toLowerCase();
  const isListOperation = n === 'ls' || n.includes('list_dir') || n.includes('system_files');
  const operation =
    isListOperation ? 'List files' :
    n === 'grep' || n.includes('grep') ? 'Search text' :
    n === 'find' ? 'Find files' :
    'File system';
  const structuredRows = Array.isArray(data?.files)
    ? data.files
    : Array.isArray(data?.matches)
      ? data.matches
      : Array.isArray(data?.results)
        ? data.results
        : [];
  const rootPath = path || data?.path || args?.path || args?.cwd || DEFAULT_TOOL_DETAIL_ROOT;
  const listRows = normalizeFileSystemRows(structuredRows, output, rootPath, isListOperation);
  const renderedOutput = output || (structuredRows.length > 0 ? structuredRows.map((row: any) => {
    if (typeof row === 'string') return row;
    return row.path || row.file || row.name || JSON.stringify(row);
  }).join('\n') : '');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: VS.bg }}>
      <div style={{ flex: 1, overflowY: 'auto', background: VS.bg }}>
        <div style={{ padding: '14px 24px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: path ? 8 : 0 }}>
            <span style={{
              fontSize: 10,
              color: VS.blue,
              background: CLAY.card,
              border: `1px solid ${VS.border}`,
              padding: '2px 8px',
              borderRadius: 20,
              fontFamily: T.sans,
            }}>
              {operation}
            </span>
            <span style={{ color: VS.dim, fontSize: 11.5, fontFamily: T.mono }}>{toolName}</span>
          </div>
          {path && (
            <p style={{ fontSize: 11.5, color: VS.muted, fontFamily: T.mono, wordBreak: 'break-all', margin: 0 }}>{path}</p>
          )}
        </div>

        {argEntries.length > 0 && (
          <CollapsibleSection icon={Braces} label="Arguments" badge={`${argEntries.length}`} dark>
            <div style={{
              margin: 0, fontFamily: T.mono, fontSize: 12, lineHeight: 1.8,
              background: CLAY.cardMuted, color: VS.text,
              padding: '18px 20px', borderRadius: T.r10,
              border: `1px solid ${VS.border}`, maxHeight: 280, overflowY: 'auto',
            }}>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                <code>{JSON.stringify(args, null, 2)}</code>
              </pre>
            </div>
          </CollapsibleSection>
        )}

        {isListOperation && listRows.length > 0 && (
          <div style={{ padding: '18px 24px 28px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 10 }}>
              <span style={{ color: VS.muted, fontSize: 11, fontFamily: T.sans }}>
                {listRows.length} item{listRows.length === 1 ? '' : 's'}
              </span>
              <CopyBtn text={renderedOutput || listRows.map(row => row.relativePath || row.name).join('\n')} dark />
            </div>
            <FileSystemList rows={listRows} />
          </div>
        )}

        {renderedOutput && !(isListOperation && listRows.length > 0) && (
          <div style={{ padding: '20px 24px 28px' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', paddingBottom: 10 }}>
              <CopyBtn text={renderedOutput} dark />
            </div>
            <div style={{
              background: CLAY.cardMuted,
              border: `1px solid ${VS.border}`,
              borderRadius: T.r10,
              overflow: 'auto',
              maxHeight: 520,
            }}>
              <pre style={{
                margin: 0,
                padding: '14px 16px',
                color: '#e4e4e7',
                fontFamily: T.mono,
                fontSize: 11.5,
                lineHeight: 1.55,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}>
                {renderedOutput}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   FILE EDITOR VIEW — IDE-styled code editor showing additions
   ============================================================ */
const EDITOR_COLORS = {
  bg: '#121214',
  gutterBg: '#18181b',
  gutterText: '#52525b',
  border: '#27272a',
  text: '#e4e4e7',
  keyword: '#e879f9', // pink/magenta
  string: '#34d399', // green
  number: '#60a5fa', // blue
  comment: '#71717a', // grey
};

const detectLanguage = (ext: string): string => {
  const langMap: Record<string, string> = {
    js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
    py: 'python', html: 'html', htm: 'html', css: 'css', scss: 'css',
    json: 'json', sql: 'sql', md: 'markdown', yml: 'yaml', yaml: 'yaml',
    txt: 'text'
  };
  return langMap[ext.toLowerCase()] || 'text';
};

const syntaxHighlightLine = (line: string, ext: string) => {
  const colors = EDITOR_COLORS;
  
  // Comment detection
  const commentMatch = line.match(/^(\s*)(#|\/\/|\/\*|<!--)(.*)/);
  if (commentMatch) {
    return <span style={{ color: colors.comment }}>{line}</span>;
  }

  // Regex patterns
  const stringPattern = /(['"`])(.*?)\1/g;
  const keywordPattern = /\b(if|else|for|while|function|def|class|return|const|let|var|import|export|from|async|await|try|catch|throw|new|this|true|false|null|undefined|and|or|not|in|is|lambda|def|self|super|pass|break|continue|interface|type|public|private|protected)\b/g;
  const numberPattern = /\b(\d+\.?\d*)\b/g;

  const stringMatches = Array.from(line.matchAll(stringPattern));
  const keywordMatches = Array.from(line.matchAll(keywordPattern));
  const numberMatches = Array.from(line.matchAll(numberPattern));

  const allMatches = [
    ...stringMatches.map(m => ({ type: 'string', index: m.index!, value: m[0] })),
    ...keywordMatches.map(m => ({ type: 'keyword', index: m.index!, value: m[0] })),
    ...numberMatches.map(m => ({ type: 'number', index: m.index!, value: m[0] })),
  ].sort((a, b) => a.index - b.index);

  const elements: React.ReactNode[] = [];
  let lastIndex = 0;

  allMatches.forEach((match, idx) => {
    if (match.index < lastIndex) return;

    if (match.index > lastIndex) {
      elements.push(<span key={`txt-${idx}`} style={{ color: colors.text }}>{line.slice(lastIndex, match.index)}</span>);
    }
    const color = colors[match.type as keyof typeof colors] || colors.text;
    elements.push(<span key={`tok-${idx}`} style={{ color }}>{match.value}</span>);
    lastIndex = match.index + match.value.length;
  });

  if (lastIndex < line.length) {
    elements.push(<span key="tail" style={{ color: colors.text }}>{line.slice(lastIndex)}</span>);
  }

  return <>{elements.length > 0 ? elements : <span style={{ color: colors.text }}>{line}</span>}</>;
};

interface LineProps {
  type: 'add' | 'del' | 'normal';
  content: React.ReactNode;
  lineNumber?: string | number;
  ext: string;
}

const CodeLine = ({ type, content, lineNumber, ext }: LineProps) => {
  let lineBg = 'transparent';
  let textColor = EDITOR_COLORS.text;
  let indicator = ' ';
  let indicatorColor = EDITOR_COLORS.gutterText;

  if (type === 'add') {
    lineBg = 'rgba(34, 197, 94, 0.08)'; // subtle green bg
    textColor = '#4ade80'; // green text
    indicator = '+';
    indicatorColor = '#4ade80';
  } else if (type === 'del') {
    lineBg = 'rgba(239, 68, 68, 0.08)'; // subtle red bg
    textColor = '#f87171'; // red text
    indicator = '-';
    indicatorColor = '#f87171';
  }

  return (
    <div style={{
      display: 'flex',
      backgroundColor: lineBg,
      fontFamily: T.mono,
      fontSize: 11.5,
      lineHeight: '18px',
      minWidth: 'fit-content',
    }}>
      {/* Line Gutter */}
      <div style={{
        width: 42,
        flexShrink: 0,
        backgroundColor: EDITOR_COLORS.gutterBg,
        color: EDITOR_COLORS.gutterText,
        textAlign: 'right',
        paddingRight: 8,
        userSelect: 'none',
        borderRight: `1px solid ${EDITOR_COLORS.border}`,
      }}>
        {lineNumber}
      </div>

      {/* Indicator (+ or -) */}
      <div style={{
        width: 18,
        flexShrink: 0,
        textAlign: 'center',
        color: indicatorColor,
        fontWeight: 400,
        userSelect: 'none',
      }}>
        {indicator}
      </div>

      {/* Code Text */}
      <pre style={{
        margin: 0,
        paddingLeft: 3,
        paddingRight: 12,
        whiteSpace: 'pre',
        color: textColor,
        overflow: 'visible',
      }}>
        {type === 'normal' && typeof content === 'string' ? syntaxHighlightLine(content, ext) : content}
      </pre>
    </div>
  );
};

function pickString(source: any, keys: string[]) {
  if (!source) return '';
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === 'string') return value;
  }
  return '';
}

function pickArray(source: any, keys: string[]) {
  if (!source) return [];
  for (const key of keys) {
    const value = source?.[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function splitDiffLines(value: string) {
  if (!value) return [];
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n$/, '').split('\n');
}

function countDiffLines(oldText: string, newText: string) {
  const stats = { added: 0, removed: 0 };
  diffLines(oldText || '', newText || '').forEach((change) => {
    const count = splitDiffLines(change.value).length;
    if (change.added) stats.added += count;
    if (change.removed) stats.removed += count;
  });
  return stats;
}

function InlineWordDiff({ oldLine, newLine, mode }: { oldLine: string; newLine: string; mode: 'add' | 'del' }) {
  const parts = diffWords(oldLine, newLine);
  return (
    <>
      {parts.map((part, idx) => {
        if (mode === 'add' && part.removed) return null;
        if (mode === 'del' && part.added) return null;
        const isChanged = mode === 'add' ? part.added : part.removed;
        return (
          <span
            key={idx}
            style={isChanged ? {
              color: mode === 'add' ? '#86efac' : '#fca5a5',
              background: mode === 'add' ? 'rgba(34,197,94,0.22)' : 'rgba(239,68,68,0.22)',
              borderRadius: 3,
              padding: '0 1px',
            } : undefined}
          >
            {part.value}
          </span>
        );
      })}
    </>
  );
}

function FileEditorView({ toolName, path, args, output, data }: { toolName: string; path: string; args: any; output: string; data?: any }) {
  const ext = path.split(/[/\\]/).pop()?.split('.').pop() || 'text';
  const cleanReadOutput = (raw: string) => {
    const lines = (raw || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    while (lines.length && !lines[0].trim()) lines.shift();
    if (/^success:\s*read file/i.test(lines[0] || '')) lines.shift();
    if (/^path:\s*/i.test(lines[0] || '')) lines.shift();
    while (lines.length && !lines[0].trim()) lines.shift();
    return lines.join('\n');
  };
  const { isWrite, isMulti, chunks, oldContent, newContent, isRead, hasRenderableContent } = useMemo(() => {
    const name = (toolName || '').toLowerCase();
    
    let oldContent = '';
    let newContent = '';
    let isWrite = false;
    let isMulti = false;
    let chunks: any[] = [];
    let isRead = false;

    const chunkSource = [
      ...pickArray(args, ['ReplacementChunks', 'replacementChunks', 'chunks', 'edits', 'replacements']),
      ...pickArray(data, ['ReplacementChunks', 'replacementChunks', 'chunks', 'edits', 'replacements']),
    ];

    if (name.includes('write')) {
      isWrite = true;
      newContent = pickString(args, ['CodeContent', 'code', 'content', 'text']) || pickString(data, ['content', 'contentAfter', 'after']);
    } else if (name === 'read' || name === 'read_file' || name === 'view_file') {
      isRead = true;
      newContent = pickString(data, ['content']) || pickString(args, ['content']) || cleanReadOutput(output || '');
    } else {
      oldContent =
        pickString(data, ['contentBefore', 'oldContent', 'previousContent', 'before', 'oldString', 'old_string']) ||
        pickString(args, ['contentBefore', 'oldContent', 'previousContent', 'TargetContent', 'target', 'oldString', 'old_string', 'oldText', 'old_text', 'search', 'find', 'from', 'original', 'before']);
      newContent =
        pickString(data, ['contentAfter', 'newContent', 'updatedContent', 'after', 'newString', 'new_string']) ||
        pickString(args, ['contentAfter', 'newContent', 'updatedContent', 'ReplacementContent', 'replacement', 'newString', 'new_string', 'newText', 'new_text', 'replace', 'with', 'to', 'updated', 'after']);

      if (!oldContent && !newContent && chunkSource.length > 0) {
        isMulti = true;
        chunks = chunkSource.map((chunk: any) => ({
          target: pickString(chunk, ['TargetContent', 'target', 'oldString', 'old_string', 'oldText', 'old_text', 'search', 'find', 'from', 'before']),
          replacement: pickString(chunk, ['ReplacementContent', 'replacement', 'newString', 'new_string', 'newText', 'new_text', 'replace', 'with', 'to', 'after']),
          startLine: chunk.StartLine || chunk.startLine || chunk.line || chunk.lineNumber,
          endLine: chunk.EndLine || chunk.endLine,
        }));
      }
    }

    return {
      isWrite,
      isMulti,
      chunks,
      oldContent,
      newContent,
      isRead,
      hasRenderableContent: isMulti ? chunks.length > 0 : Boolean(oldContent || newContent),
    };
  }, [toolName, args, output, data]);

  const diffStats = useMemo(() => {
    if (isRead) return { added: 0, removed: 0 };
    if (isWrite) return { added: splitDiffLines(newContent).length, removed: 0 };
    if (isMulti) {
      return chunks.reduce((total, chunk) => {
        const stats = countDiffLines(chunk.target, chunk.replacement);
        return { added: total.added + stats.added, removed: total.removed + stats.removed };
      }, { added: 0, removed: 0 });
    }
    return countDiffLines(oldContent, newContent);
  }, [isRead, isWrite, isMulti, chunks, oldContent, newContent]);

  // Helper to render diff lines for a target and replacement
  const renderDiffLines = (oldText: string, newText: string, startLine = 1) => {
    if (isWrite || isRead) {
      const lines = newText.split('\n');
      return lines.map((line, idx) => (
        <CodeLine
          key={idx}
          type={isRead ? 'normal' : 'add'}
          content={line}
          lineNumber={startLine + idx}
          ext={ext}
        />
      ));
    }

    // Compute diff
    const changes = diffLines(oldText, newText);
    const lineElements: React.ReactNode[] = [];
    let oldLine = startLine;
    let newLine = startLine;

    for (let changeIdx = 0; changeIdx < changes.length; changeIdx++) {
      const change = changes[changeIdx];

      if (change.removed && changes[changeIdx + 1]?.added) {
        const next = changes[changeIdx + 1];
        const removedLines = splitDiffLines(change.value);
        const addedLines = splitDiffLines(next.value);
        const max = Math.max(removedLines.length, addedLines.length);

        for (let lineIdx = 0; lineIdx < max; lineIdx++) {
          const removedLine = removedLines[lineIdx];
          const addedLine = addedLines[lineIdx];
          const key = `${changeIdx}-${lineIdx}`;
          if (removedLine !== undefined) {
            lineElements.push(
              <CodeLine
                key={`${key}-del`}
                type="del"
                content={addedLine !== undefined ? <InlineWordDiff oldLine={removedLine} newLine={addedLine} mode="del" /> : removedLine}
                lineNumber={oldLine++}
                ext={ext}
              />
            );
          }
          if (addedLine !== undefined) {
            lineElements.push(
              <CodeLine
                key={`${key}-add`}
                type="add"
                content={removedLine !== undefined ? <InlineWordDiff oldLine={removedLine} newLine={addedLine} mode="add" /> : addedLine}
                lineNumber={newLine++}
                ext={ext}
              />
            );
          }
        }
        changeIdx++;
        continue;
      }

      const lines = splitDiffLines(change.value);
      lines.forEach((line, lineIdx) => {
        const key = `${changeIdx}-${lineIdx}`;
        if (change.added) {
          lineElements.push(
            <CodeLine
              key={key}
              type="add"
              content={line}
              lineNumber={newLine++}
              ext={ext}
            />
          );
        } else if (change.removed) {
          lineElements.push(
            <CodeLine
              key={key}
              type="del"
              content={line}
              lineNumber={oldLine++}
              ext={ext}
            />
          );
        } else {
          lineElements.push(
            <CodeLine
              key={key}
              type="normal"
              content={line}
              lineNumber={newLine++}
              ext={ext}
            />
          );
          oldLine++;
        }
      });
    }

    return lineElements;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: VS.bg }}>
      <div style={{ height: 38, display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px', borderBottom: `1px solid ${VS.border}`, flexShrink: 0 }}>
        <FileIcon size={15} color={getFileVisual(path).color} />
        <span style={{ color: VS.text, fontFamily: T.sans, fontSize: 13, fontWeight: 400 }}>
          {path.split(/[/\\]/).pop() || toolName}
        </span>
        <span style={{
          fontSize: 10,
          fontWeight: 400,
          color: isWrite ? VS.green : isRead ? VS.blue : VS.muted,
          background: CLAY.card,
          border: `1px solid ${VS.border}`,
          padding: '2px 8px',
          borderRadius: 20,
          fontFamily: T.sans
        }}>
          {isWrite ? 'Write' : isRead ? 'Read' : 'Edit'}
        </span>
        {path && (
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: VS.muted, fontSize: 11, fontFamily: T.mono }}>
            {path}
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {!isRead && hasRenderableContent && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: T.mono, fontSize: 11 }}>
              <span style={{
                color: '#4ade80',
                border: '1px solid rgba(34,197,94,0.22)',
                borderRadius: 7,
                padding: '3px 7px',
                lineHeight: 1,
              }}>
                +{diffStats.added}
              </span>
              <span style={{
                color: '#f87171',
                border: '1px solid rgba(239,68,68,0.22)',
                borderRadius: 7,
                padding: '3px 7px',
                lineHeight: 1,
              }}>
                -{diffStats.removed}
              </span>
            </div>
          )}
          <CopyBtn text={isWrite ? newContent : isMulti ? chunks.map(c => c.replacement).join('\n') : newContent} dark />
        </div>
      </div>

      {isRead || isWrite ? (
        <FileContentBody path={path} content={newContent} mode={isWrite ? 'add' : 'normal'} />
      ) : (
        <div style={{ flex: 1, overflow: 'auto', background: EDITOR_COLORS.bg, paddingTop: 6, paddingBottom: 18 }}>
          {!hasRenderableContent ? (
            <div style={{ padding: 16 }}>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#a1a1aa', fontFamily: T.mono, fontSize: 11.5, lineHeight: 1.55 }}>
                {output || JSON.stringify(args || {}, null, 2)}
              </pre>
            </div>
          ) : isMulti ? (
            chunks.map((chunk, idx) => (
              <div key={idx}>
                <div style={{
                  backgroundColor: '#18181b',
                  color: '#a1a1aa',
                  padding: '4px 16px',
                  fontSize: 10,
                  fontWeight: 400,
                  fontFamily: T.mono,
                  borderTop: idx > 0 ? `1px dashed ${EDITOR_COLORS.border}` : 'none',
                  borderBottom: `1px solid ${EDITOR_COLORS.border}`,
                }}>
                  @@ Chunk {idx + 1} (Line {chunk.startLine || '?'} to {chunk.endLine || '?'}) @@
                </div>
                {renderDiffLines(chunk.target, chunk.replacement, chunk.startLine || 1)}
              </div>
            ))
          ) : (
            renderDiffLines(oldContent, newContent, 1)
          )}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   LOCAL PERMISSION VIEW
   ============================================================ */
function LocalPermissionView({
  command,
  reason,
  shellType,
  agentName,
  requestId,
}: {
  command: string;
  reason: string;
  shellType?: string;
  agentName?: string;
  requestId?: string;
}) {
  const [responded, setResponded] = useState(false);
  const canRespond = !!requestId && requestId.startsWith('local-exec-');

  const sendResponse = (approved: boolean, alwaysAllow: boolean) => {
    if (!canRespond || !requestId) return;

    const acpApi = (window as any).electronAPI?.acp;
    if (acpApi?.sendLocalExecutionResponse) {
      acpApi.sendLocalExecutionResponse({ approved, alwaysAllow, requestId });

      // Emit a chat event to show the permission decision in the chat
      if (acpApi?.onPermissionResponse) {
        acpApi.onPermissionResponse({
          requestId,
          approved,
          alwaysAllow,
          timestamp: new Date().toISOString()
        });
      }
    }
    setResponded(true);
  };

  const btnBase: React.CSSProperties = {
    padding: '8px 18px', borderRadius: T.r8, fontSize: 12, fontWeight: 400,
    fontFamily: T.sans, cursor: 'pointer', border: '1px solid transparent', transition: 'all 0.12s',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: VS.bg, color: VS.text }}>
      <div style={{ padding: '16px 20px', borderBottom: `1px solid ${VS.border}`, background: VS.bg, flexShrink: 0 }}>
        <h3 style={{ fontSize: 13, fontWeight: 400, color: VS.text, margin: '0 0 4px', letterSpacing: '-0.015em', fontFamily: T.sans }}>
          Local Execution Request
        </h3>
        {agentName && <p style={{ fontSize: 11.5, color: VS.muted, margin: 0, fontFamily: T.sans }}>Requested by Everfern</p>}
        {!canRespond && (
          <p style={{ fontSize: 11.5, color: VS.muted, margin: '6px 0 0', fontFamily: T.sans }}>
            Respond from the chat permission card.
          </p>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 24px', display: 'flex', flexDirection: 'column', gap: 16, background: VS.bg }}>
        {/* Reason */}
        {reason && (
          <div style={{ background: CLAY.card, border: `1px solid ${VS.border}`, borderRadius: 12, padding: '13px 16px', boxShadow: CLAY.shadow }}>
            <p style={{ fontSize: 10, fontWeight: 400, color: VS.muted, letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 8px', fontFamily: T.sans }}>
              Reason
            </p>
            <p style={{ fontSize: 12.5, color: VS.text, margin: 0, lineHeight: 1.6, fontFamily: T.sans }}>{reason}</p>
          </div>
        )}

        {/* Command */}
        <div>
          <p style={{ fontSize: 10, fontWeight: 400, color: VS.muted, letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 8px', fontFamily: T.sans }}>
            Command {shellType && <span style={{ color: VS.dim }}>· {shellType}</span>}
          </p>
          <div style={{
            margin: 0, fontFamily: T.mono, fontSize: 12.5, lineHeight: 1.7,
            background: T.inkBg, color: T.inkText,
            padding: '16px 18px', borderRadius: T.r10,
            border: `1px solid ${T.inkBorder}`, overflowX: 'auto',
          }}>
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              <code>{command}</code>
            </pre>
          </div>
        </div>

        {/* Buttons */}
        {!responded && canRespond && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap', borderTop: `1px solid ${VS.border}`, paddingTop: 16 }}>
            <button
              onClick={() => sendResponse(false, false)}
              style={{ ...btnBase, background: '#2a1f1f', color: '#fca5a5', borderColor: 'rgba(239,68,68,0.28)' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#3a2424'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#2a1f1f'; }}
            >
              Deny
            </button>
            <button
              onClick={() => sendResponse(true, true)}
              style={{ ...btnBase, background: CLAY.card, color: VS.text, borderColor: VS.border, boxShadow: CLAY.shadow }}
              onMouseEnter={e => { e.currentTarget.style.background = CLAY.hover; }}
              onMouseLeave={e => { e.currentTarget.style.background = CLAY.card; }}
            >
              Always Allow
            </button>
            <button
              onClick={() => sendResponse(true, false)}
              style={{ ...btnBase, background: '#2563eb', color: '#fff', borderColor: '#3b82f6' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#1d4ed8'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#2563eb'; }}
            >
              Allow Once
            </button>
          </div>
        )}

        {responded && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center',
            padding: 12, background: 'rgba(34,197,94,0.10)', border: '1px solid rgba(34,197,94,0.22)',
            borderRadius: T.r10,
          }}>
            <CheckCircle size={14} color={T.green} strokeWidth={2} />
            <span style={{ fontSize: 12.5, fontWeight: 400, color: T.green, fontFamily: T.sans }}>Response sent</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   IMAGE ANALYSIS VIEW
   ============================================================ */
type ImagePreviewItem = {
  fileName: string;
  dataUrl?: string;
  path?: string;
  subtitle?: string;
  badge?: string;
};

function imagePathBasename(value: string): string {
  return String(value || '').split(/[/\\]/).pop() || String(value || '');
}

function hasImageExtension(value: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|avif|ico|svg|tiff?)$/i.test(String(value || '').split(/[?#]/)[0]);
}

function extractImagePathsFromText(value: string): string[] {
  const matches = String(value || '').match(/[A-Za-z]:\\[^\r\n]+?\.(?:png|jpe?g|gif|webp|bmp|avif|ico|svg|tiff?)/gi) || [];
  return Array.from(new Set(matches.map(match => match.trim()).filter(hasImageExtension)));
}

function getImageAnalysisPayloadKey(tc: any): string {
  const data = tc?.data || tc?.result?.data || {};
  const sheets = Array.isArray(data.sheets) ? data.sheets : [];
  const images = Array.isArray(data.images) ? data.images : [];
  const fileNames = Array.isArray(data.fileNames) ? data.fileNames : [];
  return [
    tc?.status || '',
    tc?.output || tc?.result?.output || '',
    data.imageCount ?? '',
    data.sheetCount ?? '',
    data.directory || '',
    data.outputDir || '',
    data.manifestPath || '',
    tc?.base64Image ? String(tc.base64Image).length : 0,
    data.base64Image ? String(data.base64Image).length : 0,
    sheets.length,
    sheets.map((sheet: any) => `${sheet?.path || ''}:${sheet?.dataUrl ? String(sheet.dataUrl).length : 0}`).join('|'),
    images.length,
    images.map((img: any) => `${img?.path || img?.fileName || ''}:${img?.dataUrl ? String(img.dataUrl).length : 0}`).join('|'),
    fileNames.length,
    fileNames.join('|'),
  ].join('\n');
}

function asImageDataUrl(value: string, fallbackMime = 'image/jpeg'): string {
  if (!value) return '';
  if (/^data:image\//i.test(value)) return value;
  const clean = value.includes(',') && /^data:/i.test(value) ? value.substring(value.indexOf(',') + 1) : value;
  return `data:${fallbackMime};base64,${clean}`;
}

function uniqueImageItems(items: ImagePreviewItem[]): ImagePreviewItem[] {
  const seen = new Set<string>();
  const result: ImagePreviewItem[] = [];
  for (const item of items) {
    const key = item.path || item.dataUrl || item.fileName;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function ImageViewer({ image, variant = 'image' }: { image: ImagePreviewItem; variant?: 'image' | 'sheet' }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);
  const dataUrl = image.dataUrl || '';
  const fileName = image.fileName || imagePathBasename(image.path || 'Image');
  const isSheet = variant === 'sheet';

  return (
    <div style={{
      borderRadius: T.r10, overflow: 'hidden', background: T.surface,
      border: `1px solid ${T.border}`,
      boxShadow: CLAY.shadow,
    }}>
      <div style={{
        position: 'relative',
        background: isSheet ? '#f4efe6' : T.surfaceRaised,
        minHeight: isSheet ? 220 : undefined,
        aspectRatio: isSheet ? undefined : '16/10',
        overflow: 'hidden',
      }}>
        {loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <motion.div
              style={{ width: 16, height: 16, border: `2px solid ${T.border}`, borderTopColor: T.textMuted, borderRadius: '50%' }}
              animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.75, ease: 'linear' }}
            />
          </div>
        )}
        {!err ? (
          <img
            src={dataUrl}
            alt={fileName}
            style={{
              width: '100%',
              height: isSheet ? 'auto' : '100%',
              maxHeight: isSheet ? 720 : undefined,
              objectFit: 'contain',
              display: loading ? 'none' : 'block',
            }}
            onLoad={() => setLoading(false)}
            onError={() => { setLoading(false); setErr(true); }}
          />
        ) : (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: T.textMuted, gap: 6 }}>
            <CameraOff size={18} strokeWidth={1.5} />
            <span style={{ fontSize: 11, fontFamily: T.sans }}>Failed to load</span>
          </div>
        )}
      </div>
      <div style={{ padding: '10px 14px', borderTop: `1px solid ${T.borderSubtle}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 400, color: T.text, fontFamily: T.mono, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {fileName}
          </div>
          {(image.subtitle || image.path) && (
            <div style={{ fontSize: 10.5, color: T.textMuted, fontFamily: T.sans, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
              {image.subtitle || image.path}
            </div>
          )}
        </div>
        {image.badge && (
          <span style={{
            flexShrink: 0,
            fontSize: 10,
            color: T.textSecondary,
            background: T.surfaceRaised,
            border: `1px solid ${T.border}`,
            borderRadius: 999,
            padding: '3px 8px',
            fontFamily: T.sans,
          }}>
            {image.badge}
          </span>
        )}
      </div>
    </div>
  );
}

function ImageAnalysisView({
  title = 'Image Analysis',
  question,
  output,
  imageCount,
  sheetCount,
  directory,
  outputDir,
  manifestPath,
  fileNames,
  images = [],
  isSheet = false,
}: {
  title?: string;
  question?: string;
  output?: string;
  imageCount?: number;
  sheetCount?: number;
  directory?: string;
  outputDir?: string;
  manifestPath?: string;
  fileNames?: string[];
  images?: ImagePreviewItem[];
  isSheet?: boolean;
}) {
  const [localImages, setLocalImages] = useState<ImagePreviewItem[]>(() => uniqueImageItems(images));

  useEffect(() => {
    const seededImages = uniqueImageItems(images);
    setLocalImages(seededImages);

    const pathsFromSeed = seededImages
      .filter(img => !img.dataUrl && img.path)
      .map(img => img.path as string);
    const pathsToLoad = Array.from(new Set([
      ...pathsFromSeed,
      ...(fileNames || []),
    ].filter(hasImageExtension)));

    if (pathsToLoad.length === 0) return;

    let cancelled = false;
    (async () => {
      const systemApi = (window as any).electronAPI?.system;
      const screenshotApi = (window as any).electronAPI?.screenshot;
      const results: ImagePreviewItem[] = [];
      for (const name of pathsToLoad) {
        try {
          let result = await systemApi?.readImageDataUrl?.(name);
          if (!result?.dataUrl) result = await screenshotApi?.load?.(name);
          if (cancelled) return;
          if (result?.dataUrl) {
            const existing = seededImages.find(img => img.path === name);
            results.push({
              fileName: existing?.fileName || imagePathBasename(name),
              path: name,
              dataUrl: result.dataUrl,
              subtitle: existing?.subtitle,
              badge: existing?.badge || (isSheet ? `Sheet ${results.length + 1}` : undefined),
            });
          }
        } catch { /* skip */ }
      }
      if (!cancelled && results.length > 0) {
        const loadedByPath = new Map(results.map(item => [item.path, item]));
        setLocalImages(uniqueImageItems([
          ...seededImages.map(img => img.path && loadedByPath.has(img.path) ? loadedByPath.get(img.path)! : img),
          ...results,
        ]));
      }
    })();
    return () => { cancelled = true; };
  }, [fileNames, images, isSheet]);

  const metaRows = [
    directory ? { label: 'Source', value: directory } : null,
    outputDir ? { label: 'Output folder', value: outputDir } : null,
    manifestPath ? { label: 'Manifest', value: manifestPath } : null,
  ].filter(Boolean) as { label: string; value: string }[];

  const summaryParts = [
    imageCount !== undefined ? `${imageCount} image${imageCount === 1 ? '' : 's'}` : null,
    sheetCount !== undefined ? `${sheetCount} sheet${sheetCount === 1 ? '' : 's'}` : null,
  ].filter(Boolean);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '18px 24px', borderBottom: `1px solid ${T.border}`, background: T.surface, flexShrink: 0 }}>
        <h3 style={{ fontSize: 13.5, fontWeight: 400, color: T.text, margin: '0 0 4px', letterSpacing: '-0.015em', fontFamily: T.sans }}>
          {title}
        </h3>
        {summaryParts.length > 0 && (
          <p style={{ fontSize: 12, color: T.textMuted, margin: 0, fontFamily: T.sans }}>
            {summaryParts.join(' • ')} {isSheet ? 'prepared for vision' : 'analyzed'}
          </p>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {metaRows.length > 0 && (
          <div style={{ display: 'grid', gap: 8 }}>
            {metaRows.map(row => (
              <div key={row.label} style={{
                background: T.surface,
                border: `1px solid ${T.border}`,
                borderRadius: T.r10,
                padding: '10px 14px',
                boxShadow: CLAY.shadow,
              }}>
                <p style={{ fontSize: 9.5, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 5px', fontFamily: T.sans }}>
                  {row.label}
                </p>
                <p style={{ fontSize: 11.5, color: T.text, margin: 0, fontFamily: T.mono, overflowWrap: 'anywhere', lineHeight: 1.45 }}>
                  {row.value}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Question */}
        {question && (
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.r10, padding: '14px 18px' }}>
            <p style={{ fontSize: 10, fontWeight: 400, color: T.textMuted, letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 8px', fontFamily: T.sans }}>
              Question
            </p>
            <p style={{ fontSize: 13, color: T.text, margin: 0, lineHeight: 1.6, fontFamily: T.sans }}>{question}</p>
          </div>
        )}

        {/* Images */}
        {localImages.length > 0 && (
          <div>
            <p style={{ fontSize: 10, fontWeight: 400, color: T.textMuted, letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 10px', fontFamily: T.sans }}>
              {isSheet ? 'Contact Sheets' : 'Images'}
            </p>
            <div style={{
              display: 'grid',
              gridTemplateColumns: isSheet ? '1fr' : 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 10,
            }}>
              {localImages.map((img, i) => (
                img.dataUrl ? (
                  <ImageViewer key={`${img.fileName}-${i}`} image={img} variant={isSheet ? 'sheet' : 'image'} />
                ) : null
              ))}
            </div>
          </div>
        )}

        {localImages.length === 0 && (fileNames?.some(hasImageExtension) || isSheet) && (
          <div style={{
            background: T.surface,
            border: `1px solid ${T.border}`,
            borderRadius: T.r10,
            padding: '18px',
            color: T.textMuted,
            fontSize: 12,
            fontFamily: T.sans,
          }}>
            Image previews are not loaded yet. Stored paths are available above and in the tool output.
          </div>
        )}

        {/* Output */}
        {output && (
          <div>
            <p style={{ fontSize: 10, fontWeight: 400, color: T.textMuted, letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 8px', fontFamily: T.sans }}>
              Analysis Result
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
              <CopyBtn text={output} />
            </div>
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.r10, overflow: 'hidden' }}>
              <MarkdownViewer content={output} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   DATA EXTRACTION — local permission
   ============================================================ */
function extractLocalPermissionData(tc: any) {
  try {
    const args = tc.args || tc.arguments || {};
    return {
      command: args.command || '',
      reason: args.reason || '',
      shellType: args.shellType || 'Bash',
      agentName: tc.agentName || '',
      requestId: args.requestId || tc.data?.requestId || tc.result?.data?.requestId || (String(tc.id || '').startsWith('local-exec-') ? tc.id : ''),
    };
  } catch { return null; }
}

/* ============================================================
   DATA EXTRACTION — image analysis
   ============================================================ */
function extractImageAnalysisData(tc: any) {
  try {
    const toolName = String(tc.toolName || '').toLowerCase();
    const isSheet = toolName === 'visual_classification_sheet';
    const data = tc.data || tc.result?.data || {};
    const args = tc.args || {};
    const outputText = tc.output || tc.result?.output || data.visionOutput || '';
    const outputImagePaths = extractImagePathsFromText(outputText);
    const images: ImagePreviewItem[] = [];
    const rawImages = data.images || [];
    if (Array.isArray(rawImages)) {
      for (const img of rawImages) {
        if ((img?.dataUrl || img?.path) && (img?.fileName || img?.path)) {
          images.push({
            fileName: img.fileName || imagePathBasename(img.path),
            path: img.path,
            dataUrl: img.dataUrl,
            badge: isSheet ? `Sheet ${images.length + 1}` : undefined,
          });
        }
      }
    }

    const sheets = Array.isArray(data.sheets) ? data.sheets : [];
    for (const sheet of sheets) {
      const pathValue = sheet?.path || '';
      const dataUrl = sheet?.dataUrl;
      if (!pathValue && !dataUrl) continue;
      images.push({
        fileName: sheet?.fileName || imagePathBasename(pathValue) || `Sheet ${images.length + 1}`,
        path: pathValue,
        dataUrl,
        subtitle: pathValue ? `IDs ${sheet?.firstId ?? '?'}-${sheet?.lastId ?? '?'}` : undefined,
        badge: `Sheet ${sheet?.sheetIndex !== undefined ? Number(sheet.sheetIndex) + 1 : images.length + 1}`,
      });
    }

    for (const imagePath of outputImagePaths) {
      if (images.some(img => img.path === imagePath)) continue;
      images.push({
        fileName: imagePathBasename(imagePath),
        path: imagePath,
        badge: isSheet ? `Sheet ${images.length + 1}` : undefined,
      });
    }

    if ((tc.base64Image || data.base64Image) && images.length === 0) {
      images.push({
        fileName: isSheet ? 'visual-classification-sheet.jpg' : 'analysis-image.jpg',
        dataUrl: asImageDataUrl(tc.base64Image || data.base64Image),
        badge: isSheet ? 'Sheet 1' : undefined,
      });
    }

    const rawFileNames = [
      ...(Array.isArray(data.fileNames) ? data.fileNames : []),
      ...(sheets.map((sheet: any) => sheet?.path).filter(Boolean)),
      ...outputImagePaths,
      ...(Array.isArray(args.images) ? args.images : []),
      ...(args.imagePath ? [args.imagePath] : []),
    ].filter(Boolean);

    return {
      title: isSheet ? 'Visual Classification Sheet' : 'Image Analysis',
      question: args.question || '',
      output: outputText,
      imageCount: data.imageCount || images.length || args.images?.length || (args.imagePath ? 1 : 0),
      sheetCount: data.sheetCount || (sheets.length || undefined),
      directory: data.directory || args.directory || '',
      outputDir: data.outputDir || '',
      manifestPath: data.manifestPath || '',
      fileNames: Array.from(new Set(rawFileNames)),
      images: uniqueImageItems(images),
      isSheet,
    };
  } catch { return null; }
}

/* ============================================================
   MAIN PANEL
   ============================================================ */
const cache = new Map();

interface ToolDetailSidePanelProps {
  isOpen: boolean;
  toolCall: any;
  tabs?: any[];
  activeTabId?: string | null;
  onSelectTab?: (tabId: string) => void;
  onCloseTab?: (tabId: string) => void;
  onClose: () => void;
  conversationId: string;
  subAgentProgress?: Map<string, any[]>;
  subAgentProgressVersion?: number;
}

export default function ToolDetailSidePanel({
  isOpen,
  toolCall,
  tabs = [],
  activeTabId,
  onSelectTab,
  onCloseTab,
  onClose,
  conversationId,
  subAgentProgress,
  subAgentProgressVersion
}: ToolDetailSidePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [toolType, setToolType] = useState(ToolType.GENERIC);
  const [toolData, setToolData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);
  const [surfaceMode, setSurfaceMode] = useState<'tool' | 'open-file' | 'terminal' | 'browser'>('tool');
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [filePaneOpen, setFilePaneOpen] = useState(false);
  const [openedFile, setOpenedFile] = useState<{ path: string; absolutePath: string; content: string; mimeType?: string; previewError?: string } | null>(null);
  const [manualProjectRoot, setManualProjectRoot] = useState('');
  const [browserUrl, setBrowserUrl] = useState('');
  const [browserMeta, setBrowserMeta] = useState(() => getBrowserFallbackMeta(''));
  const [openWithApps, setOpenWithApps] = useState<OpenWithApp[]>([]);
  const [openWithAppsLoading, setOpenWithAppsLoading] = useState(false);
  const isMac = isMacPlatform();
  const shortcutPrefix = isMac ? '⌘' : 'Ctrl';
  const imageAnalysisPayloadKey = getImageAnalysisPayloadKey(toolCall);

  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 1024);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const type = detectToolType(toolCall?.toolName);
    const normalizedToolName = String(toolCall?.toolName || '').toLowerCase();
    setSurfaceMode(normalizedToolName === 'show_user_url' ? 'browser' : 'tool');
    setPlusMenuOpen(false);
    setFilePaneOpen(type !== ToolType.TERMINAL);
    setManualProjectRoot('');
    const possibleUrl = toolCall?.args?.url || toolCall?.args?.url_to_visit || toolCall?.data?.url || '';
    if (possibleUrl) setBrowserUrl(normalizePanelUrl(String(possibleUrl)));
  }, [isOpen, toolCall?.id, toolCall?.toolName]);

  useEffect(() => {
    let cancelled = false;
    const loadMeta = async () => {
      const fallback = getBrowserFallbackMeta(browserUrl);
      setBrowserMeta(fallback);
      if (!browserUrl || browserUrl.startsWith('file:')) return;
      try {
        const meta = await (window as any).electronAPI?.system?.fetchMetadata?.(browserUrl);
        if (cancelled) return;
        setBrowserMeta({
          title: meta?.title || fallback.title,
          favicon: meta?.favicon || fallback.favicon,
          url: browserUrl,
        });
      } catch {
        if (!cancelled) setBrowserMeta(fallback);
      }
    };
    loadMeta();
    return () => { cancelled = true; };
  }, [browserUrl]);

  // Primary effect: runs when the panel opens or the selected tool call changes.
  // Uses stable primitives as deps (id + output) instead of the toolCall object reference,
  // which changes on every parent re-render causing an infinite loop.
  useEffect(() => {
    if (!isOpen || !toolCall) { setToolData(null); setError(null); return; }

    setIsLoading(true);
    setError(null);
    try {
      let type = detectToolType(toolCall.toolName);
      if (type === ToolType.LOCAL_PERMISSION && shouldRenderLocalPermissionAsTerminal(toolCall)) {
        type = ToolType.TERMINAL;
      }
      setToolType(type);

      let extracted: any;
      if (type === ToolType.MCP_REGISTRY) {
        extracted = extractMcpRegistryData(toolCall);
      } else if (type === ToolType.WEB_SEARCH) {
        extracted = extractWebSearchData(toolCall);
      } else if (type === ToolType.LIVE_PREVIEW) {
        extracted = extractLivePreviewData(toolCall);
      } else if (type === ToolType.FERN) {
        // Pass current progress snapshot for initial render
        const progress = subAgentProgress?.get(toolCall.id) || [];
        extracted = extractFernData(toolCall, progress);
      } else if (type === ToolType.TERMINAL) {
        extracted = extractTerminalData(toolCall);
      } else if (type === ToolType.SKILL) {
        extracted = extractSkillData(toolCall);
      } else if (type === ToolType.PLAN) {
        extracted = extractPlanData(toolCall);
      } else if (type === ToolType.PRESENTATION) {
        extracted = extractPresentationData(toolCall);
      } else if (type === ToolType.TODO_WRITE) {
        extracted = extractTodoWriteData(toolCall);
      } else if (type === ToolType.FILE_SYSTEM || type === ToolType.FILE_EDITOR) {
        extracted = extractFileSystemData(toolCall);
      } else if (type === ToolType.LOCAL_PERMISSION) {
        extracted = extractLocalPermissionData(toolCall);
      } else if (type === ToolType.IMAGE_ANALYSIS) {
        extracted = extractImageAnalysisData(toolCall);
      } else {
        extracted = extractGenericData(toolCall);
      }

      if (!extracted && type !== ToolType.GENERIC) {
        setToolType(ToolType.GENERIC);
        extracted = extractGenericData(toolCall);
      }

      if (extracted) (extracted as any).toolCallId = toolCall.id;
      setToolData(extracted);
    } catch { setError('Failed to load details'); }
    setIsLoading(false);
  // toolCall?.id changes when a different tool call is selected.
  // toolCall?.output changes when an in-progress tool call finishes.
  // Using primitives instead of the toolCall object avoids infinite loops from reference churn.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, toolCall?.id, toolCall?.output, imageAnalysisPayloadKey]);

  // Lightweight secondary effect: ONLY updates screenshots for live FERN/computer_use sessions.
  // Runs when new progress events arrive but skips the loading spinner and full re-parse.
  useEffect(() => {
    if (!isOpen || !toolCall || toolType !== ToolType.FERN) return;
    const progress = subAgentProgress?.get(toolCall.id) || [];
    if (progress.length === 0) return;
    try {
      const extracted = extractFernData(toolCall, progress);
      if (extracted) {
        (extracted as any).toolCallId = toolCall.id;
        setToolData(extracted);
      }
    } catch { /* silently ignore mid-stream parse errors */ }
  // subAgentProgressVersion is a cheap counter that increments on each new event batch
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subAgentProgressVersion, toolCall?.id, isOpen, toolType]);

  // Async disk-path screenshot loader: fires when toolData contains screenshots that have a
  // screenshotPath but no base64 (i.e., the session was restored from saved history after
  // a page refresh). Loads each image via IPC and patches toolData in place.
  useEffect(() => {
    if (!isOpen || !toolData || toolType !== ToolType.FERN) return;
    const screenshots: any[] = toolData.screenshots || [];
    const needLoad = screenshots.filter((s: any) => s.screenshotPath && !s.base64);
    if (needLoad.length === 0) return;

    let cancelled = false;
    (async () => {
      const api = (window as any).electronAPI?.screenshot;
      if (!api?.load) return;

      const updated = [...screenshots];
      let changed = false;

      await Promise.all(
        needLoad.map(async (s: any) => {
          try {
            const result = await api.load(s.screenshotPath);
            if (cancelled) return;
            if (result?.dataUrl) {
              const idx = updated.findIndex((u: any) => u.screenshotPath === s.screenshotPath);
              if (idx !== -1) {
                const clean = result.dataUrl.indexOf(',') !== -1
                  ? result.dataUrl.substring(result.dataUrl.indexOf(',') + 1)
                  : result.base64;
                updated[idx] = { ...updated[idx], base64: clean };
                changed = true;
              }
            }
          } catch { /* skip failed files */ }
        })
      );

      if (!cancelled && changed) {
        setToolData((prev: any) => prev ? { ...prev, screenshots: updated } : prev);
      }
    })();

    return () => { cancelled = true; };
  // Only fire when the set of path-only screenshots changes (toolData ref change on restore)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolData?.toolCallId, isOpen, toolType]);

  // Poll for live terminal output if the command is still running
  useEffect(() => {
    if (!isOpen || !toolCall || toolCall.status === 'done' || toolType !== ToolType.TERMINAL) return;

    let mounted = true;
    const pollId = toolCall.args?.id || toolCall.id;

    const poll = async () => {
      try {
        if (!mounted || !window.electronAPI?.terminal?.getStatus) return;
        const res = await window.electronAPI.terminal.getStatus(pollId);
        if (mounted && res && res.success) {
          setToolData((prev: any) => ({
            ...prev,
            output: res.output || prev?.output || '',
            exitCode: res.exitCode,
            cwd: res.cwd || prev?.cwd || inferTerminalCwd(toolCall, res.output, toolCall.args?.command || toolCall.args?.CommandLine)
          }));
        }
      } catch (err) {
        // ignore polling errors
      }
    };

    poll(); // Initial fetch
    const interval = setInterval(poll, 1000); // Poll every second

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [isOpen, toolCall, toolType]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }

      if (shouldIgnoreToolPanelShortcut(event)) return;

      const modifierPressed = isMac ? event.metaKey : event.ctrlKey;
      if (!modifierPressed || event.altKey || event.shiftKey) return;

      const key = event.key.toLowerCase();
      const isBackquote = event.code === 'Backquote' || event.key === '`';

      if (key === 'p') {
        event.preventDefault();
        setSurfaceMode('open-file');
        setFilePaneOpen(true);
        setPlusMenuOpen(false);
      } else if (key === 't') {
        event.preventDefault();
        setSurfaceMode('browser');
        setFilePaneOpen(false);
        setPlusMenuOpen(false);
      } else if (isBackquote) {
        event.preventDefault();
        setSurfaceMode('terminal');
        setFilePaneOpen(false);
        setPlusMenuOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isMac, onClose]);

  const openTabs = tabs.length > 0 ? tabs : (toolCall ? [toolCall] : []);
  const inferredProjectRoot = useMemo(() => inferToolProjectRoot(toolCall, toolData, openTabs), [toolCall, toolData, openTabs]);
  const projectRoot = manualProjectRoot || inferredProjectRoot;
  const activeFilePath = openedFile?.path || getToolPath(toolCall).replace(projectRoot ? `${projectRoot}\\` : '', '').replace(/\\/g, '/');
  const headerFilePath = surfaceMode === 'open-file' && openedFile?.absolutePath ? openedFile.absolutePath : '';

  useEffect(() => {
    let cancelled = false;
    const loadApps = async () => {
      if (!headerFilePath) {
        setOpenWithApps([]);
        setOpenWithAppsLoading(false);
        return;
      }
      setOpenWithAppsLoading(true);
      try {
        const apps = await (window as any).electronAPI?.system?.getFileApps?.(headerFilePath);
        if (!cancelled) setOpenWithApps(Array.isArray(apps) ? apps : []);
      } catch {
        if (!cancelled) setOpenWithApps([]);
      } finally {
        if (!cancelled) setOpenWithAppsLoading(false);
      }
    };
    loadApps();
    return () => { cancelled = true; };
  }, [headerFilePath]);

  const handleOpenFile = async (filePath: string) => {
    setSurfaceMode('open-file');
    setFilePaneOpen(true);
    setPlusMenuOpen(false);
    const absolutePath = joinFsPath(projectRoot, filePath);
    try {
      if (isTextLikeFile(filePath)) {
        const content = await (window as any).electronAPI?.projects?.readFile?.(projectRoot, filePath);
        setOpenedFile({ path: filePath, absolutePath, content: content || '' });
        return;
      }
      if (isDataPreviewFile(filePath)) {
        const preview = await (window as any).electronAPI?.projects?.readFileDataUrl?.(projectRoot, filePath);
        setOpenedFile({
          path: filePath,
          absolutePath,
          content: preview?.dataUrl || '',
          mimeType: preview?.mimeType,
          previewError: preview?.success ? undefined : (preview?.error || 'Preview failed to load'),
        });
        return;
      }
      setOpenedFile({ path: filePath, absolutePath, content: '', previewError: 'No inline preview for this file type.' });
    } catch {
      setOpenedFile({ path: filePath, absolutePath, content: '', previewError: 'Unable to read file' });
    }
  };

  const renderContent = () => {
    if (surfaceMode === 'open-file') return <OpenFileSurface selectedPath={openedFile?.path} content={openedFile?.content} previewError={openedFile?.previewError} />;
    if (surfaceMode === 'terminal') {
      return <TerminalView command="" output="" shellType="windows" cwd={projectRoot} />;
    }
    if (surfaceMode === 'browser') {
      return <BrowserSurface url={browserUrl} onUrlChange={setBrowserUrl} />;
    }

    if (isLoading) return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
        <motion.div
          style={{ width: 26, height: 26, border: `2px solid ${T.border}`, borderTopColor: T.textSecondary, borderRadius: '50%' }}
          animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.75, ease: 'linear' }}
        />
        <span style={{ fontSize: 12.5, color: T.textMuted, fontFamily: T.sans }}>Loading…</span>
      </div>
    );

    if (error) return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, textAlign: 'center' }}>
        <div style={{
          width: 44, height: 44, borderRadius: T.r12, background: T.redFaint, border: `1px solid rgba(239,68,68,0.18)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16,
        }}>
          <AlertCircle size={18} color={T.red} strokeWidth={1.75} />
        </div>
        <p style={{ fontSize: 13.5, fontWeight: 400, color: T.text, margin: '0 0 6px', fontFamily: T.sans }}>{error}</p>
        <p style={{ fontSize: 12, color: T.textMuted, margin: 0, fontFamily: T.sans }}>Try reopening the panel.</p>
      </div>
    );

    if (!toolData) return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ fontSize: 13, color: T.textMuted, fontFamily: T.sans }}>No data available</p>
      </div>
    );

    if (toolType === ToolType.LIVE_PREVIEW) return <LivePreviewView {...toolData} />;
    if (toolType === ToolType.MCP_REGISTRY) return <McpRegistryView {...toolData} />;
    if (toolType === ToolType.WEB_SEARCH) return <WebSearchView {...toolData} />;
    if (toolType === ToolType.FERN) return <NavisView {...toolData} toolName={toolCall?.toolName || 'Fern'} />;
    if (toolType === ToolType.TERMINAL) return <TerminalView {...toolData} />;
    if (toolType === ToolType.SKILL) return <SkillView {...toolData} />;
    if (toolType === ToolType.PLAN) return <PlanView {...toolData} />;
    if (toolType === ToolType.PRESENTATION) return <PresentationView {...toolData} />;
    if (toolType === ToolType.TODO_WRITE) return <TodoWriteView {...toolData} />;
    if (toolType === ToolType.FILE_SYSTEM) return <FileSystemView {...toolData} />;
    if (toolType === ToolType.FILE_EDITOR) return <FileEditorView {...toolData} />;
    if (toolType === ToolType.LOCAL_PERMISSION) return <LocalPermissionView {...toolData} />;
    if (toolType === ToolType.IMAGE_ANALYSIS) return <ImageAnalysisView {...toolData} />;
    return <GenericView {...toolData} />;
  };

  const activeId = activeTabId || toolCall?.id || openTabs[0]?.id;
  const panelWidth = 920;
  const panelWidthCss = isDesktop ? `min(${panelWidth}px, 54vw)` : `min(100%, ${panelWidth}px)`;
  const hasBrowserTab = surfaceMode === 'browser' || Boolean(browserUrl);
  const hasCrowdedTabs = openTabs.length + (hasBrowserTab ? 1 : 0) >= 3;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop (mobile only) */}
          <motion.div
            style={{ position: 'fixed', inset: 0, background: 'rgba(9,9,9,0.45)', zIndex: 40 }}
            className="lg:hidden"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            role="complementary"
            aria-label="Tool execution details"
            style={isDesktop ? {
              position: 'relative',
              height: '100%',
              background: VS.bg, borderLeft: `1px solid ${VS.border}`,
              display: 'flex', flexDirection: 'column',
              overflow: 'hidden', outline: 'none', flexShrink: 0,
              zIndex: 4,
              boxShadow: CLAY.panelShadow,
            } : {
              position: 'fixed', right: 0, top: 0, bottom: 0,
              width: panelWidthCss,
              background: VS.bg, borderLeft: `1px solid ${VS.border}`,
              display: 'flex', flexDirection: 'column',
              zIndex: 140, overflow: 'hidden', outline: 'none',
            }}
            initial={isDesktop ? { width: 0, opacity: 0 } : { x: '100%', opacity: 0 }}
            animate={isDesktop ? { width: panelWidthCss, opacity: 1 } : { x: 0, opacity: 1 }}
            exit={isDesktop ? { width: 0, opacity: 0 } : { x: '100%', opacity: 0 }}
            transition={{ type: 'spring', stiffness: 340, damping: 36 }}
          >
            {/* Inner wrapper prevents layout reflow during animation */}
            <div style={{
              width: '100%', height: '100%',
              display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0,
            }}>
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <div style={{
                  height: 43,
                  background: VS.bg,
                  borderBottom: `1px solid ${VS.border}`,
                  display: 'flex',
                  alignItems: 'center',
                  minWidth: 0,
                  padding: '0 12px',
                  gap: 8,
                }}>
                  <button
                    type="button"
                    onClick={() => setSurfaceMode('tool')}
                    style={{
                      height: 31,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '0 10px',
                      borderRadius: 10,
                      background: surfaceMode === 'tool' ? CLAY.active : 'transparent',
                      border: surfaceMode === 'tool' ? `1px solid ${VS.border}` : '1px solid transparent',
                      boxShadow: surfaceMode === 'tool' ? CLAY.shadow : 'none',
                      color: surfaceMode === 'tool' ? VS.text : VS.muted,
                      cursor: 'pointer',
                      fontFamily: T.sans,
                      fontSize: 13.5,
                    }}
                  >
                    <span style={{ width: 15, height: 15, borderRadius: 4, border: `1px solid ${VS.muted}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>+</span>
                    Review
                  </button>

                  <button
                    type="button"
                    onClick={() => { setSurfaceMode('open-file'); setFilePaneOpen(true); setPlusMenuOpen(false); }}
                    style={{
                      height: 31,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '0 11px',
                      borderRadius: 10,
                      background: surfaceMode === 'open-file' ? CLAY.active : 'transparent',
                      border: surfaceMode === 'open-file' ? `1px solid ${VS.border}` : '1px solid transparent',
                      boxShadow: surfaceMode === 'open-file' ? CLAY.shadow : 'none',
                      color: surfaceMode === 'open-file' ? VS.text : VS.muted,
                      cursor: 'pointer',
                      fontFamily: T.sans,
                      fontSize: 13.5,
                    }}
                  >
                    <FileIcon size={15} />
                    Open file
                  </button>

                  <div style={{ position: 'relative', minWidth: 0, flex: 1, overflow: 'hidden' }}>
                    {hasCrowdedTabs && (
                      <div style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: 28,
                        background: 'linear-gradient(90deg, #f5f4f0 0%, rgba(245,244,240,0.76) 46%, rgba(245,244,240,0) 100%)',
                        pointerEvents: 'none',
                        zIndex: 2,
                      }} />
                    )}
                    {hasCrowdedTabs && (
                      <div style={{
                        position: 'absolute',
                        right: 0,
                        top: 0,
                        bottom: 0,
                        width: 34,
                        background: 'linear-gradient(270deg, #f5f4f0 0%, rgba(245,244,240,0.76) 46%, rgba(245,244,240,0) 100%)',
                        pointerEvents: 'none',
                        zIndex: 2,
                      }} />
                    )}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                      minWidth: 0,
                      overflowX: hasCrowdedTabs ? 'auto' : 'visible',
                      overflowY: 'hidden',
                      scrollbarWidth: 'thin',
                      paddingLeft: hasCrowdedTabs ? 16 : 0,
                      paddingRight: hasCrowdedTabs ? 16 : 0,
                    }}>
                      {openTabs.map((tab) => {
                        const isActive = tab.id === activeId && surfaceMode === 'tool';
                        return (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => { setSurfaceMode('tool'); onSelectTab?.(tab.id); }}
                          title={getToolSubtitle(tab)}
                          style={{
                            height: 31,
                            minWidth: 0,
                            maxWidth: 220,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '0 12px',
                            borderRadius: 10,
                            background: isActive ? CLAY.active : 'transparent',
                            border: isActive ? `1px solid ${VS.border}` : '1px solid transparent',
                            boxShadow: isActive ? CLAY.shadow : 'none',
                            color: isActive ? VS.text : VS.muted,
                            cursor: 'pointer',
                            fontFamily: T.sans,
                            fontSize: 13.5,
                            flexShrink: 0,
                          }}
                        >
                          <ToolTabIcon toolName={tab.toolName} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {getToolTabLabel(tab)}
                          </span>
                          <span
                            role="button"
                            aria-label="Close tab"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              onCloseTab?.(tab.id);
                            }}
                            style={{
                              width: 17,
                              height: 17,
                              borderRadius: 4,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: isActive ? VS.muted : VS.dim,
                            }}
                          >
                            <X size={12} />
                          </span>
                        </button>
                        );
                      })}
                      {hasBrowserTab && (
                        <button
                          type="button"
                          onClick={() => { setSurfaceMode('browser'); setFilePaneOpen(false); setPlusMenuOpen(false); }}
                          title={browserMeta.url || browserMeta.title}
                          style={{
                            height: 31,
                            minWidth: 0,
                            maxWidth: 220,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '0 12px',
                            borderRadius: 10,
                            background: surfaceMode === 'browser' ? CLAY.active : 'transparent',
                            border: surfaceMode === 'browser' ? `1px solid ${VS.border}` : '1px solid transparent',
                            boxShadow: surfaceMode === 'browser' ? CLAY.shadow : 'none',
                            color: surfaceMode === 'browser' ? VS.text : VS.muted,
                            cursor: 'pointer',
                            fontFamily: T.sans,
                            fontSize: 13.5,
                            flexShrink: 0,
                          }}
                        >
                          {browserMeta.favicon ? (
                            <img
                              src={browserMeta.favicon}
                              alt=""
                              style={{ width: 14, height: 14, flexShrink: 0, borderRadius: 3 }}
                              onError={(e) => { e.currentTarget.style.display = 'none'; }}
                            />
                          ) : (
                            <Globe size={13} />
                          )}
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {browserMeta.title || 'Browser'}
                          </span>
                          <span
                            role="button"
                            aria-label="Close browser tab"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setBrowserUrl('');
                              setBrowserMeta(getBrowserFallbackMeta(''));
                              setSurfaceMode('tool');
                            }}
                            style={{
                              width: 17,
                              height: 17,
                              borderRadius: 4,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: surfaceMode === 'browser' ? VS.muted : VS.dim,
                            }}
                          >
                            <X size={12} />
                          </span>
                        </button>
                      )}
                      <button
                        type="button"
                        aria-label="Open panel menu"
                        onClick={() => setPlusMenuOpen(v => !v)}
                        style={{
                          width: 33,
                          height: 33,
                          border: plusMenuOpen ? '1px solid rgba(20,184,166,0.55)' : `1px solid ${VS.border}`,
                          borderRadius: 12,
                          background: plusMenuOpen ? CLAY.active : CLAY.card,
                          color: VS.text,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          cursor: 'pointer',
                          boxShadow: plusMenuOpen ? '0 0 0 1px rgba(20,184,166,0.18), 0 8px 18px rgba(32,30,36,0.08)' : CLAY.shadow,
                        }}
                      >
                        <Plus size={19} />
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: VS.muted, flexShrink: 0 }}>
                    <Maximize2 size={15} />
                    <button
                      type="button"
                      title="Toggle files"
                      onClick={() => setFilePaneOpen(v => !v)}
                      style={{
                        width: 31,
                        height: 31,
                            borderRadius: 10,
                        background: filePaneOpen ? CLAY.active : 'transparent',
                        border: filePaneOpen ? `1px solid ${VS.border}` : '1px solid transparent',
                        boxShadow: filePaneOpen ? CLAY.shadow : 'none',
                        color: filePaneOpen ? VS.text : VS.muted,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                      }}
                    >
                      <FolderOpenIcon style={{ width: 18, height: 18 }} />
                    </button>
                    <PanelRightOpen size={17} />
                  <button
                    onClick={onClose}
                    aria-label="Close tool details"
                    style={{
                      width: 28,
                      height: 28,
                      border: `1px solid ${VS.borderStrong}`,
                      borderRadius: 8,
                      background: VS.tabActive,
                      color: VS.text,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    <X size={15} />
                  </button>
                  </div>
                </div>
                <AnimatePresence>
                  {plusMenuOpen && (
                    <PlusMenu
                      onOpenFile={() => { setSurfaceMode('open-file'); setFilePaneOpen(true); setPlusMenuOpen(false); }}
                      onTerminal={() => { setSurfaceMode('terminal'); setFilePaneOpen(false); setPlusMenuOpen(false); }}
                      onBrowser={() => { setSurfaceMode('browser'); setFilePaneOpen(false); setPlusMenuOpen(false); }}
                      shortcutPrefix={shortcutPrefix}
                    />
                  )}
                </AnimatePresence>
                {headerFilePath && (
                  <FileBreadcrumbHeader
                    filePath={headerFilePath}
                    apps={openWithApps}
                    appsLoading={openWithAppsLoading}
                  />
                )}
              </div>

              <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden', background: VS.bg }}>
                <motion.div
                  style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0, background: VS.bg }}
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.07, duration: 0.2 }}
                >
                  {renderContent()}
                </motion.div>
                {filePaneOpen && (
                  <FileExplorerPane
                    rootPath={projectRoot}
                    activePath={activeFilePath}
                    onOpenFile={handleOpenFile}
                    onRootPathChange={(root) => setManualProjectRoot(root)}
                  />
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
