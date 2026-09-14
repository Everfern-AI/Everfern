/**
 * Property-Based Tests: FaviconCitation Component
 *
 * **Validates: Requirements 8.2, 8.4, 8.5**
 *
 * Property 2: Favicon URL derivation
 * Property 3: Favicon rendered before URL text
 * Property 4: Favicon dimensions are 16×16
 *
 * Feature: web-tool-settings, Properties 2, 3, 4
 */

import { describe, it } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import fc from 'fast-check';
import { getFaviconUrl, FaviconCitation } from '../FaviconCitation';

describe('Feature: web-tool-settings, Property 2: Favicon URL derivation', () => {
  it('property: getFaviconUrl returns <origin>/favicon.ico for any valid URL', () => {
    fc.assert(
      fc.property(
        fc.webUrl(),
        (url) => {
          const origin = new URL(url).origin;
          expect(getFaviconUrl(url)).toBe(`${origin}/favicon.ico`);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: web-tool-settings, Properties 3 & 4: Favicon rendered before URL, 16x16', () => {
  it('property: favicon img is 16x16 and appears before the URL text span', () => {
    fc.assert(
      fc.property(
        fc.webUrl(),
        (url) => {
          const { container } = render(React.createElement(FaviconCitation, { url }));
          const img = container.querySelector('img');

          // Property 4: dimensions are 16×16
          expect(img?.getAttribute('width')).toBe('16');
          expect(img?.getAttribute('height')).toBe('16');

          // Property 3: img appears before the text span in DOM order
          const nodes = Array.from(container.firstChild!.childNodes);
          const imgIdx = nodes.findIndex(
            (n) => (n as Element).tagName === 'IMG'
          );
          const textSpanIdx = nodes.findIndex(
            (n) =>
              (n as Element).tagName === 'SPAN' &&
              (n as Element).textContent?.includes(url)
          );
          expect(imgIdx).toBeLessThan(textSpanIdx);
        }
      ),
      { numRuns: 100 }
    );
  });
});
