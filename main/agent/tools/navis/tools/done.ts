import { z } from 'zod';
import { defineTool, errorResult, textResult } from './framework';

export const done = defineTool({
  name: 'done',
  description: 'Mark the task as complete with a success status and final answer text.',
  input: z.object({
    success: z.boolean().describe('Whether the task was completed successfully.'),
    text: z.string().describe('Final answer or summary text.'),
  }),
  handler: async (args, ctx, response) => {
    const result = await ctx.adapter.executeAction(
      'done',
      { success: args.success, text: args.text },
      ctx.step ?? 0,
      ctx.maxSteps ?? 25,
    );

    response.text(result.message || args.text);
    return textResult(args.text, { success: args.success });
  },
});

export const solveCaptcha = defineTool({
  name: 'solve_captcha',
  description: 'Attempt to solve a visible CAPTCHA or human verification challenge.',
  input: z.object({}),
  annotations: { readOnlyHint: false },
  handler: async (args, ctx, response) => {
    const result = await ctx.adapter.executeAction(
      'solve_captcha',
      {},
      ctx.step ?? 0,
      ctx.maxSteps ?? 25,
    );

    if (!result.success) {
      return errorResult(`solve_captcha failed: ${result.message}`);
    }

    response.text(result.message);
    return textResult(result.message || 'captcha solved');
  },
});
