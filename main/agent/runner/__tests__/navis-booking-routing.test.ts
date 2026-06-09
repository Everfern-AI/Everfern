import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  redirectComputerUseCallsToNavis,
  shouldRouteComputerUseToNavis,
} from '../tool-routing';

const runnerRoot = path.resolve(__dirname, '..');
const agentRoot = path.resolve(__dirname, '../..');

describe('Navis routing for booking and browser workflows', () => {
  it('redirects a misrouted computer_use call for flight booking live prices to navis', () => {
    const state: any = {
      currentIntent: 'research',
      messages: [
        {
          role: 'user',
          content: 'find me flight tickets from rotterdam to JFK, and date is next monday, one way trip',
        },
        {
          role: 'assistant',
          content: 'I found options. Want me to open one of these booking platforms and pull live prices?',
        },
        {
          role: 'user',
          content: 'Can you open the booking platforms and pull live prices',
        },
      ],
      decomposedTask: {
        steps: [
          {
            id: 'step_1',
            title: 'Bad plan',
            description: "Use computer_use to open the user's browser and inspect booking platforms.",
            tool: 'computer_use',
          },
        ],
      },
    };

    const result = redirectComputerUseCallsToNavis([
      {
        id: 'call_1',
        name: 'computer_use',
        arguments: {
          action: 'answer',
          text: "Use computer_use to open the user's browser, navigate booking platforms, and pull live prices.",
        },
      },
    ] as any, state);

    expect(result.redirected).toBe(1);
    expect(result.calls[0].name).toBe('navis');
    expect((result.calls[0].arguments as any).task).toContain('Use Navis for this browser/web workflow');
    expect((result.calls[0].arguments as any).task).toContain('booking platforms');
    expect((result.calls[0].arguments as any).task).toContain('live prices');
  });

  it('preserves native desktop automation as computer_use', () => {
    const shouldRedirect = shouldRouteComputerUseToNavis({
      toolName: 'computer_use',
      currentIntent: 'automate',
      userText: 'Open Spotify on Windows and click the play button',
      args: { action: 'left_click', coordinate: [320, 480] },
    });

    expect(shouldRedirect).toBe(false);
  });

  it('routes research intent directly to web_explorer in the graph source', () => {
    const graphSource = fs.readFileSync(path.join(runnerRoot, 'graph.ts'), 'utf8');

    expect(graphSource).toContain("if (intent === 'research')");
    expect(graphSource).toContain("return 'web_explorer'");
    expect(graphSource).toContain("Decomposed research/browser task");
  });

  it('forbids computer_use for browser booking tasks in decomposer and system prompts', () => {
    const decomposerSource = fs.readFileSync(path.join(runnerRoot, 'task-decomposer.ts'), 'utf8');
    const systemPrompt = fs.readFileSync(path.join(agentRoot, 'prompts/SYSTEM_PROMPT.md'), 'utf8');

    expect(decomposerSource).toContain('WEB / BOOKING ROUTING RULES');
    expect(decomposerSource).toContain('NEVER output "computer_use" for websites');
    expect(systemPrompt).toContain('Booking/live-price rule');
    expect(systemPrompt).toContain('Use computer_use to open the user');
  });
});
