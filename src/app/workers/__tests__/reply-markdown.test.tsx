import { render } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ReplyMarkdown, parseCards } from '../ReplyMarkdown';

const fence = '```';

it('renders Markdown: title, numbered list, table, link and inline code', () => {
  const { container } = render(<ReplyMarkdown text={[
    '# Invoices imported', '', '1. First', '2. Second', '',
    '| Name | Total |', '| --- | --- |', '| Acme | 120 |', '',
    'See [the sheet](https://example.com) and `Q3`.',
  ].join('\n')} />);
  expect(container.querySelector('h1.wk-r-title')?.textContent).toBe('Invoices imported');
  expect(container.querySelectorAll('ol > li')).toHaveLength(2);
  expect(container.querySelector('.wk-r-table td')?.textContent).toBe('Acme');
  expect(container.querySelector('a')?.getAttribute('target')).toBe('_blank');
  expect(container.querySelector('code')?.textContent).toBe('Q3');
});

it('turns card and cards fences into glass cards with tones', () => {
  const { container } = render(<ReplyMarkdown text={[
    `${fence}card`, '### Result', 'Imported **14** invoices.', fence, '',
    `${fence}cards`, 'tone: green', '### Paid', '**12** invoices', '---', 'tone: red', '### Overdue', '**2** invoices', fence,
  ].join('\n')} />);
  const cards = container.querySelectorAll('.wk-r-card');
  expect(cards).toHaveLength(3);
  expect(cards[0].querySelector('h3')?.textContent).toBe('Result');
  expect(container.querySelectorAll('.wk-r-cards > .wk-r-card')).toHaveLength(2);
  expect(container.querySelector('.wk-r-card.is-green h3')?.textContent).toBe('Paid');
  expect(container.querySelector('.wk-r-card.is-red strong')?.textContent).toBe('2');
  expect(container.querySelector('pre')).toBeNull();
});

it('keeps the older "> **Result**" callout as a card, and plain code as code', () => {
  const { container } = render(<ReplyMarkdown text={['> **Result**', '> Done with **3** rows.', '', `${fence}js`, 'x()', fence].join('\n')} />);
  expect(container.querySelector('.wk-r-card.is-callout strong')?.textContent).toBe('Result');
  expect(container.querySelector('pre.wk-r-code')?.textContent).toContain('x()');
});

it('ignores unknown tones and empty cards', () => {
  expect(parseCards('tone: purple\n### A\n---\n\n', true)).toEqual([{ tone: undefined, body: '### A' }]);
});
