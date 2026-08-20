import { ipcMain } from 'electron';
import { toolApprovalStore } from '../store/tool-approvals';

export function registerToolApprovalHandlers() {
  ipcMain.handle('tool-approvals:get-all', async () => {
    return toolApprovalStore.getPolicies();
  });

  ipcMain.handle('tool-approvals:add', async (_event, policy: { type: 'exact' | 'prefix'; toolName: string; pattern: string }) => {
    return toolApprovalStore.addPolicy(policy);
  });

  ipcMain.handle('tool-approvals:update', async (_event, { id, updates }: { id: string; updates: any }) => {
    return toolApprovalStore.updatePolicy(id, updates);
  });

  ipcMain.handle('tool-approvals:delete', async (_event, id: string) => {
    toolApprovalStore.deletePolicy(id);
    return { success: true };
  });

  ipcMain.handle('tool-approvals:clear-all', async () => {
    toolApprovalStore.clearAllPolicies();
    return { success: true };
  });
}
