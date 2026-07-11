/**
 * Navis — Tool Registry
 *
 * Single array of all Navis tool definitions (BrowserOS registry pattern).
 */

import type { ToolDefinition } from './framework';
import { navigate } from './navigate';
import { act } from './act';
import { tabs } from './tabs';
import { extract } from './extract';
import { wait } from './wait';
import { done, solveCaptcha } from './done';
import { browserCoordinate } from './browser-coordinate';

export const NAVIS_TOOLS: readonly ToolDefinition[] = [
  navigate,
  act,
  tabs,
  extract,
  wait,
  done,
  solveCaptcha,
  browserCoordinate,
];

/**
 * Convert Navis tools to the plain JSON Schema format expected by the AI client.
 * Used by the orchestrator to send tool definitions to the LLM.
 */
export function navisToolsToJsonSchema(): Array<{
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}> {
  return NAVIS_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.input.description
      ? tool.input.description
      : tool.input as any,
  }));
}
