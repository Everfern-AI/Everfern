import { describe, it, expect } from 'vitest';
import { esc, formatInline, highlightLine } from '../../src/app/chat/components/ToolCallDetailPane';

describe('esc', () => {
  it('escapes HTML-significant characters so markup is inert', () => {
    const out = esc('<img src=x onerror=alert(1)>');
    expect(out).toContain('&lt;img');
    expect(out).not.toContain('<img');
  });

  it('escapes ampersand, angle brackets, and double quotes', () => {
    expect(esc('&<>"')).toBe('&amp;&lt;&gt;&quot;');
  });

  it('strips Private Use Area characters', () => {
    expect(esc('a\uE000b\uF8FFc')).toBe('abc');
  });
});

describe('formatInline', () => {
  it('renders raw HTML tags inert', () => {
    const out = formatInline('<img src=x onerror=alert(1)>');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('preserves bold formatting', () => {
    const out = formatInline('**bold**');
    expect(out).toContain('<strong');
    expect(out).toContain('</strong>');
    expect(out).toContain('>bold<');
  });

  it('preserves inline code formatting', () => {
    const out = formatInline('`code`');
    expect(out).toContain('<code');
    expect(out).toContain('</code>');
  });

  it('preserves italic formatting alongside plain text', () => {
    const out = formatInline('a *i* b');
    expect(out).toContain('<em');
  });

  it('never emits a raw double quote, keeping injected attributes unbreakable', () => {
    const out = formatInline('value with "quotes"');
    expect(out).not.toContain('"');
  });
});

describe('highlightLine', () => {
  it('renders raw HTML tags inert', () => {
    const out = highlightLine('<img src=x onerror=alert(1)>', 'txt');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('still injects trusted span markup with style attributes', () => {
    const out = highlightLine('const x = "str"', 'ts');
    expect(out).toContain('<span style="color: #');
    expect((out.match(/<span /g) || []).length).toBe((out.match(/<\/span>/g) || []).length);
  });

  it('leaks no internal placeholder characters for common languages', () => {
    const inputs = ['const x = "s"', '# heading', '{"k": 1}', 'echo $HOME'];
    const exts = ['ts', 'md', 'json', 'sh'];
    inputs.forEach((line, i) => {
      const out = highlightLine(line, exts[i]);
      expect(out).not.toMatch(/[\uE000-\uF8FF]/);
    });
  });

  it('keeps injected style attributes well-formed across multi-pass highlighting', () => {
    const html = highlightLine('.foo { color: red; }', 'css');
    expect(html).not.toContain('style="<');
    expect(html).not.toContain('=<span');
    expect((html.match(/<span /g) || []).length).toBe((html.match(/<\/span>/g) || []).length);
  });
});
