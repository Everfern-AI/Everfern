/**
 * EverFern Cloud Vision Grounding Helper
 *
 * Simplified integration for sending screenshots to EverFern Cloud API
 * for vision grounding when using the 'everfern' provider.
 *
 * This is the recommended way to use vision grounding with EverFern Cloud.
 */

import { AIClient } from './ai-client';

export interface VisionGroundingParams {
  /** Base64-encoded screenshot (data:image/png;base64,...) */
  screenshot: string;
  /** Task objective (e.g., "click the search button") */
  objective: string;
  /** Previous instructions for context */
  history?: string[];
  /** API base URL (default: http://localhost:5000) */
  apiBaseUrl?: string;
  /** Authentication token */
  token?: string;
}

export interface VisionGroundingResult {
  instruction: string;
  actions: string[];
  screenshot: string;
}

/**
 * Get vision grounding instruction and actions from EverFern Cloud
 *
 * Example:
 * ```typescript
 * const client = new AIClient({ provider: 'everfern', apiKey: '...' });
 * const result = await getEverFernCloudInstructionAndActions(client, {
 *   screenshot: 'data:image/png;base64,...',
 *   objective: 'open chrome and search for news',
 *   history: ['previous instruction -> actions'],
 *   token: 'user-token'
 * });
 * console.log(result.instruction); // "click the chrome icon"
 * console.log(result.actions);     // ["click(100,200)"]
 * ```
 */
export async function getEverFernCloudInstructionAndActions(
  client: AIClient,
  params: VisionGroundingParams
): Promise<VisionGroundingResult> {
  if (client.provider !== 'everfern') {
    throw new Error(
      `getEverFernCloudInstructionAndActions() requires provider='everfern', got '${client.provider}'`
    );
  }

  const apiBaseUrl = params.apiBaseUrl || 'http://localhost:5000';
  const response = await fetch(`${apiBaseUrl}/api/tars/vision`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(params.token && { 'Authorization': `Bearer ${params.token}` })
    },
    body: JSON.stringify({
      screenshot: params.screenshot,
      objective: params.objective,
      history: params.history || []
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  if (!data.instruction) {
    throw new Error('No instruction in response');
  }

  return {
    instruction: data.instruction,
    actions: data.actions || [],
    screenshot: data.screenshot || params.screenshot
  };
}

/**
 * Get vision grounding instruction from EverFern Cloud (instruction only)
 *
 * Example:
 * ```typescript
 * const client = new AIClient({ provider: 'everfern', apiKey: '...' });
 * const instruction = await getEverFernCloudInstruction(client, {
 *   screenshot: 'data:image/png;base64,...',
 *   objective: 'click the search button',
 *   history: ['previous instruction -> actions'],
 *   token: 'user-token'
 * });
 * console.log(instruction); // "click the search button"
 * ```
 */
export async function getEverFernCloudInstruction(
  client: AIClient,
  params: VisionGroundingParams
): Promise<string> {
  const result = await getEverFernCloudInstructionAndActions(client, params);
  return result.instruction;
}

/**
 * Check if a client is configured for EverFern Cloud
 */
export function isEverFernCloudClient(client: AIClient): boolean {
  return client.provider === 'everfern';
}

/**
 * Create a vision grounding pipeline for desktop automation
 *
 * Example:
 * ```typescript
 * const pipeline = createVisionGroundingPipeline(client, {
 *   apiBaseUrl: 'http://localhost:5000',
 *   token: 'user-token'
 * });
 *
 * const result = await pipeline.ground({
 *   screenshot: screenshotBase64,
 *   objective: 'search for news'
 * });
 * console.log(result.instruction); // "click the search button"
 * console.log(result.actions);     // ["click(100,200)"]
 * ```
 */
export function createVisionGroundingPipeline(
  client: AIClient,
  config: { apiBaseUrl?: string; token?: string }
) {
  if (!isEverFernCloudClient(client)) {
    throw new Error('Vision grounding pipeline requires EverFern Cloud provider');
  }

  const history: string[] = [];

  return {
    /**
     * Get instruction and actions for the current screenshot
     */
    async ground(params: {
      screenshot: string;
      objective: string;
    }): Promise<VisionGroundingResult> {
      const result = await getEverFernCloudInstructionAndActions(client, {
        screenshot: params.screenshot,
        objective: params.objective,
        history,
        ...config
      });

      // Track history for context
      history.push(result.instruction);
      if (history.length > 8) {
        history.shift(); // Keep last 8 instructions
      }

      return result;
    },

    /**
     * Reset history
     */
    reset(): void {
      history.length = 0;
    },

    /**
     * Get current history
     */
    getHistory(): string[] {
      return [...history];
    }
  };
}
