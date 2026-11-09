// @vitest-environment node
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ThumbBody } from '../Desktop';

it('keeps unopened app previews distinct without connecting each thumbnail to the shared VM', () => {
  const apps = ['chatgpt', 'chrome', 'claude', 'terminal'];
  const previews = apps.map(app => renderToStaticMarkup(<ThumbBody app={app} snapKey={`persist:worker-preview|${app}`} />));
  expect(new Set(previews).size).toBe(apps.length);
  previews.forEach(preview => {
    expect(preview).toContain('data-preview-state="unavailable"');
    expect(preview).toContain('Open to view this app');
    expect(preview).not.toContain('<iframe');
    expect(preview).not.toContain('<webview');
    expect(preview).not.toContain('wk-thumb-win-bar');
    expect(preview).not.toContain('wk-thumb-win-dots');
  });
  expect(previews[0]).toContain('ChatGPT');
  expect(previews[1]).toContain('Chrome');
  expect(previews[2]).toContain('Claude');
  expect(previews[3]).toContain('Terminal');
});
