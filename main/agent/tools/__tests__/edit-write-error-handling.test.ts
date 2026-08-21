import { describe, it, expect, vi, beforeEach } from 'vitest';
import { performSmartReplace } from '../pi-tools';

describe('Edit and Write Tool Error Handling', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('performSmartReplace returns success: false with clear message when oldString is empty', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const content = 'import sys\nprint("hello")';
    const result = performSmartReplace(content, '', 'print("world")');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Empty oldString provided');
    expect(result.error).toContain('write');
    expect(errorSpy).toHaveBeenCalled();
  });

  it('performSmartReplace returns success: true when exact string matches', () => {
    const content = 'import sys\nprint("hello")';
    const result = performSmartReplace(content, 'print("hello")', 'print("world")');

    expect(result.success).toBe(true);
    expect(result.updatedContent).toBe('import sys\nprint("world")');
  });

  it('performSmartReplace handles normalized line endings across CRLF and LF', () => {
    const content = 'def test():\r\n    return 1\r\n';
    const result = performSmartReplace(content, 'def test():\n    return 1', 'def test():\n    return 2');

    expect(result.success).toBe(true);
    expect(result.updatedContent).toContain('return 2');
  });

  it('performSmartReplace returns success: false when text is not found', () => {
    const content = 'def foo(): pass';
    const result = performSmartReplace(content, 'def bar(): pass', 'def baz(): pass');

    expect(result.success).toBe(false);
  });
});
