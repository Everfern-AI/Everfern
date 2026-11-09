import { guardWorkerTools } from './worker-tool-policy';
export { guardWorkerTools } from './worker-tool-policy';
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
import { allowFileDeleteTool } from '../tools/control-plane';
import { terminalTool, terminalStatusTool } from '../tools/terminal';
import { searchMcpRegistryTool, connectMcpServerTool, listMcpToolsTool } from '../tools/mcp-registry-tool';
import { localPermissionTool } from '../tools/local-permission';
import { createArtifactTool } from '../tools/create-artifact';
import { editArtifactTool } from '../tools/edit-artifact';
import { visualizeTool } from '../tools/visualize';
import { sendDiscordMessageTool, sendTelegramMessageTool } from '../tools/messaging';
import { createScheduledTaskTool, listScheduledTasksTool, deleteScheduledTaskTool } from '../tools/scheduled-tasks';
import { mcpRegistry } from '../tools/mcp';
import { createNavisTool } from '../tools/navis/navis';
import { NavisOrchestrator } from '../tools/navis/agent/orchestrator';
import { AIClient } from '../../lib/ai-client';
import { hydrateVlmApiKey } from '../../lib/vlm-config';
import { createAnalyzeImageTool } from '../tools/analyze-image';
import { createVisualClassificationSheetTool } from '../tools/visual-classification-sheet';
import { rememberFactTool, recallFactTool, updateProfileTool } from '../tools/memory-graph';
import { previewLiveUrlTool, showUserUrlTool } from '../tools/preview-live-url';
import { webFetchTool } from '../tools/webfetch';
import { loadAllSynthesizedTools, synthesizeToolTool, synthesizeSkillTool } from '../tools/tool-synthesizer';
import {
  openAppTool,
  switchAppTool,
  listAppsTool,
  closeAppTool,
  createWorkerBashTool,
  createWorkerReadFileTool,
  createWorkerWriteFileTool,
  createWorkerListFilesTool,
  createWorkerUploadFilesTool,
} from '../tools/worker-tools';
import {
  createSheetsReadTool,
  createSheetsWriteTool,
  createSheetsAppendTool,
  createSheetsClearTool,
  createSheetsCreateTool,
  createSheetsImportTool,
  createSheetsExportTool,
  createSheetsFormatTool,
  createSheetsAddSheetTool,
  createWorkerClickTool,
  createWorkerTypeTool,
  createWorkerDescribeTool,
} from '../tools/sheet-tools';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

export const getBaseTools = (runner: any): AgentTool[] => {
  const platform = os.platform();
  const config = runner.config;
  let clientConfig = runner.client?.getFullConfig?.() as any || {};
  if (!clientConfig.vlm) {
    try {
      const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
      const diskConfigPath = path.join(home, '.everfern', 'config.json');
      if (fs.existsSync(diskConfigPath)) {
        const diskConfig = JSON.parse(fs.readFileSync(diskConfigPath, 'utf-8'));
        clientConfig = {
          ...diskConfig,
          ...clientConfig,
          vlm: diskConfig.vlm || clientConfig.vlm,
          keys: { ...(diskConfig.keys || {}), ...(clientConfig.keys || {}) }
        };
      }
    } catch {}
  }
  const mainConfig = hydrateVlmApiKey(clientConfig);

  if (!runner.navisOrchestrator && runner.client) {
    // Check if we need a separate vision client for Navis
    // If the main AI doesn't support vision, use the configured VLM (from settings)
    let visionClient: AIClient | undefined;
    if (mainConfig.vlm?.enabled === true) {
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

  // Load dynamic/synthesized tools
  let dynamicTools: AgentTool[] = [];
  try {
    dynamicTools = loadAllSynthesizedTools();
  } catch (err) {
    console.error('[ToolsManager] Failed to load synthesized tools:', err);
  }

  // Static tools
  const tools: AgentTool[] = [
    terminalTool,
    terminalStatusTool,
    plannerTool,
    updateStepTool,
    executionPlanTool,
    synthesizeToolTool,
    synthesizeSkillTool,
    ...dynamicTools,
  ];

  // Create computer_use tool with production build validation
  let computerUseTool: AgentTool | null = null;
  try {
    computerUseTool = createComputerUseTool(
      runner.client,
      platform,
      config.visionModel,
      undefined, // showuiUrl removed
      config.ollamaBaseUrl,
      config.checkPermission,
      config.requestPermission,
      mainConfig.vlm?.enabled === true ? mainConfig.vlm as any : undefined
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
    webFetchTool,
    todoWriteTool,
    askUserTool,
    createAnalyzeImageTool(runner.client, runner),
    createVisualClassificationSheetTool(runner.client),
    localPermissionTool,
    skillTool,
    createPresentFilesTool(runner),
    ...(runner.navisOrchestrator ? [createNavisTool(runner.navisOrchestrator, runner)] : []),
    allowFileDeleteTool,
    searchMcpRegistryTool,
    connectMcpServerTool,
    listMcpToolsTool,
    createArtifactTool(runner),
    editArtifactTool(runner),
    visualizeTool,
    // pptx_generator removed — use WSL with pptxgenjs via terminal instead
    sendDiscordMessageTool,
    sendTelegramMessageTool,
    createScheduledTaskTool,
    listScheduledTasksTool,
    deleteScheduledTaskTool,
    rememberFactTool,
    recallFactTool,
    updateProfileTool,
    previewLiveUrlTool,
    showUserUrlTool,
    // EverFern Worker primitives
    openAppTool,
    switchAppTool,
    listAppsTool,
    closeAppTool,
    createWorkerBashTool(runner),
    createWorkerReadFileTool(runner),
    createWorkerWriteFileTool(runner),
    createWorkerListFilesTool(runner),
    createWorkerUploadFilesTool(runner),
    // Native Sheets app + in-app pixel automation
    createSheetsReadTool(runner),
    createSheetsWriteTool(runner),
    createSheetsAppendTool(runner),
    createSheetsClearTool(runner),
    createSheetsCreateTool(runner),
    createSheetsImportTool(runner),
    createSheetsExportTool(runner),
    createSheetsFormatTool(runner),
    createSheetsAddSheetTool(runner),
    createWorkerClickTool(runner),
    createWorkerTypeTool(runner),
    createWorkerDescribeTool(runner),
  );

  // Add dynamically connected MCP tools
  const mcpTools = mcpRegistry.listAllTools().map(name => mcpRegistry.getTool(name)).filter(Boolean) as AgentTool[];
  tools.push(...mcpTools);

  // Add taskName to all tool schemas to enforce mandatory task grouping
  for (const tool of tools) {
    if (tool.parameters && tool.parameters.properties) {
      tool.parameters.properties['taskName'] = {
        type: 'string',
        description: 'MANDATORY: Human-friendly Title Case name for this logical step (e.g., "Drafting Report Script", "Generating PDF Document", "Presenting Final Artifacts"). Never use snake_case or technical names like "run_pdf_generation" or "write_script_in_vm". Related tool calls with the same taskName are grouped into a clean collapsible timeline batch in the UI.'
      };
      if (!tool.parameters.required) {
        tool.parameters.required = [];
      }
      if (!tool.parameters.required.includes('taskName')) {
        tool.parameters.required.push('taskName');
      }
    }
  }

  console.log(`[ToolsManager] Registered ${tools.length} base tools: ${tools.map(t => t.name).join(', ')}`);

  // Enforce at execution time: runner tools can be built before a worker ID is set.
  return guardWorkerTools(tools, runner);
};
