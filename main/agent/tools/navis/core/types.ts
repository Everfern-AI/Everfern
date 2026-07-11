/**
 * Navis — Core Types
 *
 * Shared interfaces for the Navis browser automation engine.
 * Equivalent to BrowserOS's browser-core types + browser-mcp ToolContext.
 */

// ── Browser State ────────────────────────────────────────────────────────────

export interface BrowserPageState {
  tabId?: number;
  url: string;
  title: string;
  text?: string;
  refs: RefMetadata[];
  tabs: TabInfo[];
  snapshot?: unknown;
  mode: 'extension' | 'playwright';
}

export interface TabInfo {
  id?: number;
  index?: number;
  title?: string;
  url?: string;
  active?: boolean;
}

export interface BrowserActionResult {
  success: boolean;
  message: string;
  stateChanged: boolean;
  data?: unknown;
}

// ── Browser Adapter Interface ────────────────────────────────────────────────

export interface BrowserControlAdapter {
  readonly mode: 'extension' | 'playwright';
  isAvailable(): boolean;
  launch(options: { startUrl?: string; headless?: boolean; selectedBrowserId?: string }): Promise<void>;
  capture(): Promise<BrowserPageState>;
  screenshot(options?: { quality?: number }): Promise<string>;
  executeAction(
    actionName: ActionName,
    actionArgs: Record<string, unknown>,
    step: number,
    maxSteps: number,
  ): Promise<BrowserActionResult>;
  close?(): Promise<void>;
}

// ── Element / Ref Types ──────────────────────────────────────────────────────

export interface RefMetadata {
  ref?: string;
  role?: string;
  tag?: string;
  name?: string;
  label?: string;
  placeholder?: string;
  href?: string;
  selector?: string;
  id?: string;
  testId?: string;
  nameAttr?: string;
  type?: string;
  nearbyText?: string;
  section?: string;
  key?: string;
  form?: { name?: string; action?: string; method?: string };
  actions?: string[];
  disabled?: boolean;
}

export interface AriaSnapshotResult {
  raw: string;
  refs: Map<string, RefMetadata>;
  elementCount: number;
  captureTimeMs: number;
}

export interface HtmlDomParserNodeSummary {
  tag: string;
  text?: string;
  selector?: string;
  role?: string;
  href?: string;
  action?: string;
  method?: string;
  id?: string;
  testId?: string;
  name?: string;
  type?: string;
  placeholder?: string;
  ariaLabel?: string;
  title?: string;
}

export interface HtmlDomParserContext {
  parser: 'html-dom-parser';
  stats: {
    htmlBytes: number;
    truncated: boolean;
    totalElements: number;
    capturedElements: number;
  };
  title?: string;
  headings: HtmlDomParserNodeSummary[];
  navigation: HtmlDomParserNodeSummary[];
  forms: HtmlDomParserNodeSummary[];
  controls: HtmlDomParserNodeSummary[];
  links: HtmlDomParserNodeSummary[];
  media: HtmlDomParserNodeSummary[];
  content: HtmlDomParserNodeSummary[];
}

// ── Action Types ─────────────────────────────────────────────────────────────

export type ActionName =
  | 'go_to_url'
  | 'go_back'
  | 'click_element'
  | 'click_text'
  | 'smart_click'
  | 'input_text'
  | 'smart_type'
  | 'hold_element'
  | 'drag_element'
  | 'press_key'
  | 'scroll_down'
  | 'scroll_up'
  | 'wait'
  | 'extract_content'
  | 'extract'
  | 'open_tab'
  | 'switch_tab'
  | 'close_tab'
  | 'wait_for_navigation'
  | 'wait_for_dom_change'
  | 'solve_captcha'
  | 'done'
  | 'upload_file'
  | 'select_option'
  | 'set_date'
  | 'drag_and_drop'
  | 'hover'
  | 'right_click'
  | 'hybrid_click'
  | 'browser_click'
  | 'browser_type'
  | 'browser_double_click'
  | 'browser_right_click'
  | 'browser_hover';

export interface ActionResult {
  success: boolean;
  message: string;
  stateChanged: boolean;
  data?: unknown;
}

// ── Orchestrator Types ───────────────────────────────────────────────────────

export interface NavisOptions {
  task: string;
  maxSteps?: number;
  maxActionsPerStep?: number;
  headless?: boolean;
  startUrl?: string;
  onProgress?: (msg: string) => void;
  useVision?: boolean;
  onlyVision?: boolean;
  forceVision?: boolean;
  useChromeProfile?: boolean;
  selectedBrowserId?: string;
  useIsolatedBrowser?: boolean;
}

export interface NavisResult {
  success: boolean;
  output: string;
  steps: number;
}

// ── JSON Schema for Navis decision output (strict validation) ────────────────

export const NAVIS_DECISION_SCHEMA = {
  $name: 'navis_decision',
  type: 'object',
  properties: {
    current_state: {
      type: 'object',
      properties: {
        evaluation_previous_goal: { type: 'string', enum: ['Success', 'Failed', 'Unknown'] },
        memory: { type: 'string' },
        next_goal: { type: 'string' },
        request_vision: { type: 'boolean', description: 'Set to true if you need a visual screenshot to proceed' },
        is_form_interaction: { type: 'boolean', description: 'Set to true if interacting with complex forms, datepickers, or sliders' }
      },
      required: ['evaluation_previous_goal', 'memory', 'next_goal'],
      additionalProperties: false,
    },
    action: {
      type: 'array',
      items: {
        type: 'object',
        oneOf: [
          { properties: { go_to_url: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'], additionalProperties: false } }, required: ['go_to_url'], additionalProperties: false },
          { properties: { go_back: { type: 'object', additionalProperties: false } }, required: ['go_back'], additionalProperties: false },
          { properties: { click_element: { type: 'object', properties: { ref: { type: 'string' } }, required: ['ref'], additionalProperties: false } }, required: ['click_element'], additionalProperties: false },
          { properties: { click_text: { type: 'object', properties: { text: { type: 'string' }, target: { type: 'string' }, role: { type: 'string' }, href: { type: 'string' } }, additionalProperties: false } }, required: ['click_text'], additionalProperties: false },
          { properties: { smart_click: { type: 'object', properties: { ref: { type: 'string' }, target: { type: 'string' }, text: { type: 'string' }, role: { type: 'string' }, href: { type: 'string' }, url: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } }, additionalProperties: false } }, required: ['smart_click'], additionalProperties: false },
          { properties: { input_text: { type: 'object', properties: { ref: { type: 'string' }, text: { type: 'string' } }, required: ['ref', 'text'], additionalProperties: false } }, required: ['input_text'], additionalProperties: false },
          { properties: { smart_type: { type: 'object', properties: { ref: { type: 'string' }, target: { type: 'string' }, text: { type: 'string' }, submit: { type: 'boolean' } }, required: ['text'], additionalProperties: false } }, required: ['smart_type'], additionalProperties: false },
          { properties: { hold_element: { type: 'object', properties: { ref: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, holdTimeMs: { type: 'number' } }, additionalProperties: false } }, required: ['hold_element'], additionalProperties: false },
          { properties: { drag_element: { type: 'object', properties: { sourceRef: { type: 'string' }, targetRef: { type: 'string' }, targetX: { type: 'number' }, targetY: { type: 'number' } }, required: ['sourceRef'], additionalProperties: false } }, required: ['drag_element'], additionalProperties: false },
          { properties: { press_key: { type: 'object', properties: { ref: { type: 'string' }, key: { type: 'string' } }, required: ['key'], additionalProperties: false } }, required: ['press_key'], additionalProperties: false },
          { properties: { select_option: { type: 'object', properties: { ref: { type: 'string', description: 'The ref of the select/combobox element.' }, value: { type: 'string', description: 'The option value or visible label text to select.' } }, required: ['ref', 'value'], additionalProperties: false } }, required: ['select_option'], additionalProperties: false },
          { properties: { scroll_down: { type: 'object', properties: { ref: { type: 'string' } }, additionalProperties: false } }, required: ['scroll_down'], additionalProperties: false },
          { properties: { scroll_up: { type: 'object', properties: { ref: { type: 'string' } }, additionalProperties: false } }, required: ['scroll_up'], additionalProperties: false },
          { properties: { wait: { type: 'object', properties: { ms: { type: 'number' } }, additionalProperties: false } }, required: ['wait'], additionalProperties: false },
          { properties: { extract_content: { type: 'object', properties: { goal: { type: 'string' }, click_target: { type: 'string' } }, required: ['goal'], additionalProperties: false } }, required: ['extract_content'], additionalProperties: false },
          { properties: { extract: { type: 'object', properties: { goal: { type: 'string' }, click_target: { type: 'string' } }, required: ['goal'], additionalProperties: false } }, required: ['extract'], additionalProperties: false },
          { properties: { open_tab: { type: 'object', properties: { url: { type: 'string' } }, additionalProperties: false } }, required: ['open_tab'], additionalProperties: false },
          { properties: { switch_tab: { type: 'object', properties: { index: { type: 'number' }, target: { type: 'string' } }, additionalProperties: false } }, required: ['switch_tab'], additionalProperties: false },
          { properties: { close_tab: { type: 'object', additionalProperties: false } }, required: ['close_tab'], additionalProperties: false },
          { properties: { wait_for_navigation: { type: 'object', properties: { timeoutMs: { type: 'number' }, urlContains: { type: 'string' } }, additionalProperties: false } }, required: ['wait_for_navigation'], additionalProperties: false },
          { properties: { wait_for_dom_change: { type: 'object', properties: { text: { type: 'string', description: 'Wait until this text appears on the page.' }, selector: { type: 'string', description: 'Wait until this CSS selector matches.' }, timeoutMs: { type: 'number' } }, additionalProperties: false } }, required: ['wait_for_dom_change'], additionalProperties: false },
          { properties: { done: { type: 'object', properties: { success: { type: 'boolean' }, text: { type: 'string' } }, required: ['success', 'text'], additionalProperties: false } }, required: ['done'], additionalProperties: false },
          { properties: { solve_captcha: { type: 'object', additionalProperties: false } }, required: ['solve_captcha'], additionalProperties: false },
          { properties: { browser_click: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'], additionalProperties: false } }, required: ['browser_click'], additionalProperties: false },
          { properties: { browser_double_click: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'], additionalProperties: false } }, required: ['browser_double_click'], additionalProperties: false },
          { properties: { browser_right_click: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'], additionalProperties: false } }, required: ['browser_right_click'], additionalProperties: false },
          { properties: { browser_hover: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'], additionalProperties: false } }, required: ['browser_hover'], additionalProperties: false },
          { properties: { browser_type: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } }, required: ['browser_type'], additionalProperties: false },
        ],
      },
      minItems: 1,
      maxItems: 8,
    },
  },
  required: ['current_state', 'action'],
  additionalProperties: false,
};

// ── Tool Framework Types (BrowserOS-style) ───────────────────────────────────

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolContext {
  adapter: BrowserControlAdapter;
  logger?: import('../logger').NavisLogger;
  aiClient?: import('../../../../lib/ai-client').AIClient;
  step?: number;
  maxSteps?: number;
  signal?: AbortSignal;
}

export interface ContentItem {
  type: 'text';
  text: string;
}

export interface ToolResult {
  content: ContentItem[];
  isError?: boolean;
  structuredContent?: unknown;
}
