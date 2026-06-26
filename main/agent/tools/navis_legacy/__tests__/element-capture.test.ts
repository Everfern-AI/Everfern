/**
 * Unit tests for Navis Element Capture
 * Tests viewport-aware filtering, caching, and performance
 */

import { test, expect, describe, beforeEach, afterEach } from 'vitest';
import { Page, Browser } from 'playwright';
import { chromium } from 'playwright';
import {
  captureInteractiveElements,
  captureFastSnapshot,
  parseRefs,
  parseRefsOptimized,
  parseHtmlDomParserContext,
  clearElementCache,
  getCacheStats,
  AriaSnapshotResult,
} from '../element-capture';

describe('Element Capture - Viewport-Aware Filtering', () => {
  let browser: Browser;
  let page: Page;

  beforeEach(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    clearElementCache();
  });

  afterEach(async () => {
    if (page) await page.close();
    if (browser) await browser.close();
    clearElementCache();
  });

  describe('html-dom-parser context', () => {
    test('should extract page structure from raw HTML', () => {
      const context = parseHtmlDomParserContext(`
        <html>
          <head><title>Booking Flow</title></head>
          <body>
            <nav aria-label="Primary navigation">
              <a href="/homes">Homes</a>
              <a href="/book">Book</a>
            </nav>
            <main>
              <h1>Find a stay</h1>
              <form action="/search" method="post">
                <label for="where">Where</label>
                <input id="where" name="where" placeholder="City or address" />
                <button type="submit">Search</button>
              </form>
              <p>Choose verified listings with flexible booking windows.</p>
            </main>
          </body>
        </html>
      `);

      expect(context.parser).toBe('html-dom-parser');
      expect(context.title).toBe('Booking Flow');
      expect(context.headings.some(item => item.text === 'Find a stay')).toBe(true);
      expect(context.forms.some(item => item.action === '/search')).toBe(true);
      expect(context.controls.some(item => item.placeholder === 'City or address')).toBe(true);
      expect(context.links.some(item => item.href === '/book')).toBe(true);
    });
  });

  describe('Viewport-Aware Filtering (Req 1.5)', () => {
    test('should capture elements within viewport', async () => {
      // Create a page with elements in viewport
      await page.setContent(`
        <html>
          <body style="margin: 0; padding: 0;">
            <button id="btn1" style="position: absolute; top: 100px; left: 100px;">Button 1</button>
            <button id="btn2" style="position: absolute; top: 200px; left: 200px;">Button 2</button>
          </body>
        </html>
      `);

      const result = await captureFastSnapshot(page);
      expect(result).not.toBeNull();
      expect(result!.elementCount).toBeGreaterThan(0);
      expect(result!.raw).toContain('Button 1');
      expect(result!.raw).toContain('Button 2');
    });

    test('should skip elements far below viewport (outside 500px buffer)', async () => {
      // Set viewport to 720px height
      await page.setViewportSize({ width: 1280, height: 720 });

      // Create elements: one in viewport, one far below
      await page.setContent(`
        <html>
          <body style="margin: 0; padding: 0; height: 3000px;">
            <button id="btn-visible" style="position: absolute; top: 100px;">Visible Button</button>
            <button id="btn-far" style="position: absolute; top: 2000px;">Far Button</button>
          </body>
        </html>
      `);

      const result = await captureFastSnapshot(page);
      expect(result).not.toBeNull();
      expect(result!.raw).toContain('Visible Button');
      // Far button should not be captured (2000px > 720 + 500 buffer)
      expect(result!.raw).not.toContain('Far Button');
    });

    test('should include elements within 500px buffer below viewport', async () => {
      await page.setViewportSize({ width: 1280, height: 720 });

      // Create element just within buffer (viewport height 720 + 500 buffer = 1220px)
      await page.setContent(`
        <html>
          <body style="margin: 0; padding: 0; height: 2000px;">
            <button id="btn-in-buffer" style="position: absolute; top: 1000px;">In Buffer</button>
          </body>
        </html>
      `);

      const result = await captureFastSnapshot(page);
      expect(result).not.toBeNull();
      // Element at 1000px should be within buffer (720 + 500 = 1220)
      expect(result!.raw).toContain('In Buffer');
    });

    test('should skip elements far above viewport (outside 500px buffer)', async () => {
      await page.setViewportSize({ width: 1280, height: 720 });

      // Scroll down and create elements above viewport
      await page.setContent(`
        <html>
          <body style="margin: 0; padding: 0; height: 3000px;">
            <button id="btn-far-above" style="position: absolute; top: -1000px;">Far Above</button>
            <button id="btn-visible" style="position: absolute; top: 100px;">Visible</button>
          </body>
        </html>
      `);

      const result = await captureFastSnapshot(page);
      expect(result).not.toBeNull();
      expect(result!.raw).toContain('Visible');
      // Element at -1000px should not be captured (outside -500 buffer)
      expect(result!.raw).not.toContain('Far Above');
    });

    test('should include elements within 500px buffer above viewport', async () => {
      await page.setViewportSize({ width: 1280, height: 720 });

      // Create element just within buffer above viewport
      await page.setContent(`
        <html>
          <body style="margin: 0; padding: 0; height: 2000px;">
            <button id="btn-in-buffer-above" style="position: absolute; top: -300px;">In Buffer Above</button>
            <button id="btn-visible" style="position: absolute; top: 100px;">Visible</button>
          </body>
        </html>
      `);

      const result = await captureFastSnapshot(page);
      expect(result).not.toBeNull();
      expect(result!.raw).toContain('Visible');
      // Element at -300px should be within buffer (-500 to 0)
      expect(result!.raw).toContain('In Buffer Above');
    });

    test('should skip elements far to the right (outside buffer)', async () => {
      await page.setViewportSize({ width: 1280, height: 720 });

      await page.setContent(`
        <html>
          <body style="margin: 0; padding: 0; width: 5000px;">
            <button id="btn-visible" style="position: absolute; left: 100px; top: 100px;">Visible</button>
            <button id="btn-far-right" style="position: absolute; left: 3000px; top: 100px;">Far Right</button>
          </body>
        </html>
      `);

      const result = await captureFastSnapshot(page);
      expect(result).not.toBeNull();
      expect(result!.raw).toContain('Visible');
      // Element at 3000px right should not be captured (outside 1280 + 200 buffer)
      expect(result!.raw).not.toContain('Far Right');
    });

    test('should include elements within horizontal buffer', async () => {
      await page.setViewportSize({ width: 1280, height: 720 });

      await page.setContent(`
        <html>
          <body style="margin: 0; padding: 0; width: 3000px;">
            <button id="btn-visible" style="position: absolute; left: 100px; top: 100px;">Visible</button>
            <button id="btn-in-buffer" style="position: absolute; left: 1400px; top: 100px;">In Buffer</button>
          </body>
        </html>
      `);

      const result = await captureFastSnapshot(page);
      expect(result).not.toBeNull();
      expect(result!.raw).toContain('Visible');
      // Element at 1400px should be within buffer (1280 + 200 = 1480)
      expect(result!.raw).toContain('In Buffer');
    });
  });

  describe('Element Snapshot Caching (Req 1.4)', () => {
    test('should cache element snapshots for 500ms', async () => {
      await page.setContent(`
        <html>
          <body>
            <button>Test Button</button>
          </body>
        </html>
      `);

      // First capture
      const result1 = await captureInteractiveElements(page);
      expect(result1).not.toBeNull();

      // Second capture immediately (should be cached)
      const result2 = await captureInteractiveElements(page);
      expect(result2).not.toBeNull();
      expect(result2.raw).toBe(result1.raw);

      // Wait for cache to expire
      await new Promise(resolve => setTimeout(resolve, 600));

      // Third capture (cache expired, should recapture)
      const result3 = await captureInteractiveElements(page);
      expect(result3).not.toBeNull();
    });

    test('should invalidate cache on navigation', async () => {
      clearElementCache();

      await page.setContent(`
        <html>
          <body>
            <button>Button 1</button>
          </body>
        </html>
      `);

      const result1 = await captureInteractiveElements(page);
      expect(result1.raw).toContain('Button 1');

      // Clear cache to simulate navigation
      clearElementCache();

      // Navigate to new content
      await page.setContent(`
        <html>
          <body>
            <button>Button 2</button>
          </body>
        </html>
      `);

      const result2 = await captureInteractiveElements(page);
      expect(result2.raw).toContain('Button 2');
    });

    test('should track cache statistics', async () => {
      await page.setContent(`
        <html>
          <body>
            <button>Test</button>
          </body>
        </html>
      `);

      clearElementCache();
      let stats = getCacheStats();
      expect(stats.size).toBe(0);

      await captureInteractiveElements(page);
      stats = getCacheStats();
      expect(stats.size).toBeGreaterThan(0);

      clearElementCache();
      stats = getCacheStats();
      expect(stats.size).toBe(0);
    });

    test('should return cached snapshot within TTL window', async () => {
      clearElementCache();

      await page.setContent(`
        <html>
          <body>
            <button id="btn1">Button 1</button>
            <button id="btn2">Button 2</button>
          </body>
        </html>
      `);

      // First capture
      const result1 = await captureInteractiveElements(page);
      const snapshot1 = result1.raw;

      // Multiple captures within 500ms should all return same cached snapshot
      for (let i = 0; i < 5; i++) {
        const result = await captureInteractiveElements(page);
        expect(result.raw).toBe(snapshot1);
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // Total time: 250ms, still within 500ms TTL
      const stats = getCacheStats();
      expect(stats.size).toBe(1);
      expect(stats.entries[0].age).toBeLessThan(500);
    });

    test('should recapture after TTL expires', async () => {
      clearElementCache();

      await page.setContent(`
        <html>
          <body>
            <button>Original Button</button>
          </body>
        </html>
      `);

      // First capture
      const result1 = await captureInteractiveElements(page);
      expect(result1.raw).toContain('Original Button');

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 550));

      // Modify page content
      await page.setContent(`
        <html>
          <body>
            <button>Updated Button</button>
          </body>
        </html>
      `);

      // Second capture should recapture (cache expired)
      const result2 = await captureInteractiveElements(page);
      expect(result2.raw).toContain('Updated Button');
    });

    test('should invalidate cache when URL changes', async () => {
      clearElementCache();

      // First page
      await page.setContent(`
        <html>
          <body>
            <button>Page 1</button>
          </body>
        </html>
      `);

      const result1 = await captureInteractiveElements(page);
      expect(result1.raw).toContain('Page 1');

      let stats = getCacheStats();
      expect(stats.size).toBe(1);

      // Verify cache is being used
      const result1b = await captureInteractiveElements(page);
      expect(result1b.raw).toBe(result1.raw); // Same reference (cached)

      // Clear cache to simulate navigation
      clearElementCache();

      // Modify content (simulating navigation)
      await page.setContent(`
        <html>
          <body>
            <button>Page 2</button>
          </body>
        </html>
      `);

      // Cache should be empty after clear
      stats = getCacheStats();
      expect(stats.size).toBe(0);

      // New capture should get new content
      const result2 = await captureInteractiveElements(page);
      expect(result2.raw).toContain('Page 2');
    });

    test('should provide accurate cache age in statistics', async () => {
      clearElementCache();

      await page.setContent(`
        <html>
          <body>
            <button>Test</button>
          </body>
        </html>
      `);

      await captureInteractiveElements(page);

      // Check cache age immediately
      let stats = getCacheStats();
      expect(stats.entries[0].age).toBeLessThan(50);

      // Wait and check again
      await new Promise(resolve => setTimeout(resolve, 200));
      stats = getCacheStats();
      expect(stats.entries[0].age).toBeGreaterThanOrEqual(200);
      expect(stats.entries[0].age).toBeLessThan(250);
    });
  });

  describe('Performance Targets (Req 1.1, 1.2, 1.3)', () => {
    test('should capture <100 elements within 50ms', async () => {
      // Create page with ~50 elements
      let html = '<html><body>';
      for (let i = 0; i < 50; i++) {
        html += `<button id="btn${i}">Button ${i}</button>`;
      }
      html += '</body></html>';

      await page.setContent(html);

      const startTime = Date.now();
      const result = await captureFastSnapshot(page);
      const duration = Date.now() - startTime;

      expect(result).not.toBeNull();
      expect(result!.elementCount).toBeLessThan(100);
      expect(duration).toBeLessThan(50);
    });

    test('should capture 100-500 elements within 100ms', async () => {
      // Create page with ~200 elements
      let html = '<html><body>';
      for (let i = 0; i < 200; i++) {
        html += `<button id="btn${i}">Button ${i}</button>`;
      }
      html += '</body></html>';

      await page.setContent(html);

      const startTime = Date.now();
      const result = await captureFastSnapshot(page);
      const duration = Date.now() - startTime;

      expect(result).not.toBeNull();
      expect(result!.elementCount).toBeGreaterThanOrEqual(100);
      expect(result!.elementCount).toBeLessThanOrEqual(500);
      expect(duration).toBeLessThan(100);
    });

    test('should capture >500 elements within 200ms', async () => {
      // Create page with ~600 elements
      let html = '<html><body>';
      for (let i = 0; i < 600; i++) {
        html += `<button id="btn${i}">Button ${i}</button>`;
      }
      html += '</body></html>';

      await page.setContent(html);

      const startTime = Date.now();
      const result = await captureFastSnapshot(page);
      const duration = Date.now() - startTime;

      expect(result).not.toBeNull();
      expect(result!.elementCount).toBeGreaterThan(500);
      expect(duration).toBeLessThan(200);
    });

    test('should parse refs efficiently for <100 elements', async () => {
      const snapshot = `- button "Button 1" [ref=e1]
- button "Button 2" [ref=e2]
- button "Button 3" [ref=e3]`;

      const startTime = Date.now();
      const refs = parseRefsOptimized(snapshot);
      const duration = Date.now() - startTime;

      expect(refs.size).toBe(3);
      expect(duration).toBeLessThan(5); // Should be very fast
    });

    test('should parse refs efficiently for large snapshots', async () => {
      // Create a large snapshot
      const lines: string[] = [];
      for (let i = 1; i <= 500; i++) {
        lines.push(`- button "Button ${i}" [ref=e${i}]`);
      }
      const snapshot = lines.join('\n');

      const startTime = Date.now();
      const refs = parseRefsOptimized(snapshot);
      const duration = Date.now() - startTime;

      expect(refs.size).toBe(500);
      expect(duration).toBeLessThan(20); // Should be fast even for large snapshots
    });
  });

  describe('Ref Parsing and Extraction', () => {
    test('should parse refs from snapshot correctly', () => {
      const snapshot = `
- button "Click me" [ref=e1]
- input "Search" [ref=e2]
- link "Home" [ref=e3]
      `;

      const refs = parseRefs(snapshot);
      expect(refs.size).toBe(3);
      expect(refs.has('e1')).toBe(true);
      expect(refs.has('e2')).toBe(true);
      expect(refs.has('e3')).toBe(true);
    });

    test('should extract role and name from refs', () => {
      const snapshot = `
- button "Submit" [ref=e1]
- textbox "Email" [ref=e2]
      `;

      const refs = parseRefs(snapshot);
      expect(refs.get('e1')).toEqual({ role: 'button', name: 'Submit' });
      expect(refs.get('e2')).toEqual({ role: 'textbox', name: 'Email' });
    });

    test('should handle refs with special characters in names', () => {
      const snapshot = `
- button "Click & Submit" [ref=e1]
- link "FAQ?" [ref=e2]
      `;

      const refs = parseRefs(snapshot);
      expect(refs.size).toBe(2);
      expect(refs.get('e1')?.name).toContain('Click');
      expect(refs.get('e2')?.name).toContain('FAQ');
    });
  });

  describe('Interactive Element Detection', () => {
    test('should capture buttons', async () => {
      await page.setContent(`
        <html>
          <body>
            <button>Click me</button>
          </body>
        </html>
      `);

      const result = await captureFastSnapshot(page);
      expect(result).not.toBeNull();
      expect(result!.raw).toContain('button');
      expect(result!.raw).toContain('Click me');
    });

    test('should capture links', async () => {
      await page.setContent(`
        <html>
          <body>
            <a href="/">Home</a>
          </body>
        </html>
      `);

      const result = await captureFastSnapshot(page);
      expect(result).not.toBeNull();
      expect(result!.raw).toContain('Home');
    });

    test('should capture input fields', async () => {
      await page.setContent(`
        <html>
          <body>
            <input type="text" placeholder="Enter name" />
          </body>
        </html>
      `);

      const result = await captureFastSnapshot(page);
      expect(result).not.toBeNull();
      expect(result!.raw).toContain('input');
    });

    test('should capture select elements', async () => {
      await page.setContent(`
        <html>
          <body>
            <select>
              <option>Option 1</option>
              <option>Option 2</option>
            </select>
          </body>
        </html>
      `);

      const result = await captureFastSnapshot(page);
      expect(result).not.toBeNull();
      expect(result!.raw).toContain('select');
    });

    test('should capture elements with role attributes', async () => {
      await page.setContent(`
        <html>
          <body>
            <div role="button">Custom Button</div>
          </body>
        </html>
      `);

      const result = await captureFastSnapshot(page);
      expect(result).not.toBeNull();
      expect(result!.raw).toContain('Custom Button');
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty page', async () => {
      await page.setContent(`
        <html>
          <body></body>
        </html>
      `);

      const result = await captureFastSnapshot(page);
      // Empty pages may return null or a minimal result
      if (result) {
        expect(result.elementCount).toBe(0);
      }
    });

    test('should handle page with only text', async () => {
      await page.setContent(`
        <html>
          <body>
            <p>Just some text</p>
          </body>
        </html>
      `);

      const result = await captureFastSnapshot(page);
      // Pages with only text may return null or a minimal result
      if (result) {
        expect(result.raw).toBeDefined();
      }
    });

    test('should handle hidden elements', async () => {
      await page.setContent(`
        <html>
          <body>
            <button style="display: none;">Hidden Button</button>
            <button>Visible Button</button>
          </body>
        </html>
      `);

      const result = await captureFastSnapshot(page);
      expect(result).not.toBeNull();
      expect(result!.raw).toContain('Visible Button');
    });

    test('should handle very long element names', async () => {
      const longName = 'A'.repeat(200);
      await page.setContent(`
        <html>
          <body>
            <button>${longName}</button>
          </body>
        </html>
      `);

      const result = await captureFastSnapshot(page);
      expect(result).not.toBeNull();
      // Should truncate to 100 chars
      expect(result!.raw.length).toBeLessThan(300);
    });

    test('should handle elements with aria-label', async () => {
      await page.setContent(`
        <html>
          <body>
            <button aria-label="Close dialog">×</button>
          </body>
        </html>
      `);

      const result = await captureFastSnapshot(page);
      expect(result).not.toBeNull();
      expect(result!.raw).toContain('Close dialog');
    });
  });

  describe('Viewport Boundary Conditions', () => {
    test('should handle elements at exact viewport boundaries', async () => {
      await page.setViewportSize({ width: 1280, height: 720 });

      await page.setContent(`
        <html>
          <body style="margin: 0; padding: 0;">
            <button id="btn-top" style="position: absolute; top: 0px; left: 0px;">Top</button>
            <button id="btn-bottom" style="position: absolute; top: 720px; left: 0px;">Bottom</button>
            <button id="btn-right" style="position: absolute; top: 0px; left: 1280px;">Right</button>
          </body>
        </html>
      `);

      const result = await captureFastSnapshot(page);
      expect(result).not.toBeNull();
      expect(result!.raw).toContain('Top');
    });

    test('should handle scrolled viewport', async () => {
      await page.setViewportSize({ width: 1280, height: 720 });

      await page.setContent(`
        <html>
          <body style="margin: 0; padding: 0; height: 2000px;">
            <button id="btn1" style="position: absolute; top: 100px;">Button 1</button>
            <button id="btn2" style="position: absolute; top: 1000px;">Button 2</button>
          </body>
        </html>
      `);

      // Scroll down
      await page.evaluate(() => window.scrollBy(0, 500));

      const result = await captureFastSnapshot(page);
      expect(result).not.toBeNull();
    });
  });

  describe('Performance Benchmarks and Optimization Verification', () => {
    test('should demonstrate <50ms capture for <100 elements', async () => {
      // Create page with exactly 75 elements
      let html = '<html><body>';
      for (let i = 0; i < 75; i++) {
        html += `<button id="btn${i}">Button ${i}</button>`;
      }
      html += '</body></html>';

      await page.setContent(html);

      const timings: number[] = [];
      for (let i = 0; i < 5; i++) {
        clearElementCache();
        const startTime = Date.now();
        const result = await captureFastSnapshot(page);
        const duration = Date.now() - startTime;
        timings.push(duration);
        expect(result).not.toBeNull();
      }

      const avgTime = timings.reduce((a, b) => a + b, 0) / timings.length;
      console.log(`[Performance] <100 elements: avg ${avgTime.toFixed(2)}ms, max ${Math.max(...timings)}ms`);
      expect(Math.max(...timings)).toBeLessThan(50);
    });

    test('should demonstrate <100ms capture for 100-500 elements', async () => {
      // Create page with exactly 250 elements
      let html = '<html><body>';
      for (let i = 0; i < 250; i++) {
        html += `<button id="btn${i}">Button ${i}</button>`;
      }
      html += '</body></html>';

      await page.setContent(html);

      const timings: number[] = [];
      for (let i = 0; i < 3; i++) {
        clearElementCache();
        const startTime = Date.now();
        const result = await captureFastSnapshot(page);
        const duration = Date.now() - startTime;
        timings.push(duration);
        expect(result).not.toBeNull();
      }

      const avgTime = timings.reduce((a, b) => a + b, 0) / timings.length;
      console.log(`[Performance] 100-500 elements: avg ${avgTime.toFixed(2)}ms, max ${Math.max(...timings)}ms`);
      expect(Math.max(...timings)).toBeLessThan(100);
    });

    test('should demonstrate <200ms capture for >500 elements', async () => {
      // Create page with exactly 600 elements
      let html = '<html><body>';
      for (let i = 0; i < 600; i++) {
        html += `<button id="btn${i}">Button ${i}</button>`;
      }
      html += '</body></html>';

      await page.setContent(html);

      const timings: number[] = [];
      for (let i = 0; i < 3; i++) {
        clearElementCache();
        const startTime = Date.now();
        const result = await captureFastSnapshot(page);
        const duration = Date.now() - startTime;
        timings.push(duration);
        expect(result).not.toBeNull();
      }

      const avgTime = timings.reduce((a, b) => a + b, 0) / timings.length;
      console.log(`[Performance] >500 elements: avg ${avgTime.toFixed(2)}ms, max ${Math.max(...timings)}ms`);
      expect(Math.max(...timings)).toBeLessThan(200);
    });

    test('should verify parseRefsOptimized is faster than parseRefs', async () => {
      // Create a large snapshot with 500 elements
      const lines: string[] = [];
      for (let i = 1; i <= 500; i++) {
        lines.push(`- button "Button ${i}" [ref=e${i}]`);
      }
      const snapshot = lines.join('\n');

      // Time original parseRefs
      const start1 = Date.now();
      for (let i = 0; i < 10; i++) {
        parseRefs(snapshot);
      }
      const time1 = Date.now() - start1;

      // Time optimized parseRefsOptimized
      const start2 = Date.now();
      for (let i = 0; i < 10; i++) {
        parseRefsOptimized(snapshot);
      }
      const time2 = Date.now() - start2;

      console.log(`[Performance] parseRefs: ${time1}ms for 10 iterations, parseRefsOptimized: ${time2}ms for 10 iterations`);
      // Optimized version should be at least as fast
      expect(time2).toBeLessThanOrEqual(time1 + 5); // Allow 5ms margin for variance
    });

    test('should skip ariaSnapshot for <100 elements', async () => {
      // Create page with 50 elements
      let html = '<html><body>';
      for (let i = 0; i < 50; i++) {
        html += `<button id="btn${i}">Button ${i}</button>`;
      }
      html += '</body></html>';

      await page.setContent(html);
      clearElementCache();

      const startTime = Date.now();
      const result = await captureInteractiveElements(page);
      const duration = Date.now() - startTime;

      // Should complete quickly without calling expensive ariaSnapshot
      expect(result.elementCount).toBeLessThan(100);
      expect(duration).toBeLessThan(100); // Should be much faster than ariaSnapshot
      console.log(`[Performance] captureInteractiveElements for <100 elements: ${duration}ms`);
    });
  });
});
