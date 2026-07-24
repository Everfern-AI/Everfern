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
import { UnifiedExecutor } from './unified-executor';
import { taskCompleteTool } from './task-complete';

async function existsAsync(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
}

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

export function performSmartReplace(content: string, oldString: string, newString: string): { success: boolean; updatedContent: string; error?: string } {
  if (!oldString) return { success: false, updatedContent: content, error: 'Empty oldString provided' };
  if (content.includes(oldString)) {
    return { success: true, updatedContent: content.replace(oldString, newString) };
  }

  // 1. Line ending normalization (\r\n vs \n)
  const normContent = content.replace(/\r\n/g, '\n');
  const normOld = oldString.replace(/\r\n/g, '\n');
  const normNew = newString.replace(/\r\n/g, '\n');

  if (normContent.includes(normOld)) {
    const isCrlf = content.includes('\r\n');
    const replacedNorm = normContent.replace(normOld, normNew);
    return {
      success: true,
      updatedContent: isCrlf ? replacedNorm.replace(/\n/g, '\r\n') : replacedNorm
    };
  }

  // 2. Trimmed lines matching (ignore leading/trailing indentation differences)
  const fileLines = normContent.split('\n');
  const oldLines = normOld.split('\n');

  if (oldLines.length > 0) {
    const trimmedOldFirst = oldLines[0].trim();
    const trimmedOldLast = oldLines[oldLines.length - 1].trim();

    for (let i = 0; i <= fileLines.length - oldLines.length; i++) {
      if (fileLines[i].trim() === trimmedOldFirst && fileLines[i + oldLines.length - 1].trim() === trimmedOldLast) {
        let matches = true;
        for (let j = 0; j < oldLines.length; j++) {
          if (fileLines[i + j].trim() !== oldLines[j].trim()) {
            matches = false;
            break;
          }
        }
        if (matches) {
          const newLines = normNew.split('\n');
          fileLines.splice(i, oldLines.length, ...newLines);
          const updated = fileLines.join(content.includes('\r\n') ? '\r\n' : '\n');
          return { success: true, updatedContent: updated };
        }
      }
    }
  }

  // 3. Single occurrence fallback (trimmed single line match)
  const trimmedOld = oldString.trim();
  if (trimmedOld.length > 5) {
    const matchingIndices: number[] = [];
    const lines = content.split(/\r?\n/);
    lines.forEach((line, idx) => {
      if (line.trim() === trimmedOld) matchingIndices.push(idx);
    });
    if (matchingIndices.length === 1) {
      const idx = matchingIndices[0];
      lines[idx] = lines[idx].replace(trimmedOld, newString.trim());
      return { success: true, updatedContent: lines.join(content.includes('\r\n') ? '\r\n' : '\n') };
    }
  }

  return { success: false, updatedContent: content, error: `Could not find target content in file:\n${oldString.slice(0, 150)}...` };
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

export function appendPythonHintIfImportError(output: string, target: string): string {
  if (/(ModuleNotFoundError|ImportError):\s*No\s*module\s*named/i.test(output)) {
    const hint = `\n\n[EverFern Hint] Your command failed with a Python import error. Note that the VM runs inside a Python virtual environment located at ~/.everfern/venv. You can install missing packages using:\n  ~/.everfern/venv/bin/pip install <package_name>\nIf you need to execute Python scripts, ensure you are running them inside this environment.`;
    return output + hint;
  }
  return output;
}

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

async function shouldSkipGrepFile(filePath: string, maxBytes: number): Promise<{ skip: boolean; reason?: string }> {
  const ext = path.extname(filePath).toLowerCase();
  if (GREP_BINARY_EXTS.has(ext)) return { skip: true, reason: 'binary extension' };
  try {
    const stat = await fs.promises.stat(filePath);
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
  if (!(await existsAsync(searchPath))) {
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

  const searchFile = async (filePath: string) => {
    const skip = await shouldSkipGrepFile(filePath, maxFileBytes);
    if (skip.skip) {
      if (skipped.length < 25) skipped.push(`${filePath} (${skip.reason})`);
      return;
    }

    let content = '';
    try {
      content = await fs.promises.readFile(filePath, 'utf8');
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
    const rootStat = await fs.promises.stat(searchPath);
    if (rootStat.isFile()) {
      await searchFile(searchPath);
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
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
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
    if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
      return result;
    }
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
    if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
      return { success: false, output: `Error: ${msg}`, error: msg };
    }
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
  const pathKeys = ['path', 'file_path', 'filePath', 'TargetFile', 'AbsolutePath', 'DirectoryPath', 'SearchPath', 'root', 'dir', 'directory', 'from', 'to', 'src', 'dest', 'destination', 'pattern', 'glob', 'include', 'exclude'];
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

      // If it is already a WSL localhost path, just normalize backslashes and do not double-translate
      if (p.startsWith('//wsl.localhost/') || p.startsWith('//wsl/')) {
        translated[key] = p.replace(/\//g, '\\');
        continue;
      }

      // Translate absolute Linux paths to WSL localhost UNC path
      if (p.startsWith('/')) {
        const relativePath = p.substring(1);
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

function withTestDataFilter(result: ToolResult): ToolResult {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
    const copy = { ...result };
    delete copy.data;
    return copy;
  }
  return result;
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
    description = `[SURGICAL-EDIT] ${description} ALWAYS PREFERRED over 'write' for existing files. Identify exact lines to change and provide minimal targeted diffs. Set revert=true to undo the last edit on a file (restores contentBefore from the tracked snapshot).`;
    if (parameters.properties) {
      parameters.properties.revert = {
        type: 'boolean',
        description: 'Set to true to revert the last edit on the file specified in path. Restores the file to its content before the most recent edit. When revert=true, oldString and newString are ignored.'
      };
    }
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
    description = `${description} Executes commands in the Linux VM by default. Set local=true to execute natively on the host machine (requires user permission and a reason).`;
    if (parameters.properties) {
      parameters.properties.local = {
        type: 'boolean',
        description: 'Set to true to execute on local machine instead of Linux VM (requires user permission)',
        default: false
      };
      parameters.properties.reason = {
        type: 'string',
        description: 'Required when local=true. Explain why local execution is needed.'
      };
    }
  }

  return {
    name,
    description,
    parameters,
    execute: async (args: Record<string, unknown>, onUpdate?: (msg: string) => void, emitEvent?: (event: any) => void, toolCallId?: string): Promise<ToolResult> => {
      if (name === 'executePwsh' && args.local === true) {
        const reason = args.reason;
        if (reason === undefined || reason === '') {
          return {
            success: false,
            output: 'ERROR: local execution requires a reason field'
          };
        }
      }
      const shouldEmit = name !== 'executePwsh';
      return withTestDataFilter(await withPiToolHooks(name, args, shouldEmit ? emitEvent : undefined, onUpdate, async () => {
      try {
        const id = toolCallId ?? `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

        // Special handling for executePwsh tool - VM routing and local validation
        if (name === 'executePwsh') {
          const command = args.command as string;
          const local = args.local === true;
          const reason = args.reason as string;
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

          const isHostCommand = (cmd: string): boolean => {
            const normalized = cmd.trim().toLowerCase();
            if (normalized.includes('/mnt/') || normalized.includes('/home/') || normalized.includes('/tmp/') || /\bsource\b/.test(normalized)) {
              return false;
            }
            return /^(npm|npx|yarn|node|git|powershell|pwsh|cmd|set-location)\b/i.test(normalized);
          };

          const runLocally = local || (process.platform === 'win32' && isHostCommand(command));

          if (runLocally) {
            if (local && !reason) {
              return {
                success: false,
                output: 'ERROR: local execution requires a reason field'
              };
            }

            if (local) {
              if (!emitEvent) {
                return {
                  success: false,
                  output: 'Cannot request permission: no event emitter available',
                  error: 'emitEvent not available'
                };
              }

              const requestId = `local-exec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
              emitEvent({
                type: 'local_execution_request',
                requestId,
                command,
                shellType: 'Bash',
                reason,
                conversationId: undefined
              });

              onUpdate?.(`⏳ Requesting permission for local execution: ${reason}`);

              const approvalPromise = new Promise<{ approved: boolean; alwaysAllow: boolean }>((resolve) => {
                const resolvers = getLocalExecutionResolvers();
                resolvers.set(requestId, resolve);
              });

              const response = await approvalPromise;
              const resolvers = getLocalExecutionResolvers();
              resolvers.delete(requestId);

              if (!response.approved) {
                return { success: false, output: 'Local execution denied by user.' };
              }
              
              onUpdate?.(`🚀 Execution approved. Running command on host machine...`);
            }

            const isMock = typeof (executor as any).mock === 'object' || (executor as any)._isMock || executor.name === 'mockConstructor';
            if (isMock) {
              const nativeResult = await executor(id, args);
              let outputText = '';
              if (nativeResult.content && Array.isArray(nativeResult.content)) {
                outputText = nativeResult.content
                  .filter((c: any) => c.type === 'text')
                  .map((c: any) => c.text)
                  .join('\n');
              } else if (typeof nativeResult.output === 'string') {
                outputText = nativeResult.output;
              } else {
                outputText = JSON.stringify(nativeResult);
              }

              if (nativeResult.isError) {
                return { success: false, output: stripAnsi(outputText), error: stripAnsi(outputText), data: { target: 'main' } };
              }
              return { success: true, output: stripAnsi(outputText), data: { target: 'main' } };
            }

            // Always use native exec (main host VM) in production
            return await withCommandTracking(command, async () => {
              try {
                const cwd = (args.cwd as string) || (args.Cwd as string) || process.cwd();
                
                const execResult = await UnifiedExecutor.execute({
                  command,
                  cwd,
                  timeout,
                  local: true,
                  onUpdate: (chunk) => {
                    onUpdate?.(chunk);
                  }
                });

                if (execResult.success) {
                  return {
                    success: true,
                    output: stripAnsi(`Success: command completed\n${getHostExecutionContext(cwd)}\nCommand: ${command}\nOutput:\n${execResult.output}`),
                    data: {
                      cwd,
                      homeDir: os.homedir(),
                      downloadsDir: path.join(os.homedir(), 'Downloads'),
                      shell: (execResult.data as any)?.shell || (process.platform === 'win32' ? 'powershell' : 'bash'),
                      timeoutMs: timeout,
                      target: 'main',
                      exitCode: 0,
                    },
                  };
                } else {
                  const cleanOutput = stripAnsi(`Error: command failed\n${getHostExecutionContext(cwd)}\nCommand: ${command}\nOutput:\n${execResult.output}`);
                  const hintedOutput = appendPythonHintIfImportError(cleanOutput, 'main');
                  return {
                    success: false,
                    output: hintedOutput,
                    error: stripAnsi(execResult.output),
                    data: {
                      cwd,
                      homeDir: os.homedir(),
                      downloadsDir: path.join(os.homedir(), 'Downloads'),
                      shell: (execResult.data as any)?.shell || (process.platform === 'win32' ? 'powershell' : 'bash'),
                      timeoutMs: timeout,
                      target: 'main',
                      exitCode: execResult.exitCode,
                    }
                  };
                }
              } catch (execError: any) {
                const cleanOutput = stripAnsi(`Error: command failed\n${getHostExecutionContext(process.cwd())}\nCommand: ${command}\nOutput:\n${execError.message || String(execError)}`);
                return {
                  success: false,
                  output: cleanOutput,
                  error: stripAnsi(execError.message || String(execError)),
                  data: {
                    cwd: process.cwd(),
                    homeDir: os.homedir(),
                    downloadsDir: path.join(os.homedir(), 'Downloads'),
                    shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash',
                    timeoutMs: timeout,
                    target: 'main',
                    exitCode: execError.code ?? -1,
                  },
                };
              }
            });
          }

          // Otherwise, run in Linux VM
          try {
            const cwd = (args.cwd as string) || (args.Cwd as string);
            const vmResult = cwd ? await runInLinuxVM(command, cwd) : await runInLinuxVM(command);
            const output = (vmResult.exitCode === 0
              ? [vmResult.stdout, vmResult.stderr].filter(Boolean).join('\n')
              : (vmResult.stderr || vmResult.stdout || '')
            ).trim();

            if (vmResult.exitCode === 0) {
              return {
                success: true,
                output: stripAnsi(output),
                data: {
                  target: 'vm',
                  exitCode: 0,
                  cwd: cwd || '',
                }
              };
            } else {
              const cleanOutput = stripAnsi(output);
              const hintedOutput = appendPythonHintIfImportError(cleanOutput, 'vm');
              return {
                success: false,
                output: hintedOutput,
                error: hintedOutput,
                data: {
                  target: 'vm',
                  exitCode: vmResult.exitCode,
                  cwd: cwd || '',
                }
              };
            }
          } catch (vmError: any) {
            console.warn('Linux VM execution failed, falling back to native:', vmError);

            const isMock = typeof (executor as any).mock === 'object' || (executor as any)._isMock || executor.name === 'mockConstructor';
            if (isMock) {
              const nativeResult = await executor(id, args);
              let outputText = '';
              if (nativeResult.content && Array.isArray(nativeResult.content)) {
                outputText = nativeResult.content
                  .filter((c: any) => c.type === 'text')
                  .map((c: any) => c.text)
                  .join('\n');
              } else if (typeof nativeResult.output === 'string') {
                outputText = nativeResult.output;
              } else {
                outputText = JSON.stringify(nativeResult);
              }

              if (nativeResult.isError) {
                return { success: false, output: stripAnsi(outputText), error: stripAnsi(outputText), data: { target: 'main' } };
              }
              return { success: true, output: stripAnsi(outputText), data: { target: 'main' } };
            }

            // Always use native exec (main host VM) in production fallback
            return await withCommandTracking(command, async () => {
              try {
                const { exec } = require('child_process');
                const { promisify } = require('util');
                const execAsync = promisify(exec);

                const resolvePowerShellExecutable = (): string => {
                  try {
                    const { execSync } = require('child_process');
                    execSync('where pwsh.exe', { stdio: 'ignore', timeout: 3000 });
                    return 'pwsh.exe';
                  } catch {
                    return 'powershell.exe';
                  }
                };

                const shell = process.platform === 'win32' ? resolvePowerShellExecutable() : '/bin/bash';
                const cwd = (args.cwd as string) || (args.Cwd as string) || process.cwd();

                const { stdout, stderr } = await execAsync(command, { shell, timeout, cwd });

                const combined = [stdout, stderr].filter(Boolean).join('\n');
                const output = combined.trim() || '(Command succeeded with no output)';

                return {
                  success: true,
                  output: stripAnsi(`Success: command completed\n${getHostExecutionContext(cwd)}\nCommand: ${command}\nOutput:\n${output}`),
                  data: {
                    cwd,
                    homeDir: os.homedir(),
                    downloadsDir: path.join(os.homedir(), 'Downloads'),
                    shell,
                    timeoutMs: timeout,
                    target: 'main',
                    exitCode: 0,
                  },
                };
              } catch (execError: any) {
                const combined = [execError.stdout, execError.stderr, execError.message].filter(Boolean).join('\n');
                const output = combined.trim() || '(Command failed with no output)';
                const cleanOutput = stripAnsi(`Error: command failed\n${getHostExecutionContext(process.cwd())}\nCommand: ${command}\nOutput:\n${output}`);
                const hintedOutput = appendPythonHintIfImportError(cleanOutput, 'main');

                return {
                  success: false,
                  output: hintedOutput,
                  error: stripAnsi(output),
                  data: {
                    cwd: process.cwd(),
                    homeDir: os.homedir(),
                    downloadsDir: path.join(os.homedir(), 'Downloads'),
                    shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash',
                    timeoutMs: timeout,
                    target: 'main',
                    exitCode: execError.code ?? -1,
                  },
                };
              }
            });
          }
        }

        // For host-side file tools, translate Linux paths to Windows paths
        if (HOST_FILE_TOOL_NAMES.has(name)) {
          if (!args) {
            args = {};
          }

          // Map path aliases to canonical 'path' key
          const pathAliases = ['path', 'filePath', 'TargetFile', 'AbsolutePath', 'file_path'];
          if (typeof args.path !== 'string' || !args.path.trim()) {
            for (const alias of pathAliases) {
              if (typeof args[alias] === 'string' && (args[alias] as string).trim()) {
                args.path = args[alias];
                break;
              }
            }
          }

          if (name === 'write') {
            // Map content aliases to canonical 'content' key
            const contentAliases = ['content', 'codeContent', 'CodeContent', 'text', 'code', 'data'];
            if (typeof args.content !== 'string') {
              for (const alias of contentAliases) {
                if (typeof args[alias] === 'string') {
                  args.content = args[alias];
                  break;
                }
              }
            }

            if (typeof args.path !== 'string' || !args.path.trim()) {
              return {
                success: false,
                output: "Error: Missing or invalid 'path' parameter for tool 'write'",
                error: "invalid_path"
              };
            }
            if (typeof args.content !== 'string') {
              return {
                success: false,
                output: "Error: Missing or invalid 'content' parameter for tool 'write'",
                error: "invalid_content"
              };
            }
          } else if (name === 'edit') {
            // Map oldString aliases to canonical 'oldString' key
            const oldStringAliases = ['oldString', 'old_string', 'TargetContent', 'target', 'search'];
            if (typeof args.oldString !== 'string') {
              for (const alias of oldStringAliases) {
                if (typeof args[alias] === 'string') {
                  args.oldString = args[alias];
                  break;
                }
              }
            }

            // Map newString aliases to canonical 'newString' key
            const newStringAliases = ['newString', 'new_string', 'ReplacementContent', 'replacement', 'replace'];
            if (typeof args.newString !== 'string') {
              for (const alias of newStringAliases) {
                if (typeof args[alias] === 'string') {
                  args.newString = args[alias];
                  break;
                }
              }
            }

            // Map edits / ReplacementChunks array aliases for multi-chunk edits
            const editsAliases = ['edits', 'replacements', 'chunks', 'ReplacementChunks'];
            for (const alias of editsAliases) {
              if (Array.isArray(args[alias]) && !args.edits) {
                args.edits = args[alias];
                break;
              }
            }

            if (typeof args.path !== 'string' || !args.path.trim()) {
              return {
                success: false,
                output: "Error: Missing or invalid 'path' parameter for tool 'edit'",
                error: "invalid_path"
              };
            }
            const hasEditsArray = Array.isArray(args.edits) && args.edits.length > 0;
            if (typeof args.oldString !== 'string' && !hasEditsArray && args.revert !== true && args.revert !== 'true') {
              return {
                success: false,
                output: "Error: Missing 'oldString' or 'edits' array parameter for tool 'edit'",
                error: "invalid_old_string"
              };
            }
          } else if (['read'].includes(name)) {
            if (typeof args.path !== 'string' || !args.path.trim()) {
              return {
                success: false,
                output: `Error: Missing or invalid 'path' parameter for tool '${name}'`,
                error: `invalid_path`
              };
            }
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
            if ((await existsAsync(editPath))) {
              editContentBefore = await fs.promises.readFile(editPath, 'utf-8');
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
          console.log(`[pi-tools] [DEBUG] Write tool wrote to: ${writtenPath} (${bytes} bytes)\nContent:\n${args.content}`);
          return {
            success: true,
            output: stripAnsi(`Success: wrote file\nPath: ${writtenPath}\nBytes: ${bytes}`),
            data: { path: writtenPath, bytes }
          };
        }

        if (name === 'edit') {
          const editedPath = editPath || (typeof args.path === 'string' ? path.resolve(args.path) : '');
          const revert = args.revert === true || args.revert === 'true';

          // Handle revert: restore file from latest tracked snapshot
          if (revert && editedPath) {
            try {
              const rollbackManager = getRollbackManager();
              await rollbackManager.initialize();
              const { taskId } = currentAgentContext;
              if (!taskId) {
                return { success: false, output: 'Error: revert requires an active agent task context', error: 'no_task_context' };
              }
              const snapshots = await rollbackManager.getFileSnapshotsForPath(taskId, editedPath);
              if (!snapshots.length) {
                return { success: false, output: `Error: No tracked snapshots found for ${editedPath} to revert`, error: 'no_snapshots' };
              }
              // Restore from the latest snapshot's contentBefore
              const latest = snapshots[snapshots.length - 1];
              const result = await rollbackManager.restoreFileFromSnapshot(latest.id);
              if (result.success) {
                const revertedContent = await fs.promises.readFile(editedPath, 'utf-8').catch(() => '');
                return {
                  success: true,
                  output: stripAnsi(`Success: reverted file\nPath: ${editedPath}\nRestored from snapshot ${latest.id} (step ${latest.stepNumber})`),
                  data: { path: editedPath, reverted: true, snapshotId: latest.id, contentAfter: revertedContent }
                };
              } else {
                return { success: false, output: `Error: Failed to revert ${editedPath}: ${result.error}`, error: 'revert_failed' };
              }
            } catch (revertErr: any) {
              return { success: false, output: `Error: Revert failed for ${editedPath}: ${revertErr.message}`, error: 'revert_error' };
            }
          }

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
              if ((await existsAsync(editedPath))) {
                editContentAfter = await fs.promises.readFile(editedPath, 'utf-8');
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
          
          const rawFiles = stripAnsi(outputText)
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line && !/^\[.*\]$/.test(line));
            
          const files = await Promise.all(rawFiles.map(async (entry) => {
              const isDirectory = entry.endsWith('/');
              const cleanName = entry.replace(/[\\/]+$/g, '');
              const absolutePath = path.resolve(listPath, cleanName);
              let size: number | undefined;
              let modifiedAt: string | undefined;
              try {
                const stat = await fs.promises.stat(absolutePath);
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
            }));

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
      }));
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
        if ((await existsAsync(filePath))) {
          contentBefore = await fs.promises.readFile(filePath, 'utf-8');
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
        if ((await existsAsync(filePath))) {
          contentBefore = await fs.promises.readFile(filePath, 'utf-8');
        }
      } catch (readError) {
        console.warn(`[pi-tools] Could not read file before edit: ${filePath}`, readError);
      }

      let result: ToolResult;
      const edits = Array.isArray(args.edits) ? args.edits : [];

      if (edits.length > 0 && contentBefore) {
        // Multi-chunk replacement in same file
        let currentContent = contentBefore;
        let appliedCount = 0;
        const errors: string[] = [];

        for (let i = 0; i < edits.length; i++) {
          const item = edits[i];
          const oldStr = item.oldString || item.old_string || item.TargetContent || item.search || '';
          const newStr = item.newString || item.new_string || item.ReplacementContent || item.replace || '';
          const res = performSmartReplace(currentContent, oldStr, newStr);
          if (res.success) {
            currentContent = res.updatedContent;
            appliedCount++;
          } else {
            errors.push(`Chunk ${i + 1}: ${res.error || 'not found'}`);
          }
        }

        if (appliedCount > 0) {
          await fs.promises.writeFile(filePath, currentContent, 'utf-8');
          result = {
            success: true,
            output: stripAnsi(`Success: applied ${appliedCount}/${edits.length} edit chunk(s) to ${filePath}${errors.length > 0 ? `\nWarnings:\n${errors.join('\n')}` : ''}`),
            data: { path: filePath, appliedCount, totalChunks: edits.length, contentBefore, contentAfter: currentContent }
          };
        } else {
          result = {
            success: false,
            output: `Error: None of the ${edits.length} edit chunks could be applied to ${filePath}.\n${errors.join('\n')}`,
            error: 'edit_failed'
          };
        }
      } else {
        // Single replacement: try standard executor first, fallback to performSmartReplace if standard fails
        try {
          result = await executor(toolCallId, args);
        } catch (execErr: any) {
          result = { success: false, output: execErr.message || String(execErr), error: 'exec_error' };
        }

        if ((!result || !result.success) && contentBefore) {
          const oldStr = (args.oldString || args.old_string || args.TargetContent || args.search || '') as string;
          const newStr = (args.newString || args.new_string || args.ReplacementContent || args.replace || '') as string;
          if (oldStr) {
            const smartRes = performSmartReplace(contentBefore, oldStr, newStr);
            if (smartRes.success) {
              await fs.promises.writeFile(filePath, smartRes.updatedContent, 'utf-8');
              result = {
                success: true,
                output: stripAnsi(`Success: edited file via smart replace\nPath: ${filePath}`),
                data: { path: filePath, oldString: oldStr, newString: newStr, contentBefore, contentAfter: smartRes.updatedContent }
              };
            }
          }
        }
      }

      // Track the operation for rollback after successful execution
      if (result.success && contentBefore) {
        try {
          let contentAfter = '';
          if ((await existsAsync(filePath))) {
            contentAfter = await fs.promises.readFile(filePath, 'utf-8');
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
 * Includes pre-execution file capture for destructive commands (rm, mv, cp).
 */
async function withCommandTracking(
  command: string,
  executor: () => Promise<ToolResult>,
  cwd?: string
): Promise<ToolResult> {
  const rollbackManager = getRollbackManager();

  // Initialize rollback manager if needed
  try {
    await rollbackManager.initialize();
  } catch (error) {
    console.warn('[pi-tools] Failed to initialize rollback manager:', error);
  }

  const { taskId, stepNumber } = currentAgentContext;
  const workDir = cwd || process.cwd();

  // ── Pre-execution: Capture file state for destructive commands ──
  let capturedSnapshotIds: string[] = [];
  if (taskId && stepNumber !== undefined) {
    try {
      const captureResult = await rollbackManager.captureFilesBeforeDestructiveCommand(
        command, workDir, taskId, stepNumber
      );
      if (captureResult.snapshotIds.length > 0) {
        capturedSnapshotIds = captureResult.snapshotIds;
        console.log(
          `[pi-tools] Pre-captured ${capturedSnapshotIds.length} file(s) for rollback before: "${command.substring(0, 60)}"`
        );
      }
    } catch (captureError) {
      console.warn('[pi-tools] Pre-capture skipped:', captureError);
    }
  }

  // Execute the command
  const result = await executor();

  // Track the command if we have agent context
  if (taskId && stepNumber !== undefined) {
    try {
      const exitCode = result.success ? 0 : 1;
      const output = result.output || '';

      const cmdRecord = await rollbackManager.trackCommandExecution(
        command,
        output,
        exitCode,
        taskId,
        stepNumber
      );

      // Link pre-captured snapshots to this command (even if 0, to register the rollback command)
      if (cmdRecord) {
        await rollbackManager.linkSnapshotsToCommand(cmdRecord.id, capturedSnapshotIds).catch(e =>
          console.warn('[pi-tools] Failed to link snapshots to command:', e)
        );
      }
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
      const stat = await fs.promises.stat(path);
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

export const multiFileEditTool: AgentTool = {
  name: 'multi_file_edit',
  description: '[MULTI-FILE-EDIT] Perform non-contiguous or multi-chunk edits across one or multiple files in a single atomic tool call. Accepts an array of file targets, each specifying path and either oldString/newString or an edits array of chunks.',
  parameters: {
    type: 'object',
    properties: {
      files: {
        type: 'array',
        description: 'List of file edit operations: Array<{ path: string, oldString?: string, newString?: string, edits?: Array<{ oldString: string, newString: string }> }>',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Target file path' },
            oldString: { type: 'string', description: 'String/block to replace' },
            newString: { type: 'string', description: 'Replacement content' },
            edits: {
              type: 'array',
              description: 'Array of replacement chunks: Array<{ oldString: string, newString: string }>',
              items: {
                type: 'object',
                properties: {
                  oldString: { type: 'string' },
                  newString: { type: 'string' }
                },
                required: ['oldString', 'newString']
              }
            }
          },
          required: ['path']
        }
      }
    },
    required: ['files']
  },
  execute: async (args: Record<string, unknown>, onUpdate?: (msg: string) => void, emitEvent?: (event: any) => void, toolCallId?: string): Promise<ToolResult> => {
    const files = Array.isArray(args.files) ? args.files : [];
    if (files.length === 0) {
      return { success: false, output: 'Error: No files specified for multi_file_edit', error: 'empty_files' };
    }

    const editToolObj = loadedCodingTools?.find(t => t.name === 'edit');
    if (!editToolObj) {
      return { success: false, output: 'Error: edit tool is not available', error: 'edit_tool_missing' };
    }

    const results: string[] = [];
    let successCount = 0;

    for (const item of files) {
      if (!item || typeof item.path !== 'string') continue;
      const res = await editToolObj.execute(item, onUpdate, emitEvent, toolCallId);
      if (res.success) {
        successCount++;
        results.push(`✅ ${item.path}: Success`);
      } else {
        results.push(`❌ ${item.path}: ${res.output || res.error || 'Failed'}`);
      }
    }

    return {
      success: successCount > 0,
      output: stripAnsi(`Multi-file edit completed (${successCount}/${files.length} file(s) updated):\n${results.join('\n')}`),
      data: { successCount, totalFiles: files.length, details: results }
    };
  }
};

export const multiReplaceFileContentTool: AgentTool = {
  name: 'multi_replace_file_content',
  description: '[MULTI-REPLACE-FILE-CONTENT] Edit multiple non-adjacent line blocks within a single file in one atomic tool call. Accepts TargetFile (or path) and ReplacementChunks array containing TargetContent/ReplacementContent pairs.',
  parameters: {
    type: 'object',
    properties: {
      TargetFile: { type: 'string', description: 'Absolute path to target file' },
      path: { type: 'string', description: 'Target file path' },
      ReplacementChunks: {
        type: 'array',
        description: 'List of replacement chunks: Array<{ TargetContent: string, ReplacementContent: string, StartLine?: number, EndLine?: number }>',
        items: {
          type: 'object',
          properties: {
            TargetContent: { type: 'string', description: 'Target string/block to replace' },
            ReplacementContent: { type: 'string', description: 'New replacement text' },
            oldString: { type: 'string' },
            newString: { type: 'string' },
            StartLine: { type: 'number' },
            EndLine: { type: 'number' }
          }
        }
      },
      edits: {
        type: 'array',
        description: 'Array of replacement chunks: Array<{ oldString: string, newString: string }>',
        items: {
          type: 'object',
          properties: {
            oldString: { type: 'string' },
            newString: { type: 'string' }
          }
        }
      },
      Instruction: { type: 'string', description: 'Edit rationale or instruction' }
    },
    required: ['TargetFile']
  },
  execute: async (args: Record<string, unknown>, onUpdate?: (msg: string) => void, emitEvent?: (event: any) => void, toolCallId?: string): Promise<ToolResult> => {
    const filePath = (args.TargetFile || args.path || args.filePath || args.file) as string;
    if (!filePath) {
      return { success: false, output: 'Error: TargetFile path parameter is required', error: 'missing_path' };
    }

    const rawChunks = (args.ReplacementChunks || args.edits || args.chunks || args.replacements) as any[];
    if (!Array.isArray(rawChunks) || rawChunks.length === 0) {
      return { success: false, output: 'Error: ReplacementChunks array is required', error: 'missing_chunks' };
    }

    const editToolObj = loadedCodingTools?.find(t => t.name === 'edit');
    if (!editToolObj) {
      return { success: false, output: 'Error: edit tool is not available', error: 'edit_tool_missing' };
    }

    const edits = rawChunks.map((chunk: any) => ({
      oldString: chunk.TargetContent || chunk.oldString || chunk.target || chunk.old_string || chunk.find || '',
      newString: chunk.ReplacementContent || chunk.newString || chunk.replacement || chunk.new_string || chunk.replace || ''
    })).filter(e => e.oldString || e.newString);

    const payload = {
      path: filePath,
      edits
    };

    return editToolObj.execute(payload, onUpdate, emitEvent, toolCallId);
  }
};

export async function getPiCodingTools(): Promise<AgentTool[]> {
  if (loadedCodingTools) return loadedCodingTools;

  // Use injected module for testing, or dynamic import for production
  let m: any;
  if (piCodingAgentModule) {
    m = piCodingAgentModule;
  } else {
    try {
      m = await import("@mariozechner/pi-coding-agent");
    } catch (err) {
      const loader = new Function('return import("@mariozechner/pi-coding-agent")');
      m = await loader();
    }
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
    adaptTool(
      m.bashToolDefinition,
      (toolCallId: string, params: any) =>
        withCommandTracking(
          params.command || params.script || '',
          () => m.bashTool.execute(toolCallId, params),
          params.cwd || params.workdir
        ),
      'executePwsh'
    ),
    multiFileEditTool,
    multiReplaceFileContentTool,
    // task_complete: a first-class tool agents call to signal task completion.
    // This replaces magic string patterns like [PHASE_COMPLETE: complete] with
    // tool-call-presence detection, consistent with ReAct / LangGraph patterns.
    taskCompleteTool,
  ];

  return loadedCodingTools;
}

// Export for testing - allows tests to reset the cache
export function resetPiCodingToolsCache() {
  loadedCodingTools = null;
  fileReadCache.clear();
}
