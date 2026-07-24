import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { AgentTool, ToolResult } from '../runner/types';

export const getDynamicToolsDir = (): string => {
  const dir = path.join(os.homedir(), '.everfern', 'dynamic-tools');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
};

export const getPendingToolsDir = (): string => {
  const dir = path.join(getDynamicToolsDir(), 'pending');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
};

export interface SynthesizedToolData {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required: string[];
  };
  code: string;
}

// Global runtime cache for dynamically registered tools
const registeredDynamicTools = new Map<string, AgentTool>();

export function registerDynamicTool(toolData: SynthesizedToolData): AgentTool {
  // Use new Function to compile the dynamic code safely at runtime
  const executeFn = new Function('args', 'onUpdate', `
    return (async () => {
      ${toolData.code}
    })();
  `);

  const tool: AgentTool = {
    name: toolData.name,
    description: toolData.description,
    parameters: toolData.parameters as any,
    async execute(args, onUpdate) {
      try {
        const result = await executeFn(args, onUpdate);
        if (result && typeof result === 'object' && 'success' in result) {
          return result as ToolResult;
        }
        return {
          success: true,
          output: typeof result === 'string' ? result : JSON.stringify(result)
        };
      } catch (err: any) {
        return {
          success: false,
          output: `Error executing synthesized tool: ${err.message || String(err)}`
        };
      }
    }
  };

  registeredDynamicTools.set(tool.name, tool);
  return tool;
}

export function loadAllSynthesizedTools(): AgentTool[] {
  const dir = getDynamicToolsDir();
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  const tools: AgentTool[] = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(dir, file), 'utf8');
      const toolData: SynthesizedToolData = JSON.parse(content);
      const tool = registerDynamicTool(toolData);
      tools.push(tool);
    } catch (err) {
      console.error(`[ToolSynthesizer] Failed to load dynamic tool ${file}:`, err);
    }
  }

  // Also include runtime registered ones
  for (const tool of registeredDynamicTools.values()) {
    if (!tools.some(t => t.name === tool.name)) {
      tools.push(tool);
    }
  }

  return tools;
}

export function approveSynthesizedTool(name: string): AgentTool {
  const pendingDir = getPendingToolsDir();
  const pendingPath = path.join(pendingDir, `${name}.json`);
  if (!fs.existsSync(pendingPath)) {
    throw new Error(`Pending tool not found: ${name}`);
  }

  const content = fs.readFileSync(pendingPath, 'utf8');
  const toolData: SynthesizedToolData = JSON.parse(content);

  // Move from pending to active dynamic tools
  const activeDir = getDynamicToolsDir();
  fs.writeFileSync(path.join(activeDir, `${name}.json`), content, 'utf8');

  // Remove pending file
  try {
    fs.unlinkSync(pendingPath);
  } catch {}

  return registerDynamicTool(toolData);
}

export function deleteSynthesizedTool(name: string): void {
  const activeDir = getDynamicToolsDir();
  const activePath = path.join(activeDir, `${name}.json`);
  if (fs.existsSync(activePath)) {
    fs.unlinkSync(activePath);
  }

  const pendingDir = getPendingToolsDir();
  const pendingPath = path.join(pendingDir, `${name}.json`);
  if (fs.existsSync(pendingPath)) {
    fs.unlinkSync(pendingPath);
  }

  registeredDynamicTools.delete(name);
}

export function getSynthesizedToolsList(): any[] {
  const dir = getDynamicToolsDir();
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  const list: any[] = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(dir, file), 'utf8');
      const data = JSON.parse(content);
      list.push({
        name: data.name,
        description: data.description,
        parameters: data.parameters,
        code: data.code,
        status: 'approved'
      });
    } catch {}
  }

  return list;
}

export const synthesizeToolTool: AgentTool = {
  name: 'synthesize_tool',
  description: 'Synthesizes a new custom tool to perform a specific task when existing tools are insufficient. The tool will be proposed to the user for approval before dynamic registration.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'The snake_case name of the new tool (e.g. parse_ini_file)'
      },
      description: {
        type: 'string',
        description: 'A detailed description of what the tool does, guiding the AI on when to use it.'
      },
      parameters: {
        type: 'object',
        description: 'The schema properties definition for parameters (following standard ToolParameter structure)'
      },
      requiredParameters: {
        type: 'array',
        description: 'A list of parameter names that are required'
      },
      code: {
        type: 'string',
        description: 'The JavaScript code implementing the tool logic. The code must take an `args` object, perform operations, and return a ToolResult or JSON object.'
      }
    },
    required: ['name', 'description', 'parameters', 'requiredParameters', 'code']
  },
  async execute(args, onUpdate?: (msg: string) => void, emitEvent?: (event: any) => void) {
    const { checkToolPermission } = require('./permission-checker');
    const perm = await checkToolPermission('synthesize_tool', args, onUpdate, emitEvent);
    if (!perm.approved) {
      return { success: false, output: perm.error || 'Permission denied by user for synthesize_tool.' };
    }

    const name = String(args.name).trim();
    const description = String(args.description).trim();
    const code = String(args.code);
    const properties = (args.parameters || {}) as Record<string, any>;
    const required = (args.requiredParameters || []) as string[];

    const toolData: SynthesizedToolData = {
      name,
      description,
      parameters: {
        type: 'object',
        properties,
        required
      },
      code
    };

    // Save as pending tool first
    const pendingDir = getPendingToolsDir();
    fs.writeFileSync(path.join(pendingDir, `${name}.json`), JSON.stringify(toolData, null, 2), 'utf8');

    return {
      success: true,
      output: `Success: Tool "${name}" has been successfully synthesized and queued for user approval.`
    };
  }
};

export const synthesizeSkillTool: AgentTool = {
  name: 'synthesize_skill',
  description: 'Synthesizes a new reusable expert skill containing system instructions, guidelines, and context. The skill will be proposed to the user for approval before dynamic registration.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'The snake_case name of the new skill (e.g. tailwind-button-expert)'
      },
      description: {
        type: 'string',
        description: 'A detailed description of what this skill is for and when to use it.'
      },
      content: {
        type: 'string',
        description: 'The markdown instruction content of the skill (e.g., guidelines, styles, patterns, code examples).'
      }
    },
    required: ['name', 'description', 'content']
  },
  async execute(args, onUpdate?: (msg: string) => void, emitEvent?: (event: any) => void) {
    const { checkToolPermission } = require('./permission-checker');
    const perm = await checkToolPermission('synthesize_skill', args, onUpdate, emitEvent);
    if (!perm.approved) {
      return { success: false, output: perm.error || 'Permission denied by user for synthesize_skill.' };
    }

    const name = String(args.name).trim();
    const description = String(args.description).trim();
    const content = String(args.content);

    try {
      const { saveCustomSkill } = require('../../lib/skills-sync');
      await saveCustomSkill(name, description, content);
      return {
        success: true,
        output: `Success: Skill "${name}" has been successfully synthesized and registered as a reusable expert skill.`
      };
    } catch (err: any) {
      return {
        success: false,
        output: `Error registering skill: ${err.message || String(err)}`
      };
    }
  }
};

