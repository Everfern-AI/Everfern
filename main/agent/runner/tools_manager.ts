import { AgentTool } from './types';
import { plannerTool, updateStepTool, executionPlanTool } from '../tools/planner';
import { createComputerUseTool } from '../tools/computer-use';
import { getPiCodingTools } from '../tools/pi-tools';
import { systemFilesTool } from '../tools/system-files';
import { memorySaveTool } from '../tools/memory-save';
import { memorySearchTool } from '../tools/memory-search';
import { webSearchTool } from '../tools/web-search';
import { todoWriteTool } from '../tools/todo-write';
import { askUserTool } from '../tools/ask-user';
import { skillTool } from '../tools/skill-tool';
import { createPresentFilesTool } from '../tools/present-files';
import { createWorkspaceRequestTool, allowFileDeleteTool } from '../tools/control-plane';
import { terminalTool, terminalStatusTool } from '../tools/terminal';
import { searchMcpRegistryTool, connectMcpServerTool, listMcpToolsTool } from '../tools/mcp-registry-tool';
import { localPermissionTool } from '../tools/local-permission';
import { createArtifactTool } from '../tools/create-artifact';
import { editArtifactTool } from '../tools/edit-artifact';
import { visualizeTool } from '../tools/visualize';
import { pptxGeneratorTool } from '../tools/pptx-generator';
import { batchWriteTool } from '../tools/batch-write';
import { sendDiscordMessageTool, sendTelegramMessageTool } from '../tools/messaging';
import { createScheduledTaskTool, listScheduledTasksTool, deleteScheduledTaskTool } from '../tools/scheduled-tasks';
import { mcpRegistry } from '../tools/mcp';
import { createNavisTool } from '../tools/navis/navis';
import { NavisOrchestrator } from '../tools/navis/orchestrator';
import { AIClient } from '../../lib/ai-client';
import { createAnalyzeImageTool } from '../tools/analyze-image';
import { rememberFactTool, recallFactTool, updateProfileTool } from '../tools/memory-graph';
import * as os from 'os';

export const getBaseTools = (runner: any): AgentTool[] => {
  const platform = os.platform();
  const config = runner.config;

  if (!runner.navisOrchestrator && runner.client) {
    // Check if we need a separate vision client for Navis
    // If the main AI doesn't support vision, use the configured VLM (from settings)
    let visionClient: AIClient | undefined;
    const mainConfig = runner.client.getFullConfig();
    if (mainConfig.vlm) {
      try {
        const mappedProvider = (mainConfig.vlm.engine === 'cloud' && mainConfig.vlm.provider === 'ollama' ? 'ollama-cloud' :
                                mainConfig.vlm.engine === 'cloud' && mainConfig.vlm.provider === 'everfern' ? 'everfern' :
                                mainConfig.vlm.provider) as any;
        visionClient = new AIClient({
          provider: mappedProvider,
          model: mainConfig.vlm.model,
          // For cloud-only providers (everfern, openrouter), don't pass baseUrl
          // Let AIClient use its defaults to avoid stale URLs from previous provider selections
          baseUrl: (mappedProvider === 'everfern' || mappedProvider === 'openrouter') ? undefined : mainConfig.vlm.baseUrl,
          apiKey: mainConfig.vlm.apiKey,
        });
        console.log(`[ToolsManager] 🖼️ Navis vision fallback client: ${mainConfig.vlm.provider}/${mainConfig.vlm.model}`);
      } catch (err) {
        console.warn('[ToolsManager] Failed to create vision client for Navis:', err);
      }
    }
    runner.navisOrchestrator = new NavisOrchestrator(runner.client, undefined, visionClient);
  }

  // Static tools
  const tools: AgentTool[] = [
    terminalTool,
    terminalStatusTool,
    plannerTool,
    updateStepTool,
    executionPlanTool,
  ];

  // Create computer_use tool with production build validation
  let computerUseTool: AgentTool | null = null;
  try {
    computerUseTool = createComputerUseTool(
      runner.client,
      platform,
      config.visionModel,
      config.showuiUrl,
      config.ollamaBaseUrl,
      config.checkPermission,
      config.requestPermission,
      config.vlm
    );

    // Validate tool instance has all required properties
    if (!computerUseTool) {
      console.warn('[ToolsManager] computer_use tool creation returned null');
    } else if (!computerUseTool.name || !computerUseTool.description || !computerUseTool.parameters) {
      console.warn('[ToolsManager] computer_use tool has missing properties:', {
        name: computerUseTool.name,
        hasDescription: !!computerUseTool.description,
        hasParameters: !!computerUseTool.parameters,
      });
    } else {
      console.log('[ToolsManager] ✅ computer_use tool created successfully with valid properties');
      tools.push(computerUseTool);
    }
  } catch (error) {
    console.error('[ToolsManager] Failed to create computer_use tool:', error instanceof Error ? error.message : String(error));
  }

  // Add remaining static tools
  tools.push(
    systemFilesTool,
    memorySaveTool,
    memorySearchTool,
    webSearchTool,
    todoWriteTool,
    askUserTool,
    createAnalyzeImageTool(runner.client, runner),
    localPermissionTool,
    skillTool,
    createPresentFilesTool(runner),
    ...(runner.navisOrchestrator ? [createNavisTool(runner.navisOrchestrator)] : []),
    createWorkspaceRequestTool(config.requestPermission),
    allowFileDeleteTool,
    searchMcpRegistryTool,
    connectMcpServerTool,
    listMcpToolsTool,
    batchWriteTool,
    createArtifactTool(runner),
    editArtifactTool(runner),
    visualizeTool,
    pptxGeneratorTool,
    sendDiscordMessageTool,
    sendTelegramMessageTool,
    createScheduledTaskTool,
    listScheduledTasksTool,
    deleteScheduledTaskTool,
    rememberFactTool,
    recallFactTool,
    updateProfileTool,
  );

  // Add dynamically connected MCP tools
  const mcpTools = mcpRegistry.listAllTools().map(name => mcpRegistry.getTool(name)).filter(Boolean) as AgentTool[];
  tools.push(...mcpTools);

  console.log(`[ToolsManager] Registered ${tools.length} base tools: ${tools.map(t => t.name).join(', ')}`);

  return tools;
};
