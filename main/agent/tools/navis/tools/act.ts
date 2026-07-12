import { z } from 'zod';
import { defineTool, errorResult, textResult } from './framework';
import type { ActionName } from '../core/types';

export const act = defineTool({
  name: 'act',
  description:
    'Act on the page using refs from the last snapshot. kinds: click (by ref), click_text (by visible text), smart_click (ref/text/coords), fill (input by ref), type (smart type by ref/target), press (key combo), scroll_down, scroll_up, hover, hold, drag, select (dropdown), upload, set_date, right_click, hybrid_click (vision+DOM).',
  input: z.object({
    kind: z.enum([
      'click',
      'click_text',
      'smart_click',
      'fill',
      'type',
      'smart_type',
      'press',
      'scroll_down',
      'scroll_up',
      'hover',
      'hold',
      'drag',
      'select',
      'upload',
      'set_date',
      'right_click',
      'hybrid_click',
    ]),
    ref: z.string().optional().describe('Target element ref, e.g. "e12".'),
    text: z.string().optional().describe('Text for type/smart_type or click_text.'),
    target: z.string().optional().describe('Target text for smart_click/smart_type.'),
    value: z.string().optional().describe('Value for fill/select/upload.'),
    key: z.string().optional().describe('Key/combo for press, e.g. "Enter", "Control+a".'),
    role: z.string().optional().describe('ARIA role for click_text.'),
    href: z.string().optional().describe('Href for click_text.'),
    url: z.string().optional().describe('URL for smart_click.'),
    x: z.number().optional().describe('Viewport x coordinate.'),
    y: z.number().optional().describe('Viewport y coordinate.'),
    sourceRef: z.string().optional().describe('Source ref for drag.'),
    targetRef: z.string().optional().describe('Target ref for drag.'),
    targetX: z.number().optional().describe('Target x for drag.'),
    targetY: z.number().optional().describe('Target y for drag.'),
    holdTimeMs: z.number().optional().describe('Hold duration for hold kind.'),
    submit: z.boolean().optional().describe('Submit after typing for smart_type.'),
    files: z.array(z.string()).optional().describe('File paths for upload.'),
    selector: z.string().optional().describe('CSS selector for set_date.'),
    dateValue: z.string().optional().describe('Date value for set_date.'),
    targetDescription: z.string().optional().describe('Description for hybrid_click.'),
  }),
  annotations: { destructiveHint: false },
  handler: async (args, ctx, response) => {
    const kindToAction: Record<string, ActionName> = {
      click: 'click_element',
      click_text: 'click_text',
      smart_click: 'smart_click',
      fill: 'input_text',
      type: 'input_text',
      smart_type: 'smart_type',
      press: 'press_key',
      scroll_down: 'scroll_down',
      scroll_up: 'scroll_up',
      hover: 'hover',
      hold: 'hold_element',
      drag: 'drag_element',
      select: 'select_option',
      upload: 'upload_file',
      set_date: 'set_date',
      right_click: 'right_click',
      hybrid_click: 'hybrid_click',
    };

    const actionName = kindToAction[args.kind];
    if (!actionName) {
      return errorResult(`act: unknown kind "${args.kind}".`);
    }

    const actionArgs: Record<string, unknown> = {};
    if (args.ref !== undefined) actionArgs.ref = args.ref;
    if (args.text !== undefined) actionArgs.text = args.text;
    if (args.target !== undefined) actionArgs.target = args.target;
    if (args.value !== undefined) actionArgs.value = args.value;
    if (args.key !== undefined) actionArgs.key = args.key;
    if (args.role !== undefined) actionArgs.role = args.role;
    if (args.href !== undefined) actionArgs.href = args.href;
    if (args.url !== undefined) actionArgs.url = args.url;
    if (args.x !== undefined) actionArgs.x = args.x;
    if (args.y !== undefined) actionArgs.y = args.y;
    if (args.sourceRef !== undefined) actionArgs.sourceRef = args.sourceRef;
    if (args.targetRef !== undefined) actionArgs.targetRef = args.targetRef;
    if (args.targetX !== undefined) actionArgs.targetX = args.targetX;
    if (args.targetY !== undefined) actionArgs.targetY = args.targetY;
    if (args.holdTimeMs !== undefined) actionArgs.holdTimeMs = args.holdTimeMs;
    if (args.submit !== undefined) actionArgs.submit = args.submit;
    if (args.files !== undefined) actionArgs.files = args.files;
    if (args.selector !== undefined) actionArgs.selector = args.selector;
    if (args.dateValue !== undefined) actionArgs.dateValue = args.dateValue;
    if (args.targetDescription !== undefined) actionArgs.targetDescription = args.targetDescription;

    const result = await ctx.adapter.executeAction(
      actionName,
      actionArgs,
      ctx.step ?? 0,
      ctx.maxSteps ?? 25,
    );

    if (!result.success) {
      return errorResult(`act ${args.kind} failed: ${result.message}`);
    }

    response.text(result.message);
    response.data({ kind: args.kind, stateChanged: result.stateChanged });
    return textResult(`ok (${args.kind})`, { kind: args.kind, stateChanged: result.stateChanged });
  },
});
