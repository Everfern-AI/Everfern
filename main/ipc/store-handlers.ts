import { ipcMain } from 'electron';
import { listArtifacts, readArtifact, writeArtifact, deleteArtifact } from '../store/artifacts';
import { listPlans, readPlan, writePlan, deletePlan } from '../store/plans';
import { listSites, readSiteFile, writeSiteFile, deleteSite } from '../store/sites';

// MP-SEC-02: store helpers throw on renderer-supplied identifiers/paths that
// escape their sandbox roots; convert those rejections to each endpoint's
// existing failure shape instead of leaking raw errors to the renderer.
function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function registerStoreHandlers() {
  // Artifacts
  ipcMain.handle('artifacts:list', async (_e, chatId?: string, projectPath?: string) => {
    try {
      return await listArtifacts(chatId, projectPath);
    } catch (err) {
      console.error('[StoreHandlers] artifacts:list rejected:', errMessage(err));
      return [];
    }
  });
  ipcMain.handle('artifacts:read', async (_e, chatId: string, filename: string, projectPath?: string) => {
    try {
      return await readArtifact(chatId, filename, projectPath);
    } catch (err) {
      console.error('[StoreHandlers] artifacts:read rejected:', errMessage(err));
      return null;
    }
  });
  ipcMain.handle('artifacts:write', async (_e, chatId: string, filename: string, content: string, projectPath?: string) => {
    try {
      return await writeArtifact(chatId, filename, content, projectPath);
    } catch (err) {
      console.error('[StoreHandlers] artifacts:write rejected:', errMessage(err));
      return { success: false, error: errMessage(err) };
    }
  });
  ipcMain.handle('artifacts:delete', async (_e, chatId: string, filename: string, projectPath?: string) => {
    try {
      return await deleteArtifact(chatId, filename, projectPath);
    } catch (err) {
      console.error('[StoreHandlers] artifacts:delete rejected:', errMessage(err));
      return { success: false };
    }
  });

  // Plans
  ipcMain.handle('plans:list', async (_e, chatId: string) => {
    try {
      return await listPlans(chatId);
    } catch (err) {
      console.error('[StoreHandlers] plans:list rejected:', errMessage(err));
      return [];
    }
  });
  ipcMain.handle('plans:read', async (_e, chatId: string, filename: string) => {
    try {
      return await readPlan(chatId, filename);
    } catch (err) {
      console.error('[StoreHandlers] plans:read rejected:', errMessage(err));
      return null;
    }
  });
  ipcMain.handle('plans:write', async (_e, chatId: string, filename: string, content: string) => {
    try {
      return await writePlan(chatId, filename, content);
    } catch (err) {
      console.error('[StoreHandlers] plans:write rejected:', errMessage(err));
      return { success: false, error: errMessage(err) };
    }
  });
  ipcMain.handle('plans:delete', async (_e, chatId: string, filename: string) => {
    try {
      return await deletePlan(chatId, filename);
    } catch (err) {
      console.error('[StoreHandlers] plans:delete rejected:', errMessage(err));
      return { success: false };
    }
  });

  // Sites
  ipcMain.handle('sites:list', async () => {
    try {
      return await listSites();
    } catch (err) {
      console.error('[StoreHandlers] sites:list rejected:', errMessage(err));
      return [];
    }
  });
  ipcMain.handle('sites:read-file', async (_e, siteName: string, filePath: string) => {
    try {
      return await readSiteFile(siteName, filePath);
    } catch (err) {
      console.error('[StoreHandlers] sites:read-file rejected:', errMessage(err));
      return null;
    }
  });
  ipcMain.handle('sites:write-file', async (_e, siteName: string, filePath: string, content: string) => {
    try {
      return await writeSiteFile(siteName, filePath, content);
    } catch (err) {
      console.error('[StoreHandlers] sites:write-file rejected:', errMessage(err));
      return { success: false, error: errMessage(err) };
    }
  });
  ipcMain.handle('sites:delete', async (_e, name: string) => {
    try {
      return await deleteSite(name);
    } catch (err) {
      console.error('[StoreHandlers] sites:delete rejected:', errMessage(err));
      return { success: false };
    }
  });
}
