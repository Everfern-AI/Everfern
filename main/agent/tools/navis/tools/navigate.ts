import { z } from 'zod';
import { defineTool, errorResult, textResult } from './framework';

export const navigate = defineTool({
  name: 'navigate',
  description:
    'Navigate to a URL or go back in history. After navigation, the orchestrator captures a fresh snapshot.',
  input: z.object({
    action: z.enum(['url', 'back']).default('url'),
    url: z.string().optional().describe('Required when action is "url".'),
  }),
  annotations: { readOnlyHint: false },
  handler: async (args, ctx, response) => {
    const actionName = args.action === 'back' ? 'go_back' : 'go_to_url';
    const actionArgs = args.action === 'back' ? {} : { url: args.url };

    if (args.action === 'url' && !args.url) {
      return errorResult('navigate: url is required for action="url".');
    }

    const result = await ctx.adapter.executeAction(
      actionName as any,
      actionArgs,
      ctx.step ?? 0,
      ctx.maxSteps ?? 25,
    );

    if (!result.success) {
      return errorResult(`Navigate failed: ${result.message}`);
    }

    response.text(result.message);
    response.data({ url: args.url, action: args.action });
    return textResult(`navigated (${args.action}) -> ${args.url ?? 'back'}`);
  },
});
