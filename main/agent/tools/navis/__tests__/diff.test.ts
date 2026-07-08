import { describe, test, expect } from 'vitest';
import { diffSnapshots } from '../diff';

describe('diffSnapshots', () => {
  test('returns changed: false for identical strings', () => {
    const content = `- button "Submit" [ref=e1]\n- textbox "Email" [ref=e2]`;
    const result = diffSnapshots(content, content);
    expect(result.changed).toBe(false);
    expect(result.text).toBe('');
    expect(result.added).toBe(0);
    expect(result.removed).toBe(0);
  });

  test('correctly identifies additions and removals', () => {
    const before = `- button "Submit" [ref=e1]\n- textbox "Email" [ref=e2]`;
    const after = `- button "Submit" [ref=e1]\n- textbox "Password" [ref=e3]`;
    const result = diffSnapshots(before, after);
    expect(result.changed).toBe(true);
    expect(result.removed).toBe(1);
    expect(result.added).toBe(1);
    expect(result.text).toContain('- textbox "Email" [ref=e2]');
    expect(result.text).toContain('+ textbox "Password" [ref=e3]');
  });

  test('collapses unchanged context lines according to radius', () => {
    const before = [
      '- heading "Header" [ref=e1]',
      '- link "Home" [ref=e2]',
      '- link "About" [ref=e3]',
      '- link "Contact" [ref=e4]',
      '- button "Submit" [ref=e5]',
      '- footer "Footer" [ref=e6]',
    ].join('\n');

    const after = [
      '- heading "Header" [ref=e1]',
      '- link "Home" [ref=e2]',
      '- link "About" [ref=e3]',
      '- link "Privacy Policy" [ref=e7]',
      '- link "Contact" [ref=e4]',
      '- button "Submit" [ref=e5]',
      '- footer "Footer" [ref=e6]',
    ].join('\n');

    const result = diffSnapshots(before, after, { contextRadius: 1 });
    expect(result.changed).toBe(true);
    expect(result.added).toBe(1);
    expect(result.removed).toBe(0);
    
    // With radius 1:
    // Unchanged lines kept: 'link "About"', 'link "Contact"' (1 line context above and below addition)
    // Elided: 'heading "Header"', 'link "Home"', 'button "Submit"', 'footer "Footer"' should be compressed with '…'
    expect(result.text).toContain('…');
    expect(result.text).toContain('  link "About" [ref=e3]');
    expect(result.text).toContain('+ link "Privacy Policy" [ref=e7]');
    expect(result.text).toContain('  link "Contact" [ref=e4]');
  });

  test('preserves indentation while stripping bullet hyphens', () => {
    const before = `  - div [ref=e1]\n    - button "Click" [ref=e2]`;
    const after = `  - div [ref=e1]`;
    const result = diffSnapshots(before, after);
    expect(result.changed).toBe(true);
    expect(result.removed).toBe(1);
    expect(result.added).toBe(0);
    expect(result.text).toContain('-     button "Click" [ref=e2]');
  });
});
