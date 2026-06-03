import { AgentTool, ToolResult } from '../runner/types';

/**
 * Preview Live URL Tool
 * Opens a live preview pane rendering the site at the specified URL/localhost in an iframe.
 */
export const previewLiveUrlTool: AgentTool = {
  name: 'preview_live_url',
  description: 'Displays a website or live development server to the user in a side-by-side preview panel. Use this whenever you start a web server, launch a React/Next.js/HTML website, or want to show a web page to the user.',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to preview (e.g., http://localhost:3000 or https://example.com).'
      }
    },
    required: ['url']
  },
  async execute(args: Record<string, unknown>, onUpdate?: (msg: string) => void, emitEvent?: (event: any) => void, toolCallId?: string): Promise<ToolResult> {
    const url = args.url as string;
    if (!url) {
      return {
        success: false,
        output: 'Error: URL parameter is missing.',
        error: 'missing_url'
      };
    }

    onUpdate?.(`Opening live preview for ${url}...`);

    if (emitEvent) {
      emitEvent({
        type: 'preview_live_url',
        url
      });
    }

    return {
      success: true,
      output: `Live preview pane opened successfully for ${url}`,
      data: { url }
    };
  }
};
