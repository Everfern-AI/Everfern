import { ipcMain, BrowserWindow } from 'electron';
import { mcpRegistry, parseMcpJson, type MCPConfig } from '../agent/tools/mcp';

const ok = <T>(data?: T) => ({ success: true as const, data });
const fail = (e: unknown) => ({ success: false as const, error: e instanceof Error ? e.message : String(e) });

export function registerMcpHandlers() {
  // Push status changes (connecting -> connected/error) to every window.
  let pending: NodeJS.Timeout | null = null;
  mcpRegistry.onChange(() => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      const status = mcpRegistry.status();
      for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('mcp:changed', status);
    }, 80);
  });

  ipcMain.handle('mcp:list', () => mcpRegistry.status());

  ipcMain.handle('mcp:sync-saved', async (_e, request: { serverNames?: unknown; removedNames?: unknown }) => {
    try {
      const count = await mcpRegistry.syncSaved(request?.serverNames, request?.removedNames);
      return ok(count);
    } catch (e) { return fail(e); }
  });

  ipcMain.handle('mcp:save', async (_e, config: MCPConfig, previousName?: string) => {
    try {
      if (previousName && previousName !== config.name) await mcpRegistry.removeServer(previousName);
      const count = await mcpRegistry.registerServer(config);
      return ok(count);
    } catch (e) { return fail(e); }
  });

  ipcMain.handle('mcp:remove', async (_e, name: string) => {
    try { await mcpRegistry.removeServer(name); return ok(); } catch (e) { return fail(e); }
  });

  ipcMain.handle('mcp:set-enabled', async (_e, name: string, enabled: boolean) => {
    try { await mcpRegistry.setEnabled(name, enabled); return ok(); } catch (e) { return fail(e); }
  });

  ipcMain.handle('mcp:reconnect', async (_e, name: string) => {
    try { await mcpRegistry.reconnect(name); return ok(); } catch (e) { return fail(e); }
  });

  // Paste a Claude Desktop / Cursor style { "mcpServers": {...} } block.
  ipcMain.handle('mcp:import-json', async (_e, text: string) => {
    try {
      const configs = parseMcpJson(text);
      if (configs.length === 0) return fail('No servers found. Expected { "mcpServers": { "name": { "command": ... } } }.');
      // Save all first, then connect in parallel.
      await Promise.all(configs.map(c => mcpRegistry.registerServer(c).catch(() => 0)));
      return ok(configs.map(c => c.name));
    } catch (e) { return fail(e); }
  });
}
