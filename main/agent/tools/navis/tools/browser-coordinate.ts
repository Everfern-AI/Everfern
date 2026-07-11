import { z } from 'zod';
import { defineTool, errorResult, textResult } from './framework';
import type { ActionName } from '../core/types';

export const browserCoordinate = defineTool({
  name: 'browser_coordinate',
  description:
    'Coordinate-based fallback actions on a 0-1000 normalized grid. Use only when DOM refs are unavailable (canvas, visual UI, etc.).',
  input: z.object({
    kind: z.enum(['click', 'double_click', 'right_click', 'hover', 'type']),
    x: z.number().describe('Viewport x coordinate (0-1000 scale).'),
    y: z.number().describe('Viewport y coordinate (0-1000 scale).'),
    text: z.string().optional().describe('Text for kind=type.'),
  }),
  annotations: { destructiveHint: false },
  handler: async (args, ctx, response) => {
    const kindToAction: Record<string, ActionName> = {
      click: 'browser_click',
      double_click: 'browser_double_click',
      right_click: 'browser_right_click',
      hover: 'browser_hover',
      type: 'browser_type',
    };

    const actionName = kindToAction[args.kind];
    if (!actionName) {
      return errorResult(`browser_coordinate: unknown kind "${args.kind}".`);
    }

    const actionArgs: Record<string, unknown> = { x: args.x, y: args.y };
    if (args.text !== undefined) actionArgs.text = args.text;

    const result = await ctx.adapter.executeAction(
      actionName,
      actionArgs,
      ctx.step ?? 0,
      ctx.maxSteps ?? 25,
    );

    if (!result.success) {
      return errorResult(`browser_coordinate ${args.kind} failed: ${result.message}`);
    }

    response.text(result.message);
    return textResult(`ok (${args.kind} at ${args.x},${args.y})`);
  },
});
