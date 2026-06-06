import type { AgentTool, ToolResult } from '../runner/types';

export const askUserTool: AgentTool = {
  name: 'ask_user_question',
  description:
    'Present clarifying questions (either multiple-choice or subjective open-ended text fields) to the user before starting work or booking. ' +
    'To request free-form text input (e.g., booking details, passenger names, flight dates, custom text), omit the "options" array or leave it empty. ' +
    'If an option requires the user to provide a file (e.g. "Upload a file"), set requiresFileUpload: true on that option — ' +
    'the frontend will automatically show a file picker when the user selects it.',
  parameters: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        description: '1-3 specific clarifying questions. You can mix multiple-choice and subjective text input questions.',
        items: {
          type: 'object',
          properties: {
            question: { type: 'string', description: 'The question text (e.g. "To book your trip from Hyderabad to JFK, please provide the passenger full name and preferred dates:")' },
            options: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string', description: 'Display text for the option.' },
                  value: { type: 'string', description: 'Value sent back when selected.' },
                  isRecommended: { type: 'boolean', description: 'Highlight as recommended.' },
                  requiresFileUpload: { type: 'boolean', description: 'If true, selecting this option opens a file picker so the user can attach a file.' }
                },
                required: ['label', 'value']
              },
              description: 'Possible answers for the user to pick from. OMIT this array (or pass an empty array) to show a subjective/open-ended text input box.'
            },
            multiSelect: { type: 'boolean', description: 'Whether multiple options can be chosen.' }
          },
          required: ['question']
        }
      },
      previewMarkdown: {
        type: 'string',
        description: 'Optional Markdown preview (e.g. ASCII mockup or config snippet) to help the user decide.'
      }
    },
    required: ['questions']
  },

  async execute(args: Record<string, unknown>, onUpdate?: (msg: string) => void, emitEvent?: (event: any) => void, toolCallId?: string): Promise<ToolResult> {
    // Handle both formats: { questions: [...] } or { question: "...", options: [...] }
    let questions: any[];

    if (args.questions && Array.isArray(args.questions)) {
      // Correct format: questions array
      questions = args.questions as any[];
    } else if (args.question && args.options) {
      // Incorrect format: single question object - wrap it in an array
      questions = [{
        question: args.question,
        options: args.options,
        multiSelect: args.multiSelect
      }];
    } else {
      // Invalid format
      return {
        success: false,
        output: 'Invalid arguments: expected either "questions" array or "question" with "options"',
        error: 'Invalid tool arguments'
      };
    }

    const preview = args.previewMarkdown as string | undefined;

    const formatted = questions.map(q => {
      const opts = (Array.isArray(q.options) ? q.options : [])
        .map((o: any) => typeof o === 'string' ? o : (o?.label || o?.value || String(o)))
        .join(' / ') || 'No options provided';
      return `❓ **${q.question}**\n   Choices: ${opts}`;
    }).join('\n\n');

    onUpdate?.(`🤔 Presenting ${questions.length} clarifying questions to the user...`);

    // Normalize options to ensure they're properly serializable
    const normalizedQuestions = questions.map(q => ({
      question: String(q.question || ''),
      options: (Array.isArray(q.options) ? q.options : []).map((opt: any) => {
        if (typeof opt === 'string') {
          return { label: opt, value: opt };
        } else if (typeof opt === 'object' && opt !== null) {
          return {
            label: String(opt.label || opt.value || opt),
            value: String(opt.value || opt.label || opt),
            isRecommended: Boolean(opt.isRecommended || opt.recommended || false),
            requiresFileUpload: Boolean(opt.requiresFileUpload || false)
          };
        }
        return { label: String(opt), value: String(opt) };
      }),
      multiSelect: Boolean(q.multiSelect || false)
    }));

    // Show system notification via Electron
    try {
      const { Notification, BrowserWindow } = require('electron');
      if (Notification.isSupported()) {
        const isSecurity = formatted.includes('Security Check Required') || formatted.includes('⚠️');
        const notif = new Notification({
          title: isSecurity ? 'EverFern Security Authorization' : 'EverFern Clarification Required',
          body: isSecurity 
            ? 'A security check is pending. Click to review and authorize.' 
            : 'The agent has clarification questions for you.',
          silent: false,
        });

        notif.on('click', () => {
          const windows = BrowserWindow.getAllWindows();
          if (windows.length > 0) {
            const win = windows[0];
            if (win.isMinimized()) win.restore();
            win.focus();
          }
        });

        notif.show();
      }
    } catch (err) {
      console.error('[Notification] Failed to show system notification:', err);
    }

    return {
      success: true,
      output: `Questions presented to the user:\n\n${formatted}\n\n${preview ? `**Preview Context:**\n${preview}\n\n` : ''}Wait for the user's selection.`,
      data: {
        questions: normalizedQuestions,
        preview: preview || '',
        type: 'ask_user'
      }
    };
  }
};
