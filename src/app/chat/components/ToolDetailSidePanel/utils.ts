/**
 * Utility functions for Tool Detail Side Panel
 */

import { ToolType, ToolCallDisplay, WebSearchData, NavisData, TerminalData, GenericToolData, SearchResult, Screenshot } from './types';

/**
 * Detect tool type from tool name using pattern matching
 */
export function detectToolType(toolName: string): ToolType {
  const lowerName = toolName.toLowerCase();

  // Web search tools
  if (
    lowerName.includes('web_search') ||
    lowerName.includes('remote_web_search') ||
    lowerName.includes('search')
  ) {
    return ToolType.WEB_SEARCH;
  }

  // NAVIS/browser tools
  if (
    lowerName.includes('navis') ||
    lowerName.includes('browser') ||
    lowerName.includes('computer_use')
  ) {
    return ToolType.NAVIS;
  }

  // Terminal tools
  if (
    lowerName.includes('run_command') ||
    lowerName.includes('bash') ||
    lowerName.includes('run_terminal') ||
    lowerName.includes('execute')
  ) {
    return ToolType.TERMINAL;
  }

  return ToolType.GENERIC;
}

/**
 * Extract web search data from tool call
 */
export function extractWebSearchData(toolCall: ToolCallDisplay): WebSearchData | null {
  try {
    const query = (toolCall.args?.query as string) || '';
    const results = (toolCall.data?.results as SearchResult[]) || [];
    const totalResults = results.length;

    return {
      query,
      results: results.slice(0, 50), // Limit to 50 results for performance
      totalResults
    };
  } catch (error) {
    console.error('Error extracting web search data:', error);
    return null;
  }
}

/**
 * Extract NAVIS screenshot data from tool call
 */
export function extractNavisData(toolCall: ToolCallDisplay): NavisData | null {
  try {
    const screenshots: Screenshot[] = [];

    // Handle different screenshot data formats
    if (toolCall.data?.screenshot) {
      const screenshot = toolCall.data.screenshot;
      if (typeof screenshot === 'string') {
        screenshots.push({
          base64: screenshot,
          timestamp: toolCall.timestamp || Date.now(),
          sequenceNumber: 0
        });
      } else if (Array.isArray(screenshot)) {
        screenshot.forEach((img, index) => {
          if (typeof img === 'string') {
            screenshots.push({
              base64: img,
              timestamp: toolCall.timestamp || Date.now(),
              sequenceNumber: index
            });
          }
        });
      }
    }

    // Handle base64Image field
    if (toolCall.data?.base64Image && typeof toolCall.data.base64Image === 'string') {
      screenshots.push({
        base64: toolCall.data.base64Image,
        timestamp: toolCall.timestamp || Date.now(),
        sequenceNumber: screenshots.length
      });
    }

    return {
      screenshots,
      url: (toolCall.args?.url as string) || undefined,
      action: (toolCall.args?.action as string) || undefined
    };
  } catch (error) {
    console.error('Error extracting NAVIS data:', error);
    return null;
  }
}

/**
 * Extract terminal output data from tool call
 */
export function extractTerminalData(toolCall: ToolCallDisplay): TerminalData | null {
  try {
    const command = (toolCall.args?.command as string) || (toolCall.args?.CommandLine as string) || '';
    const output = (toolCall.output as string) || '';
    const exitCode = (toolCall.data?.exitCode as number) || undefined;
    const duration = (toolCall.duration as number) || undefined;

    return {
      command,
      output,
      exitCode,
      duration
    };
  } catch (error) {
    console.error('Error extracting terminal data:', error);
    return null;
  }
}

/**
 * Extract generic tool data from tool call
 */
export function extractGenericToolData(toolCall: ToolCallDisplay): GenericToolData {
  return {
    toolName: toolCall.toolName,
    args: toolCall.args || {},
    output: (toolCall.output as string) || ''
  };
}

/**
 * Extract tool-specific data based on tool type
 */
export function extractToolData(toolCall: ToolCallDisplay, toolType: ToolType): WebSearchData | NavisData | TerminalData | GenericToolData | null {
  switch (toolType) {
    case ToolType.WEB_SEARCH:
      return extractWebSearchData(toolCall);
    case ToolType.NAVIS:
      return extractNavisData(toolCall);
    case ToolType.TERMINAL:
      return extractTerminalData(toolCall);
    case ToolType.GENERIC:
      return extractGenericToolData(toolCall);
    default:
      return null;
  }
}

/**
 * Format bytes to human-readable size
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Format timestamp to readable date string
 */
export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString();
}

/**
 * Format duration in milliseconds to readable string
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Truncate text to specified length with ellipsis
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength) + '...';
}

/**
 * Extract domain from URL
 */
export function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return url;
  }
}

/**
 * Get favicon URL for domain
 */
export function getFaviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
}

/**
 * Check if string is valid base64
 */
export function isValidBase64(str: string): boolean {
  try {
    return btoa(atob(str)) === str;
  } catch {
    return false;
  }
}

/**
 * Preserve ANSI color codes in terminal output
 */
export function preserveAnsiColors(text: string): string {
  // This is a placeholder - actual implementation would parse ANSI codes
  // and convert them to HTML/CSS for display
  return text;
}
