/**
 * EverFern Skills Sync & Path Validation
 *
 * Automatically syncs built-in skills to ~/.everfern/skills/ on app startup
 * and provides path validation with spelling correction capabilities.
 *
 * Uses a content-hash dirty-check so the expensive wipe+copy is skipped
 * when the source skills have not changed since the last sync.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { invalidateSkillsCache } from '../agent/runner/skills-loader';


// ── Levenshtein Distance for Spelling Correction ────────────────────────

function levenshteinDistance(a: string, b: string): number {
  const lenA = a.length;
  const lenB = b.length;
  const matrix: number[][] = Array(lenA + 1).fill(null).map(() => Array(lenB + 1).fill(0));

  for (let i = 0; i <= lenA; i++) matrix[i][0] = i;
  for (let j = 0; j <= lenB; j++) matrix[0][j] = j;

  for (let i = 1; i <= lenA; i++) {
    for (let j = 1; j <= lenB; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return matrix[lenA][lenB];
}

// ── Version-hash helpers ────────────────────────────────────────────────

const SYNC_VERSION_FILE = '.sync-version';

/**
 * Walk `dir` and produce a deterministic hash string from every file's
 * relative path + size + last-modified time.  Changes to any file will
 * produce a different hash.
 */
function computeDirHash(dir: string): string {
  const entries: string[] = [];

  function walk(current: string, prefix: string): void {
    const items = fs.readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    for (const item of items) {
      const rel = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) {
        walk(path.join(current, item.name), rel);
      } else {
        const stat = fs.statSync(path.join(current, item.name));
        entries.push(`${rel}:${stat.size}:${stat.mtimeMs}`);
      }
    }
  }

  try {
    walk(dir, '');
  } catch {
    return '';
  }

  return crypto.createHash('sha1').update(entries.join('\n')).digest('hex');
}

function readSyncVersion(skillsDir: string): string {
  try {
    return fs.readFileSync(path.join(skillsDir, SYNC_VERSION_FILE), 'utf-8').trim();
  } catch {
    return '';
  }
}

function writeSyncVersion(skillsDir: string, hash: string): void {
  try {
    fs.writeFileSync(path.join(skillsDir, SYNC_VERSION_FILE), hash, 'utf-8');
  } catch {
    // non-critical
  }
}

// ── Recursively copy directory ──────────────────────────────────────────

function copyDirRecursive(src: string, dest: string): void {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// ── Traverse directory and collect all skill paths ───────────────────────

function getAllSkillPaths(skillsDir: string, prefix = ''): { name: string; relPath: string; fullPath: string }[] {
  const results: { name: string; relPath: string; fullPath: string }[] = [];

  if (!fs.existsSync(skillsDir)) {
    return results;
  }

  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(skillsDir, entry.name);
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      results.push(...getAllSkillPaths(fullPath, relPath));
    } else {
      results.push({
        name: entry.name,
        relPath,
        fullPath
      });
    }
  }

  return results;
}

// ── Sync built-in skills to ~/.everfern/skills ──────────────────────────

export function syncBuiltInSkills(): void {
  try {
    const configDir = path.join(os.homedir(), '.everfern');
    const skillsDir = path.join(configDir, 'skills');

    // Ensure directories exist
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    function getAppPathSafe(): string | null {
      try {
        const { app } = require('electron');
        if (app && typeof app.getAppPath === 'function') {
          return app.getAppPath();
        }
      } catch (_) {}
      return null;
    }

    const appPath = getAppPathSafe();

    // Try multiple possible locations for built-in skills
    const possibleLocations = [
      // Location 1: Electron app.getAppPath() candidates (most reliable for packaged app)
      appPath ? path.join(appPath, 'main', 'skills') : '',
      appPath ? path.join(appPath, 'dist-electron', 'main', 'skills') : '',
      // Location 2: dist-electron/main/skills (compiled production inside asar)
      path.join(__dirname, '..', 'skills'),
      path.join(__dirname, '..', '..', 'skills'),
      // Location 3: extraResources (production resources/skills)
      ...(process.resourcesPath ? [
        path.join(process.resourcesPath, 'skills'),
        path.join(process.resourcesPath, 'main', 'skills'),
        path.join(process.resourcesPath, 'app.asar.unpacked', 'dist-electron', 'main', 'skills'),
      ] : []),
      // Location 4: main/skills (source/dev)
      path.join(__dirname, '..', '..', 'main', 'skills'),
      path.join(__dirname, '..', '..', '..', 'main', 'skills'),
      path.join(process.cwd(), 'main', 'skills'),
      path.join(process.cwd(), 'apps', 'desktop', 'main', 'skills'),
      path.join(process.cwd(), 'dist-electron', 'main', 'skills'),
    ].filter(Boolean);


    let builtInSkillsDir: string | null = null;

    console.log(`[SkillsSync] 🔍 Searching for built-in skills directory...`);
    for (const loc of possibleLocations) {
      console.log(`[SkillsSync]    Checking: ${loc}`);
      if (fs.existsSync(loc)) {
        console.log(`[SkillsSync]    ✅ Found: ${loc}`);
        builtInSkillsDir = loc;
        break;
      }
    }

    if (!builtInSkillsDir) {
      console.warn(`[SkillsSync] ⚠️ Built-in skills directory not found in any of these locations:`);
      for (const loc of possibleLocations) {
        console.warn(`[SkillsSync]    - ${loc}`);
      }
      console.warn(`[SkillsSync] ℹ️ Skills will need to be manually placed in: ${skillsDir}`);
      return;
    }

    // ── Dirty-check: skip wipe+copy if source hasn't changed ───────────
    const sourceHash = computeDirHash(builtInSkillsDir);
    const cachedHash = readSyncVersion(skillsDir);

    if (sourceHash && sourceHash === cachedHash && fs.existsSync(skillsDir)) {
      console.log(`[SkillsSync] ✅ Skills already up-to-date (hash ${sourceHash.slice(0, 8)}…) — skipping sync`);
      return;
    }

    console.log(`[SkillsSync] 📦 Syncing built-in skills`);
    console.log(`[SkillsSync]    From: ${builtInSkillsDir}`);
    console.log(`[SkillsSync]    To:   ${skillsDir}`);

    // Clear existing skills and copy fresh
    if (fs.existsSync(skillsDir)) {
      console.log(`[SkillsSync] 🔄 Clearing existing skills`);
      fs.rmSync(skillsDir, { recursive: true, force: true });
    }

    // Copy all built-in skills
    copyDirRecursive(builtInSkillsDir, skillsDir);

    // Persist the hash so the next startup can skip the sync
    writeSyncVersion(skillsDir, sourceHash);
    invalidateSkillsCache();

    // Log synced skills

    const syncedSkills = getAllSkillPaths(skillsDir);
    console.log(`[SkillsSync] ✅ Skills synced successfully (${syncedSkills.length} files)`);

    // Group by skill
    const skillGroups = new Map<string, number>();
    for (const skill of syncedSkills) {
      const skillName = skill.relPath.split('/')[0];
      skillGroups.set(skillName, (skillGroups.get(skillName) || 0) + 1);
    }

    const skillEntries = Array.from(skillGroups.entries());
    for (const [skillName, count] of skillEntries) {
      console.log(`[SkillsSync]    • ${skillName} (${count} files)`);
    }

    // ── Also sync skills into WSL /everfern/skills/ ───────────────────
    if (process.platform === 'win32') {
      try {
        const { execSync } = require('child_process');
        // Build WSL path for Windows skillsDir (e.g. C:\Users\srini\.everfern\skills)
        const driveLetter = skillsDir.replace(/^([A-Za-z]):.*/, '$1').toLowerCase();
        const relPath = skillsDir.replace(/^[A-Za-z]:\\/, '').replace(/\\/g, '/');
        const wslSkillsSrc = `/mnt/${driveLetter}/${relPath}`;
        console.log(`[SkillsSync] 🐧 Syncing skills to WSL: ${wslSkillsSrc} → /everfern/skills/`);
        execSync(
          `wsl.exe --exec bash -c "mkdir -p /everfern/skills && cp -r '${wslSkillsSrc}/.' /everfern/skills/ && chmod -R 755 /everfern/skills/"`,
          { timeout: 60000, stdio: 'pipe' }
        );
        console.log(`[SkillsSync] ✅ Skills synced to WSL /everfern/skills/`);
      } catch (wslErr: any) {
        console.warn(`[SkillsSync] ⚠️ WSL skills sync failed (non-fatal): ${wslErr.message}`);
      }
    }
  } catch (error) {
    console.error(`[SkillsSync] ❌ Error syncing skills:`, error);
  }
}

// ── Validate and correct skill paths ────────────────────────────────────

export interface PathValidationResult {
  isValid: boolean;
  correctedPath?: string;
  suggestions?: string[];
  confidence?: number;
}

export function validateAndCorrectSkillPath(
  providedPath: string,
  threshold = 0.7
): PathValidationResult {
  try {
    const configDir = path.join(os.homedir(), '.everfern');
    const skillsDir = path.join(configDir, 'skills');
    const homeDir = os.homedir();

    console.log(`[PathValidation] 🔍 Validating path: ${providedPath}`);

    // ── Extract relative path from absolute paths ──────────────────────
    let relativeProvided = providedPath;

    // If path is absolute, try to extract the relative skill path
    if (providedPath.includes('.everfern/skills')) {
      const parts = providedPath.split('.everfern/skills/');
      if (parts.length > 1) {
        relativeProvided = parts[parts.length - 1];
        console.log(`[PathValidation] 📍 Extracted relative path: ${relativeProvided}`);
      }
    }

    // Normalize the path
    const normalizedPath = relativeProvided.replace(/\\/g, '/').toLowerCase();

    // Check if path exists exactly
    const absolutePath = path.join(skillsDir, relativeProvided);
    if (fs.existsSync(absolutePath)) {
      console.log(`[PathValidation] ✅ Path is valid`);
      return { isValid: true };
    }

    console.log(`[PathValidation] ⚠️ Path not found: ${absolutePath}`);

    // ── Try to fix truncated usernames in absolute paths ──────────────────
    if (providedPath.includes('Users/') && !providedPath.includes(path.basename(homeDir))) {
      const username = path.basename(homeDir);
      const truncated = username.slice(-3);  // Last few chars of username

      if (providedPath.includes(`Users/${truncated}/`)) {
        const corrected = providedPath.replace(`Users/${truncated}/`, `Users/${username}/`);
        console.log(`[PathValidation] 🔧 Detected truncated username "${truncated}", corrected to "${username}"`);

        // Recursively try with corrected path
        return validateAndCorrectSkillPath(corrected, threshold);
      }
    }

    // Get all available skills
    const allSkills = getAllSkillPaths(skillsDir);
    const availablePaths = allSkills.map(s => s.relPath.toLowerCase());

    // Find closest matches using Levenshtein distance
    const matches: { path: string; distance: number; score: number }[] = [];

    for (const availPath of availablePaths) {
      const distance = levenshteinDistance(normalizedPath, availPath);
      const maxLen = Math.max(normalizedPath.length, availPath.length);
      const score = 1 - (distance / maxLen);

      if (score >= threshold) {
        matches.push({ path: availPath, distance, score });
      }
    }

    // Sort by score (highest first)
    matches.sort((a, b) => b.score - a.score);

    if (matches.length > 0) {
      const bestMatch = matches[0];
      const suggestions = matches.map(m => m.path);

      console.log(`[PathValidation] 🎯 Found corrections:`);
      for (const suggestion of suggestions.slice(0, 3)) {
        console.log(`[PathValidation]    • ${suggestion}`);
      }

      return {
        isValid: false,
        correctedPath: bestMatch.path,
        suggestions: suggestions.slice(0, 5),
        confidence: bestMatch.score
      };
    }

    console.log(`[PathValidation] ❌ No corrections found`);
    console.log(`[PathValidation] 📋 Available skills:`);
    const skillsGrouped = new Map<string, string[]>();
    for (const skillPath of availablePaths) {
      const skillName = skillPath.split('/')[0];
      if (!skillsGrouped.has(skillName)) {
        skillsGrouped.set(skillName, []);
      }
      skillsGrouped.get(skillName)!.push(skillPath);
    }

    const skillsGroupedEntries = Array.from(skillsGrouped.entries());
    for (const [skillName, paths] of skillsGroupedEntries) {
      console.log(`[PathValidation]    • ${skillName}/`);
      for (const p of paths.slice(0, 3)) {
        console.log(`[PathValidation]      - ${p}`);
      }
      if (paths.length > 3) {
        console.log(`[PathValidation]      ... and ${paths.length - 3} more`);
      }
    }

    return { isValid: false, suggestions: availablePaths.slice(0, 5) };
  } catch (error) {
    console.error(`[PathValidation] ❌ Validation error:`, error);
    return { isValid: false };
  }
}

// ── Custom Skills Directory ─────────────────────────────────────────

export function getCustomSkillsPath(): string {
  return path.join(os.homedir(), '.everfern', 'custom_skills');
}

export function getSkillsPath(): string {
  return path.join(os.homedir(), '.everfern', 'skills');
}

// ── Merge custom skills to main skills directory ───────────────────

export function mergeCustomSkills(): void {
  try {
    const customDir = getCustomSkillsPath();
    const skillsDir = getSkillsPath();

    if (!fs.existsSync(customDir)) {
      console.log('[SkillsSync] ℹ️ No custom_skills directory found');
      return;
    }

    if (!fs.existsSync(skillsDir)) {
      fs.mkdirSync(skillsDir, { recursive: true });
    }

    const customEntries = fs.readdirSync(customDir, { withFileTypes: true });
    let mergedCount = 0;

    for (const entry of customEntries) {
      const srcPath = path.join(customDir, entry.name);
      const destPath = path.join(skillsDir, entry.name);

      if (entry.isDirectory()) {
        if (!fs.existsSync(destPath)) {
          fs.mkdirSync(destPath, { recursive: true });
        }
        const subEntries = fs.readdirSync(srcPath, { withFileTypes: true });
        for (const subEntry of subEntries) {
          fs.copyFileSync(path.join(srcPath, subEntry.name), path.join(destPath, subEntry.name));
          mergedCount++;
        }
      } else {
        fs.copyFileSync(srcPath, destPath);
        mergedCount++;
      }
    }

    console.log(`[SkillsSync] ✅ Merged ${mergedCount} custom skills to runtime skills directory`);
  } catch (error) {
    console.error('[SkillsSync] ❌ Error merging custom skills:', error);
  }
}

// ── List custom skills ─────────────────────────────────────────────────

export function listCustomSkills(): { name: string; path: string; description: string }[] {
  const customDir = getCustomSkillsPath();
  const skills: { name: string; path: string; description: string }[] = [];

  try {
    if (!fs.existsSync(customDir)) {
      return skills;
    }

    const entries = fs.readdirSync(customDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillPath = path.join(customDir, entry.name);
        const skillMdPath = path.join(skillPath, 'SKILL.md');

        if (fs.existsSync(skillMdPath)) {
          const content = fs.readFileSync(skillMdPath, 'utf-8');
          const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);

          if (match) {
            const frontmatter = match[1];
            const nameMatch = frontmatter.match(/^name:\s*["']?([^"'\n]+)["']?/m);
            let descMatch = frontmatter.match(/^description:\s*"([^"]*)"/m);
            if (!descMatch) {
              descMatch = frontmatter.match(/^description:\s*'([^']*)'/m);
            }
            if (!descMatch) {
              descMatch = frontmatter.match(/^description:\s*([^\n]+)/m);
            }

            skills.push({
              name: nameMatch?.[1]?.trim() || entry.name,
              path: skillPath,
              description: descMatch?.[1]?.trim() || ''
            });
          }
        }
      }
    }
  } catch (error) {
    console.error('[SkillsSync] ❌ Error listing custom skills:', error);
  }

  return skills;
}

// ── Save a custom skill ────────────────────────────────────────────

export interface CustomSkillData {
  name: string;
  description: string;
  content: string;
  category?: string;
}

export function saveCustomSkill(data: CustomSkillData): { success: boolean; error?: string } {
  try {
    const customDir = getCustomSkillsPath();

    if (!fs.existsSync(customDir)) {
      fs.mkdirSync(customDir, { recursive: true });
    }

    const sanitizedName = data.name.replace(/[^a-zA-Z0-9-_]/g, '_');
    const skillDir = path.join(customDir, sanitizedName);

    if (!fs.existsSync(skillDir)) {
      fs.mkdirSync(skillDir, { recursive: true });
    }

    const skillMdContent = `---
name: ${data.name}
description: "${data.description}"
---

${data.content}
`;

    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillMdContent, 'utf-8');

    console.log(`[SkillsSync] ✅ Saved custom skill: ${data.name}`);
    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[SkillsSync] ❌ Error saving custom skill:', errorMsg);
    return { success: false, error: errorMsg };
  }
}

// ── Delete a custom skill ────────────────────────────────────────────

export function deleteCustomSkill(name: string): { success: boolean; error?: string } {
  try {
    const customDir = getCustomSkillsPath();
    const skillDir = path.join(customDir, name);

    if (!fs.existsSync(skillDir)) {
      return { success: false, error: 'Skill not found' };
    }

    fs.rmSync(skillDir, { recursive: true, force: true });
    console.log(`[SkillsSync] ✅ Deleted custom skill: ${name}`);
    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[SkillsSync] ❌ Error deleting custom skill:', errorMsg);
    return { success: false, error: errorMsg };
  }
}

// ── Ensure skills directory exists (even if empty) ──────────────────

export function ensureSkillsDirectoryExists(): string {
  const skillsDir = getSkillsPath();

  if (!fs.existsSync(skillsDir)) {
    console.log(`[SkillsSync] 📁 Creating skills directory: ${skillsDir}`);
    fs.mkdirSync(skillsDir, { recursive: true });
  }

  return skillsDir;
}

// ── List all available skills ──────────────────────────────────────────

export function listAvailableSkills(): string[] {
  try {
    const skillsDir = getSkillsPath();
    if (!fs.existsSync(skillsDir)) {
      return [];
    }

    const allSkills = getAllSkillPaths(skillsDir);
    const skillNames = new Set<string>();

    for (const skill of allSkills) {
      const skillName = skill.relPath.split('/')[0];
      skillNames.add(skillName);
    }

    return Array.from(skillNames).sort();
  } catch (error) {
    console.error(`[SkillsSync] ❌ Error listing skills:`, error);
    return [];
  }
}

// ── Resolve skill path with auto-correction ──────────────────────────────

export function resolveSkillPath(providedPath: string): string | null {
  try {
    const skillsDir = getSkillsPath();

    // If the provided path is already absolute and contains the skills directory,
    // extract the relative portion to prevent double-joining.
    let relativePath = providedPath;
    const normalizedProvided = providedPath.replace(/\\/g, '/');
    if (normalizedProvided.includes('.everfern/skills/')) {
      const parts = normalizedProvided.split('.everfern/skills/');
      if (parts.length > 1) {
        relativePath = parts[parts.length - 1];
      }
    }

    const absolutePath = path.join(skillsDir, relativePath);

    // Try exact match first
    if (fs.existsSync(absolutePath)) {
      return absolutePath;
    }

    // Try validation and correction
    const validation = validateAndCorrectSkillPath(relativePath);

    if (validation.isValid) {
      return path.join(skillsDir, relativePath);
    }

    if (validation.correctedPath) {
      const correctedAbsPath = path.join(skillsDir, validation.correctedPath);
      console.log(`[PathResolution] 🔁 Auto-correcting path:`);
      console.log(`[PathResolution]    From: ${providedPath}`);
      console.log(`[PathResolution]    To:   ${validation.correctedPath}`);
      console.log(`[PathResolution]    Confidence: ${(validation.confidence! * 100).toFixed(1)}%`);

      if (fs.existsSync(correctedAbsPath)) {
        return correctedAbsPath;
      }
    }

    return null;
  } catch (error) {
    console.error(`[PathResolution] ❌ Error resolving path:`, error);
    return null;
  }
}
