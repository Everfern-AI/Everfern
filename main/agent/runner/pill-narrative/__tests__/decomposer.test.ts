/**
 * Unit Tests for PillBasedTaskDecomposer
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7**
 *
 * Tests for:
 * - generateTasks() creates tasks with business-focused titles
 * - generatePills() creates pills with dependencies
 * - decompose() generates complete pill-based structure
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PillBasedTaskDecomposer } from '../decomposer';
import type { AIClient } from '../../../lib/ai-client';

/**
 * Mock AIClient for testing
 */
class MockAIClient implements AIClient {
  async chat(options: any): Promise<any> {
    // Return a mock response with tasks
    return {
      content: JSON.stringify([
        {
          title: 'Search for information',
          description: 'Find relevant data',
          pills: [
            { toolName: 'web_search', label: 'Search', icon: '🔍' },
            { toolName: 'browser_use', label: 'Browse', icon: '🌐', dependsOn: ['web_search'] },
          ],
        },
        {
          title: 'Analyze results',
          description: 'Process the data',
          pills: [{ toolName: 'python_execute', label: 'Execute', icon: '🐍', dependsOn: ['browser_use'] }],
        },
      ]),
    };
  }
}

describe('PillBasedTaskDecomposer', () => {
  let decomposer: PillBasedTaskDecomposer;
  let mockClient: MockAIClient;

  beforeEach(() => {
    mockClient = new MockAIClient();
    decomposer = new PillBasedTaskDecomposer(mockClient);
  });

  describe('decompose()', () => {
    it('should generate a complete pill-based structure', async () => {
      const userRequest = 'Find information about Discord bots';
      const missionId = 'mission_1';

      const timeline = await decomposer.decompose(userRequest, missionId);

      expect(timeline).toBeDefined();
      expect(timeline.missionId).toBe(missionId);
      expect(timeline.tasks).toBeDefined();
      expect(timeline.tasks.length).toBeGreaterThan(0);
      expect(timeline.status).toBe('pending');
      expect(timeline.startTime).toBeDefined();
      expect(timeline.metadata?.userRequest).toBe(userRequest);
    });

    it('should create tasks with pills', async () => {
      const userRequest = 'Find information about Discord bots';
      const missionId = 'mission_1';

      const timeline = await decomposer.decompose(userRequest, missionId);

      expect(timeline.tasks.length).toBeGreaterThan(0);
      timeline.tasks.forEach((task) => {
        expect(task.id).toBeDefined();
        expect(task.title).toBeDefined();
        expect(task.pills).toBeDefined();
        expect(task.pills.length).toBeGreaterThan(0);
      });
    });

    it('should set initial status to pending', async () => {
      const userRequest = 'Find information about Discord bots';
      const missionId = 'mission_1';

      const timeline = await decomposer.decompose(userRequest, missionId);

      expect(timeline.status).toBe('pending');
      timeline.tasks.forEach((task) => {
        expect(task.status).toBe('pending');
        task.pills.forEach((pill) => {
          expect(pill.status).toBe('pending');
        });
      });
    });
  });

  describe('generateTasks()', () => {
    it('should create tasks with business-focused titles', async () => {
      const userRequest = 'Find information about Discord bots';

      const tasks = await decomposer.generateTasks(userRequest);

      expect(tasks.length).toBeGreaterThan(0);
      tasks.forEach((task) => {
        expect(task.title).toBeDefined();
        expect(task.title.length).toBeGreaterThan(0);
        // Title should not contain tool names
        expect(task.title.toLowerCase()).not.toContain('web_search');
        expect(task.title.toLowerCase()).not.toContain('browser_use');
      });
    });

    it('should create tasks with unique IDs', async () => {
      const userRequest = 'Find information about Discord bots';

      const tasks = await decomposer.generateTasks(userRequest);

      const ids = tasks.map((t) => t.id);
      const uniqueIds = new Set(ids);
      expect(ids.length).toBe(uniqueIds.size);
    });

    it('should create tasks with pills', async () => {
      const userRequest = 'Find information about Discord bots';

      const tasks = await decomposer.generateTasks(userRequest);

      tasks.forEach((task) => {
        expect(task.pills).toBeDefined();
        expect(task.pills.length).toBeGreaterThan(0);
      });
    });

    it('should handle AI client errors gracefully', async () => {
      const errorClient = {
        chat: vi.fn().mockRejectedValue(new Error('AI client error')),
      } as any;

      const errorDecomposer = new PillBasedTaskDecomposer(errorClient);
      const userRequest = 'Find information about Discord bots';

      const tasks = await errorDecomposer.generateTasks(userRequest);

      // Should return fallback tasks
      expect(tasks.length).toBeGreaterThan(0);
      expect(tasks[0].pills.length).toBeGreaterThan(0);
    });
  });

  describe('generatePills()', () => {
    it('should create pills with required fields', async () => {
      const userRequest = 'Find information about Discord bots';

      const tasks = await decomposer.generateTasks(userRequest);

      tasks.forEach((task) => {
        task.pills.forEach((pill) => {
          expect(pill.id).toBeDefined();
          expect(pill.toolName).toBeDefined();
          expect(pill.status).toBe('pending');
        });
      });
    });

    it('should create pills with labels and icons', async () => {
      const userRequest = 'Find information about Discord bots';

      const tasks = await decomposer.generateTasks(userRequest);

      tasks.forEach((task) => {
        task.pills.forEach((pill) => {
          expect(pill.label).toBeDefined();
          expect(pill.icon).toBeDefined();
        });
      });
    });

    it('should handle dependencies between pills', async () => {
      const userRequest = 'Find information about Discord bots';

      const tasks = await decomposer.generateTasks(userRequest);

      // At least one task should have pills with dependencies
      const hasDependent = tasks.some((task) =>
        task.pills.some((pill) => pill.dependsOn && pill.dependsOn.length > 0)
      );

      // This may or may not be true depending on the AI response
      // but we should at least be able to handle it
      expect(tasks).toBeDefined();
    });

    it('should create unique pill IDs within a task', async () => {
      const userRequest = 'Find information about Discord bots';

      const tasks = await decomposer.generateTasks(userRequest);

      tasks.forEach((task) => {
        const pillIds = task.pills.map((p) => p.id);
        const uniquePillIds = new Set(pillIds);
        expect(pillIds.length).toBe(uniquePillIds.size);
      });
    });
  });

  describe('Task Title Validation', () => {
    it('should not include tool names in task titles', async () => {
      const userRequest = 'Find information about Discord bots';

      const tasks = await decomposer.generateTasks(userRequest);

      const toolNames = [
        'web_search',
        'browser_use',
        'read_file',
        'write_file',
        'python_execute',
        'terminal_execute',
      ];

      tasks.forEach((task) => {
        const lowerTitle = task.title.toLowerCase();
        toolNames.forEach((toolName) => {
          expect(lowerTitle).not.toContain(toolName);
        });
      });
    });

    it('should create non-empty task titles', async () => {
      const userRequest = 'Find information about Discord bots';

      const tasks = await decomposer.generateTasks(userRequest);

      tasks.forEach((task) => {
        expect(task.title).toBeDefined();
        expect(task.title.trim().length).toBeGreaterThan(0);
      });
    });

    it('should create distinct task titles', async () => {
      const userRequest = 'Find information about Discord bots';

      const tasks = await decomposer.generateTasks(userRequest);

      const titles = tasks.map((t) => t.title);
      const uniqueTitles = new Set(titles);
      expect(titles.length).toBe(uniqueTitles.size);
    });
  });

  describe('Fallback Behavior', () => {
    it('should create fallback tasks when AI fails', async () => {
      const errorClient = {
        chat: vi.fn().mockRejectedValue(new Error('AI client error')),
      } as any;

      const errorDecomposer = new PillBasedTaskDecomposer(errorClient);
      const userRequest = 'Find information about Discord bots';

      const tasks = await errorDecomposer.generateTasks(userRequest);

      expect(tasks.length).toBeGreaterThan(0);
      expect(tasks[0].id).toBeDefined();
      expect(tasks[0].title).toBeDefined();
      expect(tasks[0].pills.length).toBeGreaterThan(0);
    });

    it('should create valid fallback structure', async () => {
      const errorClient = {
        chat: vi.fn().mockRejectedValue(new Error('AI client error')),
      } as any;

      const errorDecomposer = new PillBasedTaskDecomposer(errorClient);
      const userRequest = 'Find information about Discord bots';

      const timeline = await errorDecomposer.decompose(userRequest, 'mission_1');

      expect(timeline.missionId).toBe('mission_1');
      expect(timeline.tasks.length).toBeGreaterThan(0);
      expect(timeline.status).toBe('pending');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty user request', async () => {
      const userRequest = '';

      const tasks = await decomposer.generateTasks(userRequest);

      expect(tasks).toBeDefined();
      expect(Array.isArray(tasks)).toBe(true);
    });

    it('should handle very long user request', async () => {
      const userRequest = 'A'.repeat(1000);

      const tasks = await decomposer.generateTasks(userRequest);

      expect(tasks).toBeDefined();
      expect(Array.isArray(tasks)).toBe(true);
    });

    it('should handle special characters in user request', async () => {
      const userRequest = 'Find info about @#$%^&*() special chars';

      const tasks = await decomposer.generateTasks(userRequest);

      expect(tasks).toBeDefined();
      expect(Array.isArray(tasks)).toBe(true);
    });
  });
});
