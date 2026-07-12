/**
 * Navis — Observer
 *
 * Wraps element-capture.ts with a clean interface (BrowserOS Observer pattern).
 * Provides DOM snapshot, diff, and ref resolution for the orchestrator and tools.
 */

import type { Page } from 'playwright';
import {
  captureInteractiveElements,
  formatElementsForPrompt,
  captureHtmlDomParserContext,
  invalidateElementSnapshotCache,
  getRefMetadata,
  type AriaSnapshotResult,
  type HtmlDomParserContext,
  type RefMetadata,
} from '../element-capture';
import { diffSnapshots } from '../diff';
import type { BrowserPageState } from './types';

export type { AriaSnapshotResult, HtmlDomParserContext, RefMetadata };

/**
 * Per-page observer that tracks DOM state and computes diffs.
 * Similar to BrowserOS's Observer class but works with Playwright pages.
 */
export class Observer {
  private previousText: string | undefined;
  private previousUrl: string | undefined;

  /**
   * Capture a full DOM snapshot (elements + HTML context).
   */
  async snapshot(page: Page): Promise<{
    elements: AriaSnapshotResult;
    htmlContext: HtmlDomParserContext | null;
    formattedForPrompt: string;
  }> {
    const elements = await captureInteractiveElements(page);
    const htmlContext = await captureHtmlDomParserContext(page);
    const formattedForPrompt = formatElementsForPrompt(elements.raw);

    this.previousText = elements.raw;
    this.previousUrl = page.url();

    return { elements, htmlContext, formattedForPrompt };
  }

  /**
   * Compute diff between current DOM and previous snapshot.
   */
  diff(currentText: string, currentUrl: string): {
    changed: boolean;
    urlChanged: boolean;
    diffText: string;
  } {
    if (!this.previousText) {
      return { changed: false, urlChanged: false, diffText: '' };
    }

    const result = diffSnapshots(this.previousText, currentText);
    const urlChanged = this.previousUrl !== currentUrl && this.previousUrl !== undefined;

    return {
      changed: result.changed || urlChanged,
      urlChanged,
      diffText: result.text || '',
    };
  }

  /**
   * Update the baseline after a successful step.
   */
  commit(text: string, url: string): void {
    this.previousText = text;
    this.previousUrl = url;
  }

  /**
   * Invalidate cached element snapshots (e.g. after navigation).
   */
  invalidate(page?: Page): void {
    invalidateElementSnapshotCache(page);
    if (!page) {
      this.previousText = undefined;
      this.previousUrl = undefined;
    }
  }

  /**
   * Get metadata for a specific ref.
   */
  getRef(page: Page, ref: string): RefMetadata | null {
    return getRefMetadata(page, ref);
  }
}
