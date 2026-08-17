import { Notification, BrowserWindow, app } from 'electron';
import path from 'path';
import fs from 'fs';
import { getLocalExecutionResolvers } from '../agent/tools/pi-tools';

// Track active notifications and shown timestamps to prevent duplicates
const activeNotifications = new Map<string, Notification>();
const shownRequestTimestamps = new Map<string, number>();

// Clean up stale timestamps periodically (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [reqId, ts] of shownRequestTimestamps.entries()) {
    if (now - ts > 5 * 60 * 1000) {
      shownRequestTimestamps.delete(reqId);
    }
  }
}, 5 * 60 * 1000);

function getNotificationIcon(): string | undefined {
  try {
    const candidates = [
      path.join(app.getAppPath(), 'public', 'images', 'logos', 'everfern.ico'),
      path.join(app.getAppPath(), 'dist-electron', 'public', 'images', 'logos', 'everfern.ico'),
      path.join(process.resourcesPath || '', 'public', 'images', 'logos', 'everfern.ico'),
      path.join(app.getAppPath(), 'public', 'images', 'logos', 'everfern.png'),
      path.join(app.getAppPath(), 'public', 'favicon.ico')
    ];
    return candidates.find(p => fs.existsSync(p));
  } catch {
    return undefined;
  }
}

export function dismissPermissionNotification(requestId: string): void {
  const existing = activeNotifications.get(requestId);
  if (existing) {
    try {
      existing.close();
    } catch {}
    activeNotifications.delete(requestId);
  }
}

export function showPermissionNotification(params: {
  requestId: string;
  toolName?: string;
  shellType?: string;
  command?: string;
  reason?: string;
  conversationId?: string;
  onApprove?: () => void;
  onDeny?: () => void;
}): void {
  try {
    if (!params.requestId) return;

    // Deduplication check: prevent showing duplicate notification within 60 seconds for same requestId
    const now = Date.now();
    const lastShown = shownRequestTimestamps.get(params.requestId);
    if (lastShown && now - lastShown < 60000) {
      console.log(`[PermissionNotification] ⚠️ Skipping duplicate notification for requestId: ${params.requestId}`);
      return;
    }
    shownRequestTimestamps.set(params.requestId, now);

    if (!Notification.isSupported()) {
      console.log('[PermissionNotification] System notifications not supported on this platform');
      return;
    }

    // Dismiss any existing notification for this requestId
    dismissPermissionNotification(params.requestId);

    const tool = (params.toolName || params.shellType || 'Action').trim();
    const isComputerUse = /computer/i.test(tool) || /desktop/i.test(tool);
    const isNavis = /navis/i.test(tool) || /browser/i.test(tool);

    let title = 'EverFern: Permission Required';
    if (isComputerUse) title = 'EverFern: Computer Use Permission';
    else if (isNavis) title = 'EverFern: Navis Browser Permission';
    else if (params.shellType) title = `EverFern: ${params.shellType} Permission`;

    const body = params.reason || params.command || `${tool} is requesting permission to execute.`;
    const iconPath = getNotificationIcon();

    const notif = new Notification({
      title,
      body: body.length > 220 ? `${body.slice(0, 217)}…` : body,
      icon: iconPath,
      urgency: 'critical',
      timeoutType: 'never',
      silent: false,
      actions: [
        { type: 'button', text: 'Allow Always' },
        { type: 'button', text: 'Allow Once' },
        { type: 'button', text: 'Deny' }
      ]
    });

    activeNotifications.set(params.requestId, notif);

    const resolveRequest = (approved: boolean, alwaysAllow: boolean = false) => {
      dismissPermissionNotification(params.requestId);

      // Persist policy to toolApprovalStore if alwaysAllow is true
      if (alwaysAllow && params.toolName) {
        try {
          const { toolApprovalStore } = require('../store/tool-approvals');
          toolApprovalStore.addPolicy({
            type: 'exact',
            toolName: params.toolName,
            pattern: params.toolName
          });
          console.log(`[PermissionNotification] 🛡️ Added policy 'exact' for ${params.toolName} in toolApprovalStore`);
        } catch (e) {
          console.warn('[PermissionNotification] Failed to add alwaysAllow policy:', e);
        }
      }

      const resolvers = getLocalExecutionResolvers();
      const resolver = resolvers.get(params.requestId);
      if (resolver) {
        resolvers.delete(params.requestId);
        resolver({ approved, alwaysAllow });
        console.log(`[PermissionNotification] 🔔 Notification action resolved requestId ${params.requestId}: approved=${approved}, alwaysAllow=${alwaysAllow}`);
      } else {
        console.warn(`[PermissionNotification] ⚠️ No resolver found for requestId ${params.requestId}`);
      }

      // Notify renderer window to update inline UI card
      const windows = BrowserWindow.getAllWindows();
      for (const win of windows) {
        if (!win.isDestroyed()) {
          win.webContents.send('acp:local-execution-resolved', {
            requestId: params.requestId,
            approved,
            alwaysAllow
          });
        }
      }
    };

    // Button click handling (Windows 10/11 WinRT & macOS)
    notif.on('action', (event: any, index: any) => {
      console.log(`[PermissionNotification] 🔔 Action received: event=${event}, index=${index}`);
      const actionIndex = typeof index === 'number' ? index : (typeof event === 'number' ? event : (event?.actionIndex ?? 0));
      if (actionIndex === 0) {
        // "Allow Always"
        resolveRequest(true, true);
        params.onApprove?.();
      } else if (actionIndex === 1) {
        // "Allow Once"
        resolveRequest(true, false);
        params.onApprove?.();
      } else {
        // "Deny"
        resolveRequest(false, false);
        params.onDeny?.();
      }
    });

    // Body click handling (bring EverFern window to foreground)
    notif.on('click', () => {
      const windows = BrowserWindow.getAllWindows();
      if (windows.length > 0) {
        const win = windows[0];
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      }
    });

    notif.on('close', () => {
      activeNotifications.delete(params.requestId);
    });

    notif.show();
    console.log(`[PermissionNotification] 🔔 Shown native notification with [Allow Always, Allow Once, Deny] for ${tool} (requestId: ${params.requestId})`);
  } catch (err) {
    console.error('[PermissionNotification] Failed to show system notification:', err);
  }
}
