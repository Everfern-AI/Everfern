/**
 * Dependency Detector Tool
 *
 * Detects and classifies dependencies from JavaScript/TypeScript and Python source files.
 * Classifies imports as: built-in (Node.js/Python standard library),
 * external (npm/PyPI packages), or local (project files)
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { parse } from '@babel/parser';
import type { Program, ImportDeclaration, ExportNamedDeclaration, CallExpression } from '@babel/types';

export interface DetectedImport {
  module: string;
  type: 'import' | 'require' | 'dynamic-import';
  isDefault: boolean;
  specifiers?: string[];
  filePath: string;
  lineNumber: number;
}

export interface ClassifiedDependency {
  module: string;
  classification: 'builtin' | 'external' | 'local';
  type: 'javascript' | 'python';
  imports: DetectedImport[];
  suggestedVersion?: string;
}

export interface DetectionResult {
  projectRoot: string;
  language: 'javascript' | 'python' | 'mixed';
  detectedImports: DetectedImport[];
  classified: ClassifiedDependency[];
  summary: {
    builtinCount: number;
    externalCount: number;
    localCount: number;
    missingFromPackageJson?: string[];
  };
}

// Node.js built-in modules
const NODE_BUILTINS = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console',
  'crypto', 'dgram', 'diagnostics_channel', 'dns', 'dns/promises', 'domain',
  'events', 'fs', 'fs/promises', 'globals', 'http', 'http2', 'https',
  'inspector', 'inspector/promises', 'internal', 'intl', 'module', 'net',
  'os', 'path', 'perf_hooks', 'performance', 'process', 'punycode', 'querystring',
  'readline', 'readline/promises', 'repl', 'stream', 'stream/consumers',
  'stream/promises', 'stream/web', 'string_decoder', 'sys', 'test', 'timers',
  'timers/promises', 'tls', 'trace_events', 'tty', 'url', 'util', 'v8',
  'vm', 'wasi', 'worker_threads', 'zlib',
  // Common external packages
  'react', 'react-dom', 'next', 'vue', 'express', 'fastify', 'axios', 'lodash',
]);

// Python standard library modules (common ones)
const PYTHON_BUILTINS = new Set([
  'abc', 'aifc', 'argparse', 'array', 'ast', 'asyncio', 'atexit', 'audioop',
  'base64', 'bdb', 'binascii', 'binhex', 'bisect', 'builtins', 'bz2',
  'calendar', 'cgi', 'cgitb', 'chunk', 'cmath', 'cmd', 'code', 'codecs',
  'codeop', 'collections', 'colorsys', 'compileall', 'concurrent', 'configparser',
  'contextlib', 'contextvars', 'copy', 'copyreg', 'cProfile', 'crypt', 'csv',
  'ctypes', 'curses', 'dataclasses', 'datetime', 'dbm', 'decimal', 'difflib',
  'dis', 'distutils', 'doctest', 'dummy_thread', 'dummy_threading', 'email',
  'encodings', 'enum', 'errno', 'faulthandler', 'fcntl', 'filecmp', 'fileinput',
  'fnmatch', 'fractions', 'ftplib', 'functools', 'gc', 'getopt', 'getpass',
  'gettext', 'glob', 'grp', 'gzip', 'hashlib', 'heapq', 'hmac', 'html', 'http',
  'idlelib', 'imaplib', 'imghdr', 'imp', 'importlib', 'inspect', 'io', 'ipaddress',
  'itertools', 'json', 'keyword', 'lib2to3', 'linecache', 'locale', 'logging',
  'lzma', 'mailbox', 'mailcap', 'marshal', 'math', 'mimetypes', 'mmap',
  'modulefinder', 'msilib', 'msvcrt', 'multiprocessing', 'netrc', 'nis', 'nntplib',
  'numbers', 'operator', 'optparse', 'os', 'ossaudiodev', 'parser', 'pathlib',
  'pdb', 'pickle', 'pickletools', 'pipes', 'pkgutil', 'platform', 'plistlib',
  'poplib', 'posix', 'posixpath', 'pprint', 'profile', 'pstats', 'pty', 'pwd',
  'py_compile', 'pyclbr', 'pydoc', 'queue', 'quopri', 'random', 're', 'readline',
  'reprlib', 'resource', 'rlcompleter', 'runpy', 'sched', 'secrets', 'select',
  'selectors', 'shelve', 'shlex', 'shutil', 'signal', 'site', 'smtpd', 'smtplib',
  'sndhdr', 'socket', 'socketserver', 'spwd', 'sqlite3', 'ssl', 'stat', 'statistics',
  'string', 'stringprep', 'struct', 'subprocess', 'sunau', 'symbol', 'symtable',
  'sys', 'sysconfig', 'syslog', 'tabnanny', 'tarfile', 'telnetlib', 'tempfile',
  'termios', 'test', 'textwrap', 'threading', 'time', 'timeit', 'tkinter', 'token',
  'tokenize', 'trace', 'traceback', 'tracemalloc', 'types', 'typing', 'typing_extensions',
  'unicodedata', 'unittest', 'urllib', 'uu', 'uuid', 'venv', 'warnings', 'wave',
  'weakref', 'webbrowser', 'wsgiref', 'xdrlib', 'xml', 'xmlrpc', 'zipapp', 'zipfile',
  'zipimport', 'zlib', '__future__', '__main__',
  // Common framework/lib modules
  'django', 'flask', 'fastapi', 'pydantic', 'numpy', 'pandas', 'requests',
]);

/**
 * Extract imports from a JavaScript/TypeScript file using Babel parser
 */
export async function extractJavaScriptImports(filePath: string): Promise<DetectedImport[]> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');

    // Parse the file
    const parseResult = parse(content, {
      sourceType: 'module',
      allowImportExportEverywhere: true,
      allowReturnOutsideFunction: true,
      plugins: [
        'jsx',
        'typescript',
        'decorators-legacy',
        'classProperties',
        'classPrivateProperties',
        'classPrivateMethods',
        'logicalAssignment',
        'partialApplication',
        'pipelineOperator',
        'nullishCoalescingOperator',
        'optionalChaining',
        'optionalCatchBinding',
        'asyncGenerators',
        'topLevelAwait',
        'moduleStringNames',
        'dynamicImport',
      ],
    });

    const imports: DetectedImport[] = [];
    let lineNumber = 1;

    // Visit all statements in the AST
    parseResult.program.body.forEach((node: any) => {
      if (node.type === 'ImportDeclaration') {
        const importNode = node;
        const specifiers = importNode.specifiers.map((spec: any) => {
          if (spec.type === 'ImportDefaultSpecifier') return 'default';
          if (spec.type === 'ImportNamespaceSpecifier') return '*';
          if (spec.type === 'ImportSpecifier') return spec.imported.name || spec.imported.value;
          return '';
        }).filter(Boolean);

        imports.push({
          module: importNode.source.value,
          type: 'import',
          isDefault: importNode.specifiers.some((s: any) => s.type === 'ImportDefaultSpecifier'),
          specifiers,
          filePath,
          lineNumber: importNode.loc?.start.line || lineNumber,
        });
      }

      // Handle export statements that re-export
      if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') {
        const exportNode = node as ExportNamedDeclaration;
        if (exportNode.source) {
          imports.push({
            module: exportNode.source.value,
            type: 'import',
            isDefault: false,
            filePath,
            lineNumber: exportNode.loc?.start.line || lineNumber,
          });
        }
      }

      // Handle require() calls
      if (node.type === 'VariableDeclaration') {
        node.declarations.forEach((decl: any) => {
          if (decl.init && decl.init.type === 'CallExpression') {
            const call = decl.init;
            if (call.callee.type === 'Identifier' && call.callee.name === 'require' && call.arguments.length > 0) {
              const arg = call.arguments[0];
              if (arg.type === 'StringLiteral') {
                const moduleName = arg.value;
                imports.push({
                  module: moduleName as string,
                  type: 'require',
                  isDefault: true,
                  filePath,
                  lineNumber: call.loc?.start.line || lineNumber,
                });
              }
            }
          }
        });
      }
    });

    return imports;
  } catch (error) {
    console.warn(`Failed to parse JavaScript file ${filePath}:`, error);
    return [];
  }
}

/**
 * Extract imports from a Python file
 */
export async function extractPythonImports(filePath: string): Promise<DetectedImport[]> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const imports: DetectedImport[] = [];

    const lines = content.split('\n');

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      const lineNumber = index + 1;

      // Skip comments and empty lines
      if (trimmed.startsWith('#') || trimmed.length === 0) return;

      // Handle: import module_name
      const simpleImportMatch = trimmed.match(/^import\s+([a-zA-Z0-9_.]+(?:\s+as\s+\w+)?)/);
      if (simpleImportMatch) {
        const parts = simpleImportMatch[1].split(/\s+as\s+/);
        imports.push({
          module: parts[0].split('.')[0], // Get root module
          type: 'import',
          isDefault: true,
          filePath,
          lineNumber,
        });
      }

      // Handle: import module1, module2, ...
      const multiImportMatch = trimmed.match(/^import\s+(.+?)(?:\s*#|$)/);
      if (multiImportMatch && !trimmed.includes('from')) {
        const modules = multiImportMatch[1].split(',').map(m => m.trim());
        modules.forEach(mod => {
          const parts = mod.split(/\s+as\s+/);
          if (parts[0]) {
            imports.push({
              module: parts[0].split('.')[0],
              type: 'import',
              isDefault: true,
              filePath,
              lineNumber,
            });
          }
        });
      }

      // Handle: from module import name
      const fromImportMatch = trimmed.match(/^from\s+([a-zA-Z0-9_.]+)\s+import\s+(.+?)(?:\s*#|$)/);
      if (fromImportMatch) {
        const moduleName = fromImportMatch[1].split('.')[0]; // Get root module
        const specifiers = fromImportMatch[2].split(',').map(s => s.trim().split(/\s+as\s+/)[0]);

        imports.push({
          module: moduleName,
          type: 'import',
          isDefault: false,
          specifiers: specifiers.filter(s => s !== '*'),
          filePath,
          lineNumber,
        });
      }

      // Handle: from . import (relative imports)
      const relativeImportMatch = trimmed.match(/^from\s+(\.+)(?:([a-zA-Z0-9_.]*))?\s+import/);
      if (relativeImportMatch) {
        // Relative imports are local, skip
        return;
      }
    });

    return imports;
  } catch (error) {
    console.warn(`Failed to parse Python file ${filePath}:`, error);
    return [];
  }
}

/**
 * Classify a dependency as built-in, external, or local
 */
export function classifyDependency(
  moduleName: string,
  language: 'javascript' | 'python',
  existingPackages?: Set<string>
): 'builtin' | 'external' | 'local' {
  // Get the root module name (e.g., 'lodash' from 'lodash/fp')
  const rootModule = moduleName.split('/')[0].split('.')[0];

  if (language === 'javascript') {
    // Check for relative imports (starts with . or ../)
    if (moduleName.startsWith('.')) {
      return 'local';
    }

    // Check against Node.js builtins
    if (NODE_BUILTINS.has(rootModule)) {
      return 'builtin';
    }

    // Check if it's in package.json
    if (existingPackages?.has(rootModule)) {
      return 'external';
    }

    // Default to external (likely npm package)
    return 'external';
  } else if (language === 'python') {
    // Check for relative imports
    if (moduleName.startsWith('.')) {
      return 'local';
    }

    // Check against Python stdlib
    if (PYTHON_BUILTINS.has(rootModule)) {
      return 'builtin';
    }

    // Check if it's in requirements.txt or setup.py
    if (existingPackages?.has(rootModule)) {
      return 'external';
    }

    // Default to external (likely PyPI package)
    return 'external';
  }

  return 'external';
}

/**
 * Scan a directory for JavaScript/TypeScript files
 */
export async function findSourceFiles(
  projectRoot: string,
  language?: 'javascript' | 'python'
): Promise<string[]> {
  const files: string[] = [];

  async function scanDir(dir: string) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        // Skip node_modules, .git, venv, etc.
        if (['node_modules', '.git', 'dist', 'build', 'venv', '.venv', '__pycache__', '.next'].includes(entry.name)) {
          continue;
        }

        if (entry.isDirectory()) {
          await scanDir(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);

          if (!language || language === 'javascript') {
            if (['.js', '.ts', '.jsx', '.tsx', '.mjs'].includes(ext)) {
              files.push(fullPath);
            }
          }

          if (!language || language === 'python') {
            if (ext === '.py') {
              files.push(fullPath);
            }
          }
        }
      }
    } catch (error) {
      console.warn(`Failed to scan directory ${dir}:`, error);
    }
  }

  await scanDir(projectRoot);
  return files;
}

/**
 * Read existing dependencies from package.json or requirements.txt
 */
export async function readExistingDependencies(projectRoot: string): Promise<{
  javascript?: Set<string>;
  python?: Set<string>;
}> {
  const result: { javascript?: Set<string>; python?: Set<string> } = {};

  // Read package.json
  try {
    const packageJsonPath = path.join(projectRoot, 'package.json');
    const content = await fs.readFile(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(content);

    const deps = new Set<string>();
    const { dependencies = {}, devDependencies = {}, peerDependencies = {} } = packageJson;

    Object.keys(dependencies).forEach(dep => deps.add(dep));
    Object.keys(devDependencies).forEach(dep => deps.add(dep));
    Object.keys(peerDependencies).forEach(dep => deps.add(dep));

    result.javascript = deps;
  } catch {
    // package.json not found or invalid
  }

  // Read requirements.txt
  try {
    const requirementsPath = path.join(projectRoot, 'requirements.txt');
    const content = await fs.readFile(requirementsPath, 'utf-8');

    const deps = new Set<string>();
    content.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        // Extract package name (before ==, >=, <=, etc.)
        const pkgName = trimmed.split(/[<>=!]/)[0].trim().split('[')[0];
        if (pkgName) deps.add(pkgName);
      }
    });

    result.python = deps;
  } catch {
    // requirements.txt not found or invalid
  }

  return result;
}

/**
 * Main detection function
 */
export async function detectDependencies(projectRoot: string): Promise<DetectionResult> {
  // Read existing dependencies
  const existingDeps = await readExistingDependencies(projectRoot);

  // Find source files
  const jsFiles = await findSourceFiles(projectRoot, 'javascript');
  const pyFiles = await findSourceFiles(projectRoot, 'python');

  // Determine language
  let language: 'javascript' | 'python' | 'mixed' = 'javascript';
  if (jsFiles.length === 0 && pyFiles.length > 0) {
    language = 'python';
  } else if (jsFiles.length > 0 && pyFiles.length > 0) {
    language = 'mixed';
  }

  // Extract all imports
  const allImports: DetectedImport[] = [];

  for (const file of jsFiles) {
    const imports = await extractJavaScriptImports(file);
    allImports.push(...imports);
  }

  for (const file of pyFiles) {
    const imports = await extractPythonImports(file);
    allImports.push(...imports);
  }

  // Classify dependencies
  const classifiedMap = new Map<string, ClassifiedDependency>();

  allImports.forEach(imp => {
    const lang = imp.filePath.endsWith('.py') ? 'python' : 'javascript';
    const classification = classifyDependency(imp.module, lang, lang === 'javascript' ? existingDeps.javascript : existingDeps.python);

    const key = `${imp.module}-${lang}`;
    if (!classifiedMap.has(key)) {
      classifiedMap.set(key, {
        module: imp.module,
        classification,
        type: lang,
        imports: [],
      });
    }

    classifiedMap.get(key)!.imports.push(imp);
  });

  const classified = Array.from(classifiedMap.values());

  // Calculate summary
  const summary = {
    builtinCount: classified.filter(d => d.classification === 'builtin').length,
    externalCount: classified.filter(d => d.classification === 'external').length,
    localCount: classified.filter(d => d.classification === 'local').length,
  };

  // Find missing packages
  const missingFromPackageJson = classified
    .filter(d => d.classification === 'external' && d.type === 'javascript' && !existingDeps.javascript?.has(d.module))
    .map(d => d.module);

  return {
    projectRoot,
    language,
    detectedImports: allImports,
    classified,
    summary: {
      ...summary,
      missingFromPackageJson: missingFromPackageJson.length > 0 ? missingFromPackageJson : undefined,
    },
  };
}
