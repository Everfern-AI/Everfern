import { AgentTool, ToolResult } from '../runner/types';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { addOrUpdateMemory } from '../learning/memory/persistent-memory';

function getMemoryDir(): string {
  const dir = path.join(os.homedir(), '.everfern', 'memory');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export const rememberFactTool: AgentTool = {
  name: 'remember_fact',
  description: 'Saves general, structured facts, system parameters, or project decisions to PROJECT_STATE.md memory file.',
  parameters: {
    type: 'object',
    properties: {
      fact: { type: 'string', description: 'The fact, design pattern, library choice, or project detail to remember.' },
      category: { type: 'string', description: 'Optional category for organizing facts (e.g. database, frontend, api, rules).' }
    },
    required: ['fact']
  },
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const fact = (args.fact as string || '').trim();
      const category = (args.category as string || 'General').trim();
      if (!fact) return { success: false, output: 'No fact provided.' };

      addOrUpdateMemory('fact', category, fact, 'PROJECT_STATE.md');
      return {
        success: true,
        output: `Successfully saved fact under category "${category}" to PROJECT_STATE.md`
      };
    } catch (err: any) {
      return { success: false, output: `Failed to save fact: ${err.message}` };
    }
  }
};

export const recallFactTool: AgentTool = {
  name: 'recall_fact',
  description: 'Recalls saved memories from PROJECT_STATE.md and USER_PROFILE.md using keyword matching.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query or keywords to find.' }
    },
    required: ['query']
  },
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const query = (args.query as string || '').toLowerCase().trim();
      if (!query) return { success: false, output: 'No search query provided.' };

      const dir = getMemoryDir();
      const projectPath = path.join(dir, 'PROJECT_STATE.md');
      const profilePath = path.join(dir, 'USER_PROFILE.md');

      let results: string[] = [];

      if (fs.existsSync(projectPath)) {
        const content = fs.readFileSync(projectPath, 'utf-8');
        const sections = content.split('\n### ');
        for (const sec of sections) {
          if (sec.toLowerCase().includes(query)) {
            results.push(`[Project State] ${sec.trim()}`);
          }
        }
      }

      if (fs.existsSync(profilePath)) {
        const content = fs.readFileSync(profilePath, 'utf-8');
        const sections = content.split('\n### ');
        for (const sec of sections) {
          if (sec.toLowerCase().includes(query)) {
            results.push(`[User Profile] ${sec.trim()}`);
          }
        }
      }

      if (results.length === 0) {
        return { success: true, output: `No facts matching query "${query}" were found.` };
      }

      return {
        success: true,
        output: `Found matches:\n\n${results.join('\n\n---\n\n')}`
      };
    } catch (err: any) {
      return { success: false, output: `Failed to recall facts: ${err.message}` };
    }
  }
};

export const updateProfileTool: AgentTool = {
  name: 'update_profile',
  description: 'Updates the user profile preferences (e.g. favorite tech stacks, coding guidelines, layout styles) in USER_PROFILE.md.',
  parameters: {
    type: 'object',
    properties: {
      preference: { type: 'string', description: 'The user preference, style, or choice to update.' },
      category: { type: 'string', description: 'Optional category (e.g., tech_stack, css_framework, writing_style).' }
    },
    required: ['preference']
  },
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const preference = (args.preference as string || '').trim();
      const category = (args.category as string || 'General').trim();
      if (!preference) return { success: false, output: 'No preference details provided.' };

      addOrUpdateMemory('preference', category, preference, 'USER_PROFILE.md');
      return {
        success: true,
        output: `Successfully updated user preference under category "${category}" in USER_PROFILE.md`
      };
    } catch (err: any) {
      return { success: false, output: `Failed to update user profile: ${err.message}` };
    }
  }
};
