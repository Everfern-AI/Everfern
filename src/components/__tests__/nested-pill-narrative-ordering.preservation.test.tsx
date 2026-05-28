import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ToolCallTag } from '../ToolCallComponents';
import type { ToolCallDisplay } from '../../types';

describe('Preservation Tests: Tool Calls Without Narratives', () => {
  it('should not render narrative elements when description is missing', () => {
    const toolCall: ToolCallDisplay = {
      id: 'test-no-desc',
      toolName: 'read_file',
      status: 'done',
      label: 'Read File',
      icon: '📄'
    };

    const { container } = render(<ToolCallTag tc={toolCall} isLast={true} />);
    const narrativeElement = container.querySelector('[data-testid="narrative-element"]');
    expect(narrativeElement).not.toBeInTheDocument();
  });

  it('should not render narrative elements when description is empty', () => {
    const toolCall: ToolCallDisplay = {
      id: 'test-empty-desc',
      description: '',
      toolName: 'bash',
      status: 'done',
      label: 'Terminal',
      icon: '💻'
    };

    const { container } = render(<ToolCallTag tc={toolCall} isLast={true} />);
    const narrativeElement = container.querySelector('[data-testid="narrative-element"]');
    expect(narrativeElement).not.toBeInTheDocument();
  });

  it('should render standard tool pill details correctly', () => {
    const toolCall: ToolCallDisplay = {
      id: 'test-pill-details',
      toolName: 'web_search',
      status: 'done',
      label: 'Search',
      icon: '🔍',
      output: 'test output'
    };

    const { container } = render(<ToolCallTag tc={toolCall} isLast={true} />);
    expect(container).toBeDefined();
    expect(container.textContent).toContain('Search');
  });
});
