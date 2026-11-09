// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { latestAssistantPreview } from '../worker-presentation';

describe('collapsed conversation preview', () => {
  it('does not show a prompt or a placeholder when the AI has not replied', () => {
    expect(latestAssistantPreview([])).toBeNull();
    expect(latestAssistantPreview([{ kind: 'user', text: 'My task' }, { kind: 'thinking', text: 'Planning' }, { kind: 'ai', text: '   ' }])).toBeNull();
  });
  it('uses the latest AI reply even when a user prompt follows it', () => {
    expect(latestAssistantPreview([{ kind: 'ai', text: 'Earlier' }, { kind: 'ai', text: '# Plan\n\nUse **Chrome** and [the files](https://example.com).\n- Read `report.pdf`' }, { kind: 'user', text: 'Continue' }])).toBe('Plan Use Chrome and the files. Read report.pdf');
  });
});
