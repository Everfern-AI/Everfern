import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface WorkspaceProjection {
  gitStatus: string;
  activeDependencies: string;
  environmentInfo: string;
}

/**
 * Dynamic Workspace State Projection (DWSP)
 * 
 * A pioneering Context Engineering subsystem that automatically analyzes the developer's
 * active workspace, tracks uncommitted Git modifications, parses file import/dependency trees
 * on-the-fly, and projects a cohesive architectural context directly into the agent's mind.
 */
export async function getWorkspaceProjection(workspaceDir: string, activeFiles: string[]): Promise<WorkspaceProjection> {
  // 1. Get Git Status & uncommitted diff summaries
  let gitStatus = 'No active Git repository detected or git is not installed.';
  try {
    const { stdout } = await execAsync('git status --porcelain', { cwd: workspaceDir, timeout: 2000 });
    if (stdout.trim()) {
      gitStatus = stdout
        .trim()
        .split('\n')
        .map(line => {
          const status = line.slice(0, 2).trim();
          const file = line.slice(3).trim();
          return `- \`${file}\` [Status: ${status}]`;
        })
        .join('\n');
    } else {
      gitStatus = 'Workspace is clean (no uncommitted Git modifications).';
    }
  } catch (err) {
    // Fail silently
  }

  // 2. Build code dependency graph for active files on the fly
  let activeDependencies = 'No active file dependencies mapped.';
  if (activeFiles.length > 0) {
    try {
      const depMap: Record<string, string[]> = {};
      for (const file of activeFiles) {
        // Resolve absolute or workspace-relative path
        const fullPath = path.isAbsolute(file) ? file : path.resolve(workspaceDir, file);
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
          const content = await fs.promises.readFile(fullPath, 'utf-8');
          const imports: string[] = [];
          
          // Parse common import patterns (TS/JS ES6 & CommonJS, plus Python imports)
          const tsImportRegex = /from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]/g;
          let match;
          while ((match = tsImportRegex.exec(content)) !== null) {
            const dep = match[1] || match[2];
            if (dep && (dep.startsWith('.') || dep.startsWith('@/'))) {
              imports.push(dep);
            }
          }

          // Parse Python imports
          const pyImportRegex = /^\s*(?:import\s+([a-zA-Z0-9_., ]+)|from\s+([a-zA-Z0-9_.]+)\s+import)/gm;
          let pyMatch;
          while ((pyMatch = pyImportRegex.exec(content)) !== null) {
            const dep = pyMatch[1] || pyMatch[2];
            if (dep) {
              const parts = dep.split(',').map(p => p.trim());
              for (const part of parts) {
                if (part) imports.push(part);
              }
            }
          }

          if (imports.length > 0) {
            depMap[path.basename(file)] = Array.from(new Set(imports)).slice(0, 10); // Limit to top 10 to preserve tokens
          }
        }
      }

      if (Object.keys(depMap).length > 0) {
        activeDependencies = Object.entries(depMap)
          .map(([file, deps]) => `- \`${file}\` dependencies:\n${deps.map(d => `  - \`${d}\``).join('\n')}`)
          .join('\n');
      }
    } catch (err) {
      // Fail silently
    }
  }

  // 3. Environment info
  const environmentInfo = `- **Node Version**: ${process.version}\n- **Platform**: ${process.platform}\n- **Root Path**: \`${workspaceDir.replace(/\\/g, '/')}\``;

  return {
    gitStatus,
    activeDependencies,
    environmentInfo
  };
}

/**
 * Parses conversation history to extract unique files referenced in tool arguments.
 */
export function getActiveFilesFromHistory(history: any[]): string[] {
  const filePaths = new Set<string>();
  const pathKeys = ['path', 'filePath', 'file_path', 'src', 'dest', 'TargetFile'];
  
  for (const record of history) {
    const args = record.args || record.arguments;
    if (args) {
      for (const key of pathKeys) {
        const val = args[key];
        if (typeof val === 'string' && val.includes('.') && !val.includes('node_modules')) {
          filePaths.add(val);
        }
      }
    }
  }
  return Array.from(filePaths).slice(0, 10); // Limit to top 10 active files to conserve context budget
}
