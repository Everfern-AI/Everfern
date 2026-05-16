"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.VisionGroundingHybrid = void 0;
const vision_predictor_1 = require("./vision-predictor");
const dom_query_1 = require("./dom-query");
class VisionGroundingHybrid {
    visionPredictor;
    domQuery;
    confidenceThreshold;
    nearbySearchRadius;
    constructor(aiClient, options) {
        this.visionPredictor = new vision_predictor_1.VisionPredictor(aiClient);
        this.domQuery = new dom_query_1.DOMQueryModule();
        this.confidenceThreshold = options?.confidenceThreshold || 0.7;
        this.nearbySearchRadius = options?.nearbySearchRadius || 5;
    }
    /**
     * Use vision model to identify element, then DOM to click it
     */
    async hybridClick(page, screenshot, targetDescription) {
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
                const nearbyElement = await this.domQuery.searchNearbyPixels(page, prediction.coordinates, this.nearbySearchRadius);
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
        }
        catch (error) {
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
    async domClick(page, element) {
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
        }
        catch (error) {
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
    async pixelClick(page, coords) {
        try {
            await page.mouse.click(coords.x, coords.y);
            console.log(`[HybridClick] Pixel click at (${coords.x}, ${coords.y})`);
            return {
                success: true,
                method: 'pixel',
                coordinates: coords,
            };
        }
        catch (error) {
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
exports.VisionGroundingHybrid = VisionGroundingHybrid;
