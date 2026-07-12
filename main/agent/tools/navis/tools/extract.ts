import { z } from 'zod';
import { defineTool, errorResult, textResult } from './framework';

export const extract = defineTool({
  name: 'extract',
  description:
    'Extract page content matching a goal. Triggers content extraction to a markdown report file.',
  input: z.object({
    goal: z.string().describe('What data to extract from the page.'),
    clickTarget: z.string().optional().describe('Element to click before extracting.'),
  }),
  annotations: { readOnlyHint: true },
  handler: async (args, ctx, response) => {
    const result = await ctx.adapter.executeAction(
      'extract_content',
      { goal: args.goal, click_target: args.clickTarget },
      ctx.step ?? 0,
      ctx.maxSteps ?? 25,
    );

    if (!result.success) {
      return errorResult(`extract failed: ${result.message}`);
    }

    response.text(result.message);
    return textResult(result.message || 'extracted');
  },
});
