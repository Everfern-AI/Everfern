import type { ToolDefinition } from '../../../lib/ai-client';

export const NAVIS_TOOLS: ToolDefinition[] = [
  {
    name: 'go_to_url',
    description: 'Navigate to a specific URL.',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string', description: 'The absolute URL to navigate to.' } },
      required: ['url'],
      additionalProperties: false
    }
  },
  {
    name: 'go_back',
    description: 'Navigate back to the previous page in history.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: 'click_element',
    description: 'Click an element by its DOM ref (e.g. "e1", "e5").',
    parameters: {
      type: 'object',
      properties: { ref: { type: 'string', description: 'The ref label of the element to click.' } },
      required: ['ref'],
      additionalProperties: false
    }
  },
  {
    name: 'click_text',
    description: 'Click a visible element matching text, target, role, or href.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        target: { type: 'string' },
        role: { type: 'string' },
        href: { type: 'string' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'smart_click',
    description: 'Smart click an element using ref, target text, role, href, or coordinate fallback.',
    parameters: {
      type: 'object',
      properties: {
        ref: { type: 'string' },
        target: { type: 'string' },
        text: { type: 'string' },
        role: { type: 'string' },
        href: { type: 'string' },
        url: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'input_text',
    description: 'Type text into an input field targeted by its DOM ref.',
    parameters: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'The ref label of the input element.' },
        text: { type: 'string', description: 'The text to type.' }
      },
      required: ['ref', 'text'],
      additionalProperties: false
    }
  },
  {
    name: 'smart_type',
    description: 'Smart type text into an input field matching ref, target name/label, or placeholder.',
    parameters: {
      type: 'object',
      properties: {
        ref: { type: 'string' },
        target: { type: 'string' },
        text: { type: 'string' },
        submit: { type: 'boolean' }
      },
      required: ['text'],
      additionalProperties: false
    }
  },
  {
    name: 'hold_element',
    description: 'Click and hold an element by its DOM ref or coordinate fallback.',
    parameters: {
      type: 'object',
      properties: {
        ref: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
        holdTimeMs: { type: 'number' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'drag_element',
    description: 'Drag an element to a target element or coordinates.',
    parameters: {
      type: 'object',
      properties: {
        sourceRef: { type: 'string' },
        targetRef: { type: 'string' },
        targetX: { type: 'number' },
        targetY: { type: 'number' }
      },
      required: ['sourceRef'],
      additionalProperties: false
    }
  },
  {
    name: 'press_key',
    description: 'Press a keyboard key (e.g. "Enter", "Tab", "ArrowDown"). Optionally focuses an element first.',
    parameters: {
      type: 'object',
      properties: {
        ref: { type: 'string' },
        key: { type: 'string' }
      },
      required: ['key'],
      additionalProperties: false
    }
  },
  {
    name: 'select_option',
    description: 'Select an option from a <select> dropdown or ARIA listbox/combobox by value or label text.',
    parameters: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'The ref of the select/combobox element.' },
        value: { type: 'string', description: 'The option value or visible label text to select.' }
      },
      required: ['ref', 'value'],
      additionalProperties: false
    }
  },
  {
    name: 'scroll_down',
    description: 'Scroll the page content down. Optionally scrolls a specific scrollable ref.',
    parameters: {
      type: 'object',
      properties: { ref: { type: 'string' } },
      additionalProperties: false
    }
  },
  {
    name: 'scroll_up',
    description: 'Scroll the page content up. Optionally scrolls a specific scrollable ref.',
    parameters: {
      type: 'object',
      properties: { ref: { type: 'string' } },
      additionalProperties: false
    }
  },
  {
    name: 'wait',
    description: 'Wait for a specified duration in milliseconds.',
    parameters: {
      type: 'object',
      properties: { ms: { type: 'number' } },
      additionalProperties: false
    }
  },
  {
    name: 'extract_content',
    description: 'Extract specific data or page context matching your goal.',
    parameters: {
      type: 'object',
      properties: {
        goal: { type: 'string' },
        click_target: { type: 'string' }
      },
      required: ['goal'],
      additionalProperties: false
    }
  },
  {
    name: 'extract',
    description: 'Alias for extract_content. Extract specific data or page context.',
    parameters: {
      type: 'object',
      properties: {
        goal: { type: 'string' },
        click_target: { type: 'string' }
      },
      required: ['goal'],
      additionalProperties: false
    }
  },
  {
    name: 'open_tab',
    description: 'Open a new tab with the specified URL.',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string' } },
      additionalProperties: false
    }
  },
  {
    name: 'switch_tab',
    description: 'Switch active tab by index or title keywords.',
    parameters: {
      type: 'object',
      properties: {
        index: { type: 'number' },
        target: { type: 'string' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'close_tab',
    description: 'Close the current active tab.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: 'wait_for_navigation',
    description: 'Wait for navigation or SPA page-load state to settle.',
    parameters: {
      type: 'object',
      properties: {
        timeoutMs: { type: 'number' },
        urlContains: { type: 'string' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'wait_for_dom_change',
    description: 'Wait for a specific text or CSS selector to appear on the page, or for any DOM mutation. Use after actions that trigger async content loading (search results, form submissions, page transitions).',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Wait until this text appears anywhere on the page.' },
        selector: { type: 'string', description: 'Wait until a CSS selector matches at least one element.' },
        timeoutMs: { type: 'number', description: 'Max wait time in milliseconds. Default: 3000.' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'upload_file',
    description: 'Upload file(s) to a file input element targeted by its DOM ref.',
    parameters: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'The ref label of the file input element.' },
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of absolute local file paths to upload.'
        }
      },
      required: ['ref', 'files'],
      additionalProperties: false
    }
  },
  {
    name: 'done',
    description: 'Mark the task complete with success status and final answer text.',
    parameters: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        text: { type: 'string' }
      },
      required: ['success', 'text'],
      additionalProperties: false
    }
  },
  {
    name: 'solve_captcha',
    description: 'Attempt to solve visible CAPTCHA or human verification.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: 'browser_click',
    description: 'Fallback: Click at specific screen coordinates (x, y) on a 0-1000 scale. Use only as last resort.',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' }
      },
      required: ['x', 'y'],
      additionalProperties: false
    }
  },
  {
    name: 'browser_double_click',
    description: 'Fallback: Double-click at specific screen coordinates (x, y).',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' }
      },
      required: ['x', 'y'],
      additionalProperties: false
    }
  },
  {
    name: 'browser_right_click',
    description: 'Fallback: Right-click at specific screen coordinates (x, y).',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' }
      },
      required: ['x', 'y'],
      additionalProperties: false
    }
  },
  {
    name: 'browser_hover',
    description: 'Fallback: Hover at specific screen coordinates (x, y).',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' }
      },
      required: ['x', 'y'],
      additionalProperties: false
    }
  },
  {
    name: 'browser_type',
    description: 'Fallback: Type text directly at current focus.',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false
    }
  }
];
