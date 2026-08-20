import { ipcMain } from 'electron';
import { dbOps } from '../../lib/db';

export function registerRollbackHandlers(): void {
  ipcMain.handle('agent:rollback-turn', async (_event, conversationId: string, timestamp: number) => {
    const { getRollbackManager } = require('../../agent/persistence/rollback-manager');
    const manager = getRollbackManager();
    await manager.initialize();
    const result = await manager.rollbackSinceTimestamp(conversationId, timestamp);
    return result;
  });

  ipcMain.handle('agent:get-rollback-changes', async (_event, conversationId: string, timestamp: number) => {
    const { getRollbackManager } = require('../../agent/persistence/rollback-manager');
    const manager = getRollbackManager();
    await manager.initialize();
    
    // Fetch files that would be reverted
    const fileRows = await dbOps.all(
      `SELECT file_path, operation, timestamp FROM file_snapshots
       WHERE task_id = ? AND timestamp >= ?
       ORDER BY timestamp DESC`,
      [conversationId, timestamp]
    );

    // Fetch commands that would be reverted
    const cmdRows = await dbOps.all(
      `SELECT command, reversible, timestamp FROM command_history
       WHERE task_id = ? AND timestamp >= ?
       ORDER BY timestamp DESC`,
      [conversationId, timestamp]
    );

    return {
      files: fileRows.map((r: any) => ({
        path: r.file_path,
        operation: r.operation,
        timestamp: r.timestamp
      })),
      commands: cmdRows.map((r: any) => ({
        command: r.command,
        reversible: r.reversible,
        timestamp: r.timestamp
      }))
    };
  });

  ipcMain.handle('agent:get-rollback-preview', async (_event, conversationId: string, timestamp: number) => {
    const { getRollbackManager } = require('../../agent/persistence/rollback-manager');
    const manager = getRollbackManager();
    await manager.initialize();
    const preview = await manager.getRollbackPreviewByTimestamp(conversationId, timestamp);
    return preview;
  });

  ipcMain.handle('agent:get-snapshot-content', async (_event, snapshotId: string) => {
    const { getRollbackManager } = require('../../agent/persistence/rollback-manager');
    const manager = getRollbackManager();
    await manager.initialize();
    const content = await manager.getSnapshotContent(snapshotId);
    return content;
  });
}
