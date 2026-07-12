import { z } from 'zod';
import { defineTool, errorResult, textResult, clampTimeout } from './framework';

const DEFAULT_WAIT_TIMEOUT_MS = 3000;
const MAX_WAIT_TIMEOUT_MS = 30000;

export const wait = defineTool({
  name: 'wait',
  description:
    'Wait for a time duration, page navigation, DOM change, specific text, or CSS selector. Use after actions that trigger async content loading.',
  input: z.object({
    for: z
      .enum(['time', 'navigation', 'dom_change', 'text', 'selector'])
      .default('time')
      .describe('What to wait for.'),
    value: z
      .union([z.string(), z.number()])
      .optional()
      .describe('For "time": ms to pause. For "text"/"selector": the text or CSS selector.'),
    timeoutMs: z.number().optional().describe('Max wait in ms (default 3000).'),
    urlContains: z.string().optional().describe('For "navigation": URL substring to match.'),
  }),
  annotations: { readOnlyHint: true },
  handler: async (args, ctx, response) => {
    const timeoutMs = clampTimeout(args.timeoutMs, DEFAULT_WAIT_TIMEOUT_MS, MAX_WAIT_TIMEOUT_MS);
    const value = args.value === undefined ? undefined : String(args.value);

    let actionName: string;
    let actionArgs: Record<string, unknown>;

    switch (args.for) {
      case 'time': {
        const waitMs = Math.min(Number(value) || 2000, timeoutMs);
        await new Promise((r) => setTimeout(r, waitMs));
        response.text(`waited ${waitMs}ms`);
        return textResult(`waited ${waitMs}ms`, { waitedMs: waitMs });
      }
      case 'navigation':
        actionName = 'wait_for_navigation';
        actionArgs = { timeoutMs, urlContains: args.urlContains };
        break;
      case 'dom_change':
        actionName = 'wait_for_dom_change';
        actionArgs = { timeoutMs, text: value, selector: value };
        break;
      case 'text':
        actionName = 'wait_for_dom_change';
        if (!value) return errorResult('wait: value (text) is required for for="text".');
        actionArgs = { timeoutMs, text: value };
        break;
      case 'selector':
        actionName = 'wait_for_dom_change';
        if (!value) return errorResult('wait: value (CSS selector) is required for for="selector".');
        actionArgs = { timeoutMs, selector: value };
        break;
      default:
        return errorResult(`wait: unknown for="${args.for}".`);
    }

    const result = await ctx.adapter.executeAction(
      actionName as any,
      actionArgs,
      ctx.step ?? 0,
      ctx.maxSteps ?? 25,
    );

    response.text(result.message);
    return textResult(result.message || `wait (${args.for})`, { stateChanged: result.stateChanged });
  },
});
