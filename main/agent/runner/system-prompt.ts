import * as fs from 'fs';
import * as path from 'path';
import { homedir as osHomedir, userInfo as osUserInfo } from 'os';
import { loadSkills, loadSkillsAsync, formatSkillsForPrompt } from './skills-loader';
import { projectsStore } from '../../store/projects/projects';
import { integrationService } from '../../integrations/integration-service';

/**
 * Converts a host path to the corresponding Linux VM path.
 * - Windows: C:/Users/... → /mnt/c/Users/...
 * - macOS:   /Users/...   → /host/Users/... (mounted Docker volume)
 * - Linux:   pass-through (already native)
 */
function hostPathToLinux(hostPath: string): string {
  const p = hostPath.replace(/\\/g, '/');
  const driveMatch = p.match(/^([A-Za-z]):(\/.*)?$/);
  if (driveMatch) {
    const drive = driveMatch[1].toLowerCase();
    const rest = driveMatch[2] || '';
    return `/mnt/${drive}${rest}`;
  }
  if (process.platform === 'darwin' && p.startsWith('/Users/')) {
    return p.replace('/Users/', '/host/Users/');
  }
  return p;
}

// ─────────────────────────────────────────────
// SYSTEM PROMPT CACHING
// ─────────────────────────────────────────────

interface CachedPrompt {
  prompt: string;
  timestamp: number;
  cacheKey: string;
}

class SystemPromptCache {
  private cache = new Map<string, CachedPrompt>();
  private maxAge = 300000; // 5 minutes
  private maxSize = 50;

  private generateCacheKey(
    platform: string,
    conversationId: string | undefined,
    sessionCreatedPaths: string[]
  ): string {
    const safeConvId = conversationId || 'current';
    // Create cache key based on parameters that affect prompt content
    const pathsHash = sessionCreatedPaths.join(',');
    return `${platform}:${safeConvId}:${pathsHash.length}`;
  }

  get(
    platform: string,
    conversationId: string | undefined,
    sessionCreatedPaths: string[]
  ): string | null {
    const key = this.generateCacheKey(platform, conversationId, sessionCreatedPaths);
    const cached = this.cache.get(key);
    
    if (!cached) return null;
    
    // Check if cache entry is still valid
    if (Date.now() - cached.timestamp > this.maxAge) {
      this.cache.delete(key);
      return null;
    }
    
    return cached.prompt;
  }

  set(
    platform: string,
    conversationId: string | undefined,
    sessionCreatedPaths: string[],
    prompt: string
  ): void {
    const key = this.generateCacheKey(platform, conversationId, sessionCreatedPaths);
    
    // Clean up old entries if cache is full
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }
    
    this.cache.set(key, {
      prompt,
      timestamp: Date.now(),
      cacheKey: key
    });
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.maxAge) {
        this.cache.delete(key);
      }
    }
  }
}

const promptCache = new SystemPromptCache();

// Cleanup cache every 2 minutes
setInterval(() => promptCache.cleanup(), 120000);

// ─────────────────────────────────────────────
// ASSEMBLY
// ─────────────────────────────────────────────

/**
 * Load and assemble system prompt asynchronously using fs.promises for non-blocking I/O
 * This function should be used before graph building to avoid blocking the event loop
 * 
 * @param platform - Operating system platform
 * @param conversationId - Conversation ID
 * @param sessionCreatedPaths - Session created paths
 * @param preloadedSkills - Optional pre-loaded skills to avoid loading them again
 */
export async function getSlimSystemPromptAsync(
  platform: string = 'win32', 
  conversationId?: string, 
  sessionCreatedPaths: string[] = [],
  preloadedSkills?: any[],
  projectId?: string
): Promise<string> {
  const safeConvId = conversationId && typeof conversationId === 'string' ? conversationId : 'current';
  
  const homedir = osHomedir();
  const homedirNorm = homedir.replace(/\\/g, '/');
  const linuxHome = hostPathToLinux(homedirNorm);
  const user = osUserInfo();

  // All paths are Linux VM paths — the AI uses these in all tool calls
  const planPath = `${linuxHome}/.everfern/chat/plan/${safeConvId}/`;
  const artifactPath = `${linuxHome}/.everfern/artifacts/${safeConvId}/`;
  const execPath = `${linuxHome}/.everfern/exec/${safeConvId}/`;
  const sitePath = `${linuxHome}/.everfern/sites/${safeConvId}/`;
  const uploadsPath = `${linuxHome}/.everfern/attachments/`;

  // Read the Markdown file asynchronously
  let promptMd = '';
  const searchPaths = [
    path.join(homedir, '.everfern', 'prompts', 'SYSTEM_PROMPT.md'),
    path.join(homedir, '.everfern', 'SYSTEM_PROMPT.md'),
    path.join(__dirname, 'prompts', 'SYSTEM_PROMPT.md'),
    path.join(__dirname, '..', '..', 'main', 'agent', 'prompts', 'SYSTEM_PROMPT.md'), // Fallback from dist-electron
    path.join(process.cwd(), 'main', 'agent', 'prompts', 'SYSTEM_PROMPT.md'),
    path.join(process.cwd(), 'apps', 'desktop', 'main', 'agent', 'prompts', 'SYSTEM_PROMPT.md')
  ];

  for (const mdPath of searchPaths) {
    try {
      // Use async access to check if file exists
      await fs.promises.access(mdPath);
      promptMd = await fs.promises.readFile(mdPath, 'utf8');
      console.log(`[SystemPrompt] ✅ Successfully loaded prompt asynchronously from: ${mdPath}`);
      break;
    } catch (err) {
      // Continue to next path
    }
  }

  if (!promptMd) {
    console.error('[SystemPrompt] ❌ Failed to read SYSTEM_PROMPT.md from any search path.');
    promptMd = '# EverFern System Prompt\n(Error loading full prompt file - check logs)';
  }

  // OS Info
  const osInfo =
    platform === 'win32'
      ? '**OS**: Windows (host).\n- **target: "main" (Default)**: Executes commands on the Windows host using PowerShell (pwsh.exe or powershell.exe). You MUST use Windows PowerShell syntax (do NOT use Linux commands like "ls -la", use PowerShell syntax and backslash paths like "C:\\Users\\...").\n- **target: "vm"**: Executes commands inside the Linux VM (WSL running Bash). You MUST use Linux Bash syntax (use Linux commands like "ls -la" and paths like "/mnt/c/Users/...").'
      : platform === 'darwin'
        ? '**OS**: macOS (host).\n- **target: "main" (Default)**: Executes commands on the macOS host using Bash/Zsh.\n- **target: "vm"**: Executes commands inside the Docker Linux VM running Bash (uses "/host/Users/..." paths).'
        : '**OS**: Linux. All commands execute natively using Bash.';
  console.log(`[SystemPrompt] OS info string: platform=${platform}, osInfo="${osInfo.slice(0, 120)}..."`);

  // Session File Registry
  const sessionRegistry = sessionCreatedPaths.length > 0
    ? sessionCreatedPaths.map(p => `- \`${p}\``).join('\n')
    : '_No files created in this session memory yet._';

  // Skills - use pre-loaded skills if provided, otherwise load asynchronously
  const skills = preloadedSkills || await loadSkillsAsync();
  const skillsTable = formatSkillsForPrompt(skills);
  const pluginsTable = '_All skills are loaded dynamically above._';

  // State Context
  const workspaceMounted = 'false';

  // Project context - lookup before replacements for {{PROJECT_PATH}} injection
  const targetProjectId = projectId || conversationId;
  let projectPath = '';
  let activeProject: any = null;
  if (targetProjectId) {
    activeProject = await projectsStore.get(targetProjectId);
    if (activeProject) {
      projectPath = hostPathToLinux(activeProject.path.replace(/\\/g, '/'));
    }
  }

  // Replace placeholders — all paths are Linux paths
  let finalPrompt = promptMd
    .replace(/{{OS_INFO}}/g, osInfo)
    .replace(/{{HOME_DIR}}/g, linuxHome)
    .replace(/{{SESSION_ID}}/g, safeConvId)
    .replace(/{{PLAN_PATH}}/g, planPath)
    .replace(/{{EXEC_PATH}}/g, execPath)
    .replace(/{{ARTIFACT_PATH}}/g, artifactPath)
    .replace(/{{SITE_PATH}}/g, sitePath)
    .replace(/{{UPLOADS_PATH}}/g, uploadsPath)
    .replace(/{{PROJECT_PATH}}/g, projectPath || execPath)
    .replace(/{{SESSION_FILES}}/g, sessionRegistry)
    .replace(/{{SKILLS}}/g, skillsTable)
    .replace(/{{PLUGIN_SKILLS}}/g, pluginsTable)
    .replace(/{{CURRENT_DATE}}/g, new Date().toISOString().split('T')[0])
    .replace(/{{WORKSPACE_MOUNTED}}/g, workspaceMounted)
    .replace(/{{USER_NAME}}/g, user.username)
    .replace(/{{USER_EMAIL}}/g, 'noreply@everfern.app')
    .replace(/{{OTHER_TOOLS}}/g, ''); 

  // Inject Integration Status
  try {
    const botManager = integrationService.getService<any>('bot-integration-manager');
    if (botManager) {
      const discord = botManager.getPlatform('discord');
      const telegram = botManager.getPlatform('telegram');
      
      const statusContext = `
## INTEGRATION STATUS
- **Discord**: ${discord ? 'CONNECTED' : 'NOT CONFIGURED'}
- **Telegram**: ${telegram ? 'CONNECTED' : 'NOT CONFIGURED'}

If a service is NOT CONFIGURED, inform the user they can set it up in the Integration Settings if they wish to use it.
`;
      finalPrompt += "\n" + statusContext;
    }
  } catch (err) {
    console.error('[SystemPrompt] Failed to inject integration status:', err);
  }

  // Add project-specific context if projectId or conversationId matches a project
  if (activeProject) {
    console.log(`[SystemPrompt] 📁 Injecting context for project: ${activeProject.name}`);
    const projectContext = `
## PROJECT CONTEXT
You are currently working in the context of a specific project.
- **Project Name**: ${activeProject.name}
- **Project Path**: ${activeProject.path}
${activeProject.instructions ? `- **Project Instructions**: ${activeProject.instructions}` : ''}

When the user asks you to perform tasks, assume they are related to this project unless specified otherwise.
Always prioritize the project path for file operations.
`;
    finalPrompt += "\n" + projectContext;
  }

  return finalPrompt;
}

/**
 * Returns the full assembled system prompt by reading the MD file and injecting context.
 * Uses caching for better performance.
 * 
 * @param preloadedPrompt - Optional pre-loaded prompt content to skip file I/O
 */
export function getSlimSystemPrompt(
  platform: string = 'win32', 
  conversationId?: string, 
  sessionCreatedPaths: string[] = [],
  preloadedPrompt?: string
): string {
  // If pre-loaded prompt is provided, use it directly
  if (preloadedPrompt) {
    return preloadedPrompt;
  }
  
  const safeConvId = conversationId && typeof conversationId === 'string' ? conversationId : 'current';
  
  // Check cache first
  const cached = promptCache.get(platform, conversationId, sessionCreatedPaths);
  if (cached) {
    return cached;
  }

  // Look up project context if conversationId is a project ID
  // Note: Since this is synchronous, we use a trick or just accept that it might miss the first time
  // Actually, better to fetch it in getSlimSystemPromptAsync and pass it here, 
  // but let's try to handle it here if possible. 
  // Actually, getSlimSystemPrompt is used in buildSystemMessages which is used in AgentRunner.runStream.
  // AgentRunner.runStream is async! So I should update getSlimSystemPrompt to be async or handle it in AgentRunner.


  const homedir = osHomedir();
  const homedirNorm = homedir.replace(/\\/g, '/');
  const linuxHome = hostPathToLinux(homedirNorm);
  const user = osUserInfo();

  // All paths are Linux VM paths
  const planPath = `${linuxHome}/.everfern/chat/plan/${safeConvId}/`;
  const artifactPath = `${linuxHome}/.everfern/artifacts/${safeConvId}/`;
  const execPath = `${linuxHome}/.everfern/exec/${safeConvId}/`;
  const sitePath = `${linuxHome}/.everfern/sites/${safeConvId}/`;
  const uploadsPath = `${linuxHome}/.everfern/attachments/`;

  // Read the Markdown file (cache this separately if needed)
  let promptMd = '';
  const searchPaths = [
    path.join(homedir, '.everfern', 'prompts', 'SYSTEM_PROMPT.md'),
    path.join(homedir, '.everfern', 'SYSTEM_PROMPT.md'),
    path.join(__dirname, 'prompts', 'SYSTEM_PROMPT.md'),
    path.join(__dirname, '..', '..', 'main', 'agent', 'prompts', 'SYSTEM_PROMPT.md'), // Fallback from dist-electron
    path.join(process.cwd(), 'main', 'agent', 'prompts', 'SYSTEM_PROMPT.md'),
    path.join(process.cwd(), 'apps', 'desktop', 'main', 'agent', 'prompts', 'SYSTEM_PROMPT.md')
  ];

  for (const mdPath of searchPaths) {
    try {
      if (fs.existsSync(mdPath)) {
        promptMd = fs.readFileSync(mdPath, 'utf8');
        console.log(`[SystemPrompt] ✅ Successfully loaded prompt from: ${mdPath}`);
        break;
      }
    } catch (err) {
      // Continue to next path
    }
  }

  if (!promptMd) {
    console.error('[SystemPrompt] ❌ Failed to read SYSTEM_PROMPT.md from any search path.');
    promptMd = '# EverFern System Prompt\n(Error loading full prompt file - check logs)';
  }

  // OS Info
  const osInfo =
    platform === 'win32'
      ? '**OS**: Windows (host).\n- **target: "main" (Default)**: Executes commands on the Windows host using PowerShell (pwsh.exe or powershell.exe). You MUST use Windows PowerShell syntax (do NOT use Linux commands like "ls -la", use PowerShell syntax and backslash paths like "C:\\Users\\...").\n- **target: "vm"**: Executes commands inside the Linux VM (WSL running Bash). You MUST use Linux Bash syntax (use Linux commands like "ls -la" and paths like "/mnt/c/Users/...").'
      : platform === 'darwin'
        ? '**OS**: macOS (host).\n- **target: "main" (Default)**: Executes commands on the macOS host using Bash/Zsh.\n- **target: "vm"**: Executes commands inside the Docker Linux VM running Bash (uses "/host/Users/..." paths).'
        : '**OS**: Linux. All commands execute natively using Bash.';
  console.log(`[SystemPrompt] OS info string (sync): platform=${platform}, osInfo="${osInfo.slice(0, 120)}..."`);

  // Session File Registry
  const sessionRegistry = sessionCreatedPaths.length > 0
    ? sessionCreatedPaths.map(p => `- \`${p}\``).join('\n')
    : '_No files created in this session memory yet._';

  // Skills (load once and cache if needed)
  const skills = loadSkills();
  const skillsTable = formatSkillsForPrompt(skills);
  const pluginsTable = '_All skills are loaded dynamically above._';

  // State Context (can be improved by checking actual manager state)
  const workspaceMounted = 'false';

  // Replace placeholders — all paths are Linux paths
  let finalPrompt = promptMd
    .replace(/{{OS_INFO}}/g, osInfo)
    .replace(/{{HOME_DIR}}/g, linuxHome)
    .replace(/{{SESSION_ID}}/g, safeConvId)
    .replace(/{{PLAN_PATH}}/g, planPath)
    .replace(/{{EXEC_PATH}}/g, execPath)
    .replace(/{{ARTIFACT_PATH}}/g, artifactPath)
    .replace(/{{SITE_PATH}}/g, sitePath)
    .replace(/{{UPLOADS_PATH}}/g, uploadsPath)
    .replace(/{{PROJECT_PATH}}/g, execPath)
    .replace(/{{SESSION_FILES}}/g, sessionRegistry)
    .replace(/{{SKILLS}}/g, skillsTable)
    .replace(/{{PLUGIN_SKILLS}}/g, pluginsTable)
    .replace(/{{CURRENT_DATE}}/g, new Date().toISOString().split('T')[0])
    .replace(/{{WORKSPACE_MOUNTED}}/g, workspaceMounted)
    .replace(/{{USER_NAME}}/g, user.username)
    .replace(/{{USER_EMAIL}}/g, 'noreply@everfern.app')
    .replace(/{{OTHER_TOOLS}}/g, ''); 

  // Cache the result
  promptCache.set(platform, conversationId, sessionCreatedPaths, finalPrompt);

  return finalPrompt;
}

// ─────────────────────────────────────────────
// MESSAGE BUILDER
// ─────────────────────────────────────────────

/**
 * Build the messages array with dynamic system prompt injected.
 * 
 * @param preloadedPrompt - Optional pre-loaded prompt content to skip file I/O
 */
export async function buildSystemMessages(
  history: Array<{ role: 'user' | 'assistant'; content: string | any[] }>,
  userInput: string | any[],
  platform: string = 'win32',
  conversationId?: string,
  sessionCreatedPaths: string[] = [],
  preloadedPrompt?: string,
  projectId?: string
): Promise<{ messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string | any[] }>; slimmed: boolean }> {
  let systemPrompt = '';
  if (preloadedPrompt) {
    systemPrompt = preloadedPrompt;
  } else {
    systemPrompt = await getSlimSystemPromptAsync(platform, conversationId, sessionCreatedPaths, undefined, projectId);
  }

  return {
    messages: [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: userInput },
    ],
    slimmed: false,
  };
}
