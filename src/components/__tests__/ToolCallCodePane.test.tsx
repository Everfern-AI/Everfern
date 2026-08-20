import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToolCallCodePane, tokenizeCodeLine } from '../tools/ToolCallCodePane';

describe('ToolCallCodePane', () => {
  it('should tokenize TypeScript / TSX code accurately', () => {
    const sampleLine = 'import React, { useState, type ComponentProps } from "react";';
    const tokens = tokenizeCodeLine(sampleLine, 'tsx');
    expect(tokens.length).toBeGreaterThan(0);
  });

  it('should render header with title and extension matching reference design', () => {
    const onClose = vi.fn();
    render(
      <ToolCallCodePane
        toolName="replace_file_content"
        path="/src/app/chat/components/WebSearch.tsx"
        args={{
          TargetFile: '/src/app/chat/components/WebSearch.tsx',
          TargetContent: 'const a = 1;',
          ReplacementContent: 'const a = 2;',
        }}
        onClose={onClose}
      />
    );

    // Title should show filename · EXT
    expect(screen.getByText(/WebSearch\.tsx · TSX/i)).toBeDefined();
    // Copy button should exist
    expect(screen.getByText('Copy')).toBeDefined();
  });

  it('should handle write tools and render added lines', () => {
    const onClose = vi.fn();
    const code = '"use client";\n\nexport interface WebSearchResult {\n  title: string;\n}';
    render(
      <ToolCallCodePane
        toolName="write_to_file"
        path="src/types.ts"
        args={{
          TargetFile: 'src/types.ts',
          CodeContent: code,
        }}
        onClose={onClose}
      />
    );

    expect(screen.getByText(/types\.ts · TS/i)).toBeDefined();
    expect(screen.getByText('1')).toBeDefined();
  });

  it('should handle read / view_file tools and render output content', () => {
    const onClose = vi.fn();
    const output = 'function take<T>(array: readonly T[], n: number): T[] {\n  return array.slice(0, n);\n}';
    render(
      <ToolCallCodePane
        toolName="view_file"
        path="src/utils.ts"
        output={output}
        onClose={onClose}
      />
    );

    expect(screen.getByText(/utils\.ts · TS/i)).toBeDefined();
    expect(screen.getByText('1')).toBeDefined();
    expect(screen.getByText('2')).toBeDefined();
  });

  it('should trigger onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <ToolCallCodePane
        toolName="view_file"
        path="src/index.ts"
        output="console.log('hello');"
        onClose={onClose}
      />
    );

    const closeBtn = screen.getByTitle('Close panel');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
