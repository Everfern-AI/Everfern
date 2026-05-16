/**
 * Navis — Full-Screen Capture Module
 *
 * Always captures screenshots at maximum screen resolution regardless of window size.
 * This ensures consistent element detection and prevents performance degradation
 * from window resizing.
 *
 * Features:
 * - Captures at full screen resolution
 * - Temporarily maximizes window for capture
 * - Restores original window size after capture
 * - Screen dimension caching (1 minute TTL)
 */

import { Page } from 'playwright';

export interface CaptureOptions {
  format?: 'png' | 'jpeg';
  quality?: number; // 0-100 for jpeg
  fullScreen?: boolean;
}

export interface CaptureResult {
  screenshot: Buffer;
  resolution: { width: number; height: number };
  windowSize: { width: number; height: number };
  timestamp: number;
}

export class FullScreenCaptureModule {
  private screenDimensionsCache: { width: number; height: number } | null = null;
  private cacheTimestamp: number = 0;
  private readonly CACHE_TTL = 60000; // 1 minute

  /**
   * Capture screenshot at maximum available resolution
   */
  async captureFullScreen(page: Page, options?: CaptureOptions): Promise<CaptureResult> {
    const startTime = Date.now();

    try {
      // 1. Get screen dimensions (cached)
      const screenSize = await this.getScreenDimensions(page);

      // 2. Get current window size
      const originalSize = await this.getWindowSize(page);

      // 3. Temporarily maximize window if needed
      const needsResize = originalSize.width !== screenSize.width || originalSize.height !== screenSize.height;
      if (needsResize) {
        await this.setWindowSize(page, screenSize);
        // Wait for layout to stabilize after resize
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // 4. Capture at full resolution
      const screenshot = await page.screenshot({
        fullPage: false, // Only visible viewport
        type: options?.format || 'jpeg',
        quality: options?.quality || 85,
      });

      // 5. Restore original window size
      if (needsResize) {
        await this.setWindowSize(page, originalSize);
      }

      const captureTime = Date.now() - startTime;
      console.log(`[Navis] Full-screen capture completed in ${captureTime}ms (${screenSize.width}x${screenSize.height})`);

      return {
        screenshot,
        resolution: screenSize,
        windowSize: originalSize,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error('[Navis] Full-screen capture failed:', error);
      throw error;
    }
  }

  /**
   * Get screen dimensions with caching (1 minute TTL)
   */
  private async getScreenDimensions(page: Page): Promise<{ width: number; height: number }> {
    const now = Date.now();

    // Check cache
    if (this.screenDimensionsCache && (now - this.cacheTimestamp) < this.CACHE_TTL) {
      return this.screenDimensionsCache;
    }

    // Query screen dimensions
    const dimensions = await page.evaluate(() => ({
      width: window.screen.width,
      height: window.screen.height,
    }));

    // Update cache
    this.screenDimensionsCache = dimensions;
    this.cacheTimestamp = now;

    return dimensions;
  }

  /**
   * Get current window size
   */
  private async getWindowSize(page: Page): Promise<{ width: number; height: number }> {
    return await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));
  }

  /**
   * Set window size
   */
  private async setWindowSize(page: Page, size: { width: number; height: number }): Promise<void> {
    await page.setViewportSize(size);
  }

  /**
   * Clear the screen dimensions cache (useful for testing)
   */
  clearCache(): void {
    this.screenDimensionsCache = null;
    this.cacheTimestamp = 0;
  }
}
