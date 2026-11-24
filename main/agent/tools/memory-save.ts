import { AgentTool, ToolResult } from '../runner/types';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';

function getMemoryPath(): string {
  const dir = path.join(os.homedir(), '.everfern');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'memory.md');
}

function detectPreference(content: string): boolean {
  const lower = content.toLowerCase();
  const strongIndicators = [
    /\bprefer(s|red|ence)?\b/, /\bchoose(s|chose|choice)?\b/,
    /\bselect(s|ed|ion)?\b/, /\blike(s|d)?\s+(to|using|when)\b/,
    /\bwant(s|ed)?\s+(to|me to)\b/, /\balways\s+(use|do|want|prefer)/,
    /\busually\s+(use|do|want|prefer)/, /\btypically\s+(use|do|want|prefer)/,
    /\bdefault\s+(to|is|should be)/, /\bfavorite\b/, /\bgo-to\b/,
  ];
  const weakIndicators = [
    /\bshould\s+(always|use|do)\b/, /\bdon't\s+(like|want|use)\b/,
    /\bavoid\b/, /\bnever\s+(use|do|want)\b/,
  ];
  if (strongIndicators.some(p => p.test(lower))) return true;
  return weakIndicators.filter(p => p.test(lower)).length >= 2;
}

function classifyPreferenceType(content: string): string {
  const lower = content.toLowerCase();
  if (/\b(format|style|layout|design|theme|color)\b/.test(lower)) return 'formatting';
  if (/\b(report|output|display|show|view)\b/.test(lower)) return 'output';
  if (/\b(workflow|process|approach|method|way)\b/.test(lower)) return 'workflow';
  if (/\b(tool|library|framework|language|tech)\b/.test(lower)) return 'technology';
  if (/\b(communication|notify|alert|message)\b/.test(lower)) return 'communication';
  return 'general';
}

export const memorySaveTool: AgentTool = {
  name: 'memory_save',
  description: 'Save important facts, user preferences, or context into a local markdown memory file.',
  parameters: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'The core textual content or fact to memorize.' },
      tags: { type: 'string', description: 'Optional comma-separated tags for grouping.' }
    },
    required: ['content']
  },
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const content = (args.content as string || '').trim();
      if (!content) return { success: false, output: 'No content provided.' };

      const tags = args.tags as string || '';
      const native = process.env.EVERFERN_SHELL === 'tauri' && process.env.EF_NATIVE_EXE;
      if (native) {
        return await new Promise<ToolResult>((resolve, reject) => {
          const child = execFile(native, ['--ef-memory-graph'], {
            encoding: 'utf8', windowsHide: true, timeout: 10000,
          }, (error, stdout) => {
            if (error) return reject(error);
            try {
              resolve(JSON.parse(stdout));
            } catch (parseError) {
              reject(parseError);
            }
          });
          child.stdin?.on('error', reject);
          child.stdin?.end(JSON.stringify({ operation: 'save-direct', content, tags }));
        });
      }
      const now = new Date();
      const dateStr = now.toDateString() + ' ' + now.toLocaleTimeString();
      const isPreference = detectPreference(content);
      const prefType = isPreference ? classifyPreferenceType(content) : '';
      const tagLine = tags ? `**Tags:** ${tags}` : '';
      const prefLine = isPreference ? `**Preference:** ${prefType}` : '';

      const entry = [
        '',
        `## ${dateStr}`,
        '',
        `**Content:** ${content}`,
        tagLine,
        prefLine,
        '---',
      ].filter(l => l).join('\n') + '\n';

      const filePath = getMemoryPath();
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, `# EverFern Memory Bank\n\n`);
      }
      fs.appendFileSync(filePath, entry, 'utf-8');

      const suffix = isPreference ? ` [Tagged as ${prefType} preference]` : '';
      return {
        success: true,
        output: `Saved memory chunk: "${content.substring(0, 50)}..."${suffix}`,
      };
    } catch (err: any) {
      return { success: false, output: `Failed to save memory: ${err.message}` };
    }
  }
};
