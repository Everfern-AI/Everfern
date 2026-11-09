import { describe, expect, it } from 'vitest';
import { isVisionGroundingError } from '../UIHelpers';

describe('isVisionGroundingError', () => {
    it('recognizes a missing local Ollama vision model', () => {
        expect(isVisionGroundingError("Error during execution: [ollama] HTTP 404: model 'qwen3-vl:2b' not found")).toBe(true);
    });

    it('does not present normal EverFern Cloud failures as local vision failures', () => {
        expect(isVisionGroundingError('Error during execution: EverFern Cloud HTTP 503')).toBe(false);
        expect(isVisionGroundingError('Error during execution: [ollama] model llama3 not found')).toBe(false);
    });
});
