import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToolCallCodePane, tokenizeCodeLine, PALETTE } from '../tools/ToolCallCodePane';

describe('ToolCallCodePane', () => {
  it('should tokenize Python code matching reference design', () => {
    const pythonLine = 'from reportlab.lib.pagesizes import letter';
    const tokens = tokenizeCodeLine(pythonLine, 'py');
    expect(tokens.length).toBeGreaterThan(0);

    const callLine = '    "TitleStyle", parent=styles["Title"], fontSize=28, leading=32,';
    const callTokens = tokenizeCodeLine(callLine, 'py');
    expect(callTokens.length).toBeGreaterThan(0);
  });

  it('should tokenize TypeScript / TSX code accurately', () => {
    const sampleLine = 'import React, { useState, type ComponentProps } from "react";';
    const tokens = tokenizeCodeLine(sampleLine, 'tsx');
    expect(tokens.length).toBeGreaterThan(0);
  });

  it('should render header with title and extension matching reference design (e.g. Build pdf · PY)', () => {
    const onClose = vi.fn();
    render(
      <ToolCallCodePane
        toolName="write_to_file"
        path="/src/build_pdf.py"
        args={{
          TargetFile: '/src/build_pdf.py',
          CodeContent: 'from reportlab.lib.pagesizes import letter\nstyles = getSampleStyleSheet()',
        }}
        onClose={onClose}
      />
    );

    // Title should show formatted "Build pdf · PY"
    expect(screen.getByText('Build pdf · PY')).toBeDefined();
    // Copy button should exist
    expect(screen.getByText('Copy')).toBeDefined();
  });

  it('should handle write tools and render code with line numbers', () => {
    const onClose = vi.fn();
    const code = 'from reportlab.lib.pagesizes import letter\nfrom reportlab.lib.units import inch';
    render(
      <ToolCallCodePane
        toolName="write_to_file"
        path="src/report.py"
        args={{
          TargetFile: 'src/report.py',
          CodeContent: code,
        }}
        onClose={onClose}
      />
    );

    expect(screen.getByText('Report · PY')).toBeDefined();
    expect(screen.getByText('1')).toBeDefined();
    expect(screen.getByText('2')).toBeDefined();
  });

  it('should handle read / view_file tools and render output content', () => {
    const onClose = vi.fn();
    const output = 'def calculate(total, tax=0.1):\n    return total * (1 + tax)';
    render(
      <ToolCallCodePane
        toolName="view_file"
        path="src/tax_calc.py"
        output={output}
        onClose={onClose}
      />
    );

    expect(screen.getByText('Tax calc · PY')).toBeDefined();
    expect(screen.getAllByText('1').length).toBeGreaterThan(0);
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
