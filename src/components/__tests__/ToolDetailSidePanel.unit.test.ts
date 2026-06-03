import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { extractNavisData, extractWebSearchData, TerminalView } from '../ToolDetailSidePanel';

describe('extractNavisData', () => {
  it('should extract screenshots from tc.data.screenshot (array of strings)', () => {
    const tc = {
      toolName: 'navis',
      args: { url: 'https://example.com' },
      data: {
        screenshot: ['base64_1', 'base64_2']
      }
    };
    const result = extractNavisData(tc);
    expect(result?.screenshots).toHaveLength(2);
    expect(result?.screenshots[0].base64).toBe('base64_2'); // It's reversed
    expect(result?.screenshots[1].base64).toBe('base64_1');
  });

  it('should extract screenshots from tc.data.screenshot (single string)', () => {
    const tc = {
      toolName: 'navis',
      args: { url: 'https://example.com' },
      data: {
        screenshot: 'base64_single'
      }
    };
    const result = extractNavisData(tc);
    expect(result?.screenshots).toHaveLength(1);
    expect(result?.screenshots[0].base64).toBe('base64_single');
  });

  it('should extract screenshots from tc.data.screenshots (array of objects)', () => {
    const tc = {
      toolName: 'navis',
      args: { url: 'https://example.com' },
      data: {
        screenshots: [
          { base64: 'base64_obj_1', timestamp: 1000 },
          { base64: 'base64_obj_2', timestamp: 2000 }
        ]
      }
    };
    const result = extractNavisData(tc);
    expect(result?.screenshots).toHaveLength(2);
    expect(result?.screenshots[0].base64).toBe('base64_obj_2');
    expect(result?.screenshots[1].base64).toBe('base64_obj_1');
  });

  it('should combine screenshots and avoid duplicates', () => {
    const tc = {
      toolName: 'navis',
      args: { url: 'https://example.com' },
      data: {
        screenshot: ['base64_1', 'base64_shared'],
        screenshots: [
          { base64: 'base64_shared', timestamp: 1000 },
          { base64: 'base64_2', timestamp: 2000 }
        ]
      }
    };
    const result = extractNavisData(tc);
    // base64_1, base64_shared, base64_2 (3 unique)
    expect(result?.screenshots).toHaveLength(3);
  });

  it('should handle data:image prefix', () => {
    const tc = {
      toolName: 'navis',
      data: {
        screenshot: 'data:image/png;base64,real_data'
      }
    };
    const result = extractNavisData(tc);
    expect(result?.screenshots[0].base64).toBe('real_data');
  });
});

describe('extractWebSearchData', () => {
  it('should extract results and handle empty results', () => {
    const tc = {
      args: { query: 'test query' },
      data: {
        results: [
          { title: 'Result 1', url: 'url1', description: 'desc1' },
          { title: 'Result 2', url: 'url2', snippet: 'snippet2' }
        ]
      }
    };
    const result = extractWebSearchData(tc);
    expect(result?.query).toBe('test query');
    expect(result?.results).toHaveLength(2);
    expect(result?.totalResults).toBe(2);
  });

  it('should handle missing data', () => {
    const tc = { args: { query: 'test' } };
    const result = extractWebSearchData(tc);
    expect(result?.results).toEqual([]);
    expect(result?.totalResults).toBe(0);
  });

  it('should extract domain from url if domain is missing', () => {
    const tc = {
      args: { query: 'test' },
      data: {
        results: [
          { title: 'Result', url: 'https://example.org/path' }
        ]
      }
    };
    const result = extractWebSearchData(tc);
    expect(result?.results[0].domain).toBe('example.org');
  });
});

describe('TerminalView', () => {
  it('renders ANSI-colored PowerShell output without stripping color spans', () => {
    render(
      React.createElement(TerminalView, {
        command: 'powershell -Command Write-Host Colored -ForegroundColor Red',
        output: '\u001b[31mColored\u001b[0m\nplain',
        exitCode: 0,
        shellType: 'windows',
      })
    );

    const colored = screen.getByText('Colored');
    expect(colored).toBeInTheDocument();
    expect(colored.tagName.toLowerCase()).toBe('span');
    expect(colored).toHaveStyle({ color: 'rgb(187, 0, 0)' });
    expect(screen.getByText('plain')).toBeInTheDocument();
  });
});

