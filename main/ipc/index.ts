import { registerSystemHandlers } from './system';
import { registerAgentHandlers } from './agent';
import { registerHistoryHandlers } from './history';
import { registerStoreHandlers } from './store-handlers';
import { registerToolSettingsHandlers } from './tool-settings-handlers';
import { registerChatTitleHandler } from '../lib/chat-title-generator';
import { registerProjectsHandlers } from './projects';
import { setupScheduledTasksIPC } from './scheduled-tasks';
import { registerAnalyticsHandlers } from './analytics';
import { registerFileAssociationHandlers } from './file-association-handlers';
import { registerConfigHandlers } from './config-handlers';
import { registerDebugHandlers } from './debug-handlers';
import { registerTerminalProcessHandlers } from './terminal-process-handlers';
import { registerVectorHandlers } from './vector-handlers';
import { registerSkillsHandlers } from './skills-handlers';
import { registerToolApprovalHandlers } from './tool-approval-handlers';
import { registerIntegrationHandlers } from './integration-handlers';
import { ChatHistoryStore } from '../store/history';

export function setupIPC(historyStore: ChatHistoryStore) {
  // 1. Core Config & Tool Settings
  registerConfigHandlers();
  registerToolSettingsHandlers();

  // 2. AI Agent & Execution
  registerAgentHandlers();
  registerToolApprovalHandlers();

  // 3. Workspace, History, Projects & Vectors
  registerHistoryHandlers(historyStore);
  registerStoreHandlers();
  registerProjectsHandlers();
  registerVectorHandlers();
  registerChatTitleHandler();

  // 4. Personality & Custom Skills
  registerSkillsHandlers();

  // 5. System, Terminal, Tasks & Hardware
  registerSystemHandlers();
  registerTerminalProcessHandlers();
  setupScheduledTasksIPC();
  registerFileAssociationHandlers();

  // 6. External Platform Integrations
  registerIntegrationHandlers();

  // 7. DevTools & Analytics
  registerDebugHandlers();
  registerAnalyticsHandlers();
}

export * from './config-handlers';
export * from './terminal-process-handlers';
export * from './vector-handlers';
export * from './skills-handlers';
export * from './tool-approval-handlers';
export * from './integration-handlers';
