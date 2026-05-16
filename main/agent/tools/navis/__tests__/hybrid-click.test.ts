/**
 * Unit tests for Vision-Grounding Hybrid Click Module
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VisionGroundingHybrid } from '../hybrid-click';
import { FullScreenCaptureModule } from '../full-screen-capture';
import { DOMQueryModule } from '../dom-query';
import { VisionPredictor } from '../vision-predictor';

describe('VisionGroundingHybrid', () => {
  let mockPage: any;
  let mockAIClient: any;

  beforeEach(() => {
    mockPage = {
      evaluate: vi.fn(),
      click: vi.fn(),
      mouse: {
        click: vi.fn(),
      },
    };

    mockAIClient = {
      chat: vi.fn(),
    };
  });

  it('should use DOM click when element is found', async () => {
    const hybrid = new VisionGroundingHybrid(mockAIClient);

    // Mock vision prediction
    mockAIClient.chat.mockResolvedValue({
      content: JSON.stringify({
        coordinates: { x: 100, y: 200 },
        confidence: 0.95,
      }),
    });

    // Mock DOM query finding element
    mockPage.evaluate.mockResolvedValue({
      tagName: 'BUTTON',
      id: 'submit-btn',
      isClickable: true,
      isVisible: true,
      boundingRect: { x: 95, y: 195, width: 100, height: 40, top: 195, right: 195, bottom: 235, left: 95 },
    });

    mockPage.click.mockResolvedValue(undefined);

    const screenshot = Buffer.from('fake-screenshot');
    const result = await hybrid.hybridClick(mockPage, screenshot, 'Submit button');

    expect(result.success).toBe(true);
    expect(result.method).toBe('dom');
    expect(mockPage.click).toHaveBeenCalled();
  });

  it('should fall back to pixel click when element not found', async () => {
    const hybrid = new VisionGroundingHybrid(mockAIClient);

    // Mock vision prediction
    mockAIClient.chat.mockResolvedValue({
      content: JSON.stringify({
        coordinates: { x: 100, y: 200 },
        confidence: 0.95,
      }),
    });

    // Mock DOM query not finding element
    mockPage.evaluate.mockResolvedValue(null);

    mockPage.mouse.click.mockResolvedValue(undefined);

    const screenshot = Buffer.from('fake-screenshot');
    const result = await hybrid.hybridClick(mockPage, screenshot, 'Submit button');

    expect(result.success).toBe(true);
    expect(result.method).toBe('pixel');
    expect(mockPage.mouse.click).toHaveBeenCalledWith(100, 200);
  });

  it('should search nearby pixels when element not at exact coordinates', async () => {
    const hybrid = new VisionGroundingHybrid(mockAIClient);

    // Mock vision prediction
    mockAIClient.chat.mockResolvedValue({
      content: JSON.stringify({
        coordinates: { x: 100, y: 200 },
        confidence: 0.95,
      }),
    });

    // Mock DOM query: first call returns null, second call (nearby) returns element
    mockPage.evaluate
      .mockResolvedValueOnce(null) // First query at exact coords
      .mockResolvedValueOnce({
        // Second query at nearby coords
        tagName: 'BUTTON',
        id: 'submit-btn',
        isClickable: true,
        isVisible: true,
        boundingRect: { x: 95, y: 195, width: 100, height: 40, top: 195, right: 195, bottom: 235, left: 95 },
      });

    mockPage.click.mockResolvedValue(undefined);

    const screenshot = Buffer.from('fake-screenshot');
    const result = await hybrid.hybridClick(mockPage, screenshot, 'Submit button');

    expect(result.success).toBe(true);
    expect(result.method).toBe('dom');
  });

  it('should handle low confidence predictions', async () => {
    const hybrid = new VisionGroundingHybrid(mockAIClient, { confidenceThreshold: 0.8 });

    // Mock vision prediction with low confidence
    mockAIClient.chat.mockResolvedValue({
      content: JSON.stringify({
        coordinates: { x: 100, y: 200 },
        confidence: 0.5,
      }),
    });

    mockPage.mouse.click.mockResolvedValue(undefined);

    const screenshot = Buffer.from('fake-screenshot');
    const result = await hybrid.hybridClick(mockPage, screenshot, 'Submit button');

    expect(result.success).toBe(true);
    expect(result.method).toBe('pixel'); // Should fall back to pixel click
  });
});

describe('FullScreenCaptureModule', () => {
  let mockPage: any;

  beforeEach(() => {
    mockPage = {
      evaluate: vi.fn(),
      screenshot: vi.fn(),
      setViewportSize: vi.fn(),
    };
  });

  it('should capture at full screen resolution', async () => {
    const captureModule = new FullScreenCaptureModule();

    mockPage.evaluate
      .mockResolvedValueOnce({ width: 1920, height: 1080 }) // Screen dimensions
      .mockResolvedValueOnce({ width: 1280, height: 720 }); // Window size

    mockPage.screenshot.mockResolvedValue(Buffer.from('screenshot-data'));
    mockPage.setViewportSize.mockResolvedValue(undefined);

    const result = await captureModule.captureFullScreen(mockPage);

    expect(result.resolution).toEqual({ width: 1920, height: 1080 });
    expect(result.windowSize).toEqual({ width: 1280, height: 720 });
    expect(mockPage.setViewportSize).toHaveBeenCalledWith({ width: 1920, height: 1080 });
  });

  it('should restore original window size', async () => {
    const captureModule = new FullScreenCaptureModule();

    mockPage.evaluate
      .mockResolvedValueOnce({ width: 1920, height: 1080 }) // Screen dimensions
      .mockResolvedValueOnce({ width: 1280, height: 720 }); // Window size

    mockPage.screenshot.mockResolvedValue(Buffer.from('screenshot-data'));
    mockPage.setViewportSize.mockResolvedValue(undefined);

    await captureModule.captureFullScreen(mockPage);

    // Should restore original size
    expect(mockPage.setViewportSize).toHaveBeenCalledWith({ width: 1280, height: 720 });
  });

  it('should cache screen dimensions', async () => {
    const captureModule = new FullScreenCaptureModule();

    mockPage.evaluate
      .mockResolvedValueOnce({ width: 1920, height: 1080 }) // Screen dimensions (first call)
      .mockResolvedValueOnce({ width: 1280, height: 720 }) // Window size (first call)
      .mockResolvedValueOnce({ width: 1280, height: 720 }); // Window size (second call, screen cached)

    mockPage.screenshot.mockResolvedValue(Buffer.from('screenshot-data'));
    mockPage.setViewportSize.mockResolvedValue(undefined);

    // First capture
    await captureModule.captureFullScreen(mockPage);

    // Second capture (should use cached screen dimensions)
    await captureModule.captureFullScreen(mockPage);

    // Screen dimensions should only be queried once (cached on second call)
    expect(mockPage.evaluate).toHaveBeenCalledTimes(3); // 1 screen + 2 window queries
  });
});

describe('DOMQueryModule', () => {
  let mockPage: any;

  beforeEach(() => {
    mockPage = {
      evaluate: vi.fn(),
    };
  });

  it('should query element at coordinates', async () => {
    const domQuery = new DOMQueryModule();

    mockPage.evaluate.mockResolvedValue({
      tagName: 'BUTTON',
      id: 'submit-btn',
      isClickable: true,
      isVisible: true,
      boundingRect: { x: 100, y: 200, width: 100, height: 40, top: 200, right: 200, bottom: 240, left: 100 },
    });

    const element = await domQuery.queryElement(mockPage, { x: 150, y: 220 });

    expect(element).not.toBeNull();
    expect(element?.tagName).toBe('BUTTON');
    expect(element?.isClickable).toBe(true);
  });

  it('should return null when no element found', async () => {
    const domQuery = new DOMQueryModule();

    mockPage.evaluate.mockResolvedValue(null);

    const element = await domQuery.queryElement(mockPage, { x: 150, y: 220 });

    expect(element).toBeNull();
  });

  it('should build selector from element', () => {
    const domQuery = new DOMQueryModule();

    // Test ID selector
    const elementWithId = {
      tagName: 'BUTTON',
      id: 'submit-btn',
      isClickable: true,
      isVisible: true,
      boundingRect: {} as any,
    };
    expect(domQuery.buildSelector(elementWithId)).toBe('#submit-btn');

    // Test class selector
    const elementWithClass = {
      tagName: 'BUTTON',
      className: 'btn btn-primary',
      isClickable: true,
      isVisible: true,
      boundingRect: {} as any,
    };
    expect(domQuery.buildSelector(elementWithClass)).toBe('button.btn.btn-primary');

    // Test tag selector (fallback)
    const elementWithoutIdOrClass = {
      tagName: 'BUTTON',
      isClickable: true,
      isVisible: true,
      boundingRect: {} as any,
    };
    expect(domQuery.buildSelector(elementWithoutIdOrClass)).toBe('button');
  });
});
