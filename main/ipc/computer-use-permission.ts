/**
 * MP-SEC-15: computer-use permission state.
 *
 * Leaf module (no electron imports) so ComputerUseTool can read the gate
 * without pulling ipcMain/CommandRegistry into its import graph. The only
 * way the flag flips to true is the user confirming the native
 * dialog.showMessageBox owned by terminal-process-handlers.ts
 * (permissions:grant) — the renderer can never self-grant.
 */
let permissionsGranted = false;

export function isPermissionGranted(): boolean {
  return permissionsGranted;
}

/** Called ONLY by the permissions:grant dialog handler on user confirmation. */
export function grantComputerUsePermission(): void {
  permissionsGranted = true;
}
