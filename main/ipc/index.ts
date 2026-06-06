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
import { ChatHistoryStore } from '../store/history';

export function setupIPC(historyStore: ChatHistoryStore) {
  registerSystemHandlers();
  registerAgentHandlers();
  registerHistoryHandlers(historyStore);
  registerStoreHandlers();
  registerToolSettingsHandlers();
  registerChatTitleHandler();
  registerProjectsHandlers();
  setupScheduledTasksIPC();
  registerAnalyticsHandlers();
  registerFileAssociationHandlers();
}
