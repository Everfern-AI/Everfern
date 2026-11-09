import { describe, expect, it } from 'vitest';
import { usesVm } from '../../app/workers/Desktop';

describe('worker browser location', () => {
  it.each(['browser', 'websearch', 'chrome', 'mail', 'docs', 'sheets', 'notion'])('%s runs inside Alpine when local is selected', (app) => {
    expect(usesVm(app, 'local')).toBe(true);
  });
  it('leaves non-browser tools on their existing routes', () => {
    expect(usesVm('files', 'local')).toBe(false);
    expect(usesVm('terminal', 'local')).toBe(false);
    expect(usesVm('mail', undefined)).toBe(false);
  });
});
