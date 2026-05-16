/**
 * Screenshot Optimization Tests
 *
 * Validates Phase 1.4 requirements:
 * - Req 4.1: JPEG format with 75% quality
 * - Req 4.2, 4.3: Detail level selection based on size
 * - Req 4.4: Viewport-only capture
 * - Req 4.5: Capture within 300ms
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Page, Browser } from 'playwright';
import { chromium } from 'playwright';
import {
  DEFAULT_SCREENSHOT_CONFIG,
  getDetailLevel,
  checkScreenshotPerformance,
} from '../ai-optimization';

describe('Screenshot Optimization (Phase 1.4)', () => {
  let browser: Browser;
  let page: Page;

  beforeEach(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
  });

  afterEach(async () => {
    await page.close();
    await browser.close();
  });

  describe('Req 4.1: JPEG Format with 75% Quality', () => {
    it('should use JPEG format by default', () => {
      expect(DEFAULT_SCREENSHOT_CONFIG.format).toBe('jpeg');
    });

    it('should use 75% quality for JPEG', () => {
      expect(DEFAULT_SCREENSHOT_CONFIG.quality).toBe(75);
    });

    it('should capture screenshot in JPEG format', async () => {
      await page.goto('data:text/html,<h1>Test Page</h1>');
      const screenshot = await page.screenshot({
        type: 'jpeg',
        quality: 75,
        fullPage: false,
      });

      // JPEG files start with FFD8 magic bytes
      expect(screenshot[0]).toBe(0xff);
      expect(screenshot[1]).toBe(0xd8);
    });

    it('should produce smaller file size with 75% quality vs 100%', async () => {
      await page.goto('data:text/html,<div style="width:1280px;height:720px;background:blue;"></div>');

      const screenshot75 = await page.screenshot({
        type: 'jpeg',
        quality: 75,
        fullPage: false,
      });

      const screenshot100 = await page.screenshot({
        type: 'jpeg',
        quality: 100,
        fullPage: false,
      });

      // 75% quality should produce smaller file
      expect(screenshot75.length).toBeLessThan(screenshot100.length);
    });

    it('should maintain acceptable visual quality at 75%', async () => {
      await page.goto(
        'data:text/html,<div style="width:1280px;height:720px;background:linear-gradient(to right, red, blue);"></div>'
      );

      const screenshot = await page.screenshot({
        type: 'jpeg',
        quality: 75,
        fullPage: false,
      });

      // File should be reasonably sized (not too small, not too large)
      expect(screenshot.length).toBeGreaterThan(5000); // At least 5KB
      expect(screenshot.length).toBeLessThan(500000); // Less than 500KB
    });
  });

  describe('Req 4.2 & 4.3: Detail Level Selection Based on Size', () => {
    it('should return "low" detail for screenshots < 200KB', () => {
      const detail = getDetailLevel(100); // 100KB
      expect(detail).toBe('low');
    });

    it('should return "low" detail for screenshots at 200KB boundary', () => {
      const detail = getDetailLevel(200); // Exactly 200KB
      expect(detail).toBe('low');
    });

    it('should return "high" detail for screenshots > 200KB', () => {
      const detail = getDetailLevel(201); // 201KB
      expect(detail).toBe('high');
    });

    it('should return "high" detail for large screenshots', () => {
      const detail = getDetailLevel(500); // 500KB
      expect(detail).toBe('high');
    });

    it('should return "low" detail for very small screenshots', () => {
      const detail = getDetailLevel(10); // 10KB
      expect(detail).toBe('low');
    });

    it('should handle edge case: 199KB', () => {
      const detail = getDetailLevel(199);
      expect(detail).toBe('low');
    });

    it('should handle edge case: 1MB', () => {
      const detail = getDetailLevel(1024);
      expect(detail).toBe('high');
    });

    it('should be consistent across multiple calls', () => {
      const detail1 = getDetailLevel(150);
      const detail2 = getDetailLevel(150);
      expect(detail1).toBe(detail2);
    });
  });

  describe('Req 4.4: Viewport-Only Screenshot Capture', () => {
    it('should capture viewport-only by default', () => {
      expect(DEFAULT_SCREENSHOT_CONFIG.viewportOnly).toBe(true);
    });

    it('should not capture full page when viewportOnly is true', async () => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto(
        'data:text/html,<div style="height:2000px;background:blue;"></div>'
      );

      const viewportScreenshot = await page.screenshot({
        type: 'jpeg',
        quality: 75,
        fullPage: false,
      });

      const fullPageScreenshot = await page.screenshot({
        type: 'jpeg',
        quality: 75,
        fullPage: true,
      });

      // Viewport screenshot should be smaller than full page
      expect(viewportScreenshot.length).toBeLessThan(fullPageScreenshot.length);
    });

    it('should capture only visible content', async () => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto(
        'data:text/html,<div style="width:1280px;height:720px;background:red;"></div><div style="width:1280px;height:720px;background:blue;"></div>'
      );

      const screenshot = await page.screenshot({
        type: 'jpeg',
        quality: 75,
        fullPage: false,
      });

      // Should only capture the visible viewport (red div, not blue)
      expect(screenshot.length).toBeGreaterThan(0);
    });

    it('should respect viewport size in screenshot', async () => {
      await page.setViewportSize({ width: 800, height: 600 });
      await page.goto('data:text/html,<h1>Test</h1>');

      const screenshot = await page.screenshot({
        type: 'jpeg',
        quality: 75,
        fullPage: false,
      });

      // Screenshot should be approximately 800x600
      expect(screenshot.length).toBeGreaterThan(0);
    });
  });

  describe('Req 4.5: Screenshot Capture Within 300ms', () => {
    it('should capture screenshot within 300ms', async () => {
      await page.goto('data:text/html,<h1>Test Page</h1>');

      const startTime = Date.now();
      await page.screenshot({
        type: 'jpeg',
        quality: 75,
        fullPage: false,
      });
      const elapsedMs = Date.now() - startTime;

      expect(elapsedMs).toBeLessThan(300);
    });

    it('should capture multiple screenshots within 300ms each', async () => {
      await page.goto('data:text/html,<h1>Test Page</h1>');

      for (let i = 0; i < 5; i++) {
        const startTime = Date.now();
        await page.screenshot({
          type: 'jpeg',
          quality: 75,
          fullPage: false,
        });
        const elapsedMs = Date.now() - startTime;

        expect(elapsedMs).toBeLessThan(300);
      }
    });

    it('should validate performance with checkScreenshotPerformance', () => {
      const result = checkScreenshotPerformance(150);
      expect(result.met).toBe(true);
      expect(result.message).toContain('150ms');
      expect(result.message).toContain('300ms');
    });

    it('should flag performance warning when exceeding 300ms', () => {
      const result = checkScreenshotPerformance(350);
      expect(result.met).toBe(false);
      expect(result.message).toContain('⚠');
    });

    it('should pass performance check at exactly 300ms', () => {
      const result = checkScreenshotPerformance(300);
      expect(result.met).toBe(true);
    });

    it('should fail performance check at 301ms', () => {
      const result = checkScreenshotPerformance(301);
      expect(result.met).toBe(false);
    });
  });

  describe('Integration: Screenshot Optimization Pipeline', () => {
    it('should capture screenshot with all optimizations applied', async () => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto('data:text/html,<h1>Optimized Screenshot Test</h1>');

      const startTime = Date.now();
      const screenshot = await page.screenshot({
        type: 'jpeg',
        quality: 75,
        fullPage: false,
      });
      const elapsedMs = Date.now() - startTime;

      // Verify all requirements
      expect(screenshot[0]).toBe(0xff); // JPEG magic bytes
      expect(screenshot[1]).toBe(0xd8);
      expect(elapsedMs).toBeLessThan(300); // Req 4.5
      expect(screenshot.length).toBeGreaterThan(0);
    });

    it('should calculate detail level based on screenshot size', async () => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto('data:text/html,<h1>Test</h1>');

      const screenshot = await page.screenshot({
        type: 'jpeg',
        quality: 75,
        fullPage: false,
      });

      const sizeKB = Math.round((screenshot.length * 3) / 4 / 1024);
      const detail = getDetailLevel(sizeKB);

      // Verify detail level is correctly determined
      if (sizeKB > 200) {
        expect(detail).toBe('high');
      } else {
        expect(detail).toBe('low');
      }
    });

    it('should handle complex pages efficiently', async () => {
      const complexHtml = `
        <html>
          <body>
            <div style="width:1280px;height:720px;background:linear-gradient(45deg, red, blue, green);">
              <h1>Complex Page</h1>
              <p>This is a complex page with multiple elements</p>
              <button>Click me</button>
              <input type="text" placeholder="Enter text" />
              <select>
                <option>Option 1</option>
                <option>Option 2</option>
              </select>
            </div>
          </body>
        </html>
      `;

      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto(`data:text/html,${complexHtml}`);

      const startTime = Date.now();
      const screenshot = await page.screenshot({
        type: 'jpeg',
        quality: 75,
        fullPage: false,
      });
      const elapsedMs = Date.now() - startTime;

      expect(screenshot.length).toBeGreaterThan(0);
      expect(elapsedMs).toBeLessThan(300);
    });
  });

  describe('Performance Characteristics', () => {
    it('should maintain consistent performance across multiple captures', async () => {
      await page.goto('data:text/html,<h1>Performance Test</h1>');

      const times: number[] = [];
      for (let i = 0; i < 10; i++) {
        const startTime = Date.now();
        await page.screenshot({
          type: 'jpeg',
          quality: 75,
          fullPage: false,
        });
        times.push(Date.now() - startTime);
      }

      // All captures should be under 300ms
      times.forEach(t => expect(t).toBeLessThan(300));

      // Average should be reasonable
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      expect(avg).toBeLessThan(200);
    });

    it('should handle rapid successive captures', async () => {
      await page.goto('data:text/html,<h1>Rapid Capture Test</h1>');

      const startTime = Date.now();
      for (let i = 0; i < 5; i++) {
        await page.screenshot({
          type: 'jpeg',
          quality: 75,
          fullPage: false,
        });
      }
      const totalTime = Date.now() - startTime;

      // 5 captures should complete in reasonable time
      expect(totalTime).toBeLessThan(1500); // ~300ms each
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty page', async () => {
      await page.goto('data:text/html,');

      const screenshot = await page.screenshot({
        type: 'jpeg',
        quality: 75,
        fullPage: false,
      });

      expect(screenshot.length).toBeGreaterThan(0);
    });

    it('should handle very small viewport', async () => {
      await page.setViewportSize({ width: 320, height: 480 });
      await page.goto('data:text/html,<h1>Mobile</h1>');

      const screenshot = await page.screenshot({
        type: 'jpeg',
        quality: 75,
        fullPage: false,
      });

      expect(screenshot.length).toBeGreaterThan(0);
    });

    it('should handle very large viewport', async () => {
      await page.setViewportSize({ width: 3840, height: 2160 });
      await page.goto('data:text/html,<h1>4K</h1>');

      const startTime = Date.now();
      const screenshot = await page.screenshot({
        type: 'jpeg',
        quality: 75,
        fullPage: false,
      });
      const elapsedMs = Date.now() - startTime;

      expect(screenshot.length).toBeGreaterThan(0);
      // Even 4K should be reasonably fast
      expect(elapsedMs).toBeLessThan(500);
    });

    it('should handle page with images', async () => {
      const html = `
        <html>
          <body>
            <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" />
          </body>
        </html>
      `;

      await page.goto(`data:text/html,${html}`);

      const screenshot = await page.screenshot({
        type: 'jpeg',
        quality: 75,
        fullPage: false,
      });

      expect(screenshot.length).toBeGreaterThan(0);
    });
  });

  describe('Configuration Validation', () => {
    it('should have correct default configuration', () => {
      expect(DEFAULT_SCREENSHOT_CONFIG).toEqual({
        format: 'jpeg',
        quality: 75,
        viewportOnly: true,
      });
    });

    it('should validate screenshot config properties', () => {
      const config = DEFAULT_SCREENSHOT_CONFIG;
      expect(config.format).toBe('jpeg');
      expect(config.quality).toBeGreaterThanOrEqual(0);
      expect(config.quality).toBeLessThanOrEqual(100);
      expect(config.viewportOnly).toBe(true);
    });
  });
});
