import { createHash } from 'crypto';

// PERF: Length threshold at which we fall back to hash-based keys to prevent memory bloat
const MAX_INLINE_KEY_LENGTH = 2048;

export interface CacheEntry {
  result: any;
  timestamp: number;
}

export class ToolCache {
  private cache = new Map<string, CacheEntry>();
  
  // List of read-only tools whose results can be safely cached within an execution loop
  private readonly readOnlyTools = new Set(['read_file', 'list_dir', 'grep_search']);
  
  // List of write/exec tools that must invalidate the cache immediately upon call
  private readonly modifyingTools = new Set([
    'write_to_file', 
    'replace_file_content', 
    'multi_replace_file_content',
    'run_command',
    'terminal_execute',
    'spawn_agent',
    'browser_subagent',
    'navis'
  ]);

  private getCacheKey(toolName: string, args: any): string {
    // PERF: Use direct string key instead of SHA-256 for in-memory cache.
    // Only fall back to hash for very large args to prevent memory bloat.
    const serializedArgs = JSON.stringify(args || {});
    if (serializedArgs.length > MAX_INLINE_KEY_LENGTH) {
      return `${toolName}:${createHash('md5').update(serializedArgs).digest('hex')}`;
    }
    return `${toolName}:${serializedArgs}`;
  }

  public get(toolName: string, args: any): any | null {
    if (!this.readOnlyTools.has(toolName)) return null;
    
    const key = this.getCacheKey(toolName, args);
    const entry = this.cache.get(key);
    
    if (entry) {
      console.log(`[ToolCache] ⚡ Cache hit for "${toolName}"`);
      return entry.result;
    }
    return null;
  }

  public set(toolName: string, args: any, result: any): void {
    if (!this.readOnlyTools.has(toolName)) return;
    
    const key = this.getCacheKey(toolName, args);
    this.cache.set(key, {
      result,
      timestamp: Date.now()
    });
    console.log(`[ToolCache] 📥 Cached result for "${toolName}"`);
  }

  public interceptCall(toolName: string, args: any): any | null {
    // If it's a modifying action, invalidate cache before proceeding
    if (this.modifyingTools.has(toolName) || toolName.includes('write') || toolName.includes('replace') || toolName.includes('delete') || toolName.includes('create')) {
      this.invalidate();
      return null; // PERF: Modifying tools are never cached, skip key computation
    }
    
    // PERF: Only compute cache key for cacheable (read-only) tools
    if (!this.readOnlyTools.has(toolName)) return null;
    
    return this.get(toolName, args);
  }

  public invalidate(): void {
    if (this.cache.size > 0) {
      this.cache.clear();
      console.log(`[ToolCache] 🧹 Invalidated all cached tool outputs due to a state modification event`);
    }
  }
}

export const toolCache = new ToolCache();
