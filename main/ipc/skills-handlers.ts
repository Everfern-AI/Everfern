import { ipcMain } from 'electron';
import { syncBuiltInSkills, mergeCustomSkills, getCustomSkillsPath, listCustomSkills, listAllSkills, saveCustomSkill, deleteCustomSkill } from '../lib/skills-sync';

export function registerSkillsHandlers() {
  ipcMain.handle('skills:list-all', async () => {
    return listAllSkills();
  });

  ipcMain.handle('skills:list-custom', async () => {
    return listCustomSkills();
  });

  ipcMain.handle('skills:save-custom', async (_event, data: { name: string; description: string; content: string }) => {
    const result = saveCustomSkill(data);
    if (result.success) {
      mergeCustomSkills();
    }
    return result;
  });

  ipcMain.handle('skills:delete-custom', async (_event, name: string) => {
    const result = deleteCustomSkill(name);
    if (result.success) {
      syncBuiltInSkills();
      mergeCustomSkills();
    }
    return result;
  });

  ipcMain.handle('skills:get-custom-path', async () => {
    return getCustomSkillsPath();
  });
}
