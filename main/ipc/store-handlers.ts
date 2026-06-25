import { ipcMain } from 'electron';
import { listArtifacts, readArtifact, writeArtifact, deleteArtifact } from '../store/artifacts';
import { listPlans, readPlan, writePlan, deletePlan } from '../store/plans';
import { listSites, readSiteFile, writeSiteFile, deleteSite } from '../store/sites';

export function registerStoreHandlers() {
  // Artifacts
  ipcMain.handle('artifacts:list', async (_e, chatId?: string, projectPath?: string) => await listArtifacts(chatId, projectPath));
  ipcMain.handle('artifacts:read', async (_e, chatId: string, filename: string, projectPath?: string) => await readArtifact(chatId, filename, projectPath));
  ipcMain.handle('artifacts:write', async (_e, chatId: string, filename: string, content: string, projectPath?: string) => await writeArtifact(chatId, filename, content, projectPath));
  ipcMain.handle('artifacts:delete', async (_e, chatId: string, filename: string, projectPath?: string) => await deleteArtifact(chatId, filename, projectPath));

  // Plans
  ipcMain.handle('plans:list', async (_e, chatId: string) => await listPlans(chatId));
  ipcMain.handle('plans:read', async (_e, chatId: string, filename: string) => await readPlan(chatId, filename));
  ipcMain.handle('plans:write', async (_e, chatId: string, filename: string, content: string) => await writePlan(chatId, filename, content));
  ipcMain.handle('plans:delete', async (_e, chatId: string, filename: string) => await deletePlan(chatId, filename));

  // Sites
  ipcMain.handle('sites:list', async () => await listSites());
  ipcMain.handle('sites:read-file', async (_e, siteName: string, filePath: string) => await readSiteFile(siteName, filePath));
  ipcMain.handle('sites:write-file', async (_e, siteName: string, filePath: string, content: string) => await writeSiteFile(siteName, filePath, content));
  ipcMain.handle('sites:delete', async (_e, name: string) => await deleteSite(name));
}
