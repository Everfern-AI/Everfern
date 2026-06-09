/**
 * EverFern Desktop — Pi Coding Tools Adapter
 *
 * Wraps @mariozechner/pi-coding-agent standard tools into EverFern's AgentTool schema.
 * Dynamically loads the ESM package to sidestep CJS runtime errors (ERR_PACKAGE_PATH_NOT_EXPORTED).
 */

import type { AgentTool, ToolResult } from '../runner/types';
import { runInLinuxVM, isLinuxVMAvailable } from './linux-vm-executor';
import { getRollbackManager } from '../persistence/rollback-manager';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Global map to store pending local execution request resolvers
// Maps requestId -> resolver function
let globalLocalExecutionResolvers: Map<string, (response: { approved: boolean; alwaysAllow: boolean }) => void> | null = null;

// Export for testing and IPC handler access
export function getLocalExecutionResolvers() {
  if (!globalLocalExecutionResolvers) {
    globalLocalExecutionResolvers = new Map();
  }
  return globalLocalExecutionResolvers;
}

// Strip ANSI escape sequences (color codes, cursor movement, etc.)
// These garble the chat UI and confuse the model's context window.
function stripAnsi(str: string): string {
  // Covers: SGR params, cursor movement, erase, scroll, OSC, etc.
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*\x07)/g, '');
}

// File tool names that run on the host and need Linux→Windows path translation
const HOST_FILE_TOOL_NAMES = new Set(['read', 'write', 'edit', 'grep', 'find', 'ls']);

function previewValue(value: unknown, max = 140): string {
  if (typeof value === 'string') {
    return value.length > max ? `${value.slice(0, max)}...` : value;
  }
  try {
    const json = JSON.stringify(value);
    return json.length > max ? `${json.slice(0, max)}...` : json;
  } catch {
    return String(value);
  }
}

function summarizeToolArgs(toolName: string, args: Record<string, unknown>): string {
  if (toolName === 'write' || toolName === 'edit' || toolName === 'read') {
    return typeof args.path === 'string' ? args.path : previewValue(args);
  }
  if (toolName === 'executePwsh') {
    return previewValue(args.command);
  }
  return previewValue(args);
}

function getHostExecutionContext(cwd?: string): string {
  const home = os.homedir();
  const downloads = path.join(home, 'Downloads');
  const desktop = path.join(home, 'Desktop');
  return [
    'Host execution context:',
    `- Platform: ${process.platform} ${os.release()}`,
    `- Current working directory: ${cwd || process.cwd()}`,
    `- User profile/home: ${home}`,
    `- Downloads: ${downloads}`,
    `- Desktop: ${desktop}`,
    `- Shell: ${process.platform === 'win32' ? 'powershell.exe' : '/bin/bash'}`,
  ].join('\n');
}

const GREP_SKIP_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  '.next',
  '.turbo',
  '.cache',
  'node_modules',
  'dist',
  'dist-electron',
  'out',
  'build',
  'coverage',
  'release',
]);

const GREP_BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.tiff',
  '.mp4', '.mov', '.avi', '.mkv', '.webm', '.mp3', '.wav', '.flac',
  '.zip', '.rar', '.7z', '.gz', '.tar', '.exe', '.dll', '.pdb',
  '.woff', '.woff2', '.ttf', '.otf', '.pdf',
]);

function normalizeDurationMs(value: unknown, fallbackMs: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallbackMs;
  return n <= 600 ? Math.round(n * 1000) : Math.round(n);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildGrepMatcher(pattern: string, caseSensitive: boolean, regexRequested: boolean): RegExp {
  const flags = caseSensitive ? '' : 'i';
  if (regexRequested) {
    try {
      return new RegExp(pattern, flags);
    } catch {
      // Fall through to literal search when the model provides an invalid regex.
    }
  }
  return new RegExp(escapeRegExp(pattern), flags);
}

function shouldSkipGrepFile(filePath: string, maxBytes: number): { skip: boolean; reason?: string } {
  const ext = path.extname(filePath).toLowerCase();
  if (GREP_BINARY_EXTS.has(ext)) return { skip: true, reason: 'binary extension' };
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return { skip: true, reason: 'not a file' };
    if (stat.size > maxBytes) return { skip: true, reason: `larger than ${maxBytes} bytes` };
  } catch (err: any) {
    return { skip: true, reason: err?.message || 'stat failed' };
  }
  return { skip: false };
}

type GrepMatch = {
  path: string;
  relativePath: string;
  line: number;
  text: string;
};

async function executeHostGrep(
  args: Record<string, unknown>,
  onUpdate?: (msg: string) => void
): Promise<ToolResult> {
  const pattern = typeof args.pattern === 'string'
    ? args.pattern
    : typeof args.query === 'string'
      ? args.query
      : typeof args.search === 'string'
        ? args.search
        : '';
  if (!pattern.trim()) {
    return { success: false, output: "Error: Missing or invalid 'pattern' parameter for grep", error: 'invalid_pattern' };
  }

  const searchPath = typeof args.path === 'string' && args.path.trim()
    ? path.resolve(args.path)
    : process.cwd();
  if (!fs.existsSync(searchPath)) {
    return { success: false, output: `Error: grep path does not exist\nPath: ${searchPath}`, error: 'path_not_found' };
  }

  const timeoutMs = normalizeDurationMs(args.timeout, 60000);
  const maxResultsRaw = Number(args.maxResults ?? args.max_results ?? args.limit ?? 200);
  const maxResults = Number.isFinite(maxResultsRaw)
    ? Math.min(Math.max(Math.floor(maxResultsRaw), 1), 1000)
    : 200;
  const maxFileBytes = normalizeDurationMs(args.maxFileBytes ?? args.max_file_bytes, 1_500_000);
  const caseSensitive = Boolean(args.caseSensitive ?? args.case_sensitive);
  const regexRequested = args.regex !== false && args.literal !== true;
  const matcher = buildGrepMatcher(pattern, caseSensitive, regexRequested);
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;

  const matches: GrepMatch[] = [];
  const skipped: string[] = [];
  const dirs: string[] = [];
  let filesSearched = 0;
  let dirsScanned = 0;
  let timedOut = false;
  let limitReached = false;
  let lastUpdate = 0;

  const emitProgress = (force = false) => {
    const now = Date.now();
    if (!force && now - lastUpdate < 650) return;
    lastUpdate = now;
    onUpdate?.(`grep: searched ${filesSearched} file${filesSearched === 1 ? '' : 's'}, found ${matches.length} match${matches.length === 1 ? '' : 'es'} in ${path.basename(searchPath) || searchPath}`);
  };

  const searchFile = (filePath: string) => {
    const skip = shouldSkipGrepFile(filePath, maxFileBytes);
    if (skip.skip) {
      if (skipped.length < 25) skipped.push(`${filePath} (${skip.reason})`);
      return;
    }

    let content = '';
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (err: any) {
      if (skipped.length < 25) skipped.push(`${filePath} (${err?.message || 'read failed'})`);
      return;
    }
    if (content.includes('\u0000')) {
      if (skipped.length < 25) skipped.push(`${filePath} (binary content)`);
      return;
    }

    filesSearched += 1;
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      matcher.lastIndex = 0;
      if (!matcher.test(lines[i])) continue;
      const relativePath = path.relative(searchPath, filePath) || path.basename(filePath);
      matches.push({
        path: filePath,
        relativePath,
        line: i + 1,
        text: lines[i].trimEnd(),
      });
      onUpdate?.(`grep: match ${matches.length} at ${relativePath}:${i + 1}`);
      if (matches.length >= maxResults) {
        limitReached = true;
        return;
      }
    }
    emitProgress();
  };

  try {
    const rootStat = fs.statSync(searchPath);
    if (rootStat.isFile()) {
      searchFile(searchPath);
    } else {
      dirs.push(searchPath);
    }
  } catch (err: any) {
    return { success: false, output: `Error: cannot access grep path\nPath: ${searchPath}\n${err?.message || err}`, error: 'path_access_failed' };
  }

  onUpdate?.(`grep: searching "${pattern}" in ${searchPath} (timeout ${Math.round(timeoutMs / 1000)}s)`);

  while (dirs.length > 0 && !limitReached) {
    if (Date.now() > deadline) {
      timedOut = true;
      break;
    }

    const dir = dirs.pop()!;
    dirsScanned += 1;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err: any) {
      if (skipped.length < 25) skipped.push(`${dir} (${err?.message || 'read directory failed'})`);
      continue;
    }

    for (const entry of entries) {
      if (Date.now() > deadline) {
        timedOut = true;
        break;
      }
      if (limitReached) break;
      const fullPath = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        if (skipped.length < 25) skipped.push(`${fullPath} (symbolic link)`);
        continue;
      }
      if (entry.isDirectory()) {
        if (GREP_SKIP_DIRS.has(entry.name)) {
          if (skipped.length < 25) skipped.push(`${fullPath} (ignored directory)`);
          continue;
        }
        dirs.push(fullPath);
        continue;
      }
      if (entry.isFile()) {
        searchFile(fullPath);
      }
    }

    if (dirsScanned % 10 === 0) {
      emitProgress();
      await new Promise(resolve => setImmediate(resolve));
    }
  }

  emitProgress(true);

  const elapsedMs = Date.now() - startedAt;
  const header = matches.length === 0
    ? `No results: grep found 0 matches.`
    : `Found ${matches.length} match${matches.length === 1 ? '' : 'es'}.`;
  const statusLines = [
    header,
    `Pattern: ${pattern}`,
    `Path: ${searchPath}`,
    `Files searched: ${filesSearched}`,
    `Directories scanned: ${dirsScanned}`,
    `Elapsed: ${elapsedMs}ms`,
  ];
  if (timedOut) statusLines.push(`Timed out after ${timeoutMs}ms; results may be partial.`);
  if (limitReached) statusLines.push(`Result limit reached (${maxResults}); narrow the search or raise maxResults.`);
  if (skipped.length > 0) {
    statusLines.push(`Skipped ${skipped.length} unreadable/ignored entr${skipped.length === 1 ? 'y' : 'ies'}:`);
    statusLines.push(...skipped.map(item => `- ${item}`));
  }
  if (matches.length > 0) {
    statusLines.push('');
    statusLines.push(...matches.map(match => `${match.relativePath}:${match.line}: ${match.text}`));
  }

  return {
    success: true,
    output: stripAnsi(statusLines.join('\n')),
    data: {
      path: searchPath,
      pattern,
      matches,
      filesSearched,
      dirsScanned,
      skipped,
      timedOut,
      limitReached,
      timeoutMs,
    },
  };
}

async function withPiToolHooks(
  toolName: string,
  args: Record<string, unknown>,
  emitEvent: ((event: any) => void) | undefined,
  onUpdate: ((msg: string) => void) | undefined,
  run: () => Promise<ToolResult>,
): Promise<ToolResult> {
  const startedAt = Date.now();
  const summary = summarizeToolArgs(toolName, args);
  onUpdate?.(`${toolName}: ${summary}`);
  emitEvent?.({
    type: 'coding_tool_hook',
    phase: 'before',
    toolName,
    summary,
    timestamp: new Date().toISOString(),
  });

  try {
    const result = await run();
    const durationMs = Date.now() - startedAt;
    emitEvent?.({
      type: 'coding_tool_hook',
      phase: 'after',
      toolName,
      summary,
      success: result.success,
      durationMs,
      outputPreview: typeof result.output === 'string' ? result.output.slice(0, 500) : '',
      timestamp: new Date().toISOString(),
    });
    return {
      ...result,
      data: {
        ...(typeof result.data === 'object' && result.data !== null ? result.data as Record<string, unknown> : {}),
        hook: { toolName, summary, durationMs },
      },
    };
  } catch (err: any) {
    const durationMs = Date.now() - startedAt;
    const msg = stripAnsi(err?.message ?? String(err));
    emitEvent?.({
      type: 'coding_tool_hook',
      phase: 'after',
      toolName,
      summary,
      success: false,
      durationMs,
      outputPreview: msg.slice(0, 500),
      timestamp: new Date().toISOString(),
    });
    return { success: false, output: `Error: ${msg}`, error: msg, data: { hook: { toolName, summary, durationMs } } };
  }
}

/**
 * Translates Linux-style paths in tool args to host-native paths.
 * Platform-specific:
 * - Windows: /mnt/c/... → C:\, /home/... → \\wsl.localhost\Ubuntu\...
 * - macOS: /host/Users/... → /Users/...
 * - Linux: pass-through (already native paths)
 */
function translateLinuxPathsToHostPaths(args: Record<string, unknown>): Record<string, unknown> {
  const pathKeys = ['path', 'file_path', 'root', 'dir', 'directory', 'from', 'to', 'src', 'dest', 'destination', 'pattern', 'glob', 'include', 'exclude'];
  const translated = { ...args };

  for (const key of pathKeys) {
    const val = translated[key];
    if (typeof val !== 'string') continue;

    let p = val.replace(/\\/g, '/');

    if (process.platform === 'win32') {
      // Translate /mnt/c/... → C:\...
      const mntMatch = p.match(/^\/mnt\/([a-zA-Z])(\/.*)?$/);
      if (mntMatch) {
        const drive = mntMatch[1].toUpperCase();
        const rest = mntMatch[2] ? mntMatch[2].replace(/\//g, '\\') : '\\';
        translated[key] = `${drive}:${rest}`;
        continue;
      }

      // Translate /home/... → \\wsl.localhost\Ubuntu\home\...
      if (p.startsWith('/home/') || p.startsWith('/root/') || p.startsWith('/tmp/')) {
        const relativePath = p.startsWith('/') ? p.substring(1) : p;
        translated[key] = `\\\\wsl.localhost\\Ubuntu\\${relativePath.replace(/\//g, '\\')}`;
        continue;
      }

      // Normalize remaining forward slashes to backslashes
      if (p.includes('/')) {
        translated[key] = p.replace(/\//g, '\\');
      }
    } else if (process.platform === 'darwin') {
      // Translate /host/Users/... → /Users/...
      if (p.startsWith('/host/Users/')) {
        translated[key] = p.replace('/host/Users/', '/Users/');
      }
    }
    // Linux: pass-through, paths are already native
  }

  return translated;
}

// Helper to convert pi-coding-agent tool into EverFern AgentTool
function adaptTool(
  definition: { name: string; description: string; parameters: any },
  executor: (toolCallId: string, params: any) => Promise<any>,
  customName?: string
): AgentTool {
  let name = customName ?? definition.name;
  let description = definition.description;
  let parameters = definition.parameters as any;

  // Enhance descriptions to enforce engineering standards from SYSTEM_PROMPT
  if (name === 'read') {
    description = `[EXPLORE-FIRST] ${description} Mandatory before any edit. For large files, use start_line/end_line to maintain context efficiency.`;
    if (parameters.properties) {
      parameters.properties.start_line = { type: 'number', description: 'Start line to read (1-indexed, inclusive)' };
      parameters.properties.end_line = { type: 'number', description: 'End line to read (1-indexed, inclusive)' };
    }
  } else if (name === 'edit') {
    description = `[SURGICAL-EDIT] ${description} ALWAYS PREFERRED over 'write' for existing files. Identify exact lines to change and provide minimal targeted diffs.`;
  } else if (name === 'write') {
    description = `[DISCIPLINED-WRITE] ${description} Use ONLY for new files or total structural rewrites. NEVER use for minor changes to existing files; use 'edit' instead.`;
  } else if (name === 'grep' || name === 'find') {
    description = `[REPO-TRIAGE] ${description} Use for mandatory triage and convention matching before writing any code.`;
    if (name === 'grep' && parameters.properties) {
      parameters.properties.timeout = {
        type: 'number',
        description: 'Search timeout. Values <= 600 are treated as seconds; larger values are treated as milliseconds. Default: 60 seconds.'
      };
      parameters.properties.maxResults = {
        type: 'number',
        description: 'Maximum number of matching lines to return before stopping. Default: 200, maximum: 1000.'
      };
      parameters.properties.caseSensitive = {
        type: 'boolean',
        description: 'Whether the search should be case-sensitive. Default: false.'
      };
      parameters.properties.regex = {
        type: 'boolean',
        description: 'Treat pattern as a regular expression. Default: true; invalid regexes fall back to literal search.'
      };
    }
  } else if (name === 'executePwsh') {
    const home = os.homedir();
    description = `${description} Executes commands natively on the host machine (main Windows VM), not a Linux VM. Host context: USERPROFILE/Home=${home}; Downloads=${path.join(home, 'Downloads')}; Desktop=${path.join(home, 'Desktop')}; cwd defaults to ${process.cwd()}. Use explicit Windows paths when the user mentions Downloads/Desktop/User profile.`;
    if (parameters.properties) {
      delete parameters.properties.local;
      delete parameters.properties.reason;
    }
  }

  return {
    name,
    description,
    parameters,
    execute: async (args: Record<string, unknown>, onUpdate?: (msg: string) => void, emitEvent?: (event: any) => void, toolCallId?: string): Promise<ToolResult> => {
      return withPiToolHooks(name, args, emitEvent, onUpdate, async () => {
      try {
        const id = toolCallId ?? `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

        // Special handling for executePwsh tool - force main host execution
        if (name === 'executePwsh') {
          const command = args.command as string;
          const normalizeTimeoutMs = (value: unknown): number | undefined => {
            const n = Number(value);
            if (!Number.isFinite(n) || n <= 0) return undefined;
            return n <= 10000 ? n * 1000 : n;
          };
          const timeout = normalizeTimeoutMs(args.timeout) || 300000;

          // Safety check: block command if it tries to kill node processes
          const normalizedCmd = (command || '').toLowerCase();
          if (normalizedCmd.includes('node') && (normalizedCmd.includes('stop-process') || normalizedCmd.includes('kill') || normalizedCmd.includes('taskkill'))) {
            return {
              success: false,
              output: 'Security Warning: Execution of commands that terminate Node.js/agent processes is blocked to prevent application crash.',
              error: 'blocked_command'
            };
          }

          // Always use native exec (main host VM)
          return await withCommandTracking(command, async () => {
            try {
              const { exec } = require('child_process');
              const { promisify } = require('util');
              const execAsync = promisify(exec);

              // Use powershell.exe on Windows, bash otherwise
              const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/bash';

              const { stdout, stderr } = await execAsync(command, { shell, timeout });

              const combined = [stdout, stderr].filter(Boolean).join('\n');
              const output = combined.trim() || '(Command succeeded with no output)';
              const cwd = process.cwd();

              return {
                success: true,
                output: stripAnsi(`Success: command completed\n${getHostExecutionContext(cwd)}\nCommand: ${command}\nOutput:\n${output}`),
                data: {
                  cwd,
                  homeDir: os.homedir(),
                  downloadsDir: path.join(os.homedir(), 'Downloads'),
                  shell,
                  timeoutMs: timeout,
                },
              };
            } catch (execError: any) {
              // Execution failed or returned non-zero exit code
              const combined = [execError.stdout, execError.stderr, execError.message].filter(Boolean).join('\n');
              const output = combined.trim() || '(Command failed with no output)';

              return {
                success: false,
                output: stripAnsi(`Error: command failed\n${getHostExecutionContext(process.cwd())}\nCommand: ${command}\nOutput:\n${output}`),
                error: stripAnsi(output),
                data: {
                  cwd: process.cwd(),
                  homeDir: os.homedir(),
                  downloadsDir: path.join(os.homedir(), 'Downloads'),
                  shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash',
                  timeoutMs: timeout,
                },
              };
            }
          });
        }

        // For host-side file tools, translate Linux paths to Windows paths
        if (HOST_FILE_TOOL_NAMES.has(name)) {
          if (name === 'write') {
            if (!args || typeof args.path !== 'string' || !args.path.trim()) {
              return {
                success: false,
                output: "Error: Missing or invalid 'path' parameter for tool 'write'",
                error: "invalid_path"
              };
            }
            if (!args || typeof args.content !== 'string') {
              return {
                success: false,
                output: "Error: Missing or invalid 'content' parameter for tool 'write'",
                error: "invalid_content"
              };
            }
          } else if (['read', 'edit'].includes(name) && (!args || typeof args.path !== 'string')) {
            return {
              success: false,
              output: `Error: Missing or invalid 'path' parameter for tool '${name}'`,
              error: `invalid_path`
            };
          }
          args = translateLinuxPathsToHostPaths(args);
        }

        if (name === 'grep') {
          return await executeHostGrep(args, onUpdate);
        }

        let editContentBefore: string | undefined;
        const editPath = name === 'edit' && typeof args?.path === 'string' ? path.resolve(args.path) : '';
        if (editPath) {
          try {
            if (fs.existsSync(editPath)) {
              editContentBefore = fs.readFileSync(editPath, 'utf-8');
            }
          } catch (readErr) {
            console.warn(`[pi-tools] Could not read file before edit result payload: ${editPath}`, readErr);
          }
        }

        // For all other tools, use the original logic
        const result = await executor(id, args);

        let outputText = '';
        if (result.content && Array.isArray(result.content)) {
          outputText = result.content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text)
            .join('\n');
        } else if (typeof result.output === 'string') {
          outputText = result.output;
        } else {
          outputText = JSON.stringify(result);
        }

        if (result.isError) {
          return { success: false, output: stripAnsi(outputText), error: stripAnsi(outputText) };
        }

        if (name === 'write') {
          const writtenPath = typeof args.path === 'string' ? path.resolve(args.path) : '';
          const bytes = typeof args.content === 'string' ? Buffer.byteLength(args.content, 'utf8') : 0;
          return {
            success: true,
            output: stripAnsi(`Success: wrote file\nPath: ${writtenPath}\nBytes: ${bytes}`),
            data: { path: writtenPath, bytes }
          };
        }

        if (name === 'edit') {
          const editedPath = editPath || (typeof args.path === 'string' ? path.resolve(args.path) : '');
          const oldString = typeof args.oldString === 'string' ? args.oldString
            : typeof args.old_string === 'string' ? args.old_string
            : typeof args.TargetContent === 'string' ? args.TargetContent
            : typeof args.target === 'string' ? args.target
            : typeof args.search === 'string' ? args.search
            : '';
          const newString = typeof args.newString === 'string' ? args.newString
            : typeof args.new_string === 'string' ? args.new_string
            : typeof args.ReplacementContent === 'string' ? args.ReplacementContent
            : typeof args.replacement === 'string' ? args.replacement
            : typeof args.replace === 'string' ? args.replace
            : '';
          let editContentAfter: string | undefined;
          if (editedPath) {
            try {
              if (fs.existsSync(editedPath)) {
                editContentAfter = fs.readFileSync(editedPath, 'utf-8');
              }
            } catch (readErr) {
              console.warn(`[pi-tools] Could not read file after edit result payload: ${editedPath}`, readErr);
            }
          }
          return {
            success: true,
            output: stripAnsi(`Success: edited file\nPath: ${editedPath}\n${outputText}`.trim()),
            data: { path: editedPath, oldString, newString, contentBefore: editContentBefore, contentAfter: editContentAfter }
          };
        }

        if (name === 'read') {
          const readPath = typeof args.path === 'string' ? path.resolve(args.path) : '';
          return {
            success: true,
            output: stripAnsi(`Success: read file\nPath: ${readPath}\n\n${outputText}`.trim()),
            data: { path: readPath, content: stripAnsi(outputText) }
          };
        }

        if (name === 'ls') {
          const listPath = typeof args.path === 'string' && args.path.trim()
            ? path.resolve(args.path)
            : process.cwd();
          const files = stripAnsi(outputText)
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line && !/^\[.*\]$/.test(line))
            .map((entry) => {
              const isDirectory = entry.endsWith('/');
              const cleanName = entry.replace(/[\\/]+$/g, '');
              const absolutePath = path.resolve(listPath, cleanName);
              let size: number | undefined;
              let modifiedAt: string | undefined;
              try {
                const stat = fs.statSync(absolutePath);
                size = stat.isFile() ? stat.size : undefined;
                modifiedAt = stat.mtime.toISOString();
              } catch {
                // The PI output is still useful even if stat fails for a transient file.
              }
              return {
                name: cleanName,
                path: absolutePath,
                relativePath: cleanName,
                type: isDirectory ? 'folder' : 'file',
                size,
                modifiedAt,
              };
            });
          return {
            success: true,
            output: stripAnsi(outputText),
            data: {
              path: listPath,
              files,
              limitReached: /\blimit reached\b/i.test(outputText),
            },
          };
        }

        if (name === 'grep') {
          const cleanOutput = stripAnsi(outputText).trim();
          const pattern = typeof args.pattern === 'string'
            ? args.pattern
            : typeof args.query === 'string'
              ? args.query
              : typeof args.search === 'string'
                ? args.search
                : '';
          const searchPath = typeof args.path === 'string' && args.path.trim()
            ? path.resolve(args.path)
            : process.cwd();
          const noMatches = cleanOutput.length === 0 || /\b(no matches|no results|0 matches)\b/i.test(cleanOutput);

          if (noMatches) {
            return {
              success: true,
              output: `No results: grep found 0 matches.\nPattern: ${pattern || '(not provided)'}\nPath: ${searchPath}`,
              data: {
                path: searchPath,
                pattern,
                matches: [],
              },
            };
          }

          return {
            success: true,
            output: cleanOutput,
            data: {
              path: searchPath,
              pattern,
            },
          };
        }

        return { success: true, output: stripAnsi(outputText) };
      } catch (err: any) {
        const msg = err.message ?? String(err);
        return { success: false, output: stripAnsi(msg), error: stripAnsi(msg) };
      }
      });
    },
  };
}

let loadedCodingTools: AgentTool[] | null = null;

// File read cache: path → { content, mtime }
const fileReadCache = new Map<string, { content: string; mtime: number }>();

/**
 * Get current agent context for rollback tracking.
 * This should be set by the agent runtime when executing tasks.
 */
let currentAgentContext: { taskId?: string; stepNumber?: number } = {};

/**
 * Set the current agent context for rollback tracking.
 * Called by the agent runtime before tool execution.
 */
export function setAgentContext(taskId: string, stepNumber: number): void {
  currentAgentContext = { taskId, stepNumber };
}

/**
 * Clear the current agent context.
 */
export function clearAgentContext(): void {
  currentAgentContext = {};
}

/**
 * Get the current agent context for rollback tracking.
 * Used by tools that need to track operations.
 */
export function getAgentContext(): { taskId?: string; stepNumber?: number } {
  return { ...currentAgentContext };
}

/**
 * Wrapper for file operations that tracks changes for rollback.
 * Captures file state before modification and tracks the operation.
 */
async function withRollbackTracking(
  toolName: string,
  args: Record<string, unknown>,
  executor: (toolCallId: string, params: any) => Promise<any>,
  toolCallId: string
): Promise<any> {
  const rollbackManager = getRollbackManager();

  // Initialize rollback manager if needed
  try {
    await rollbackManager.initialize();
  } catch (error) {
    console.warn('[pi-tools] Failed to initialize rollback manager:', error);
  }

  const { taskId, stepNumber } = currentAgentContext;

  // Only track if we have agent context
  if (!taskId || stepNumber === undefined) {
    console.warn('[pi-tools] No agent context available for rollback tracking');
    return executor(toolCallId, args);
  }

  // Handle different file operations
  if (toolName === 'write') {
    const filePath = args.path as string;
    if (!filePath) {
      return executor(toolCallId, args);
    }

    try {
      // Check if file exists and capture content before write
      let contentBefore = '';
      let fileExists = false;

      try {
        if (fs.existsSync(filePath)) {
          contentBefore = fs.readFileSync(filePath, 'utf-8');
          fileExists = true;
        }
      } catch (readError) {
        // File might not be readable, continue anyway
        console.warn(`[pi-tools] Could not read file before write: ${filePath}`, readError);
      }

      // Execute the write operation
      const result = await executor(toolCallId, args);

      // Track the operation after successful execution
      if (!result.isError) {
        try {
          const contentAfter = args.content as string || args.text as string || '';

          if (fileExists) {
            // File modification
            await rollbackManager.trackFileModification(
              path.resolve(filePath),
              contentBefore,
              contentAfter,
              taskId,
              stepNumber
            );
          } else {
            // File creation
            await rollbackManager.trackFileCreation(
              path.resolve(filePath),
              taskId,
              stepNumber
            );
          }
        } catch (trackError) {
          console.warn(`[pi-tools] Failed to track write operation for ${filePath}:`, trackError);
        }
      }

      return result;
    } catch (error) {
      console.error(`[pi-tools] Error in write operation for ${filePath}:`, error);
      throw error;
    }
  } else if (toolName === 'edit') {
    const filePath = args.path as string;
    if (!filePath) {
      return executor(toolCallId, args);
    }

    try {
      // Capture content before edit
      let contentBefore = '';

      try {
        if (fs.existsSync(filePath)) {
          contentBefore = fs.readFileSync(filePath, 'utf-8');
        }
      } catch (readError) {
        console.warn(`[pi-tools] Could not read file before edit: ${filePath}`, readError);
      }

      // Execute the edit operation
      const result = await executor(toolCallId, args);

      // Track the operation after successful execution
      if (!result.isError) {
        try {
          // Read content after edit
          let contentAfter = '';
          try {
            if (fs.existsSync(filePath)) {
              contentAfter = fs.readFileSync(filePath, 'utf-8');
            }
          } catch (readError) {
            console.warn(`[pi-tools] Could not read file after edit: ${filePath}`, readError);
          }

          if (contentBefore !== contentAfter) {
            await rollbackManager.trackFileModification(
              path.resolve(filePath),
              contentBefore,
              contentAfter,
              taskId,
              stepNumber
            );
          }
        } catch (trackError) {
          console.warn(`[pi-tools] Failed to track edit operation for ${filePath}:`, trackError);
        }
      }

      return result;
    } catch (error) {
      console.error(`[pi-tools] Error in edit operation for ${filePath}:`, error);
      throw error;
    }
  }

  // For non-file operations, just execute normally
  return executor(toolCallId, args);
}

/**
 * Wrapper for command execution that tracks commands for rollback.
 */
async function withCommandTracking(
  command: string,
  executor: () => Promise<ToolResult>
): Promise<ToolResult> {
  const rollbackManager = getRollbackManager();

  // Initialize rollback manager if needed
  try {
    await rollbackManager.initialize();
  } catch (error) {
    console.warn('[pi-tools] Failed to initialize rollback manager:', error);
  }

  const { taskId, stepNumber } = currentAgentContext;

  // Execute the command
  const result = await executor();

  // Track the command if we have agent context
  if (taskId && stepNumber !== undefined) {
    try {
      const exitCode = result.success ? 0 : 1;
      const output = result.output || '';

      await rollbackManager.trackCommandExecution(
        command,
        output,
        exitCode,
        taskId,
        stepNumber
      );
    } catch (trackError) {
      console.warn(`[pi-tools] Failed to track command execution: ${command}`, trackError);
    }
  }

  return result;
}

// Allow dependency injection for testing
let piCodingAgentModule: any = null;

export function __setPiCodingAgentModule(module: any) {
  piCodingAgentModule = module;
  loadedCodingTools = null; // Reset cache when module is injected
}

// Wrap executor with caching for read operations
function withReadCache(executor: (toolCallId: string, params: any) => Promise<any>) {
  return async (toolCallId: string, params: any) => {
    const path = params.path as string;
    if (!path) return executor(toolCallId, params);

    try {
      const fs = require('fs');
      const stat = fs.statSync(path);
      const cached = fileReadCache.get(path);

      if (cached && cached.mtime === stat.mtimeMs) {
        return { content: [{ type: 'text', text: cached.content }] };
      }

      const result = await executor(toolCallId, params);

      if (result.content && !result.isError) {
        const content = Array.isArray(result.content)
          ? result.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
          : '';
        if (content) {
          fileReadCache.set(path, { content, mtime: stat.mtimeMs });
        }
      }

      return result;
    } catch (err) {
      return executor(toolCallId, params);
    }
  };
}

export async function getPiCodingTools(): Promise<AgentTool[]> {
  if (loadedCodingTools) return loadedCodingTools;

  // Use injected module for testing, or dynamic import for production
  let m: any;
  if (piCodingAgentModule) {
    m = piCodingAgentModule;
  } else {
    // Use a Function to prevent TS from transpiling this into require()
    // Since the pi package is pure ESM (type: module, no require exports).
    const loader = new Function('return import("@mariozechner/pi-coding-agent")');
    m = await loader();
  }

  // Wrap write and edit executors with rollback tracking
  const writeExecutorWithTracking = (toolCallId: string, params: any) =>
    withRollbackTracking('write', params, m.writeTool.execute, toolCallId);
  const editExecutorWithTracking = (toolCallId: string, params: any) =>
    withRollbackTracking('edit', params, m.editTool.execute, toolCallId);

  loadedCodingTools = [
    adaptTool(m.readToolDefinition, withReadCache(m.readTool.execute)),
    adaptTool(m.writeToolDefinition, writeExecutorWithTracking),
    adaptTool(m.editToolDefinition, editExecutorWithTracking),
    adaptTool(m.findToolDefinition, m.findTool.execute),
    adaptTool(m.grepToolDefinition, m.grepTool.execute),
    adaptTool(m.lsToolDefinition, m.lsTool.execute),
    adaptTool(m.bashToolDefinition, m.bashTool.execute, 'executePwsh'),
  ];

  return loadedCodingTools;
}

// Export for testing - allows tests to reset the cache
export function resetPiCodingToolsCache() {
  loadedCodingTools = null;
  fileReadCache.clear();
}
