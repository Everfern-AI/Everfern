import { AgentRunner } from '../../main/agent/runner/runner';
import { acpManager } from '../../main/acp/manager';
import { ChatHistoryStore } from '../../main/store/history';
import ora from 'ora';
import chalk from 'chalk';

export { ChatHistoryStore };

/**
 * Globally silences common backend loggers for the CLI
 */
let debugMode = false;

export function toggleDebugMode(enabled?: boolean) {
  debugMode = enabled !== undefined ? enabled : !debugMode;
  return debugMode;
}

export function silenceBackendLogs() {
  const originalLog = console.log;
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const originalError = console.error;

  const isInternal = (args: any[]) => {
    if (debugMode) return false;
    const msg = args[0];
    if (typeof msg !== 'string') return true;

    const internalPrefixes = [
      '[', '⏱️', '🧠', '⚖️', '🎬', '=', '================'
    ];
    return internalPrefixes.some(p => msg.startsWith(p));
  };

  console.log = (...args: any[]) => {
    if (isInternal(args)) return;
    originalLog(...args);
  };

  console.info = (...args: any[]) => {
    if (isInternal(args)) return;
    originalInfo(...args);
  };

  console.warn = (...args: any[]) => {
    if (isInternal(args)) return;
    originalWarn(...args);
  };

  console.error = (...args: any[]) => {
    if (!debugMode && isInternal(args)) return;
    originalError(...args);
  };
}

export async function initializeAgent(options: { session?: string, model?: string } = {}) {
  // Ensure logs are filtered early
  silenceBackendLogs();

  const spinner = ora({
    text: chalk.cyan('Bootstrapping EverFern Engine...'),
    color: 'green'
  }).start();

  try {
    // 1. Initialize Provider
    spinner.text = chalk.cyan('Initializing AI provider...');
    const client = acpManager.getClient();
    if (!client) {
      spinner.fail(chalk.red('Initialization failed.'));
      throw new Error('No AI provider configured. Please run onboarding.');
    }

    if (options.model) {
      client.setModel(options.model);
    }

    // 2. Load Agent & Tools
    spinner.text = chalk.cyan('Loading autonomous tools & skills...');
    const runner = new AgentRunner(client, {
      maxIterations: 20,
      enableTerminal: true,
      silent: true,
    });

    if (options.session) {
      runner.currentConversationId = options.session;
    }

    await runner.waitForToolsReady();

    spinner.succeed(chalk.green('EverFern Engine Ready'));

    return { runner, client };
  } catch (err: any) {
    spinner.fail(chalk.red('Failed to start EverFern.'));
    throw err;
  }
}
