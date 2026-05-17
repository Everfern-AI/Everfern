/**
 * Type definitions for the Tool Detail Side Panel feature
 */

export enum ToolType {
  WEB_SEARCH = 'web_search',
  NAVIS = 'navis',
  TERMINAL = 'terminal',
  GENERIC = 'generic'
}

/**
 * Side panel state management interface
 */
export interface SidePanelState {
  isOpen: boolean;
  selectedToolCallId: string | null;
  toolData: ToolCallDisplay | null;
  scrollPosition: number;
}

/**
 * Tool call display data structure
 */
export interface ToolCallDisplay {
  id: string;
  toolName: string;
  agentName?: string;
  args?: Record<string, unknown>;
  output?: string;
  data?: Record<string, unknown>;
  timestamp?: number;
  duration?: number;
}

/**
 * Web search result structure
 */
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  domain: string;
  publishedDate?: string;
  favicon?: string;
}

/**
 * Web search data extracted from tool call
 */
export interface WebSearchData {
  query: string;
  results: SearchResult[];
  totalResults: number;
}

/**
 * Screenshot data structure
 */
export interface Screenshot {
  base64: string;
  timestamp: number;
  sequenceNumber: number;
  width?: number;
  height?: number;
}

/**
 * NAVIS tool data extracted from tool call
 */
export interface NavisData {
  screenshots: Screenshot[];
  url?: string;
  action?: string;
}

/**
 * Terminal output data structure
 */
export interface TerminalData {
  command: string;
  output: string;
  exitCode?: number;
  duration?: number;
}

/**
 * Generic tool data for unknown tool types
 */
export interface GenericToolData {
  toolName: string;
  args: Record<string, unknown>;
  output: string;
}

/**
 * Tool data cache entry
 */
export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

/**
 * Error state for panel display
 */
export interface ErrorState {
  type: 'missing_data' | 'load_error' | 'parse_error';
  message: string;
  recoverable: boolean;
}

/**
 * Panel header props
 */
export interface PanelHeaderProps {
  agentName?: string;
  toolName: string;
  onClose: () => void;
}

/**
 * Main panel component props
 */
export interface ToolDetailSidePanelProps {
  isOpen: boolean;
  toolCall: ToolCallDisplay | null;
  onClose: () => void;
  conversationId: string;
}

/**
 * Web search results view props
 */
export interface WebSearchResultsViewProps {
  query: string;
  results: SearchResult[];
  totalResults: number;
}

/**
 * NAVIS screenshot view props
 */
export interface NavisScreenshotViewProps {
  screenshots: Screenshot[];
  toolName: string;
}

/**
 * Terminal output view props
 */
export interface TerminalOutputViewProps {
  command: string;
  output: string;
  exitCode?: number;
  duration?: number;
}

/**
 * Generic tool view props
 */
export interface GenericToolViewProps {
  toolName: string;
  args: Record<string, unknown>;
  output: string;
}
