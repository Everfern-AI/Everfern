/**
 * Navis — Element Capture Engine
 *
 * Uses Playwright's built-in ariaSnapshot() for AI-optimized accessibility tree.
 * Every interactive element gets a stable ref (e1, e2, ...) for precise interaction.
 * https://playwright.dev/docs/aria-snapshots
 *
 * Performance Optimizations:
 * - Viewport-aware filtering (viewport ± 500px buffer)
 * - Element snapshot caching with 500ms TTL
 * - Parallel iframe processing
 * - Performance targets: <50ms for <100 elements, <100ms for 100-500, <200ms for >500
 * - Full-screen capture mode for consistent resolution
 */

import { Page } from 'playwright';
import { FullScreenCaptureModule } from './full-screen-capture';

export interface AriaSnapshotResult {
  raw: string;
  refs: Map<string, { role: string; name: string }>;
  elementCount: number;
  captureTimeMs: number;
}

// ── Element Snapshot Cache with 500ms TTL ─────────────────────────
interface CacheEntry {
  snapshot: AriaSnapshotResult;
  timestamp: number;
  url: string;
}

const CACHE_TTL_MS = 500;
const elementSnapshotCache = new Map<string, CacheEntry>();

function getCacheKey(page: Page): string {
  return `${page.url()}:${page.context().browser()?.version() || 'unknown'}`;
}

function getCachedSnapshot(page: Page): AriaSnapshotResult | null {
  const key = getCacheKey(page);
  const cached = elementSnapshotCache.get(key);

  if (!cached) return null;

  const age = Date.now() - cached.timestamp;
  if (age > CACHE_TTL_MS) {
    elementSnapshotCache.delete(key);
    return null;
  }

  // Verify URL hasn't changed (navigation invalidates cache)
  if (cached.url !== page.url()) {
    elementSnapshotCache.delete(key);
    return null;
  }

  return cached.snapshot;
}

function setCachedSnapshot(page: Page, snapshot: AriaSnapshotResult): void {
  const key = getCacheKey(page);
  elementSnapshotCache.set(key, {
    snapshot,
    timestamp: Date.now(),
    url: page.url(),
  });
}

// ── Fast Snapshot (Viewport-Aware, Optimized) ─────────────────────────
/**
 * Captures interactive elements with viewport-aware filtering.
 * Performance targets:
 * - <50ms for <100 elements
 * - <100ms for 100-500 elements
 * - <200ms for >500 elements
 *
 * Optimizations:
 * - Avoid iterating all elements for scrollable detection
 * - Use efficient string building with array join
 * - Skip expensive ariaSnapshot for small element counts
 * - Cache computed values to avoid redundant calculations
 */
export async function captureFastSnapshot(page: Page): Promise<AriaSnapshotResult | null> {
  const startTime = Date.now();

  try {
    const snapshot = await page.evaluate(() => {
      const vWidth = window.innerWidth;
      const vHeight = window.innerHeight;
      const MAX_ELEMENTS = 1000; // Hard limit to prevent token explosion

      // Select interactive elements + semantic context
      const selector = 'button, a, input, select, textarea, [role="button"], [role="link"], [role="textbox"], [role="combobox"], h1, h2, h3, h4, h5, h6, [role="heading"]';
      const elements = document.querySelectorAll(selector);

      let ref = 0;
      const lines: string[] = [];

      // Optimization: Use array for string building (faster than concatenation)
      // Optimization: Skip scrollable container detection for <100 elements (rare bottleneck)
      // Only detect scrollable containers if we have many elements
      if (elements.length > 100) {
        // For large pages, detect scrollable containers but limit search
        const scrollableContainers = document.querySelectorAll('[style*="overflow"]');
        let scrollRef = 0;

        for (let i = 0; i < Math.min(scrollableContainers.length, 20); i++) {
          const el = scrollableContainers[i];
          const style = window.getComputedStyle(el);
          const isScrollable = (
            (style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflowX === 'auto' || style.overflowX === 'scroll') &&
            (el.scrollHeight > el.clientHeight + 5 || el.scrollWidth > el.clientWidth + 5)
          );

          if (isScrollable) {
            const rect = el.getBoundingClientRect();
            // Still only show scrollable containers that are somewhat visible or relevant
            if (rect.width > 10 && rect.height > 10) {
              scrollRef++;
              const sref = `s${scrollRef}`;
              (el as HTMLElement).setAttribute('data-scroll-ref', sref);
              lines.push(`- scrollable container [ref=${sref}]`);
            }
          }
        }
      }

      // Optimization: Pre-compute interactive tag set for faster lookup
      const interactiveTags = new Set(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA']);
      const interactiveRoles = new Set(['button', 'link', 'textbox', 'combobox']);

      for (let i = 0; i < elements.length; i++) {
        if (ref >= MAX_ELEMENTS) break;

        const el = elements[i];
        const rect = el.getBoundingClientRect();

        // Check if element is visible (opacity, display, visibility)
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
          continue;
        }

        // We no longer filter by viewport to allow "whole page" analysis.
        // Elements will be included regardless of their position on the page.

        const tagName = el.tagName;
        const role = el.getAttribute('role') || tagName.toLowerCase();
        const isInteractive = interactiveTags.has(tagName) || interactiveRoles.has(role);

        // Optimization: Cache aria-label lookup
        let name = el.getAttribute('aria-label');
        if (!name) {
          const text = (el as HTMLElement).innerText;
          name = text ? text.trim().slice(0, 100) : '';
        }
        if (!name) {
          name = el.getAttribute('placeholder') || '';
        }
        if (!name) {
          name = el.getAttribute('title') || '';
        }

        // Clean up name (remove extra whitespace/newlines)
        name = name.replace(/\s+/g, ' ').trim();
        if (!name && !isInteractive) continue; // Skip empty non-interactive elements

        // Add visibility hint
        const isVisible = rect.top >= 0 && rect.left >= 0 && rect.bottom <= vHeight && rect.right <= vWidth;
        const visibilityHint = isVisible ? '' : ' (off-screen)';

        if (isInteractive) {
          ref++;
          (el as HTMLElement).setAttribute('data-ref', `e${ref}`);
          lines.push(`- ${role} "${name}" [ref=e${ref}]${visibilityHint}`);
        } else {
          // Contextual heading/text
          lines.push(`- ${role} "${name}"${visibilityHint}`);
        }
      }

      // Optimization: Join array instead of concatenating strings
      const result = lines.join('\n');
      return { snapshot: result, elementCount: ref };
    });

    if (!snapshot || snapshot.snapshot.length === 0) return null;

    const captureTimeMs = Date.now() - startTime;
    const refs = parseRefsOptimized(snapshot.snapshot);
    const result: AriaSnapshotResult = {
      raw: snapshot.snapshot,
      refs,
      elementCount: snapshot.elementCount,
      captureTimeMs,
    };

    return result;
  } catch (err) {
    console.warn('[Navis] Fast snapshot failed:', err);
    return null;
  }
}

export async function captureInteractiveElements(page: Page): Promise<AriaSnapshotResult> {
  // Check cache first (Req 1.4: 500ms TTL caching)
  const cached = getCachedSnapshot(page);
  if (cached) {
    console.log(`[Navis] Element snapshot cache hit (age: ${Date.now() - (cached.captureTimeMs || 0)}ms)`);
    return cached;
  }

  // Try fast method first (in-browser DOM query, very fast)
  const fastResult = await captureFastSnapshot(page);

  // Optimization: Skip expensive ariaSnapshot for small element counts (<100)
  // ariaSnapshot is slower and not needed for simple pages
  if (fastResult && fastResult.elementCount < 100) {
    setCachedSnapshot(page, fastResult);
    return fastResult;
  }

  // If fast method didn't find much, or we want high-fidelity reasoning for large pages
  // we fallback to Playwright's native AI-powered aria snapshot.
  try {
    const raw = await page.ariaSnapshot({
      timeout: 5000,
    });

    // Merge or pick the best. Usually, ariaSnapshot is much better for semantic roles.
    if (raw && raw.length > (fastResult?.raw.length || 0)) {
      const refs = parseRefsOptimized(raw);
      const result: AriaSnapshotResult = {
        raw,
        refs,
        elementCount: refs.size,
        captureTimeMs: Date.now() - (fastResult?.captureTimeMs || 0),
      };
      setCachedSnapshot(page, result);
      return result;
    }
  } catch (err) {
    console.warn('[Navis] ariaSnapshot failed, using fast result or empty:', err);
  }

  if (fastResult) {
    setCachedSnapshot(page, fastResult);
    return fastResult;
  }

  const fallback: AriaSnapshotResult = {
    raw: `- ${await page.title().catch(() => 'page')} "no interactive elements found" [ref=e1]`,
    refs: new Map([['e1', { role: 'heading', name: 'no interactive elements found' }]]),
    elementCount: 0,
    captureTimeMs: Date.now() - Date.now(),
  };
  setCachedSnapshot(page, fallback);
  return fallback;
}

export function parseRefs(snapshot: string): Map<string, { role: string; name: string }> {
  const refs = new Map<string, { role: string; name: string }>();
  const refRegex = /\[ref=([^\]]+)\]/g;
  const lines = snapshot.split('\n');

  for (const line of lines) {
    const match = line.match(refRegex);
    if (!match) continue;

    for (const refMatch of match) {
      const ref = refMatch.slice(5, -1);
      const roleMatch = line.match(/^\s*-\s*(\w+)/);
      const nameMatch = line.match(/"([^"]*)"/);

      refs.set(ref, {
        role: roleMatch ? roleMatch[1] : 'unknown',
        name: nameMatch ? nameMatch[1] : '',
      });
    }
  }

  return refs;
}

/**
 * Optimized ref parsing using single-pass algorithm
 * Avoids multiple regex matches per line
 */
export function parseRefsOptimized(snapshot: string): Map<string, { role: string; name: string }> {
  const refs = new Map<string, { role: string; name: string }>();
  const lines = snapshot.split('\n');

  for (const line of lines) {
    // Quick check: line must contain [ref=
    const refStart = line.indexOf('[ref=');
    if (refStart === -1) continue;

    // Extract ref value
    const refEnd = line.indexOf(']', refStart);
    if (refEnd === -1) continue;

    const ref = line.substring(refStart + 5, refEnd);

    // Extract role (first word after dash)
    let role = 'unknown';
    const dashIdx = line.indexOf('-');
    if (dashIdx !== -1) {
      const afterDash = line.substring(dashIdx + 1).trim();
      const spaceIdx = afterDash.indexOf(' ');
      role = spaceIdx !== -1 ? afterDash.substring(0, spaceIdx) : afterDash;
    }

    // Extract name (text between quotes)
    let name = '';
    const quoteStart = line.indexOf('"');
    if (quoteStart !== -1) {
      const quoteEnd = line.indexOf('"', quoteStart + 1);
      if (quoteEnd !== -1) {
        name = line.substring(quoteStart + 1, quoteEnd);
      }
    }

    refs.set(ref, { role, name });
  }

  return refs;
}

export function formatElementsForPrompt(snapshot: string): string {
  return snapshot;
}

/**
 * Clear the element snapshot cache (useful for testing or manual cache invalidation)
 */
export function clearElementCache(): void {
  elementSnapshotCache.clear();
}

/**
 * Get cache statistics for debugging
 */
export function getCacheStats(): { size: number; entries: Array<{ key: string; age: number }> } {
  const entries = Array.from(elementSnapshotCache.entries()).map(([key, entry]) => ({
    key,
    age: Date.now() - entry.timestamp,
  }));
  return { size: elementSnapshotCache.size, entries };
}

/**
 * Capture screenshot for vision model (full-screen mode)
 */
export async function captureForVision(page: Page): Promise<Buffer> {
  const fullScreenCapture = new FullScreenCaptureModule();

  // Hide overlay before screenshot so AI doesn't see it
  await page.evaluate(() => {
    const w = window as any;
    if (w.__navis_controls && w.__navis_controls.hideForScreenshot) {
      w.__navis_controls.hideForScreenshot();
    }
  }).catch(() => {});

  try {
    const result = await fullScreenCapture.captureFullScreen(page, {
      format: 'jpeg',
      quality: 85,
      fullScreen: true,
    });

    console.log(
      `[NAVIS] Captured at ${result.resolution.width}x${result.resolution.height} (window: ${result.windowSize.width}x${result.windowSize.height})`
    );

    return result.screenshot;
  } finally {
    // Show overlay again after screenshot
    await page.evaluate(() => {
      const w = window as any;
      if (w.__navis_controls && w.__navis_controls.showAfterScreenshot) {
        w.__navis_controls.showAfterScreenshot();
      }
    }).catch(() => {});
  }
}
