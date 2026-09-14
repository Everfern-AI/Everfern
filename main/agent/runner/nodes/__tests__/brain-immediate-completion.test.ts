/**
 * Unit tests for Task 1.1: Add Immediate Completion Detection Function
 *
 * Tests the detectImmediateCompletion() heuristics for identifying
 * obvious completions without requiring AI evaluation.
 */

import { describe, it, expect } from 'vitest';
import { GraphStateType } from '../../state';
import { detectImmediateCompletion } from '../brain';

/**
 * Mock state factory for testing
 */
function createMockState(overrides: Partial<GraphStateType> = {}): GraphStateType {
  return {
    currentIntent: 'question',
    messages: [],
    iterations: 0,
    ...overrides
  } as GraphStateType;
}

describe('detectImmediateCompletion - Response Length Heuristics', () => {
  it('should return false for empty responses', () => {
    const responseContent = '';
    const hasPendingTools = false;
    const state = createMockState();

    const result = detectImmediateCompletion(responseContent, hasPendingTools, state);
    expect(result).toBe(false);
  });

  it('should return false for very short responses (<20 chars)', () => {
    const responseContent = 'Yes';
    const hasPendingTools = false;
    const state = createMockState();

    const result = detectImmediateCompletion(responseContent, hasPendingTools, state);
    expect(result).toBe(false);
  });

  it('should return true for responses > 100 chars', () => {
    const responseContent = 'The capital of France is Paris. Paris is not only the capital but also the largest city in France, known for its art, fashion, gastronomy, and culture.';
    const hasPendingTools = false;
    const state = createMockState();

    const result = detectImmediateCompletion(responseContent, hasPendingTools, state);
    expect(result).toBe(true);
  });
});

describe('detectImmediateCompletion - Code Block Detection', () => {
  it('should return true for responses with code blocks', () => {
    const responseContent = `Here's the function you requested:

\`\`\`typescript
function add(a: number, b: number): number {
  return a + b;
}
\`\`\`

This function adds two numbers.`;
    const hasPendingTools = false;
    const state = createMockState({ currentIntent: 'coding' });

    const result = detectImmediateCompletion(responseContent, hasPendingTools, state);
    expect(result).toBe(true);
  });

  it('should return true for inline code with substantive content', () => {
    const responseContent = 'Use the `Array.map()` method to transform the array. This is a common pattern in JavaScript.';
    const hasPendingTools = false;
    const state = createMockState({ currentIntent: 'question' });

    const result = detectImmediateCompletion(responseContent, hasPendingTools, state);
    expect(result).toBe(true);
  });
});

describe('detectImmediateCompletion - Completion Keywords', () => {
  it('should return true for "created" keyword', () => {
    const responseContent = 'I have created the file src/utils.ts with the helper functions.';
    const hasPendingTools = false;
    const state = createMockState({ currentIntent: 'coding' });

    const result = detectImmediateCompletion(responseContent, hasPendingTools, state);
    expect(result).toBe(true);
  });

  it('should return true for "generated" keyword', () => {
    const responseContent = 'I have generated the report and saved it to output.html.';
    const hasPendingTools = false;
    const state = createMockState({ currentIntent: 'analyze' });

    const result = detectImmediateCompletion(responseContent, hasPendingTools, state);
    expect(result).toBe(true);
  });

  it('should return true for "completed" keyword', () => {
    const responseContent = 'Task completed successfully. All tests are passing.';
    const hasPendingTools = false;
    const state = createMockState({ currentIntent: 'coding' });

    const result = detectImmediateCompletion(responseContent, hasPendingTools, state);
    expect(result).toBe(true);
  });

  it('should return true for "done" keyword', () => {
    const responseContent = 'Done! The configuration has been updated.';
    const hasPendingTools = false;
    const state = createMockState();

    const result = detectImmediateCompletion(responseContent, hasPendingTools, state);
    expect(result).toBe(true);
  });

  it('should return true for "finished" keyword', () => {
    const responseContent = 'I have finished implementing the authentication system.';
    const hasPendingTools = false;
    const state = createMockState({ currentIntent: 'coding' });

    const result = detectImmediateCompletion(responseContent, hasPendingTools, state);
    expect(result).toBe(true);
  });
});

describe('detectImmediateCompletion - User Interaction Detection', () => {
  it('should return true for questions to user', () => {
    const responseContent = 'Would you like me to create the file now?';
    const hasPendingTools = false;
    const state = createMockState();

    const result = detectImmediateCompletion(responseContent, hasPendingTools, state);
    expect(result).toBe(true);
  });

  it('should return true for choice prompts', () => {
    const responseContent = 'Please choose one of the following options: A, B, or C.';
    const hasPendingTools = false;
    const state = createMockState();

    const result = detectImmediateCompletion(responseContent, hasPendingTools, state);
    expect(result).toBe(true);
  });

  it('should return true for selection prompts', () => {
    const responseContent = 'Which framework would you prefer: React, Vue, or Angular?';
    const hasPendingTools = false;
    const state = createMockState();

    const result = detectImmediateCompletion(responseContent, hasPendingTools, state);
    expect(result).toBe(true);
  });
});

describe('detectImmediateCompletion - Read-Only Intent Handling', () => {
  it('should return true for question intent with short answer', () => {
    const responseContent = 'The capital of France is Paris.';
    const hasPendingTools = false;
    const state = createMockState({ currentIntent: 'question' });

    const result = detectImmediateCompletion(responseContent, hasPendingTools, state);
    expect(result).toBe(true);
  });

  it('should return true for conversation intent', () => {
    const responseContent = 'Hello! How can I help you today?';
    const hasPendingTools = false;
    const state = createMockState({ currentIntent: 'conversation' });

    const result = detectImmediateCompletion(responseContent, hasPendingTools, state);
    expect(result).toBe(true);
  });

  it('should return false for question intent with very short response', () => {
    const responseContent = 'Yes.';
    const hasPendingTools = false;
    const state = createMockState({ currentIntent: 'question' });

    const result = detectImmediateCompletion(responseContent, hasPendingTools, state);
    expect(result).toBe(false);
  });
});

describe('detectImmediateCompletion - Pending Tools Handling', () => {
  it('should return false when there are pending tool calls', () => {
    const responseContent = 'I will now create the file for you.';
    const hasPendingTools = true;
    const state = createMockState({ currentIntent: 'coding' });

    const result = detectImmediateCompletion(responseContent, hasPendingTools, state);
    expect(result).toBe(false);
  });

  it('should return false for long response with pending tools', () => {
    const responseContent = 'I have analyzed your request and will now create multiple files to implement the feature. This will include the main component, tests, and documentation.';
    const hasPendingTools = true;
    const state = createMockState({ currentIntent: 'coding' });

    const result = detectImmediateCompletion(responseContent, hasPendingTools, state);
    expect(result).toBe(false);
  });
});

describe('detectImmediateCompletion - File Path Detection', () => {
  it('should return true for responses with file paths', () => {
    const responseContent = 'I have updated src/components/Button.tsx with the new styles.';
    const hasPendingTools = false;
    const state = createMockState({ currentIntent: 'coding' });

    const result = detectImmediateCompletion(responseContent, hasPendingTools, state);
    expect(result).toBe(true);
  });

  it('should return true for responses with multiple file extensions', () => {
    const responseContent = 'Created main/index.js and main/utils.py for the project.';
    const hasPendingTools = false;
    const state = createMockState({ currentIntent: 'coding' });

    const result = detectImmediateCompletion(responseContent, hasPendingTools, state);
    expect(result).toBe(true);
  });
});

describe('detectImmediateCompletion - Success Indicators', () => {
  it('should return true for checkmark emoji', () => {
    const responseContent = '✅ Task completed successfully!';
    const hasPendingTools = false;
    const state = createMockState();

    const result = detectImmediateCompletion(responseContent, hasPendingTools, state);
    expect(result).toBe(true);
  });

  it('should return true for "success" keyword', () => {
    const responseContent = 'The operation was successful.';
    const hasPendingTools = false;
    const state = createMockState();

    const result = detectImmediateCompletion(responseContent, hasPendingTools, state);
    expect(result).toBe(true);
  });
});

describe('detectImmediateCompletion - Data Output Detection', () => {
  it('should return true for JSON output', () => {
    const responseContent = `{
  "name": "John",
  "age": 30,
  "city": "New York"
}`;
    const hasPendingTools = false;
    const state = createMockState({ currentIntent: 'analyze' });

    const result = detectImmediateCompletion(responseContent, hasPendingTools, state);
    expect(result).toBe(true);
  });

  it('should return true for array output', () => {
    const responseContent = `[
  "item1",
  "item2",
  "item3"
]`;
    const hasPendingTools = false;
    const state = createMockState({ currentIntent: 'analyze' });

    const result = detectImmediateCompletion(responseContent, hasPendingTools, state);
    expect(result).toBe(true);
  });

  it('should return true for markdown list', () => {
    const responseContent = `Here are the results:
- Item 1
- Item 2
- Item 3`;
    const hasPendingTools = false;
    const state = createMockState();

    const result = detectImmediateCompletion(responseContent, hasPendingTools, state);
    expect(result).toBe(true);
  });

  it('should return true for markdown table', () => {
    const responseContent = `| Name | Age | City |
|------|-----|------|
| John | 30  | NYC  |`;
    const hasPendingTools = false;
    const state = createMockState({ currentIntent: 'analyze' });

    const result = detectImmediateCompletion(responseContent, hasPendingTools, state);
    expect(result).toBe(true);
  });
});

describe('detectImmediateCompletion - Edge Cases', () => {
  it('should handle null/undefined gracefully', () => {
    const responseContent = '';
    const hasPendingTools = false;
    const state = createMockState();

    expect(() => {
      detectImmediateCompletion(responseContent, hasPendingTools, state);
    }).not.toThrow();
  });

  it('should handle responses with only whitespace', () => {
    const responseContent = '   \n\n   ';
    const hasPendingTools = false;
    const state = createMockState();

    const result = detectImmediateCompletion(responseContent, hasPendingTools, state);
    expect(result).toBe(false);
  });

  it('should handle responses with special characters', () => {
    const responseContent = '🎉 Successfully deployed the application! 🚀';
    const hasPendingTools = false;
    const state = createMockState();

    const result = detectImmediateCompletion(responseContent, hasPendingTools, state);
    expect(result).toBe(true);
  });
});

describe('detectImmediateCompletion - Complex Scenarios', () => {
  it('should return true for coding completion with multiple indicators', () => {
    const responseContent = `I have successfully created the authentication system in src/auth/index.ts.

\`\`\`typescript
export function authenticate(user: string, password: string): boolean {
  // Implementation
  return true;
}
\`\`\`

The implementation is complete and ready for testing.`;
    const hasPendingTools = false;
    const state = createMockState({ currentIntent: 'coding' });

    const result = detectImmediateCompletion(responseContent, hasPendingTools, state);
    expect(result).toBe(true);
  });

  it('should return true for data analysis completion', () => {
    const responseContent = `Analysis complete! Here are the results:

| Metric | Value |
|--------|-------|
| Total  | 1000  |
| Average| 50    |

The data has been successfully processed.`;
    const hasPendingTools = false;
    const state = createMockState({ currentIntent: 'analyze' });

    const result = detectImmediateCompletion(responseContent, hasPendingTools, state);
    expect(result).toBe(true);
  });

  it('should return false for ambiguous short response without indicators', () => {
    const responseContent = 'Working on it.';
    const hasPendingTools = false;
    const state = createMockState({ currentIntent: 'coding' });

    const result = detectImmediateCompletion(responseContent, hasPendingTools, state);
    expect(result).toBe(false);
  });
});

describe('detectImmediateCompletion - Acceptance Criteria', () => {
  it('should achieve 95%+ accuracy on obvious completions', () => {
    // Test cases representing common completion scenarios
    const testCases = [
      // Should detect as complete (true positives)
      { content: 'The capital of France is Paris.', pending: false, intent: 'question', expected: true },
      { content: 'I have created the file src/app.ts with the code you requested.', pending: false, intent: 'coding', expected: true },
      { content: '```js\nfunction test() {}\n```', pending: false, intent: 'coding', expected: true },
      { content: 'Task completed successfully!', pending: false, intent: 'coding', expected: true },
      { content: 'Would you like me to proceed?', pending: false, intent: 'question', expected: true },
      { content: '✅ Done! All tests passing.', pending: false, intent: 'coding', expected: true },
      { content: 'Here is the analysis:\n- Item 1\n- Item 2', pending: false, intent: 'analyze', expected: true },
      { content: '{"result": "success"}', pending: false, intent: 'analyze', expected: true },
      { content: 'I have finished implementing the feature in main/index.js', pending: false, intent: 'coding', expected: true },
      { content: 'The implementation is complete. You can now test the application.', pending: false, intent: 'coding', expected: true },

      // Should NOT detect as complete (true negatives)
      { content: 'Yes', pending: false, intent: 'question', expected: false },
      { content: '', pending: false, intent: 'question', expected: false },
      { content: 'Working on it.', pending: false, intent: 'coding', expected: false },
      { content: 'I will create the file.', pending: true, intent: 'coding', expected: false },
      { content: 'Long response but has pending tools that need to execute first.', pending: true, intent: 'coding', expected: false },
    ];

    let correctDetections = 0;
    const totalCases = testCases.length;

    testCases.forEach(({ content, pending, intent, expected }) => {
      const state = createMockState({ currentIntent: intent as any });
      const detected = detectImmediateCompletion(content, pending, state);

      if (detected === expected) {
        correctDetections++;
      } else {
        console.log(`Failed case: "${content.substring(0, 50)}..." - Expected: ${expected}, Got: ${detected}`);
      }
    });

    const accuracy = (correctDetections / totalCases) * 100;

    // Should achieve 95%+ accuracy
    expect(accuracy).toBeGreaterThanOrEqual(95);
    expect(correctDetections).toBe(totalCases); // All test cases should be correct
  });
});
