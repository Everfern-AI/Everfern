"use strict";
/**
 * EverFern Cloud Vision Grounding Helper
 *
 * Simplified integration for sending screenshots to EverFern Cloud API
 * for vision grounding when using the 'everfern' provider.
 *
 * This is the recommended way to use vision grounding with EverFern Cloud.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEverFernCloudInstructionAndActions = getEverFernCloudInstructionAndActions;
exports.getEverFernCloudInstruction = getEverFernCloudInstruction;
exports.isEverFernCloudClient = isEverFernCloudClient;
exports.createVisionGroundingPipeline = createVisionGroundingPipeline;
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
async function getEverFernCloudInstructionAndActions(client, params) {
    if (client.provider !== 'everfern') {
        throw new Error(`getEverFernCloudInstructionAndActions() requires provider='everfern', got '${client.provider}'`);
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
async function getEverFernCloudInstruction(client, params) {
    const result = await getEverFernCloudInstructionAndActions(client, params);
    return result.instruction;
}
/**
 * Check if a client is configured for EverFern Cloud
 */
function isEverFernCloudClient(client) {
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
function createVisionGroundingPipeline(client, config) {
    if (!isEverFernCloudClient(client)) {
        throw new Error('Vision grounding pipeline requires EverFern Cloud provider');
    }
    const history = [];
    return {
        /**
         * Get instruction and actions for the current screenshot
         */
        async ground(params) {
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
        reset() {
            history.length = 0;
        },
        /**
         * Get current history
         */
        getHistory() {
            return [...history];
        }
    };
}
