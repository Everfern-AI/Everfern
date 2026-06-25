/**
 * Example usage of IntegrationSettings component
 *
 * This component should be integrated into the existing DirectoryModal
 * or accessible through the plugins/customize interface as specified
 * in the requirements.
 */

import React, { useState } from 'react';
import IntegrationSettings from './IntegrationSettings';

export default function IntegrationSettingsExample() {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <div>
            <button
                onClick={() => setIsOpen(true)}
                style={{
                    padding: '8px 16px',
                    borderRadius: '8px',
                    border: '1px solid #e5e5e0',
                    backgroundColor: 'var(--color-bg-surface)',
                    cursor: 'pointer'
                }}
            >
                Open Integration Settings
            </button>

            <IntegrationSettings
                isOpen={isOpen}
                onClose={() => setIsOpen(false)}
            />
        </div>
    );
}

/**
 * Integration Instructions:
 *
 * To integrate this component into the existing EverFern UI:
 *
 * 1. Add to DirectoryModal.tsx:
 *    - Add 'integrations' to the TabType union
 *    - Add an integrations tab to the sidebar
 *    - Render IntegrationSettings when the integrations tab is active
 *
 * 2. Or create a separate modal trigger:
 *    - Add state management in the parent component (e.g., chat/page.tsx)
 *    - Add a button or menu item to open the integration settings
 *    - Render the IntegrationSettings component conditionally
 *
 * 3. Required Electron IPC handlers (to be implemented in main process):
 *    - integration:getConfig - Load integration configuration
 *    - integration:saveConfig - Save integration configuration
 *    - integration:testConnection - Test bot connection
 *
 * Example IPC implementation in main process:
 *
 * ipcMain.handle('integration:getConfig', async () => {
 *   // Load configuration from storage
 *   return {
 *     telegram: { enabled: false, botToken: '', connected: false },
 *     discord: { enabled: false, botToken: '', connected: false }
 *   };
 * });
 *
 * ipcMain.handle('integration:saveConfig', async (event, config) => {
 *   // Save configuration to storage
 *   return true;
 * });
 *
 * ipcMain.handle('integration:testConnection', async (event, platform) => {
 *   // Test bot connection
 *   return true; // or false based on connection test
 * });
 */
