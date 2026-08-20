import { registerProviderModelHandlers } from './provider-models';
import { registerRollbackHandlers } from './rollback-handlers';
import { registerExecutionPermissionHandlers, setAgentPermissionResolver } from './execution-permissions';
import { registerStreamHandlers } from './stream-handlers';

export { setAgentPermissionResolver };

export function registerAgentHandlers(): void {
  registerProviderModelHandlers();
  registerRollbackHandlers();
  registerExecutionPermissionHandlers();
  registerStreamHandlers();
}
