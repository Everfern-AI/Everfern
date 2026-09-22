import { describe, expect, it } from 'vitest';
import {
  sanitizeComputerUseTask,
  redirectComputerUseCallsToNavis,
} from '../tool-routing';

describe('Computer Use Prompt Optimization', () => {
  it('gives the user original prompt directly when intent is direct desktop automation (automate)', () => {
    const userPrompt = 'make brave default browser';
    const convolutedAiTask =
      'Open the Windows Settings application, navigate to Apps > Default apps, locate the current default web browser assignment, change it to Brave, and verify that Brave is shown as the default browser. If Windows prompts for confirmation per file type or link type, accept the change for the browser defaults. Report the final verified state.';

    const sanitized = sanitizeComputerUseTask({
      currentTask: convolutedAiTask,
      userText: userPrompt,
      currentIntent: 'automate',
    });

    expect(sanitized).toBe('make brave default browser');
  });

  it('preserves user prompt for general direct desktop tasks', () => {
    const userPrompt = 'Open Spotify and play some jazz';
    const aiTask = 'Open the Spotify application from Start menu, wait 3 seconds, click the search bar, type jazz, click play on the first playlist.';

    const sanitized = sanitizeComputerUseTask({
      currentTask: aiTask,
      userText: userPrompt,
      isDirectComputerUse: true,
    });

    expect(sanitized).toBe('Open Spotify and play some jazz');
  });

  it('distills long step-by-step navigation recipes into a concise one-liner for checking/coding tasks', () => {
    const userPrompt = 'Build a calculator app in React and test that it works';
    const convolutedCheckingTask =
      'Verify that the calculator app adds 5 and 7 and displays 12. Open the application window, inspect the calculator interface, click button 5, click plus, click button 7, click equals, and verify that the screen displays 12. Take a screenshot of the final output.';

    const sanitized = sanitizeComputerUseTask({
      currentTask: convolutedCheckingTask,
      userText: userPrompt,
      currentIntent: 'coding',
    });

    // Should be a concise one-liner stating what to accomplish
    expect(sanitized.length).toBeLessThan(120);
    expect(sanitized).toBe('Verify that the calculator app adds 5 and 7 and displays 12.');
  });

  it('optimizes computer_use calls in redirectComputerUseCallsToNavis for direct automation', () => {
    const state: any = {
      currentIntent: 'automate',
      messages: [
        {
          role: 'user',
          content: 'Set Brave as my default browser',
        },
      ],
    };

    const calls = [
      {
        id: 'call-1',
        name: 'computer_use',
        arguments: {
          task: 'Open the Windows Settings application, navigate to Apps > Default apps, locate the current default web browser assignment, change it to Brave...',
        },
      },
    ];

    const result = redirectComputerUseCallsToNavis(calls as any, state);
    expect(result.calls[0].name).toBe('computer_use');
    expect((result.calls[0].arguments as any).task).toBe('Set Brave as my default browser');
  });

  it('does not overwrite atomic actions (like left_click) with task prompt', () => {
    const state: any = {
      currentIntent: 'automate',
      messages: [
        {
          role: 'user',
          content: 'Click the confirm button',
        },
      ],
    };

    const calls = [
      {
        id: 'call-click',
        name: 'computer_use',
        arguments: {
          action: 'left_click',
          coordinate: [500, 300],
        },
      },
    ];

    const result = redirectComputerUseCallsToNavis(calls as any, state);
    expect(result.calls[0].name).toBe('computer_use');
    expect((result.calls[0].arguments as any).action).toBe('left_click');
    expect((result.calls[0].arguments as any).task).toBeUndefined();
  });
});
