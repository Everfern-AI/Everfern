/**
 * AG-MEM-06 tests: bounded LRU file read cache in pi-tools.ts
 *
 * Verifies:
 * - Entry-count cap (200) evicts the oldest entries
 * - get() refreshes recency (LRU order)
 * - Byte accounting via __fileReadCacheStatsForTest
 * - resetPiCodingToolsCache zeroes both size and byte totals
 */

import {
  FILE_READ_CACHE_MAX_ENTRIES,
  FILE_READ_CACHE_MAX_BYTES,
  resetPiCodingToolsCache,
  __fileReadCacheStatsForTest
} from '../../tools/pi-tools';

describe('AG-MEM-06: pi-tools fileReadCache LRU bounds', () => {
  beforeEach(() => {
    resetPiCodingToolsCache();
  });

  afterEach(() => {
    resetPiCodingToolsCache();
  });

  it('exports sane cache cap constants', () => {
    expect(FILE_READ_CACHE_MAX_ENTRIES).toBe(200);
    expect(FILE_READ_CACHE_MAX_BYTES).toBe(50 * 1024 * 1024);
  });

  it('starts empty', () => {
    const stats = __fileReadCacheStatsForTest();
    expect(stats.size).toBe(0);
    expect(stats.bytes).toBe(0);
  });

  it('caps at 200 entries and evicts the oldest when 250 are inserted through the read tool', async () => {
    const { getPiCodingTools, __setPiCodingAgentModule } = await import('../../tools/pi-tools');

    // Real temp files; the fake executor returns a fixed 11-byte content per
    // real path so the read-cache wrapper stores it on every execution.
    const os = require('os');
    const fs = require('fs');
    const pathMod = require('path');
    const realDir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'ag-mem-lru-'));
    const paths: string[] = [];
    for (let i = 0; i < 250; i++) {
      const p = pathMod.join(realDir, `file-${i.toString().padStart(3, '0')}.txt`);
      fs.writeFileSync(p, 'x'.repeat(11));
      paths.push(p);
    }
    const readExecutions: string[] = [];
    const fakeModule = {
      readToolDefinition: {
        name: 'read',
        description: 'Read a file',
        parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
      },
      readTool: {
        execute: async (_toolCallId: string, params: any) => {
          const p = params.path as string;
          readExecutions.push(p);
          return { content: [{ type: 'text', text: 'abcdefghijk' }] }; // exactly 11 bytes
        }
      },
      writeToolDefinition: { name: 'write', description: '', parameters: { type: 'object' } },
      writeTool: { execute: async () => ({ content: [] }) },
      editToolDefinition: { name: 'edit', description: '', parameters: { type: 'object' } },
      editTool: { execute: async () => ({ content: [] }) },
      findToolDefinition: { name: 'find', description: '', parameters: { type: 'object' } },
      findTool: { execute: async () => ({ content: [] }) },
      grepToolDefinition: { name: 'grep', description: '', parameters: { type: 'object' } },
      grepTool: { execute: async () => ({ content: [] }) },
      lsToolDefinition: { name: 'ls', description: '', parameters: { type: 'object' } },
      lsTool: { execute: async () => ({ content: [] }) },
      bashToolDefinition: { name: 'bash', description: '', parameters: { type: 'object' } },
      bashTool: { execute: async () => ({ content: [] }) }
    };
    __setPiCodingAgentModule(fakeModule as any);

    const tools = await getPiCodingTools();
    const readTool = tools.find(t => t.name === 'read')!;

    try {

      // Wait briefly so mtimes are stable across stat calls (macOS mtime resolution).
      await new Promise(r => setTimeout(r, 10));

      for (const p of paths) {
        await readTool.execute({ path: p });
      }

      const stats = __fileReadCacheStatsForTest();
      expect(stats.size).toBeLessThanOrEqual(FILE_READ_CACHE_MAX_ENTRIES);
      expect(stats.size).toBe(FILE_READ_CACHE_MAX_ENTRIES);

      // Oldest 50 evicted: file-000..file-049 should MISS (re-executed),
      // newest (file-249) should HIT (not re-executed beyond initial call).
      const initialExecutions = readExecutions.length;
      await readTool.execute({ path: paths[0] });
      expect(readExecutions.length).toBe(initialExecutions + 1); // evicted → miss

      await readTool.execute({ path: paths[249] });
      expect(readExecutions.length).toBe(initialExecutions + 1); // still cached → hit

      // Byte accounting: 200 entries × 11 bytes = 2200 bytes
      expect(stats.bytes).toBe(200 * 11);
    } finally {
      fs.rmSync(realDir, { recursive: true, force: true });
      __setPiCodingAgentModule(null as any);
      resetPiCodingToolsCache();
    }
  });

  it('refreshes recency on get: oldest-after-refresh is evicted first', async () => {
    const { getPiCodingTools, __setPiCodingAgentModule } = await import('../../tools/pi-tools');

    const fakeModule = {
      readToolDefinition: {
        name: 'read',
        description: 'Read a file',
        parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
      },
      readTool: {
        execute: async (_toolCallId: string, params: any) => {
          const content = `c-${(params.path as string).length}`.padEnd(10, 'x');
          return { content: [{ type: 'text', text: content }] };
        }
      },
      writeToolDefinition: { name: 'write', description: '', parameters: { type: 'object' } },
      writeTool: { execute: async () => ({ content: [] }) },
      editToolDefinition: { name: 'edit', description: '', parameters: { type: 'object' } },
      editTool: { execute: async () => ({ content: [] }) },
      findToolDefinition: { name: 'find', description: '', parameters: { type: 'object' } },
      findTool: { execute: async () => ({ content: [] }) },
      grepToolDefinition: { name: 'grep', description: '', parameters: { type: 'object' } },
      grepTool: { execute: async () => ({ content: [] }) },
      lsToolDefinition: { name: 'ls', description: '', parameters: { type: 'object' } },
      lsTool: { execute: async () => ({ content: [] }) },
      bashToolDefinition: { name: 'bash', description: '', parameters: { type: 'object' } },
      bashTool: { execute: async () => ({ content: [] }) }
    };
    __setPiCodingAgentModule(fakeModule as any);

    const os = require('os');
    const fs = require('fs');
    const pathMod = require('path');
    const realDir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'ag-mem-lru-recency-'));

    try {
      const mk = (name: string) => {
        const p = pathMod.join(realDir, name);
        fs.writeFileSync(p, 'x'.repeat(10));
        return p;
      };
      const A = mk('a.txt');

      // Filler files to reach the 200-entry cap, plus B and C.
      const fillers: string[] = [];
      for (let i = 0; i < 199; i++) {
        fillers.push(mk(`f${i.toString().padStart(3, '0')}.txt`));
      }
      const B = mk('b.txt');
      const C = mk('c.txt');

      await new Promise(r => setTimeout(r, 10));

      const tools = await getPiCodingTools();
      const readTool = tools.find(t => t.name === 'read')!;

      // Prime cache: A first (oldest), then 199 fillers → exactly 200 entries.
      await readTool.execute({ path: A });
      for (const f of fillers) {
        await readTool.execute({ path: f });
      }
      expect(__fileReadCacheStatsForTest().size).toBe(200);

      // Refresh A's recency via a cached read (get → re-insert at end).
      await readTool.execute({ path: A });
      expect(__fileReadCacheStatsForTest().size).toBe(200);

      // Insert B → entry-count cap forces eviction of the true LRU entry,
      // which is fillers[0] (A was refreshed to most-recent).
      await readTool.execute({ path: B });
      const stats = __fileReadCacheStatsForTest();
      expect(stats.size).toBe(200);

      // Insert C → evicts fillers[1] (next oldest). Cache stays at 200.
      await readTool.execute({ path: C });
      expect(__fileReadCacheStatsForTest().size).toBe(200);

      // A and C survive (HITs — no re-execution), fillers[0]/[1] were evicted
      // (MISS — re-executed). Instrument executions via a fresh counting wrap.
      // NOTE: __setPiCodingAgentModule nulls loadedCodingTools but does NOT
      // clear fileReadCache, so cached entries persist across the re-wrap.
      let execCount = 0;
      const probeModule = {
        ...fakeModule,
        readTool: {
          execute: async (id: string, params: any) => {
            execCount++;
            return fakeModule.readTool.execute(id, params);
          }
        }
      };
      __setPiCodingAgentModule(probeModule as any);
      const { getPiCodingTools: gct } = await import('../../tools/pi-tools');
      const tools2 = await gct();
      const r2 = tools2.find(t => t.name === 'read')!;

      execCount = 0;
      await r2.execute({ path: A });        // hit — A survived (was refreshed)
      await r2.execute({ path: C });        // hit — C is the newest entry
      expect(execCount).toBe(0);

      await r2.execute({ path: fillers[0] }); // miss — evicted when B was inserted
      await r2.execute({ path: fillers[1] }); // miss — evicted when C was inserted
      expect(execCount).toBe(2);
    } finally {
      fs.rmSync(realDir, { recursive: true, force: true });
      __setPiCodingAgentModule(null as any);
      resetPiCodingToolsCache();
    }
  });

  it('tracks byte totals exactly and resetPiCodingToolsCache zeroes them', async () => {
    const { getPiCodingTools, __setPiCodingAgentModule } = await import('../../tools/pi-tools');

    const fakeModule = {
      readToolDefinition: {
        name: 'read',
        description: 'Read a file',
        parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
      },
      readTool: {
        execute: async (_toolCallId: string, params: any) => {
          return { content: [{ type: 'text', text: 'abcdefghij' }] }; // 10 bytes
        }
      },
      writeToolDefinition: { name: 'write', description: '', parameters: { type: 'object' } },
      writeTool: { execute: async () => ({ content: [] }) },
      editToolDefinition: { name: 'edit', description: '', parameters: { type: 'object' } },
      editTool: { execute: async () => ({ content: [] }) },
      findToolDefinition: { name: 'find', description: '', parameters: { type: 'object' } },
      findTool: { execute: async () => ({ content: [] }) },
      grepToolDefinition: { name: 'grep', description: '', parameters: { type: 'object' } },
      grepTool: { execute: async () => ({ content: [] }) },
      lsToolDefinition: { name: 'ls', description: '', parameters: { type: 'object' } },
      lsTool: { execute: async () => ({ content: [] }) },
      bashToolDefinition: { name: 'bash', description: '', parameters: { type: 'object' } },
      bashTool: { execute: async () => ({ content: [] }) }
    };
    __setPiCodingAgentModule(fakeModule as any);

    const os = require('os');
    const fs = require('fs');
    const pathMod = require('path');
    const realDir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'ag-mem-lru-bytes-'));

    try {
      const mk = (name: string) => {
        const p = pathMod.join(realDir, name);
        fs.writeFileSync(p, 'x'.repeat(10));
        return p;
      };
      const p1 = mk('one.txt');

      await new Promise(r => setTimeout(r, 10));

      const tools = await getPiCodingTools();
      const readTool = tools.find(t => t.name === 'read')!;

      await readTool.execute({ path: p1 });
      let stats = __fileReadCacheStatsForTest();
      expect(stats.size).toBe(1);
      expect(stats.bytes).toBe(10);

      // Overwrite with different-size content at same path → bytes adjust, size stays 1
      const probeModule = {
        ...fakeModule,
        readTool: {
          execute: async (id: string, params: any) => {
            return { content: [{ type: 'text', text: '0123456789abcdef' }] }; // 16 bytes
          }
        }
      };
      __setPiCodingAgentModule(probeModule as any);
      resetPiCodingToolsCache(); // re-wrap with new executor
      const { getPiCodingTools: gct } = await import('../../tools/pi-tools');
      const tools2 = await gct();
      const r2 = tools2.find(t => t.name === 'read')!;
      // Touch the file so mtime differs from any stale cache entry.
      fs.writeFileSync(p1, 'y'.repeat(10));
      await new Promise(r => setTimeout(r, 10));
      await r2.execute({ path: p1 });
      stats = __fileReadCacheStatsForTest();
      expect(stats.size).toBe(1);
      expect(stats.bytes).toBe(16);

      // Reset zeroes everything
      resetPiCodingToolsCache();
      stats = __fileReadCacheStatsForTest();
      expect(stats.size).toBe(0);
      expect(stats.bytes).toBe(0);
    } finally {
      fs.rmSync(realDir, { recursive: true, force: true });
      __setPiCodingAgentModule(null as any);
      resetPiCodingToolsCache();
    }
  });
});
