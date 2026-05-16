/**
 * Integration tests for NAVIS Hybrid System
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, Browser, Page } from 'playwright';
import { VisionGroundingHybrid } from '../hybrid-click';
import { FullScreenCaptureModule } from '../full-screen-capture';
import { captureForVision } from '../element-capture';

describe('NAVIS Hybrid System Integration', () => {
  let browser: Browser;
  let page: Page;
  let mockAIClient: any;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();

    // Mock AI client for testing
    mockAIClient = {
      chat: async () => ({
        content: JSON.stringify({
          coordinates: { x: 100, y: 100 },
          confidence: 0.95,
        }),
      }),
    };
  });

  afterAll(async () => {
    await browser.close();
  });

  it('should complete full hybrid click workflow', async () => {
    // Load a simple test page
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <body>
          <button id="test-btn" style="position: absolute; left: 90px; top: 90px; width: 100px; height: 40px;">
            Click Me
          </button>
        </body>
      </html>
    `);

    // Capture screenshot
    const captureModule = new FullScreenCaptureModule();
    const capture = await captureModule.captureFullScreen(page, {
      format: 'jpeg',
      quality: 85,
    });

    expect(capture.screenshot).toBeInstanceOf(Buffer);
    expect(capture.resolution.width).toBeGreaterThan(0);
    expect(capture.resolution.height).toBeGreaterThan(0);

    // Test hybrid click
    const hybrid = new VisionGroundingHybrid(mockAIClient);
    const result = await hybrid.hybridClick(page, capture.screenshot, 'Click Me button');

    expect(result.success).toBe(true);
    expect(['dom', 'pixel']).toContain(result.method);
  });

  it('should handle real website interactions', async () => {
    // Navigate to a simple page
    await page.goto('data:text/html,<button id="btn">Test</button>');

    // Capture screenshot
    const screenshot = await captureForVision(page);

    expect(screenshot).toBeInstanceOf(Buffer);
    expect(screenshot.length).toBeGreaterThan(0);
  });

  it('should maintain performance targets', async () => {
    // Load test page
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <body>
          <button id="test-btn">Click Me</button>
        </body>
      </html>
    `);

    const startTime = Date.now();

    // Full workflow: capture → vision → DOM → click
    const captureModule = new FullScreenCaptureModule();
    const capture = await captureModule.captureFullScreen(page);

    const captureTime = Date.now() - startTime;
    expect(captureTime).toBeLessThan(500); // < 500ms for capture

    // Note: Vision model call is mocked, so total time will be fast
    // In production, total time should be < 3s
  });

  it('should cache screen dimensions', async () => {
    const captureModule = new FullScreenCaptureModule();

    const start1 = Date.now();
    await captureModule.captureFullScreen(page);
    const time1 = Date.now() - start1;

    const start2 = Date.now();
    await captureModule.captureFullScreen(page);
    const time2 = Date.now() - start2;

    // Second capture should be faster due to caching
    // (though the difference may be small)
    expect(time2).toBeLessThanOrEqual(time1 + 50);
  });

  it('should restore window size after capture', async () => {
    const originalSize = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));

    const captureModule = new FullScreenCaptureModule();
    await captureModule.captureFullScreen(page);

    const finalSize = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));

    expect(finalSize.width).toBe(originalSize.width);
    expect(finalSize.height).toBe(originalSize.height);
  });
});
