import { z } from 'zod';
import { defineTool, errorResult, textResult } from './framework';

export const tabs = defineTool({
  name: 'tabs',
  description: 'Manage browser tabs: open a new tab, switch to a different tab, or close the current tab.',
  input: z.object({
    action: z.enum(['open', 'switch', 'close']),
    url: z.string().optional().describe('URL for open action.'),
    index: z.number().optional().describe('Tab index for switch.'),
    target: z.string().optional().describe('Tab title keywords for switch.'),
  }),
  handler: async (args, ctx, response) => {
    const actionMap = {
      open: 'open_tab',
      switch: 'switch_tab',
      close: 'close_tab',
    } as const;

    const actionArgs: Record<string, unknown> = {};
    if (args.url !== undefined) actionArgs.url = args.url;
    if (args.index !== undefined) actionArgs.index = args.index;
    if (args.target !== undefined) actionArgs.target = args.target;

    const result = await ctx.adapter.executeAction(
      actionMap[args.action] as any,
      actionArgs,
      ctx.step ?? 0,
      ctx.maxSteps ?? 25,
    );

    if (!result.success) {
      return errorResult(`tabs ${args.action} failed: ${result.message}`);
    }

    response.text(result.message);
    return textResult(`tab ${args.action} ok`);
  },
});
