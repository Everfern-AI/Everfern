import { describe, it, expect, vi } from 'vitest';
import { previewLiveUrlTool } from '../preview-live-url';

describe('previewLiveUrlTool', () => {
  it('should successfully execute with a valid URL and return it in data', async () => {
    const emitEvent = vi.fn();
    const result = await previewLiveUrlTool.execute({ url: 'http://localhost:3000' }, undefined, emitEvent);
    
    expect(result.success).toBe(true);
    expect(result.output).toContain('http://localhost:3000');
    expect(result.data).toEqual({ url: 'http://localhost:3000' });
    expect(emitEvent).toHaveBeenCalledWith({
      type: 'preview_live_url',
      url: 'http://localhost:3000',
    });
  });

  it('should return error when URL is missing', async () => {
    const result = await previewLiveUrlTool.execute({});
    
    expect(result.success).toBe(false);
    expect(result.error).toBe('missing_url');
  });
});
