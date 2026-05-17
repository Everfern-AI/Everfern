import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ToolCallTag } from '../ToolCallComponents';
import type { ToolCallDisplay } from '../../types';

/**
 * Bug Condition Exploration Test for Nested Pill Narrative Ordering Fix
 *
 * **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
 * **DO NOT attempt to fix the test or the code when it fails**
 * **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
 * **GOAL**: Surface counterexamples that demonstrate the bug exists
 *
 * **Validates: Requirements 1.1, 1.2, 1.3**
 */
describe('Bug Condition Exploration: Narrative Visibility and Positioning', () => {
  /**
   * Property 1: Bug Condition - Narrative Visibility and Positioning
   * **Validates: Requirements 2.1, 2.2**
   *
   * Test that when a tool call has a non-empty `description` field, the narrative appears above the tool pill with correct styling
   */
  it('MUST FAIL: narrative should be visible above tool pill with correct styling', () => {
    // Render ToolCallTag with description field populated
    const toolCall: ToolCallDisplay = {
      id: 'test-tool-1',
      description: "Let me conduct an investigation by visiting",
      toolName: "web_search",
      status: "done",
      label: "Search",
      icon: "🔍"
    };

    const { container } = render(<ToolCallTag tc={toolCall} isLast={true} />);

    // Find the narrative element by data-testid
    const narrativeElement = container.querySelector('[data-testid="narrative-element"]');

    expect(narrativeElement).toBeInTheDocument();

    // The narrative should contain the description text
    // This is the key assertion - if this fails, it means the description is not being rendered
    expect(narrativeElement?.textContent).toBe(toolCall.description);

    // Assert narrative appears ABOVE the tool pill element (check DOM order)
    // The tool pill has padding: 7px 12px and contains the icon and label
    const allDivs = Array.from(container.querySelectorAll('div'));
    const toolPillElement = allDivs.find(div => {
      const style = window.getComputedStyle(div);
      // Look for the div with the tool pill styling
      return (style.padding === '7px 12px' && style.borderRadius === '10px') ||
             (div.querySelector('span') && div.textContent?.includes('Search') && style.padding === '7px 12px');
    });

    if (toolPillElement) {
      // Check DOM order: narrative should come before tool pill in document order
      const narrativeIndex = allDivs.indexOf(narrativeElement!);
      const toolPillIndex = allDivs.indexOf(toolPillElement);
      expect(narrativeIndex).toBeLessThan(toolPillIndex);
    }

    // Assert narrative styling: fontSize: 12, color: '#9ca3af', marginBottom: 6, lineHeight: 1.5, fontStyle: 'italic'
    const computedStyle = window.getComputedStyle(narrativeElement!);
    expect(computedStyle.fontSize).toBe('12px');
    expect(computedStyle.color).toBe('rgb(156, 163, 175)'); // #9ca3af in RGB
    expect(computedStyle.marginBottom).toBe('6px');
    expect(computedStyle.lineHeight).toBe('1.5');
    expect(computedStyle.fontStyle).toBe('italic');
  });

  /**
   * Property 2: Bug Condition - Chronological Order Maintained
   * **Validates: Requirement 2.3**
   *
   * Test that multiple tool calls with narratives maintain chronological order
   */
  it('MUST FAIL: multiple narratives should maintain chronological order', () => {
    const toolCall1: ToolCallDisplay = {
      id: 'test-tool-1',
      description: "First, let me search for information",
      toolName: "web_search",
      status: "done",
      label: "Search",
      icon: "🔍"
    };

    const toolCall2: ToolCallDisplay = {
      id: 'test-tool-2',
      description: "Next, I'll read the file contents",
      toolName: "read_file",
      status: "done",
      label: "Read File",
      icon: "📄"
    };

    // Render multiple ToolCallTag components in sequence
    const { container } = render(
      <div>
        <ToolCallTag tc={toolCall1} isLast={false} />
        <ToolCallTag tc={toolCall2} isLast={true} />
      </div>
    );

    // Find all narrative elements by data-testid
    const narrativeElements = container.querySelectorAll('[data-testid="narrative-element"]');

    expect(narrativeElements).toHaveLength(2);

    // Verify chronological order: first narrative should appear before second narrative
    const firstNarrative = narrativeElements[0];
    const secondNarrative = narrativeElements[1];

    expect(firstNarrative).toHaveTextContent("First, let me search for information");
    expect(secondNarrative).toHaveTextContent("Next, I'll read the file contents");

    // Check DOM order
    const allElements = Array.from(container.querySelectorAll('*'));
    const firstIndex = allElements.indexOf(firstNarrative);
    const secondIndex = allElements.indexOf(secondNarrative);
    expect(firstIndex).toBeLessThan(secondIndex);
  });

  /**
   * Property 3: Bug Condition - Narrative Element Structure
   * **Validates: Requirements 2.1, 2.2**
   *
   * Test specific implementation details from Bug Condition in design
   */
  it('MUST FAIL: narrative element should have correct DOM structure and positioning', () => {
    const toolCall: ToolCallDisplay = {
      id: 'test-tool-1',
      description: "Let me conduct an investigation by visiting",
      toolName: "web_search",
      status: "done",
      label: "Search",
      icon: "🔍"
    };

    const { container } = render(<ToolCallTag tc={toolCall} isLast={true} />);

    // Find the narrative element by data-testid
    const narrativeElement = container.querySelector('[data-testid="narrative-element"]');

    expect(narrativeElement).toBeInTheDocument();

    // Verify it's a div element
    expect(narrativeElement!.tagName.toLowerCase()).toBe('div');

    // Verify it's not hidden (display: none, opacity: 0)
    const computedStyle = window.getComputedStyle(narrativeElement!);
    expect(computedStyle.display).not.toBe('none');
    expect(computedStyle.opacity).not.toBe('0');

    // Verify it's not overlapped by timeline elements (check z-index and positioning)
    const allDivs = Array.from(container.querySelectorAll('div'));
    const timelineDot = allDivs.find(div => {
      const style = window.getComputedStyle(div);
      return style.borderRadius === '50%' && style.width === '20px' && style.height === '20px';
    });

    if (timelineDot) {
      const timelineStyle = window.getComputedStyle(timelineDot);
      const narrativeStyle = window.getComputedStyle(narrativeElement!);

      // Timeline dot should not have higher z-index that would overlap narrative
      const timelineZIndex = parseInt(timelineStyle.zIndex) || 0;
      const narrativeZIndex = parseInt(narrativeStyle.zIndex) || 0;

      // If timeline has z-index, narrative should not be behind it
      if (timelineZIndex > 0) {
        expect(narrativeZIndex).toBeGreaterThanOrEqual(timelineZIndex);
      }
    }
  });

  /**
   * Preservation Test: Tool calls without narratives should be unaffected
   * **Validates: Requirement 3.1**
   *
   * This should pass on both unfixed and fixed code
   */
  it('SHOULD PASS: tool calls without description should render without narrative', () => {
    const toolCallWithoutDescription: ToolCallDisplay = {
      id: 'test-tool-no-desc',
      toolName: "read_file",
      status: "done",
      label: "Read File",
      icon: "📄"
      // No description field
    };

    const toolCallWithEmptyDescription: ToolCallDisplay = {
      id: 'test-tool-empty-desc',
      description: "",
      toolName: "bash",
      status: "done",
      label: "Terminal",
      icon: "💻"
    };

    const toolCallWithNullDescription: ToolCallDisplay = {
      id: 'test-tool-null-desc',
      description: undefined,
      toolName: "web_search",
      status: "done",
      label: "Search",
      icon: "🔍"
    };

    // Test tool call without description
    const { container: container1 } = render(<ToolCallTag tc={toolCallWithoutDescription} isLast={true} />);
    const narrative1 = container1.querySelector('[data-testid="narrative-element"]');
    expect(narrative1).not.toBeInTheDocument();

    // Test tool call with empty description
    const { container: container2 } = render(<ToolCallTag tc={toolCallWithEmptyDescription} isLast={true} />);
    const narrative2 = container2.querySelector('[data-testid="narrative-element"]');
    expect(narrative2).not.toBeInTheDocument();

    // Test tool call with null/undefined description
    const { container: container3 } = render(<ToolCallTag tc={toolCallWithNullDescription} isLast={true} />);
    const narrative3 = container3.querySelector('[data-testid="narrative-element"]');
    expect(narrative3).not.toBeInTheDocument();
  });
});
