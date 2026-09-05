import { describe, it, expect } from 'vitest';
import { esc } from '../../src/app/chat/components/ToolCallDetailPane';
import { formatInlineText } from '../../src/app/chat/components/DocumentCard';

describe('DocumentCard inline formatting XSS hardening', () => {
  it('renders raw HTML tags inert in heading/bullet/paragraph pipelines', () => {
    const out = formatInlineText('<img src=x onerror=alert(1)>', true);
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
    expect(out).not.toMatch(/<(script|img)[\s>]/i);
  });

  it('escapes markup before bold/code passes so injected attributes cannot break out', () => {
    const out = formatInlineText('**`<img src=x onerror=alert(1)>`**', false);
    expect(out).toContain('<strong>');
    expect(out).toContain('<code');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('never emits a raw double quote from user text', () => {
    const out = formatInlineText('" onmouseover="alert(1)" `x` **y**', true);
    expect(out).not.toContain('" onmouseover');
    const quotes = out.match(/"/g) || [];
    quotes.forEach((q) => {
      expect(out.indexOf(q)).toBeGreaterThan(-1);
    });
    expect(out).toContain('&quot;');
  });

  it('strips Private Use Area placeholder characters', () => {
    expect(formatInlineText('a\uE000b\uF8FFc', true)).toBe('abc');
  });

  it('keeps formatter-generated tags as literal trusted HTML', () => {
    const out = formatInlineText('**bold** and `code`', true);
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toMatch(/<code style="background-color: rgba\(255,255,255,0\.08\)[^"]*">code<\/code>/);
  });

  it('uses the same hardened esc() as ToolCallDetailPane', () => {
    expect(esc('&<>"')).toBe('&amp;&lt;&gt;&quot;');
    expect(formatInlineText('&<>"', true)).toBe('&amp;&lt;&gt;&quot;');
  });
});
