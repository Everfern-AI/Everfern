"use strict";
/**
 * Navis — Vision Prediction Interface
 *
 * Uses vision models to identify element coordinates from screenshots.
 * Returns pixel coordinates, confidence scores, and optional bounding boxes.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.VisionPredictor = void 0;
class VisionPredictor {
    aiClient;
    constructor(aiClient) {
        this.aiClient = aiClient;
    }
    /**
     * Predict element coordinates from screenshot
     */
    async predict(screenshot, targetDescription) {
        try {
            const response = await this.callVisionModel(screenshot, targetDescription);
            return {
                element: targetDescription,
                coordinates: response.coordinates,
                confidence: response.confidence,
                boundingBox: response.boundingBox,
            };
        }
        catch (error) {
            console.error('[VisionPredictor] Prediction failed:', error);
            throw error;
        }
    }
    /**
     * Call vision model API
     */
    async callVisionModel(screenshot, targetDescription) {
        // Convert screenshot to base64
        const base64Image = screenshot.toString('base64');
        // Construct prompt for vision model
        const prompt = `
Analyze this screenshot and find the element matching: "${targetDescription}"

Return a JSON object with:
- coordinates: { x: number, y: number } - pixel coordinates of the center of the element
- confidence: number (0-1) - confidence score for the identification
- boundingBox: { x: number, y: number, width: number, height: number } - optional bounding box

Example response:
{
  "coordinates": { "x": 450, "y": 320 },
  "confidence": 0.95,
  "boundingBox": { "x": 400, "y": 300, "width": 100, "height": 40 }
}
`;
        try {
            // Call vision model (e.g., GPT-4V, Claude Vision)
            const response = await this.aiClient.chat({
                messages: [
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: prompt },
                            {
                                type: 'image_url',
                                image_url: { url: `data:image/jpeg;base64,${base64Image}` },
                            },
                        ],
                    },
                ],
                responseFormat: 'json',
                temperature: 0.2,
            });
            // Parse response - handle both string and array content types
            let contentStr;
            if (typeof response.content === 'string') {
                contentStr = response.content;
            }
            else if (Array.isArray(response.content)) {
                const stringContent = response.content.find((c) => typeof c === 'string');
                contentStr = stringContent || JSON.stringify(response.content);
            }
            else {
                contentStr = JSON.stringify(response.content);
            }
            const data = JSON.parse(contentStr);
            return {
                coordinates: data.coordinates,
                confidence: data.confidence || 0.5,
                boundingBox: data.boundingBox,
            };
        }
        catch (error) {
            console.error('[VisionPredictor] Vision model call failed:', error);
            throw new Error(`Vision model failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
exports.VisionPredictor = VisionPredictor;
