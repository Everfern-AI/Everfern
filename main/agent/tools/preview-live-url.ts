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

function normalizeUserUrl(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  if (/^(https?:|file:)/i.test(raw)) return raw;

  const hostCandidate = raw.split('/')[0].replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  const isLocal =
    hostCandidate === 'localhost' ||
    hostCandidate.startsWith('localhost:') ||
    hostCandidate === '127.0.0.1' ||
    hostCandidate.startsWith('127.0.0.1:') ||
    hostCandidate === '0.0.0.0' ||
    hostCandidate.startsWith('0.0.0.0:') ||
    hostCandidate === '::1' ||
    hostCandidate.startsWith('::1:');

  return `${isLocal ? 'http' : 'https'}://${raw}`;
}

/**
 * Show User URL Tool
 * Opens the tool detail side panel directly to a browser tab for the provided URL.
 */
export const showUserUrlTool: AgentTool = {
  name: 'show_user_url',
  description: 'Show a URL to the user by opening it in the tool detail side panel browser tab. Use this when you want the user to immediately view a localhost app, live server, documentation page, or any web URL.',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to open for the user. Localhost values may be provided without a scheme, e.g. localhost:3000.'
      }
    },
    required: ['url']
  },
  async execute(args: Record<string, unknown>, onUpdate?: (msg: string) => void, emitEvent?: (event: any) => void): Promise<ToolResult> {
    const url = normalizeUserUrl(args.url);
    if (!url) {
      return {
        success: false,
        output: 'Error: URL parameter is missing.',
        error: 'missing_url'
      };
    }

    onUpdate?.(`Opening ${url} for the user...`);

    emitEvent?.({
      type: 'show_user_url',
      url
    });

    return {
      success: true,
      output: `Opened browser tab for user\nURL: ${url}`,
      data: { url }
    };
  }
};
