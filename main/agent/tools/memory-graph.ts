import { AgentTool, ToolResult } from '../runner/types';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { addOrUpdateMemory, loadMemoryGraph, getMemoryDir } from '../learning/memory/persistent-memory';
import { getEmbeddingModel, getSystemEmbeddingConfig } from '../../lib/embeddings';

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

      await addOrUpdateMemory('fact', category, fact, 'PROJECT_STATE.md');
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
  description: 'Recalls saved memories from PROJECT_STATE.md and USER_PROFILE.md using vector similarity search, falling back to keyword matching if embedding service is offline.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query or keywords to find.' }
    },
    required: ['query']
  },
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const query = (args.query as string || '').trim();
      if (!query) return { success: false, output: 'No search query provided.' };

      let results: { text: string; score: number }[] = [];
      let isVectorSearch = false;

      // 1. Try vector semantic search
      try {
        const config = getSystemEmbeddingConfig();
        const { embeddings } = getEmbeddingModel(config);
        const queryVector = await embeddings.embedQuery(query);

        const graph = loadMemoryGraph();
        const nodesToSearch = graph.nodes.filter(
          n => n.type === 'fact' || n.type === 'preference' || n.type === 'habit'
        );

        const scoredNodes = [];
        for (const node of nodesToSearch) {
          const embedding = node.metadata?.embedding;
          if (Array.isArray(embedding) && embedding.length === 1536) {
            // Compute cosine similarity (dot product of normalized vectors)
            let dotProduct = 0;
            for (let i = 0; i < 1536; i++) {
              dotProduct += queryVector[i] * embedding[i];
            }
            // threshold check (e.g. 0.65)
            if (dotProduct >= 0.65) {
              scoredNodes.push({
                node,
                score: dotProduct
              });
            }
          }
        }

        if (scoredNodes.length > 0) {
          scoredNodes.sort((a, b) => b.score - a.score);

          results = scoredNodes.map(sn => {
            const file = sn.node.linkedFile || (sn.node.type === 'fact' ? 'PROJECT_STATE.md' : 'USER_PROFILE.md');
            const sourceLabel = file.toUpperCase().includes('PROJECT') ? 'Project State' : 'User Profile';
            return {
              text: `[${sourceLabel}] [${sn.node.category}] ${sn.node.value}`,
              score: sn.score
            };
          });

          isVectorSearch = true;
        }
      } catch (vectorErr: any) {
        console.warn('[recall_fact] Semantic vector search failed/unavailable, falling back to keyword search:', vectorErr.message);
      }

      // 2. Keyword fallback (if vector search didn't yield results or failed)
      if (results.length === 0) {
        const queryLower = query.toLowerCase();
        const dir = getMemoryDir();
        const projectPath = path.join(dir, 'PROJECT_STATE.md');
        const profilePath = path.join(dir, 'USER_PROFILE.md');

        if (fs.existsSync(projectPath)) {
          const content = fs.readFileSync(projectPath, 'utf-8');
          const sections = content.split('\n### ');
          for (const sec of sections) {
            if (sec.toLowerCase().includes(queryLower)) {
              results.push({
                text: `[Project State] ${sec.trim()}`,
                score: 1.0
              });
            }
          }
        }

        if (fs.existsSync(profilePath)) {
          const content = fs.readFileSync(profilePath, 'utf-8');
          const sections = content.split('\n### ');
          for (const sec of sections) {
            if (sec.toLowerCase().includes(queryLower)) {
              results.push({
                text: `[User Profile] ${sec.trim()}`,
                score: 1.0
              });
            }
          }
        }
      }

      if (results.length === 0) {
        return { success: true, output: `No facts matching query "${query}" were found.` };
      }

      const formattedResults = results.map((r, i) => {
        const relevanceStr = isVectorSearch ? ` (Relevance: ${(r.score * 100).toFixed(1)}%)` : '';
        return `[Result ${i + 1}]${relevanceStr}\n${r.text}`;
      }).join('\n\n---\n\n');

      return {
        success: true,
        output: `Found matches:\n\n${formattedResults}`
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

      await addOrUpdateMemory('preference', category, preference, 'USER_PROFILE.md');
      return {
        success: true,
        output: `Successfully updated user preference under category "${category}" in USER_PROFILE.md`
      };
    } catch (err: any) {
      return { success: false, output: `Failed to update user profile: ${err.message}` };
    }
  }
};
