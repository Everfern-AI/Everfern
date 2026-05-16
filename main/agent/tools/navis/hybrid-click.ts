/**
 * Navis — Vision-Grounding Hybrid Click Module
 *
 * Combines vision model predictions with DOM-based clicking for precision.
 *
 * Workflow:
 * 1. Vision model identifies element coordinates
 * 2. DOM query finds actual element at coordinates
 * 3. Precise click using DOM methods
 * 4. Fallback to pixel-based clicking if needed
 */

import { Page } from 'playwright';
import { VisionPredictor, VisionPrediction } from './vision-predictor';
import { DOMQueryModule, DOMElement } from './dom-query';
import { AIClient } from '../../../lib/ai-client';

export interface HybridClickResult {
  success: boolean;
  method: 'dom' | 'pixel' | 'failed';
  element?: DOMElement;
  coordinates: { x: number; y: number };
  error?: string;
}

export class VisionGroundingHybrid {
  private visionPredictor: VisionPredictor;
  private domQuery: DOMQueryModule;
  private confidenceThreshold: number;
  private nearbySearchRadius: number;

  constructor(
    aiClient: AIClient,
    options?: {
      confidenceThreshold?: number;
      nearbySearchRadius?: number;
    }
  ) {
    this.visionPredictor = new VisionPredictor(aiClient);
    this.domQuery = new DOMQueryModule();
    this.confidenceThreshold = options?.confidenceThreshold || 0.7;
    this.nearbySearchRadius = options?.nearbySearchRadius || 5;
  }

  /**
   * Use vision model to identify element, then DOM to click it
   */
  async hybridClick(
    page: Page,
    screenshot: Buffer,
    targetDescription: string
  ): Promise<HybridClickResult> {
    try {
      // Step 1: Vision model predicts coordinates
      const prediction = await this.visionPredictor.predict(screenshot, targetDescription);

      console.log(`[HybridClick] Vision prediction: (${prediction.coordinates.x}, ${prediction.coordinates.y}), confidence: ${prediction.confidence}`);

      if (prediction.confidence < this.confidenceThreshold) {
        console.warn(`[HybridClick] Low confidence (${prediction.confidence}), falling back to pixel click`);
        return await this.pixelClick(page, prediction.coordinates);
      }

      // Step 2: Query DOM for element at coordinates
      const element = await this.domQuery.queryElement(page, prediction.coordinates);

      if (!element) {
        console.warn('[HybridClick] No DOM element found, trying nearby pixels');
        const nearbyElement = await this.domQuery.searchNearbyPixels(
          page,
          prediction.coordinates,
          this.nearbySearchRadius
        );

        if (!nearbyElement) {
          console.warn('[HybridClick] No nearby element found, falling back to pixel click');
          return await this.pixelClick(page, prediction.coordinates);
        }

        return await this.domClick(page, nearbyElement);
      }

      // Step 3: Validate element is clickable
      if (!element.isClickable) {
        console.warn('[HybridClick] Element not clickable, falling back to pixel click');
        return await this.pixelClick(page, prediction.coordinates);
      }

      if (!element.isVisible) {
        console.warn('[HybridClick] Element not visible, falling back to pixel click');
        return await this.pixelClick(page, prediction.coordinates);
      }

      // Step 4: Execute DOM-based click
      return await this.domClick(page, element);
    } catch (error) {
      console.error('[HybridClick] Hybrid click failed:', error);
      return {
        success: false,
        method: 'failed',
        coordinates: { x: 0, y: 0 },
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Execute DOM-based click
   */
  private async domClick(page: Page, element: DOMElement): Promise<HybridClickResult> {
    try {
      // Build selector for the element
      const selector = this.domQuery.buildSelector(element);

      // Click using DOM selector
      await page.click(selector, {
        force: false, // Don't force click if element is not clickable
        timeout: 5000,
      });

      console.log(`[HybridClick] Successfully clicked element: ${selector}`);

      return {
        success: true,
        method: 'dom',
        element,
        coordinates: {
          x: element.boundingRect.x + element.boundingRect.width / 2,
          y: element.boundingRect.y + element.boundingRect.height / 2,
        },
      };
    } catch (error) {
      console.error('[HybridClick] DOM click failed:', error);

      // Fallback to pixel click
      return await this.pixelClick(page, {
        x: element.boundingRect.x + element.boundingRect.width / 2,
        y: element.boundingRect.y + element.boundingRect.height / 2,
      });
    }
  }

  /**
   * Execute pixel-based click (fallback)
   */
  private async pixelClick(
    page: Page,
    coords: { x: number; y: number }
  ): Promise<HybridClickResult> {
    try {
      await page.mouse.click(coords.x, coords.y);

      console.log(`[HybridClick] Pixel click at (${coords.x}, ${coords.y})`);

      return {
        success: true,
        method: 'pixel',
        coordinates: coords,
      };
    } catch (error) {
      console.error('[HybridClick] Pixel click failed:', error);

      return {
        success: false,
        method: 'failed',
        coordinates: coords,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
