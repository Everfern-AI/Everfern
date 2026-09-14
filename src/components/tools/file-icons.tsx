'use client';

import type { LucideIcon } from 'lucide-react';
import {
  File, FileText, FileCode, FileCode2, FileJson, FileLock, Braces,
  Image as ImageIcon, Database, Lock, Package, Globe, Palette, BookOpen,
  Terminal, ScrollText, NotebookPen, FileCog, Cog, ShieldCheck, GitBranch,
  Zap, Wind, Scale, Rocket,
} from 'lucide-react';

export interface FileIconVisual {
  Icon: LucideIcon;
  color: string;
}

const V = (Icon: LucideIcon, color: string): FileIconVisual => ({ Icon, color });

const DEFAULT_VISUAL: FileIconVisual = V(File, 'var(--color-text-tertiary)');

const EXACT: Record<string, FileIconVisual> = {
  'package.json': V(Package, '#cb3837'),
  'package-lock.json': V(Package, '#cb3837'),
  'pnpm-lock.yaml': V(Package, '#ffd43b'),
  'yarn.lock': V(Package, '#2c8ebb'),
  'tsconfig.json': V(FileCog, '#7dd3fc'),
  'jsconfig.json': V(FileCog, '#facc15'),
  'next.config.ts': V(Rocket, '#cfcfcf'),
  'next.config.js': V(Rocket, '#cfcfcf'),
  'next.config.mjs': V(Rocket, '#cfcfcf'),
  'vite.config.ts': V(Zap, '#646cff'),
  'vite.config.js': V(Zap, '#646cff'),
  'tailwind.config.ts': V(Wind, '#38bdf8'),
  'tailwind.config.js': V(Wind, '#38bdf8'),
  'eslint.config.js': V(ShieldCheck, '#4b32c3'),
  'eslint.config.mjs': V(ShieldCheck, '#4b32c3'),
  '.eslintrc': V(ShieldCheck, '#4b32c3'),
  '.eslintrc.js': V(ShieldCheck, '#4b32c3'),
  '.prettierrc': V(Cog, '#f7b93e'),
  '.gitignore': V(GitBranch, '#f05033'),
  '.gitmodules': V(GitBranch, '#f05033'),
  '.npmrc': V(Package, '#cb3837'),
  'readme.md': V(BookOpen, '#4ade80'),
  'license': V(Scale, 'var(--color-text-tertiary)'),
  'license.txt': V(Scale, 'var(--color-text-tertiary)'),
};

const BY_EXT: Record<string, FileIconVisual> = {
  env: V(FileLock, '#ecc94b'),
  gitignore: V(GitBranch, '#f05033'),
  log: V(ScrollText, 'var(--color-text-tertiary)'),
  ts: V(FileCode2, '#7dd3fc'),
  tsx: V(FileCode2, '#7dd3fc'),
  js: V(FileCode, '#facc15'),
  jsx: V(FileCode, '#facc15'),
  mjs: V(FileCode, '#facc15'),
  cjs: V(FileCode, '#facc15'),
  json: V(FileJson, '#f59e0b'),
  css: V(Palette, '#60a5fa'),
  scss: V(Palette, '#cf649a'),
  sass: V(Palette, '#cf649a'),
  html: V(Globe, '#e34c26'),
  md: V(FileText, '#4ade80'),
  mdx: V(NotebookPen, '#fbbf24'),
  py: V(FileCode2, '#4b8bbe'),
  ps1: V(Terminal, '#4f8ef7'),
  bat: V(Terminal, '#4f8ef7'),
  yml: V(Braces, '#f59e0b'),
  yaml: V(Braces, '#f59e0b'),
  sql: V(Database, '#f2994a'),
  svg: V(Globe, '#ffb13b'),
  png: V(ImageIcon, '#a074c4'),
  jpg: V(ImageIcon, '#a074c4'),
  jpeg: V(ImageIcon, '#a074c4'),
  gif: V(ImageIcon, '#a074c4'),
  webp: V(ImageIcon, '#a074c4'),
  bmp: V(ImageIcon, '#a074c4'),
  pdf: V(FileText, '#e05749'),
  lock: V(Lock, 'var(--color-text-tertiary)'),
  npmrc: V(Package, '#cb3837'),
};

export function getFileIconVisual(name: string): FileIconVisual {
  const lower = name.toLowerCase();
  const ext = lower.startsWith('.') && !lower.slice(1).includes('.')
    ? lower.slice(1)
    : lower.split('.').pop() || '';

  if (lower === '.env' || lower.startsWith('.env.')) {
    return BY_EXT['env'] ?? DEFAULT_VISUAL;
  }
  return EXACT[lower] ?? BY_EXT[ext] ?? DEFAULT_VISUAL;
}
