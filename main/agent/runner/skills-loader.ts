import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getSkillsPath, validateAndCorrectSkillPath } from '../../lib/skills-sync';

export interface Skill {
  name: string;
  description: string;
  path: string;
}

/**
 * Load skills asynchronously using fs.promises for non-blocking I/O
 * This function should be used during initialization to avoid blocking the event loop
 */
let cachedSkills: Skill[] | null = null;
let lastSkillsLoadTime = 0;
const SKILLS_CACHE_TTL = 300000; // 5 minutes

/**
 * Invalidate the in-memory skills cache so the next request reloads from disk.
 */
export function invalidateSkillsCache(): void {
  cachedSkills = null;
  lastSkillsLoadTime = 0;
}

/**
 * Load skills asynchronously using fs.promises for non-blocking I/O
 * Uses in-memory caching to avoid blocking disk I/O on every prompt.
 */
export async function loadSkillsAsync(forceRefresh: boolean = false): Promise<Skill[]> {
  const now = Date.now();
  if (!forceRefresh && cachedSkills && (now - lastSkillsLoadTime < SKILLS_CACHE_TTL)) {
    return cachedSkills;
  }

  const skillsDir = getSkillsPath();
  const skills: Skill[] = [];

  try {
    let actualSkillsDir = skillsDir;
    try {
      await fs.promises.access(skillsDir);
      const contents = await fs.promises.readdir(skillsDir);
      const hasSkills = contents.some(c => c !== '.sync-version');
      if (!hasSkills) {
        throw new Error('Skills directory is empty');
      }
    } catch {
      // Fallback: try loading directly from built-in skills directory locations
      const fallbackPaths = [
        path.resolve(__dirname, '..', 'skills'),
        path.resolve(__dirname, '..', '..', 'skills'),
        ...(process.resourcesPath ? [
          path.join(process.resourcesPath, 'skills'),
          path.join(process.resourcesPath, 'app.asar.unpacked', 'dist-electron', 'main', 'skills'),
        ] : []),
        path.resolve(__dirname, '..', '..', '..', 'main', 'skills'),
        path.join(process.cwd(), 'main', 'skills'),
        path.join(process.cwd(), 'dist-electron', 'main', 'skills'),
      ].filter(Boolean);
      let found = false;
      for (const fb of fallbackPaths) {
        try {
          await fs.promises.access(fb);
          const fbContents = await fs.promises.readdir(fb);
          if (fbContents.length > 0) {
            actualSkillsDir = fb;
            found = true;
            break;
          }
        } catch { /* skip */ }
      }
      if (!found) {
        cachedSkills = skills;
        lastSkillsLoadTime = now;
        return skills;
      }
    }

    const IGNORE_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'out', 'coverage', '.vscode', '.idea', '__pycache__', 'venv', '.env', 'target']);

    const loadSkillFiles = async (currentPath: string): Promise<void> => {
      const items = await fs.promises.readdir(currentPath);

      for (const item of items) {
        const itemPath = path.join(currentPath, item);
        const stat = await fs.promises.stat(itemPath);

        if (stat.isDirectory()) {
          if (IGNORE_DIRS.has(item)) continue;
          await loadSkillFiles(itemPath);
        } else if (item === 'SKILL.md' || (item.endsWith('.md') && item.includes('SKILL'))) {
          try {
            const content = await fs.promises.readFile(itemPath, 'utf-8');
            const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);

            if (match) {
              const frontmatter = match[1];
              const nameMatch = frontmatter.match(/(?:^|##\s*)name:\s*["']?([^"'\n]+)["']?/m);

              let description = '';
              let descMatch = frontmatter.match(/description:\s*"([^"]*)"/m);
              if (!descMatch) {
                descMatch = frontmatter.match(/description:\s*'([^']*)'/m);
              }
              if (!descMatch) {
                descMatch = frontmatter.match(/description:\s*([^\n]+)/m);
              }

              if (descMatch && descMatch[1]) {
                description = descMatch[1].trim();
              }

              if (nameMatch && nameMatch[1] && description) {
                const skillName = nameMatch[1].trim();
                const skillPath = itemPath.replace(/\\/g, '/');
                skills.push({
                  name: skillName,
                  description: description,
                  path: skillPath
                });
              }
            }
          } catch (err) {
            console.error(`[SkillsLoader] Error parsing skill at ${itemPath}:`, err);
          }
        }
      }
    };

    await loadSkillFiles(actualSkillsDir);
    console.log(`[SkillsLoader] ✅ Loaded ${skills.length} skills into memory cache`);
    cachedSkills = skills;
    lastSkillsLoadTime = now;
    return skills;
  } catch (error) {
    console.error('[SkillsLoader] ❌ Error loading skills asynchronously:', error);
    return [];
  }
}


/**
 * Load skills synchronously (DEPRECATED - use loadSkillsAsync instead)
 * This function performs blocking file I/O and should not be called during graph compilation
 * @deprecated Use loadSkillsAsync() instead to avoid blocking the event loop
 */
export function loadSkills(): Skill[] {
  if (cachedSkills) {
    return cachedSkills;
  }
  const skillsDir = getSkillsPath();
  const skills: Skill[] = [];


  console.log(`[SkillsLoader] 📂 Loading skills from: ${skillsDir}`);

  try {
    if (!fs.existsSync(skillsDir)) {
      console.warn(`[SkillsLoader] ⚠️ Skills directory does not exist: ${skillsDir}`);
      return skills;
    }

    const loadSkillFiles = (currentPath: string, depth = 0) => {
      const indent = '  '.repeat(depth);
      console.log(`[SkillsLoader] ${indent}📁 Scanning directory: ${currentPath}`);
      const items = fs.readdirSync(currentPath);
      console.log(`[SkillsLoader] ${indent}   Found ${items.length} items`);

      const IGNORE_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'out', 'coverage', '.vscode', '.idea', '__pycache__', 'venv', '.env', 'target']);

      for (const item of items) {
        const itemPath = path.join(currentPath, item);
        const stat = fs.statSync(itemPath);

        if (stat.isDirectory()) {
          if (IGNORE_DIRS.has(item)) continue;
          console.log(`[SkillsLoader] ${indent}   📁 [DIR] ${item}`);
          loadSkillFiles(itemPath, depth + 1);
        } else if (item === 'SKILL.md' || (item.endsWith('.md') && item.includes('SKILL'))) {
          console.log(`[SkillsLoader] ${indent}   📄 [SKILL] ${item}`);
          try {
            const content = fs.readFileSync(itemPath, 'utf-8');
            console.log(`[SkillsLoader] ${indent}      Parsing SKILL.md (${content.length} bytes)...`);

            // Improved YAML frontmatter parser - handle quoted multiline descriptions
            const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);

            if (match) {
              const frontmatter = match[1];
              console.log(`[SkillsLoader] ${indent}      Found YAML frontmatter (${frontmatter.length} bytes)`);

              // Extract name: handle various YAML formats
              const nameMatch = frontmatter.match(/(?:^|##\s*)name:\s*["']?([^"'\n]+)["']?/m);
              console.log(`[SkillsLoader] ${indent}      Name match: ${nameMatch ? nameMatch[1] : 'NOT FOUND'}`);

              // Extract description: handle quoted strings (single or double quotes)
              let description = '';
              // Try double quotes first
              let descMatch = frontmatter.match(/description:\s*"([^"]*)"/m);
              if (!descMatch) {
                // Try single quotes
                descMatch = frontmatter.match(/description:\s*'([^']*)'/m);
              }
              if (!descMatch) {
                // Try unquoted (up to newline)
                descMatch = frontmatter.match(/description:\s*([^\n]+)/m);
              }

              if (descMatch && descMatch[1]) {
                description = descMatch[1].trim();
              }
              console.log(`[SkillsLoader] ${indent}      Description: ${description.slice(0, 50)}...`);

              if (nameMatch && nameMatch[1] && description) {
                const skillName = nameMatch[1].trim();
                const skillPath = itemPath.replace(/\\/g, '/');
                console.log(`[SkillsLoader] ${indent}      ✅ Added skill: ${skillName}`);
                skills.push({
                  name: skillName,
                  description: description,
                  path: skillPath
                });
              } else {
                console.warn(`[SkillsLoader] ${indent}      ❌ Missing name or description in frontmatter`);
              }
            } else {
              console.warn(`[SkillsLoader] ${indent}      ❌ No YAML frontmatter found`);
            }
          } catch (err) {
            console.error(`[SkillsLoader] ${indent}      ❌ Error parsing skill at ${itemPath}:`, err);
          }
        }
      }
    };

    loadSkillFiles(skillsDir);
    console.log(`[SkillsLoader] ✅ Skill loading complete: Found ${skills.length} skills`);
    for (const skill of skills) {
      console.log(`[SkillsLoader]    • ${skill.name}`);
    }
    return skills;
  } catch (error) {
    console.error('[SkillsLoader] ❌ Error loading skills:', error);
    return [];
  }
}

export function formatSkillsForPrompt(skills: Skill[]): string {
  if (!skills || !Array.isArray(skills) || skills.length === 0) return '';

  let prompt = `\n\n## Available Skills & How to Use Them

You have access to the following specialized skills. Each skill provides domain-specific procedures for handling specific file types or tasks.

### MANDATORY SKILL CALLING PROCEDURE:
1. **Detect** if your task matches any skill (check descriptions below)
2. **Invoke** by calling the \`skill\` tool with the skill name: \`{"name": "skillName"}\` — this returns the full SKILL.md content directly
3. **Follow** the skill's exact procedures before implementing

### Skills Available:

`;

  for (const skill of skills) {
    if (!skill || !skill.name || !skill.description || !skill.path) {
      continue;
    }

    // Convert Windows path to Linux /everfern/skills path
    // skill.path is like: C:\Users\srini\.everfern\skills\docx\SKILL.md
    // We want: /everfern/skills/docx/
    const normalizedPath = skill.path.replace(/\\/g, '/');
    const skillsMarker = '.everfern/skills/';
    const markerIdx = normalizedPath.indexOf(skillsMarker);
    let linuxSkillDir: string;
    if (markerIdx !== -1) {
      // Extract the relative part after '.everfern/skills/', e.g. 'docx/SKILL.md' → 'docx'
      const relPart = normalizedPath.slice(markerIdx + skillsMarker.length);
      const skillDirName = relPart.split('/')[0];
      linuxSkillDir = `/everfern/skills/${skillDirName}/`;
    } else {
      // Fallback: use basename directory
      const parts = normalizedPath.split('/');
      const fileIdx = parts.length - 1;
      const skillDirName = parts[fileIdx - 1] || skill.name;
      linuxSkillDir = `/everfern/skills/${skillDirName}/`;
    }

    prompt += `**${skill.name}**\n`;
    prompt += `- Skill Directory (Linux VM): ${linuxSkillDir}\n`;
    prompt += `- When to Use: ${skill.description}\n`;
    prompt += `- How to invoke: call the \`skill\` tool with \`{"name": "${skill.name}"}\` to get full instructions\n\n`;
  }

  prompt += `### EXAMPLE SKILL INVOCATION:\nCall the skill tool: \`{"name": "docx"}\`\nThe tool returns the complete SKILL.md with all procedures. Follow those procedures exactly.\n\nNOTE: All script paths in SKILL.md are relative to the skill's directory shown above (e.g. /everfern/skills/docx/). Run scripts from that directory in the VM.\n`;

  return prompt;
}

