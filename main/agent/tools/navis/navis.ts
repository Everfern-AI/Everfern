/**
 * Navis — Everfern In-House AI Browser Agent
 *
 * Autonomous browser automation engine for complex web tasks.
 * Architecture follows BrowserOS patterns:
 *   - core/: browser adapter, observer, shared types
 *   - tools/: defineTool() definitions with Zod schemas
 *   - agent/: orchestrator loop, prompt builder, step executor, state manager
 */

export { createNavisTool } from './tool';
export { NavisOrchestrator } from './agent/orchestrator';
export { NavisExtensionOrchestrator } from './agent/extension-orchestrator';
export { NavisLogger } from './logger';
export { NAVIS_DECISION_SCHEMA } from './core/types';
export type { NavisOptions, NavisResult } from './core/types';
export type { NavisEvent, NavisEventType } from './logger';

// New architecture exports
export { NAVIS_TOOLS } from './tools/registry';
export type { ToolDefinition } from './tools/framework';
export type { BrowserControlAdapter, BrowserPageState, BrowserActionResult } from './core/types';
