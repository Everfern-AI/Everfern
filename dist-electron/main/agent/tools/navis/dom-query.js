"use strict";
/**
 * Navis — DOM Query Module
 *
 * Queries DOM elements at specific pixel coordinates.
 * Validates element clickability and visibility.
 * Implements nearby pixel search for improved accuracy.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DOMQueryModule = void 0;
class DOMQueryModule {
    /**
     * Query DOM element at given coordinates
     */
    async queryElement(page, coords) {
        return await page.evaluate((coords) => {
            const element = document.elementFromPoint(coords.x, coords.y);
            if (!element)
                return null;
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            // Check if element is clickable
            const isClickable = element.tagName === 'BUTTON' ||
                element.tagName === 'A' ||
                element.tagName === 'INPUT' ||
                element.tagName === 'SELECT' ||
                element.tagName === 'TEXTAREA' ||
                element.getAttribute('role') === 'button' ||
                element.getAttribute('role') === 'link' ||
                element.getAttribute('role') === 'textbox' ||
                element.getAttribute('role') === 'combobox' ||
                element.onclick !== null ||
                style.cursor === 'pointer';
            // Check if element is visible
            const isVisible = style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                style.opacity !== '0' &&
                rect.width > 0 &&
                rect.height > 0;
            return {
                tagName: element.tagName,
                id: element.id || undefined,
                className: element.className || undefined,
                textContent: element.textContent?.trim().slice(0, 100) || undefined,
                isClickable,
                isVisible,
                boundingRect: {
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                    top: rect.top,
                    right: rect.right,
                    bottom: rect.bottom,
                    left: rect.left,
                },
            };
        }, coords);
    }
    /**
     * Search nearby pixels in spiral pattern
     */
    async searchNearbyPixels(page, center, radius = 5) {
        // Generate spiral offsets
        const offsets = this.generateSpiralOffsets(radius);
        for (const offset of offsets) {
            const coords = {
                x: center.x + offset.x,
                y: center.y + offset.y,
            };
            const element = await this.queryElement(page, coords);
            if (element && element.isClickable && element.isVisible) {
                console.log(`[HybridClick] Found clickable element at offset (${offset.x}, ${offset.y})`);
                return element;
            }
        }
        return null;
    }
    /**
     * Generate spiral offsets for nearby pixel search
     */
    generateSpiralOffsets(radius) {
        const offsets = [{ x: 0, y: 0 }];
        for (let r = 1; r <= radius; r++) {
            // Add offsets in a spiral pattern
            // Horizontal and vertical first
            offsets.push({ x: r, y: 0 }, { x: -r, y: 0 }, { x: 0, y: r }, { x: 0, y: -r });
            // Diagonal offsets
            offsets.push({ x: r, y: r }, { x: -r, y: r }, { x: r, y: -r }, { x: -r, y: -r });
        }
        return offsets;
    }
    /**
     * Build CSS selector for element
     */
    buildSelector(element) {
        // Prefer ID selector
        if (element.id) {
            return `#${element.id}`;
        }
        // Use class selector
        if (element.className) {
            const classes = element.className.split(' ').filter(c => c.length > 0);
            if (classes.length > 0) {
                return `${element.tagName.toLowerCase()}.${classes.join('.')}`;
            }
        }
        // Fallback to tag name
        return element.tagName.toLowerCase();
    }
}
exports.DOMQueryModule = DOMQueryModule;
