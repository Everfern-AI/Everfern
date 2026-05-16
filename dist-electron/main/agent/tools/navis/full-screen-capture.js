"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.FullScreenCaptureModule = void 0;
class FullScreenCaptureModule {
    screenDimensionsCache = null;
    cacheTimestamp = 0;
    CACHE_TTL = 60000; // 1 minute
    /**
     * Capture screenshot at maximum available resolution
     */
    async captureFullScreen(page, options) {
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
        }
        catch (error) {
            console.error('[Navis] Full-screen capture failed:', error);
            throw error;
        }
    }
    /**
     * Get screen dimensions with caching (1 minute TTL)
     */
    async getScreenDimensions(page) {
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
    async getWindowSize(page) {
        return await page.evaluate(() => ({
            width: window.innerWidth,
            height: window.innerHeight,
        }));
    }
    /**
     * Set window size
     */
    async setWindowSize(page, size) {
        await page.setViewportSize(size);
    }
    /**
     * Clear the screen dimensions cache (useful for testing)
     */
    clearCache() {
        this.screenDimensionsCache = null;
        this.cacheTimestamp = 0;
    }
}
exports.FullScreenCaptureModule = FullScreenCaptureModule;
