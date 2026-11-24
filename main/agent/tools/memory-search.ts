import { AgentTool, ToolResult } from '../runner/types';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { dbOps, ensureVectorTable } from '../../lib/db';
import { getEmbeddingModel, getSystemEmbeddingConfig } from '../../lib/embeddings';
import { nativeGraphOperation, runNativeGraphOperation } from '../learning/memory/persistent-memory';
import { currentScope } from '../agent-scope';

function getMemoryPath(): string {
  return path.join(os.homedir(), '.everfern', 'memory.md');
}

interface MemoryEntry {
  id?: string;
  embeddingText?: string;
  date: string;
  content: string;
  tags: string;
  preference: string;
  raw: string;
}

function parseEntries(text: string): MemoryEntry[] {
  const blocks = text.split(/\n---\s*\n/);
  const entries: MemoryEntry[] = [];

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed || trimmed === '# EverFern Memory Bank') continue;

    const dateMatch = trimmed.match(/^## (.+)$/m);
    const contentMatch = trimmed.match(/\*\*Content:\*\*\s*(.+)/);
    const tagsMatch = trimmed.match(/\*\*Tags:\*\*\s*(.+)/);
    const prefMatch = trimmed.match(/\*\*Preference:\*\*\s*(.+)/);

    if (contentMatch) {
      entries.push({
        date: dateMatch ? dateMatch[1].trim() : '',
        content: contentMatch[1].trim(),
        tags: tagsMatch ? tagsMatch[1].trim() : '',
        preference: prefMatch ? prefMatch[1].trim() : '',
        raw: trimmed,
      });
    }
  }

  return entries;
}

function scoreEntry(entry: MemoryEntry, queryWords: string[], query: string): number {
  let score = 0;
  const lowerContent = entry.content.toLowerCase();
  const lowerTags = entry.tags.toLowerCase();
  const lowerQuery = query.toLowerCase();

  // Exact phrase match scores highest
  if (lowerContent.includes(lowerQuery)) score += 10;
  if (lowerTags.includes(lowerQuery)) score += 8;

  // Individual word matches
  for (const word of queryWords) {
    if (lowerContent.includes(word)) score += 3;
    if (lowerTags.includes(word)) score += 2;
    if (entry.preference.toLowerCase().includes(word)) score += 1;
  }

  return score;
}

export const memorySearchTool: AgentTool = {
  name: 'memory_search',
  description: 'Search local memory using vector similarity and keyword matching. Use this to recall past context, user facts, or preferences.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query or keywords to find.' },
      limit: { type: 'number', description: 'Maximum number of results to return (default 5)' }
    },
    required: ['query']
  },
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const query = (args.query as string || '').trim();
      const limit = (args.limit as number) || 5;
      if (!query) return { success: true, output: 'No query provided.' };

      const native = process.env.EVERFERN_SHELL === 'tauri' && process.env.EF_NATIVE_EXE;
      let entries: MemoryEntry[];
      let nativeFallback: ToolResult | undefined;
      if (native) {
        try {
          return await runNativeGraphOperation<ToolResult>(native, { operation: 'search', query, limit, scope: currentScope() });
        } catch {
          // The compatibility path can still obtain embeddings from the local model.
        }
        const result = nativeGraphOperation(native, { operation: 'search-bank', query, limit });
        entries = result.entries;
        nativeFallback = result.fallback;
      } else {
        const filePath = getMemoryPath();
        if (!fs.existsSync(filePath)) {
          return { success: true, output: 'No memories found. The memory file does not exist yet.' };
        }
        entries = parseEntries(fs.readFileSync(filePath, 'utf-8'));
      }

      if (entries.length === 0) {
        return nativeFallback ?? { success: true, output: 'No memories found in the memory file.' };
      }

      // Keyword fallback score method
      const runKeywordSearch = () => {
        if (nativeFallback) return nativeFallback;
        const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        const scored = entries.map((e, i) => ({
          entry: e,
          score: scoreEntry(e, queryWords, query) + (i / entries.length) * 0.5,
        }));

        const ranked = scored
          .filter(s => s.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);

        if (ranked.length === 0) {
          return { success: true, output: 'No relevant memories found.' };
        }

        const output = ranked.map((r, i) =>
          `[Result ${i + 1}] (Relevance: ${r.score.toFixed(2)})\nDate: ${r.entry.date}\n${r.entry.content}${r.entry.tags ? `\nTags: ${r.entry.tags}` : ''}${r.entry.preference ? `\nPreference: ${r.entry.preference}` : ''}`
        ).join('\n\n');

        let hasPreference = false;
        let preferenceText = '';
        let preferenceType = '';
        for (const r of ranked) {
          if (r.entry.preference) {
            hasPreference = true;
            preferenceText = r.entry.content;
            preferenceType = r.entry.preference;
            break;
          }
        }

        return {
          success: true,
          output,
          data: { hasPreference, preferenceText, preferenceType, resultCount: ranked.length },
        };
      };

      // Try vector search
      try {
        const config = getSystemEmbeddingConfig();
        const { embeddings, dimensions } = getEmbeddingModel(config);
        if (!native) await ensureVectorTable(dimensions);

        // Sync local memory file into memory_chunks database table
        const rows: Array<{ id: string }> = native
          ? nativeGraphOperation(native, { operation: 'vector-ids', scope: currentScope() })
          : await dbOps.all('SELECT id FROM memory_chunks');
        const existingIds = new Set(rows.map(r => r.id));

        const currentIdsMap = new Map<string, MemoryEntry>();
        for (const entry of entries) {
          const id = entry.id ?? crypto.createHash('sha256').update(entry.date + '::' + entry.content).digest('hex');
          currentIdsMap.set(id, entry);
        }

        const additions: Array<{ id: string; content: string; metadata: object; vector: number[] }> = [];
        // 1. Delete removed memories from DB (the Rust path does this in the sync transaction).
        for (const id of existingIds) {
          if (!native && !currentIdsMap.has(id)) {
            await dbOps.run('DELETE FROM memory_chunks WHERE id = ?', [id]);
            await dbOps.run('DELETE FROM memory_chunks_vec WHERE id = ?', [id]);
          }
        }

        // 2. Embed and insert missing memories
        for (const [id, entry] of currentIdsMap.entries()) {
          if (!existingIds.has(id)) {
            const textToEmbed = entry.embeddingText ??
              (entry.content + (entry.tags ? ` Tags: ${entry.tags}` : '') + (entry.preference ? ` Preference: ${entry.preference}` : ''));
            const vector = await embeddings.embedQuery(textToEmbed);
            if (native) {
              additions.push({ id, content: entry.content, vector,
                metadata: { date: entry.date, tags: entry.tags, preference: entry.preference } });
              continue;
            }
            const vectorBuffer = Buffer.from(new Float32Array(vector).buffer);

            await dbOps.run('BEGIN TRANSACTION');
            try {
              await dbOps.run(
                'INSERT OR REPLACE INTO memory_chunks (id, text_content, metadata) VALUES (?, ?, ?)',
                [id, entry.content, JSON.stringify({ date: entry.date, tags: entry.tags, preference: entry.preference })]
              );
              await dbOps.run(
                'INSERT OR REPLACE INTO memory_chunks_vec (id, embedding) VALUES (?, ?)',
                [id, vectorBuffer]
              );
              await dbOps.run('COMMIT');
            } catch (e) {
              await dbOps.run('ROLLBACK').catch(() => {});
              throw e;
            }
          }
        }
        if (native) {
          nativeGraphOperation(native, { operation: 'sync-vectors', scope: currentScope(),
            ids: [...currentIdsMap.keys()], additions });
        }

        // 3. Perform vector similarity query
        const queryVector = await embeddings.embedQuery(query);
        if (native) {
          const result: ToolResult | null = nativeGraphOperation(native, {
            operation: 'search-vectors', scope: currentScope(), vector: queryVector, limit,
          });
          return result ?? runKeywordSearch();
        }
        const results = await dbOps.all(
          'SELECT mc.id, mc.text_content as content, mc.metadata, vec_distance_cosine(v.embedding, ?) as distance FROM memory_chunks_vec v JOIN memory_chunks mc ON v.id = mc.id ORDER BY distance ASC LIMIT ?',
          [Buffer.from(new Float32Array(queryVector).buffer), limit]
        );

        if (!results || results.length === 0) {
          return runKeywordSearch();
        }

        const ranked = results.map((r, i) => {
          let metadata = { date: '', tags: '', preference: '' };
          try {
            metadata = JSON.parse(r.metadata);
          } catch {}
          const similarity = 1 - r.distance; // cosine distance to cosine similarity
          return {
            content: r.content,
            date: metadata.date,
            tags: metadata.tags,
            preference: metadata.preference,
            similarity
          };
        });

        const output = ranked.map((r, i) =>
          `[Result ${i + 1}] (Relevance: ${r.similarity.toFixed(4)})\nDate: ${r.date}\n${r.content}${r.tags ? `\nTags: ${r.tags}` : ''}${r.preference ? `\nPreference: ${r.preference}` : ''}`
        ).join('\n\n');

        let hasPreference = false;
        let preferenceText = '';
        let preferenceType = '';
        for (const r of ranked) {
          if (r.preference) {
            hasPreference = true;
            preferenceText = r.content;
            preferenceType = r.preference;
            break;
          }
        }

        console.log(`[MemorySearch] Vector search completed with ${ranked.length} results`);

        return {
          success: true,
          output,
          data: { hasPreference, preferenceText, preferenceType, resultCount: ranked.length },
        };

      } catch (vectorErr: any) {
        console.warn('[MemorySearch] Vector search failed, falling back to keyword search:', vectorErr.message);
        return runKeywordSearch();
      }
    } catch (err: any) {
      return { success: false, output: `Failed to search memory: ${err.message}` };
    }
  }
};
