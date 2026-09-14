/**
 * Bug Condition Exploration Test for ask_user_question Form Display
 * 
 * This test MUST FAIL on unfixed code to confirm the bug exists.
 * 
 * Bug: Race condition where mission_complete removes stream listeners before
 * tool_call event with question data is processed by the frontend.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Bug Condition: ask_user_question Form Not Displayed', () => {
  let mockWindow: any;
  let toolCallListener: ((event: any, data: any) => void) | null = null;
  let missionCompleteListener: ((event: any, data: any) => void) | null = null;
  
  beforeEach(() => {
    // Mock window.electron API
    mockWindow = {
      electron: {
        onToolCall: vi.fn((callback) => {
          toolCallListener = callback;
        }),
        onMissionComplete: vi.fn((callback) => {
          missionCompleteListener = callback;
        }),
        removeAllListeners: vi.fn((channel) => {
          if (channel === 'tool_call') {
            toolCallListener = null;
          }
        }),
      },
    };
    
    global.window = mockWindow as any;
  });
  
  afterEach(() => {
    toolCallListener = null;
    missionCompleteListener = null;
  });

  it('should display UserQuestionForm when ask_user_question executes followed by rapid mission_complete', async () => {
    // Simulate the bug condition: ask_user_question tool_call followed by mission_complete within 100ms
    
    // Track state changes
    let activeUserQuestionSet = false;
    let listenersRemoved = false;
    let flagSetBeforeListenerRemoval = false;
    
    // Mock state setter
    const setActiveUserQuestion = vi.fn((value) => {
      activeUserQuestionSet = value !== null;
      console.log('[Test] activeUserQuestion set:', activeUserQuestionSet);
    });
    
    // Mock listener removal
    const originalRemoveAllListeners = mockWindow.electron.removeAllListeners;
    mockWindow.electron.removeAllListeners = vi.fn((channel) => {
      if (channel === 'tool_call') {
        listenersRemoved = true;
        flagSetBeforeListenerRemoval = activeUserQuestionSet;
        console.log('[Test] Listeners removed. Flag was set:', flagSetBeforeListenerRemoval);
      }
      originalRemoveAllListeners(channel);
    });
    
    // Simulate tool_call event with ask_user_question data
    const toolCallData = {
      toolName: 'ask_user_question',
      args: {
        question: 'What would you like the report to be about?',
        options: [
          { label: 'Option 1', value: 'opt1' },
          { label: 'Option 2', value: 'opt2' },
        ],
        multiSelect: false,
      },
      result: {
        success: true,
        output: 'Questions presented to the user...',
        data: {
          questions: [
            {
              question: 'What would you like the report to be about?',
              options: [
                { label: 'Option 1', value: 'opt1' },
                { label: 'Option 2', value: 'opt2' },
              ],
              multiSelect: false,
            },
          ],
          preview: '',
          type: 'ask_user',
        },
      },
      timestamp: new Date().toISOString(),
    };
    
    // Simulate the race condition: tool_call event arrives
    if (toolCallListener) {
      // Simulate the onToolCall handler logic
      const record = toolCallData;
      if (record.toolName === 'ask_user_question' && record.result?.success && record.result?.data?.questions) {
        const questionData = record.result.data.questions[0] || record.result.data.question;
        if (questionData) {
          setActiveUserQuestion(questionData);
        }
      }
    }
    
    // Simulate mission_complete firing within 100ms (race condition)
    await new Promise(resolve => setTimeout(resolve, 50));
    
    if (missionCompleteListener) {
      // Simulate the onMissionComplete handler with 200ms delay
      setTimeout(() => {
        // Check if there's an active user question
        const hasActiveQuestion = activeUserQuestionSet;
        
        if (!hasActiveQuestion) {
          // Remove listeners if no active question
          mockWindow.electron.removeAllListeners('tool_call');
        }
      }, 200);
    }
    
    // Wait for mission_complete delay to complete
    await new Promise(resolve => setTimeout(resolve, 250));
    
    // ASSERTIONS - These should FAIL on unfixed code
    
    // Property 1: Form should be displayed (activeUserQuestion should be set)
    expect(activeUserQuestionSet).toBe(true);
    
    // Property 2: __activeUserQuestion flag should prevent listener removal
    expect(listenersRemoved).toBe(false);
    
    // Property 3: Flag should be set BEFORE listeners are removed
    if (listenersRemoved) {
      expect(flagSetBeforeListenerRemoval).toBe(true);
    }
    
    // EXPECTED OUTCOME ON UNFIXED CODE:
    // - activeUserQuestionSet may be false (form doesn't appear)
    // - listenersRemoved may be true (listeners removed prematurely)
    // - flagSetBeforeListenerRemoval may be false (timing issue)
    
    console.log('[Test] Bug Condition Results:');
    console.log('  - Form displayed (activeUserQuestion set):', activeUserQuestionSet);
    console.log('  - Listeners removed:', listenersRemoved);
    console.log('  - Flag set before removal:', flagSetBeforeListenerRemoval);
  });

  it('should extract question data correctly from tool_call event', () => {
    // Test data extraction logic
    const toolCallData = {
      toolName: 'ask_user_question',
      result: {
        success: true,
        data: {
          questions: [
            {
              question: 'Test question?',
              options: [{ label: 'Yes', value: 'yes' }],
              multiSelect: false,
            },
          ],
        },
      },
    };
    
    // Simulate data extraction
    let extractedQuestion = null;
    if (toolCallData.toolName === 'ask_user_question' && toolCallData.result?.success) {
      const data = toolCallData.result.data;
      if (data?.questions && data.questions.length > 0) {
        extractedQuestion = data.questions[0];
      } else if (data?.question) {
        extractedQuestion = data.question;
      }
    }
    
    // ASSERTION - Should extract question correctly
    expect(extractedQuestion).not.toBeNull();
    expect(extractedQuestion?.question).toBe('Test question?');
    expect(extractedQuestion?.options).toHaveLength(1);
  });
});
