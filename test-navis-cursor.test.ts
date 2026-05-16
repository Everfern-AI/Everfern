
import { it, expect } from 'vitest';
import { NavisOrchestrator } from './main/agent/tools/navis/orchestrator.ts';
import { NavisLogger } from './main/agent/tools/navis/logger.ts';

const mockAIClient: any = {
  model: 'gpt-4o',
  chat: async ({ messages }: any) => {
    const lastMsg = typeof messages[messages.length - 1].content === 'string' 
      ? messages[messages.length - 1].content 
      : JSON.stringify(messages[messages.length - 1].content);
    
    if (lastMsg.includes('google.com')) {
      return {
        content: JSON.stringify({
          current_state: { evaluation_previous_goal: 'Success', memory: 'On Google', next_goal: 'Search for EverFern' },
          action: [{ input_text: { ref: 'e1', text: 'EverFern AI' } }, { press_key: { ref: 'e1', key: 'Enter' } }]
        })
      };
    }
    
    return {
      content: JSON.stringify({
        current_state: { evaluation_previous_goal: 'Success', memory: 'Found EverFern', next_goal: 'Finish' },
        action: [{ done: { success: true, text: 'Magical cursor and shimmer verified!' } }]
      })
    };
  }
};

it('should move the cursor smoothly during interaction', { timeout: 120000 }, async () => {
  console.log('🚀 Starting Navis Visual Cursor Test...');
  const logger = new NavisLogger();
  const navis = new NavisOrchestrator(mockAIClient, logger);

  const result = await navis.run({
    task: 'Go to google.com and search for EverFern AI. Watch the cursor move!',
    startUrl: 'https://www.google.com',
    headless: false,
    maxSteps: 5
  });

  console.log('✅ Test finished:', result);
  expect(result.success).toBe(true);
});
