import readline from 'readline';
import chalk from 'chalk';
import ora from 'ora';
import boxen from 'boxen';
import inquirer from 'inquirer';
import { initializeAgent, toggleDebugMode, ChatHistoryStore } from './agent-bridge';
import { acpManager } from '../../main/acp/manager';
import { PROVIDER_REGISTRY } from '../../main/lib/providers';
import { Command } from '@langchain/langgraph';

const PROVIDER_MODELS: Rec
ord<string, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1-preview', 'o1-mini', 'o3-mini'],
  anthropic: ['claude-sonnet-4-20250514', 'claude-opus-4-5', 'claude-haiku-4-5-20251001', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'],
  deepseek: ['deepseek-v4-flash', 'deepseek-v4-pro'],
  gemini: ['gemini-3.1-pro-preview', 'gemini-3.1-flash-preview', 'gemini-3.1-flash-lite-preview', 'gemini-3.1-flash-image-preview', 'gemini-3-pro-preview', 'gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
  nvidia: ['google/gemma-4-31b-it', 'meta/llama-3.2-90b-vision-instruct', 'qwen/qwen3.5-122b-a10b', 'meta/llama-3.3-70b-instruct', 'nvidia/llama-3.1-nemotron-70b-instruct', 'mistralai/mistral-small-4-119b-2603', 'nvidia/nemotron-3-super-120b-a12b'],
  ollama: [],
  'ollama-cloud': ['qwen3-vl:235b-instruct-cloud', 'kimi-k2.6:cloud', 'glm-5.1:cloud', 'gemma4:31b-cloud', 'kimi-k2.5:cloud', 'minimax-m2.7:cloud', 'glm-5:cloud'],
  lmstudio: [],
  everfern: ['everfern-1', 'everfern-fast'],
  openrouter: ['openrouter/free', 'nvidia/nemotron-3-nano-30b-a3b', 'z-ai/glm-4-5-air', 'arcee-ai/trinity-large-preview', 'minimax/minimax-m2.5', 'openai/gpt-oss-120b', 'google/gemma-4-31b', 'meta-llama/llama-3.3-70b-instruct', 'qwen/qwen3-coder-480b-a35b'],
};

export async function runChat(options: any = {}) {
  let session = options.session || 'default';
  const historyStore = new ChatHistoryStore();

  console.clear();
  const header = boxen(
    chalk.green.bold('EverFern 🌿') + ' ' + chalk.dim('Autonomous CLI Agent'),
    { padding: { left: 5, right: 5, top: 0, bottom: 0 }, borderStyle: 'round', borderColor: 'green' }
  );
  console.log(header);

  let { runner, client } = await initializeAgent({ ...options, session });
  let totalSessionTokens = 0;

  // Load existing history if session exists
  const existingConv = await historyStore.load(session);
  const messages: any[] = existingConv?.messages || [];

  const getStatusBar = () => {
    const cols = process.stdout.columns || 80;
    const modelInfo = chalk.bgBlue.white(` 🤖 ${client.model} `);
    const providerInfo = chalk.bgCyan.black(` 🔌 ${client.provider} `);
    const sessionInfo = chalk.bgMagenta.white(` 💬 ${session} `);
    const tokenInfo = chalk.bgBlack.grey(` 📊 Tokens: ${totalSessionTokens.toLocaleString()} `);
    const historyInfo = chalk.bgBlack.grey(` 📚 Hist: ${messages.length} `);

    const bar = `${modelInfo} ${providerInfo} ${sessionInfo} ${tokenInfo} ${historyInfo}`;
    const rawBar = ` 🤖 ${client.model}   🔌 ${client.provider}   💬 ${session}   📊 Tokens: ${totalSessionTokens.toLocaleString()}   📚 Hist: ${messages.length} `;
    const padding = Math.max(0, Math.floor((cols - rawBar.length) / 2));

    return ' '.repeat(padding) + bar + '\n';
  };

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const refreshPrompt = () => {
    const cols = process.stdout.columns || 80;
    const promptText = ' Ask EverFern Anything... ';
    const padding = Math.max(0, Math.floor((cols - promptText.length - 10) / 2));

    process.stdout.write('\n' + ' '.repeat(padding));
    process.stdout.write(chalk.bgGrey.white.bold(` ${promptText} `) + '\n');
    process.stdout.write(' '.repeat(padding) + chalk.grey('─'.repeat(promptText.length + 2)) + '\n');
    process.stdout.write(getStatusBar());
    process.stdout.write(' '.repeat(padding) + chalk.green('❯ '));
  };

  refreshPrompt();

  rl.on('line', async (line) => {
    const input = line.trim();

    if (!input) {
      refreshPrompt();
      return;
    }

    if (input.startsWith('/')) {
      const [cmd, ...args] = input.slice(1).split(' ');

      switch (cmd) {
        case 'help':
          console.log(boxen(
            chalk.bold('Available Commands:\n\n') +
            chalk.cyan('  /model [name]') + '    - List or change model\n' +
            chalk.cyan('  /provider [name]') + ' - List or change provider\n' +
            chalk.cyan('  /session <id>') + '    - Switch session\n' +
            chalk.cyan('  /status') + '          - System health\n' +
            chalk.cyan('  /tools') + '           - List active tools\n' +
            chalk.cyan('  /debug') + '           - Toggle debug logs\n' +
            chalk.cyan('  /clear') + '           - Clear screen\n' +
            chalk.cyan('  /exit') + '            - Exit',
            { padding: 1, borderStyle: 'round', borderColor: 'grey' }
          ));
          break;

        case 'debug':
          const isDebug = toggleDebugMode();
          console.log(chalk.yellow(`\nDebug mode: ${isDebug ? 'ENABLED' : 'DISABLED'}`));
          break;

        case 'model':
          if (args[0]) {
            client.setModel(args[0]);
            console.log(chalk.green(`\n✓ Model set to: ${args[0]}`));
          } else {
            const spinner = ora('Fetching available models...').start();
            try {
              let models = await client.listModels();
              spinner.stop();

              if (models.length === 0) {
                models = PROVIDER_MODELS[client.provider as string] || [];
              }

              if (models.length === 0) {
                console.log(chalk.yellow('  (No models found for this provider)'));
              } else {
                rl.pause();
                const { selectedModel } = await inquirer.prompt([
                  {
                    type: 'list',
                    name: 'selectedModel',
                    message: 'Select a model:',
                    choices: models.slice(0, 30),
                    pageSize: 12
                  }
                ]);
                client.setModel(selectedModel);
                console.log(chalk.green(`\n✓ Model switched to: ${selectedModel}`));
                rl.resume();
              }
            } catch (e) {
              spinner.fail('Failed to fetch models');
            }
          }
          break;

        case 'provider':
          if (args[0]) {
            const providerName = args[0].toLowerCase();
            const providers = Object.keys(PROVIDER_REGISTRY);
            if (providers.includes(providerName)) {
               const spinner = ora(`Switching to ${providerName}...`).start();
               try {
                 acpManager.setProvider({ provider: providerName as any });
                 const newClient = acpManager.getClient();
                 if (newClient) {
                   client = newClient;
                   const bridge = await initializeAgent({ model: client.model, session });
                   runner = bridge.runner;
                   spinner.succeed(`Switched to ${providerName}`);
                 }
               } catch (e: any) {
                 spinner.fail(`Failed to switch: ${e.message}`);
               }
            } else {
              console.log(chalk.red(`\nInvalid provider. Choose: ${providers.join(', ')}`));
            }
          } else {
            rl.pause();
            const providers = Object.keys(PROVIDER_REGISTRY);
            const { selectedProvider } = await inquirer.prompt([
              {
                type: 'list',
                name: 'selectedProvider',
                message: 'Select AI Provider:',
                choices: providers,
                pageSize: 10
              }
            ]);

            const spinner = ora(`Switching to ${selectedProvider}...`).start();
            try {
              acpManager.setProvider({ provider: selectedProvider as any });
              const newClient = acpManager.getClient();
              if (newClient) {
                client = newClient;
                const bridge = await initializeAgent({ model: client.model, session });
                runner = bridge.runner;
                spinner.succeed(`Switched to ${selectedProvider}`);
              }
            } catch (e: any) {
              spinner.fail(`Failed to switch: ${e.message}`);
            }
            rl.resume();
          }
          break;

        case 'session':
          session = args[0] || 'default';
          const newConv = await historyStore.load(session);
          messages.length = 0;
          if (newConv) messages.push(...newConv.messages);
          console.log(chalk.yellow(`\nSwitched to session: ${session}`));
          break;

        case 'status':
          const health = await client.healthCheck();
          console.log(boxen(
            chalk.bold('System Status\n\n') +
            chalk.dim('Provider: ') + chalk.cyan(client.provider) + '\n' +
            chalk.dim('Model:    ') + chalk.cyan(client.model) + '\n' +
            chalk.dim('Health:   ') + (health.ok ? chalk.green('Healthy') : chalk.red('Error')) + '\n' +
            chalk.dim('Latency:  ') + (health.latencyMs ? `${health.latencyMs}ms` : 'N/A'),
            { padding: 1, borderColor: 'cyan' }
          ));
          break;

        case 'tools':
          console.log(chalk.bold('\nActive Autonomous Tools:'));
          runner.tools.forEach(t => {
            console.log(chalk.cyan(`  ${t.name.padEnd(25)}`) + chalk.dim(t.description.split('.')[0]));
          });
          break;

        case 'clear':
          console.clear();
          console.log(header);
          break;

        case 'exit':
          console.log(chalk.yellow('Goodbye!'));
          process.exit(0);
          break;

        default:
          console.log(chalk.red(`Unknown command: /${cmd}`));
      }
      refreshPrompt();
      return;
    }

    // Agent Process
    console.log(chalk.dim('\n' + '─'.repeat(process.stdout.columns || 40)));
    const spinner = ora({ text: chalk.dim('Thinking...'), spinner: 'dots' }).start();

    try {
      const userMessage = { role: 'user', content: input };
      const stream = runner.runStream(input, messages, client.model, session);

      let fullResponse = '';
      spinner.stop();

      let isFirstChunk = true;
      let lastType = '';

      for await (const event of stream) {
        if (event.type !== lastType && ['thought', 'mission_phase_change', 'mission_step_update'].includes(event.type)) {
           process.stdout.write('\n');
        }
        lastType = event.type;

        switch (event.type) {
          case 'mission_phase_change':
            console.log(chalk.blue.bold(`\n📍 ${event.phase.toUpperCase()}`));
            break;

          case 'mission_step_update':
            if (event.step && event.step.description) {
              console.log(chalk.cyan(`  ▹ ${event.step.description}`));
            }
            break;

          case 'thought':
            process.stdout.write(chalk.dim(event.content));
            break;

          case 'tool_call_start':
            process.stdout.write(chalk.yellow(`\n  ⚙️  ${event.toolName}...`));
            break;

          case 'tool_call_complete':
            process.stdout.write(chalk.green(` ok`));
            break;

          case 'chunk':
            if (isFirstChunk) {
              process.stdout.write(chalk.magenta.bold('\nEverFern: '));
              isFirstChunk = false;
            }
            process.stdout.write(event.content);
            fullResponse += event.content;
            break;

          case 'error':
            console.log(chalk.red.bold(`\n❌ ${event.message}`));
            break;

          case 'hitl_request':
            rl.pause();
            process.stdout.write('\n');
            console.log(boxen(chalk.yellow.bold('⚠️  APPROVAL REQUIRED') + '\n\n' + event.request.message, { padding: 1, borderColor: 'yellow' }));

            const { approved } = await inquirer.prompt([
              {
                type: 'confirm',
                name: 'approved',
                message: 'Do you approve this action?',
                default: true
              }
            ]);

            console.log(approved ? chalk.green('✓ Approved. Resuming...') : chalk.red('✗ Rejected. Resuming...'));

            // Send the approval/rejection as a hidden command to the agent
            const resumeInput = approved ? '[HITL_APPROVED]' : '[HITL_REJECTED]';
            const resumeStream = runner.runStream(resumeInput, messages, client.model, session);

            // Consuming the resume stream (simplified for now by just letting it run)
            for await (const resEvent of resumeStream) {
               // We could recursively handle this, but for now just log chunks
               if (resEvent.type === 'chunk') {
                 if (isFirstChunk) {
                    process.stdout.write(chalk.magenta.bold('\nEverFern: '));
                    isFirstChunk = false;
                 }
                 process.stdout.write(resEvent.content);
                 fullResponse += resEvent.content;
               }
            }
            rl.resume();
            break;

          case 'mission_complete':
            const isSuccess = !event.timeline?.error && (event.timeline?.status === 'success' || event.timeline?.isComplete);
            console.log(isSuccess ? chalk.green(`\n\n🏁 MISSION SUCCESS`) : chalk.red(`\n\n🏁 MISSION FAILED`));
            break;

          case 'usage':
            if (event.totalTokens) {
              totalSessionTokens += event.totalTokens;
            }
            break;
        }
      }

      console.log('\n' + chalk.dim('─'.repeat(process.stdout.columns || 40)));

      // Save to history store
      messages.push(userMessage);
      messages.push({ role: 'assistant', content: fullResponse });

      await historyStore.save({
        id: session,
        title: input.substring(0, 30),
        provider: client.provider as any,
        model: client.model,
        messages: messages,
        updatedAt: new Date().toISOString()
      } as any);

    } catch (err: any) {
      spinner.stop();
      console.error(chalk.red(`\nSystem Error: ${err.message}\n`));
    }

    refreshPrompt();
  });

  rl.on('close', () => {
    console.log(chalk.yellow('\nGoodbye!'));
    process.exit(0);
  });
}
