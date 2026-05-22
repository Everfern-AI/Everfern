import * as path from 'path';
import { loadSkills } from '../runner/skills-loader';
import type { AgentTool, ToolResult } from '../runner/types';

export const skillTool: AgentTool = {
  name: 'skill',
  description:
    'Invoke a named skill to load its expert instructions into the session. ' +
    'Matching SKILL.md paths will be returned for reading. ' +
    'Trigger this before writing any code or starting an analysis.',
  parameters: {
    type: 'object',
    properties: {
      name: { 
        type: 'string', 
        description: 'Name of the skill (e.g. "xlsx", "pdf", "frontend-design").'
      }
    },
    required: ['name']
  },

  async execute(args: Record<string, unknown>, onUpdate?: (msg: string) => void, emitEvent?: (event: any) => void, toolCallId?: string): Promise<ToolResult> {
    const skillName = (args.name as string || '').toLowerCase();
    
    onUpdate?.(`🔍 Resolving skill "${skillName}"...`);
    
    const skills = loadSkills();
    const matched = skills.find(s => s.name.toLowerCase() === skillName);

    if (!matched) {
       // Fuzzy fallback
       const fuzzy = skills.find(s => s.name.toLowerCase().includes(skillName) || skillName.includes(s.name.toLowerCase()));
       if (fuzzy) {
          onUpdate?.(`🎯 Fuzzy match found: ${fuzzy.name}`);
          let fuzzyContent = '';
          try {
            fuzzyContent = require('fs').readFileSync(fuzzy.path, 'utf8');
          } catch (e) {
            console.error(`[SkillTool] Failed to read skill file at ${fuzzy.path}`, e);
          }
          return {
            success: true,
            output: `Resolved skill "${skillName}" to ${fuzzy.name}. Path: ${fuzzy.path}\n\n${fuzzyContent}`,
            data: { skill: { ...fuzzy, content: fuzzyContent } }
          };
       }
       return { 
         success: false, 
         output: `Skill "${skillName}" not found. Available skills: ${skills.map(s => s.name).join(', ')}`,
         error: 'skill_not_found'
       };
    }

    let fileContent = '';
    try {
      fileContent = require('fs').readFileSync(matched.path, 'utf8');
    } catch (e) {
      console.error(`[SkillTool] Failed to read skill file at ${matched.path}`, e);
    }

    return {
      success: true,
      output: `Resolved skill "${skillName}" to ${matched.name}. Path: ${matched.path}\n\n${fileContent}`,
      data: { skill: { ...matched, content: fileContent } }
    };
  }
};
