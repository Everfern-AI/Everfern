/**
 * Screenshot Integration Tests
 *
 * Tests the complete screenshot optimization pipeline in the orchestrator
 * Validates all Phase 1.4 requirements work together
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Page, Browser } from 'playwright';
import { chromium } from 'playwright';
import {
  DEFAULT_SCREENSHOT_CONFIG,
  getDetailLevel,
  checkScreenshotPerformance,
} from '../ai-optimization';

describe('Screenshot Optimization Integration (Phase 1.4)', () => {
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

  describe('Complete Screenshot Pipeline', () => {
    it('should execute full screenshot optimization pipeline', async () => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto('data:text/html,<h1>Pipeline Test</h1>');

      const startTime = Date.now();

      // Step 1: Capture screenshot with optimized settings
      const screenshot = await page.screenshot({
        type: DEFAULT_SCREENSHOT_CONFIG.format as 'jpeg' | 'png',
        quality: DEFAULT_SCREENSHOT_CONFIG.quality,
        fullPage: !DEFAULT_SCREENSHOT_CONFIG.viewportOnly,
      });

      const captureTime = Date.now() - startTime;

      // Step 2: Calculate size and detail level
      const sizeKB = Math.round((screenshot.length * 3) / 4 / 1024);
      const detail = getDetailLevel(sizeKB);

      // Step 3: Validate performance
      const perfCheck = checkScreenshotPerformance(captureTime);

      // Verify all requirements
      expect(screenshot[0]).toBe(0xff); // JPEG magic bytes
      expect(screenshot[1]).toBe(0xd8);
      expect(captureTime).toBeLessThan(300); // Req 4.5
      expect(perfCheck.met).toBe(true);
      expect(detail).toMatch(/^(low|high)$/);
    });

    it('should handle detail level transitions at 200KB boundary', async () => {
      await page.setViewportSize({ width: 1280, height: 720 });

      // Create a page that will produce a screenshot around 200KB
      const html = `
        <html>
          <body>
            <div style="width:1280px;height:720px;background:linear-gradient(45deg,
              #FF0000, #00FF00, #0000FF, #FFFF00, #FF00FF, #00FFFF, #FF0000);">
              <h1>Gradient Test</h1>
              <p>This page is designed to produce a screenshot around 200KB</p>
            </div>
          </body>
        </html>
      `;

      await page.goto(`data:text/html,${html}`);

      const screenshot = await page.screenshot({
        type: 'jpeg',
        quality: 75,
        fullPage: false,
      });

      const sizeKB = Math.round((screenshot.length * 3) / 4 / 1024);
      const detail = getDetailLevel(sizeKB);

      // Verify detail level is correctly determined
      if (sizeKB <= 200) {
        expect(detail).toBe('low');
      } else {
        expect(detail).toBe('high');
      }
    });

    it('should maintain performance across different viewport sizes', async () => {
      const viewports = [
        { width: 320, height: 480 },   // Mobile
        { width: 768, height: 1024 },  // Tablet
        { width: 1280, height: 720 },  // Desktop
        { width: 1920, height: 1080 }, // Full HD
      ];

      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        await page.goto('data:text/html,<h1>Viewport Test</h1>');

        const startTime = Date.now();
        const screenshot = await page.screenshot({
          type: 'jpeg',
          quality: 75,
          fullPage: false,
        });
        const elapsedMs = Date.now() - startTime;

        expect(elapsedMs).toBeLessThan(300);
        expect(screenshot.length).toBeGreaterThan(0);
      }
    });

    it('should handle rapid screenshot sequences', async () => {
      await page.goto('data:text/html,<h1>Rapid Sequence Test</h1>');

      const screenshots: Buffer[] = [];
      const times: number[] = [];

      for (let i = 0; i < 10; i++) {
        const startTime = Date.now();
        const screenshot = await page.screenshot({
          type: 'jpeg',
          quality: 75,
          fullPage: false,
        });
        times.push(Date.now() - startTime);
        screenshots.push(screenshot);
      }

      // All captures should be under 300ms
      times.forEach(t => expect(t).toBeLessThan(300));

      // All screenshots should be valid JPEG
      screenshots.forEach(s => {
        expect(s[0]).toBe(0xff);
        expect(s[1]).toBe(0xd8);
      });

      // Average time should be reasonable
      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      expect(avgTime).toBeLessThan(200);
    });
  });

  describe('Configuration Consistency', () => {
    it('should use consistent configuration across calls', async () => {
      await page.goto('data:text/html,<h1>Config Test</h1>');

      const config1 = DEFAULT_SCREENSHOT_CONFIG;
      const config2 = DEFAULT_SCREENSHOT_CONFIG;

      expect(config1).toEqual(config2);
      expect(config1.format).toBe('jpeg');
      expect(config1.quality).toBe(75);
      expect(config1.viewportOnly).toBe(true);
    });

    it('should apply configuration correctly to screenshot calls', async () => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto('data:text/html,<h1>Config Application Test</h1>');

      const screenshot = await page.screenshot({
        type: DEFAULT_SCREENSHOT_CONFIG.format as 'jpeg' | 'png',
        quality: DEFAULT_SCREENSHOT_CONFIG.quality,
        fullPage: !DEFAULT_SCREENSHOT_CONFIG.viewportOnly,
      });

      // Verify JPEG format
      expect(screenshot[0]).toBe(0xff);
      expect(screenshot[1]).toBe(0xd8);

      // Verify reasonable size (75% quality should produce smaller files)
      expect(screenshot.length).toBeGreaterThan(1000);
      expect(screenshot.length).toBeLessThan(1000000);
    });
  });

  describe('Performance Validation', () => {
    it('should validate performance metrics correctly', () => {
      const testCases = [
        { ms: 100, expected: true },
        { ms: 200, expected: true },
        { ms: 300, expected: true },
        { ms: 301, expected: false },
        { ms: 500, expected: false },
      ];

      testCases.forEach(({ ms, expected }) => {
        const result = checkScreenshotPerformance(ms);
        expect(result.met).toBe(expected);
        expect(result.message).toContain(ms.toString());
        expect(result.message).toContain('300ms');
      });
    });

    it('should provide meaningful performance messages', () => {
      const result = checkScreenshotPerformance(150);
      expect(result.message).toContain('150ms');
      expect(result.message).toContain('target: 300ms');
      expect(result.message).toContain('✓');
    });

    it('should flag performance warnings appropriately', () => {
      const passResult = checkScreenshotPerformance(250);
      const failResult = checkScreenshotPerformance(350);

      expect(passResult.message).toContain('✓');
      expect(failResult.message).toContain('⚠');
    });
  });

  describe('Detail Level Selection', () => {
    it('should select detail level based on size thresholds', () => {
      const testCases = [
        { kb: 50, expected: 'low' },
        { kb: 100, expected: 'low' },
        { kb: 199, expected: 'low' },
        { kb: 200, expected: 'low' },
        { kb: 201, expected: 'high' },
        { kb: 300, expected: 'high' },
        { kb: 1000, expected: 'high' },
      ];

      testCases.forEach(({ kb, expected }) => {
        const detail = getDetailLevel(kb);
        expect(detail).toBe(expected);
      });
    });

    it('should be deterministic', () => {
      for (let i = 0; i < 100; i++) {
        const detail1 = getDetailLevel(150);
        const detail2 = getDetailLevel(150);
        expect(detail1).toBe(detail2);
      }
    });
  });

  describe('Viewport-Only Capture Validation', () => {
    it('should capture only viewport content', async () => {
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

      // Viewport should be smaller than full page
      expect(viewportScreenshot.length).toBeLessThan(fullPageScreenshot.length);
    });

    it('should respect viewport size setting', async () => {
      const sizes = [
        { width: 320, height: 480 },
        { width: 1280, height: 720 },
        { width: 1920, height: 1080 },
      ];

      for (const size of sizes) {
        await page.setViewportSize(size);
        await page.goto('data:text/html,<h1>Test</h1>');

        const screenshot = await page.screenshot({
          type: 'jpeg',
          quality: 75,
          fullPage: false,
        });

        expect(screenshot.length).toBeGreaterThan(0);
      }
    });
  });

  describe('JPEG Quality Validation', () => {
    it('should produce valid JPEG files', async () => {
      await page.goto('data:text/html,<h1>JPEG Test</h1>');

      const screenshot = await page.screenshot({
        type: 'jpeg',
        quality: 75,
        fullPage: false,
      });

      // JPEG magic bytes
      expect(screenshot[0]).toBe(0xff);
      expect(screenshot[1]).toBe(0xd8);

      // JPEG end marker
      expect(screenshot[screenshot.length - 2]).toBe(0xff);
      expect(screenshot[screenshot.length - 1]).toBe(0xd9);
    });

    it('should produce smaller files with lower quality', async () => {
      await page.goto('data:text/html,<div style="width:1280px;height:720px;background:blue;"></div>');

      const low = await page.screenshot({
        type: 'jpeg',
        quality: 50,
        fullPage: false,
      });

      const high = await page.screenshot({
        type: 'jpeg',
        quality: 100,
        fullPage: false,
      });

      expect(low.length).toBeLessThan(high.length);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle empty pages', async () => {
      await page.goto('data:text/html,');

      const screenshot = await page.screenshot({
        type: 'jpeg',
        quality: 75,
        fullPage: false,
      });

      expect(screenshot.length).toBeGreaterThan(0);
    });

    it('should handle pages with no content', async () => {
      await page.goto('data:text/html,<html></html>');

      const screenshot = await page.screenshot({
        type: 'jpeg',
        quality: 75,
        fullPage: false,
      });

      expect(screenshot.length).toBeGreaterThan(0);
    });

    it('should handle very small viewports', async () => {
      await page.setViewportSize({ width: 100, height: 100 });
      await page.goto('data:text/html,<h1>Tiny</h1>');

      const screenshot = await page.screenshot({
        type: 'jpeg',
        quality: 75,
        fullPage: false,
      });

      expect(screenshot.length).toBeGreaterThan(0);
    });

    it('should handle very large viewports', async () => {
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
  });

  describe('Requirement Validation Summary', () => {
    it('should satisfy Req 4.1: JPEG format with 75% quality', () => {
      expect(DEFAULT_SCREENSHOT_CONFIG.format).toBe('jpeg');
      expect(DEFAULT_SCREENSHOT_CONFIG.quality).toBe(75);
    });

    it('should satisfy Req 4.2 & 4.3: Detail level selection', () => {
      expect(getDetailLevel(100)).toBe('low');
      expect(getDetailLevel(300)).toBe('high');
    });

    it('should satisfy Req 4.4: Viewport-only capture', () => {
      expect(DEFAULT_SCREENSHOT_CONFIG.viewportOnly).toBe(true);
    });

    it('should satisfy Req 4.5: 300ms performance target', () => {
      const result = checkScreenshotPerformance(250);
      expect(result.met).toBe(true);
    });
  });
});
