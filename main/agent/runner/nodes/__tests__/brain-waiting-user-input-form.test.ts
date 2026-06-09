import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { buildAskUserQuestionToolCall, buildUserInputQuestion } from '../brain';

describe('Brain waiting_for_user_input form bridge', () => {
  it('turns a waiting-for-input completion explanation into an open-ended question', () => {
    const question = buildUserInputQuestion(
      'I have the listing research done but need the user to provide the recipient email address, context for the email, and their preferred sign-off before I can draft the Gmail.',
      '',
      'Find new property listings in Boston and draft a Gmail email.'
    );

    expect(question).toContain('recipient email address');
    expect(question).toContain('preferred sign-off');
    expect(question).toContain('Please provide the missing details here.');
  });

  it('creates an ask_user_question tool call with text input when Brain needs user input', () => {
    const call = buildAskUserQuestionToolCall(
      {
        reason: 'waiting_for_user_input',
        explanation: 'I need the recipient email address and sign-off before drafting the Gmail.',
      },
      '',
      'Draft a Gmail email about Boston property listings.'
    );

    expect(call.name).toBe('ask_user_question');
    expect(call.arguments.questions).toHaveLength(1);
    expect(call.arguments.questions[0].question).toContain('recipient email address');
    expect(call.arguments.questions[0].options).toEqual([]);
    expect(call.arguments.questions[0].multiSelect).toBe(false);
  });

  it('brain node source converts waiting_for_user_input before returning completion', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../brain.ts'), 'utf8');

    expect(source).toContain("signal.reason === 'waiting_for_user_input'");
    expect(source).toContain('buildAskUserQuestionToolCall');
    expect(source).toContain('pendingToolCalls: [askTool]');
    expect(source).toContain('completionSignal: null');
  });
});
