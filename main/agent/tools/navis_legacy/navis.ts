/**
 * Navis — Everfern In-House AI Browser Agent
 * 
 * Autonomous browser automation engine for complex web tasks.
 * Built from scratch with clean architecture:
 *   - BrowserSession: lifecycle management
 *   - ElementCapture: DOM snapshot with NAVIS.md format
 *   - ActionExecutor: typed action dispatching
 *   - Orchestrator: AI-driven main loop with JSON schema
 * 
 * Powered by NAVIS.md system prompt from main/agent/prompts/NAVIS.md
 */

export { createNavisTool } from './tool';
export { NAVIS_DECISION_SCHEMA, NavisOrchestrator } from './orchestrator';
export { NavisLogger } from './logger';
export type { NavisOptions, NavisResult } from './orchestrator';
export type { NavisEvent, NavisEventType } from './logger';