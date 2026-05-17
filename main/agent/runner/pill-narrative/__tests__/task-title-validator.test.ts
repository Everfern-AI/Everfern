/**
 * Unit Tests for Task Title Validator
 *
 * **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6**
 *
 * Tests for:
 * - Task title validation
 * - Business language detection
 * - Tool name exclusion
 * - Title distinctness
 */

import { describe, it, expect } from 'vitest';
import {
  validateTaskTitle,
  containsToolName,
  hasBusinessLanguage,
  areTaskTitlesDistinct,
  validateTaskTitles,
  generateTaskTitle,
  sanitizeTaskTitle,
} from '../task-title-validator';
import type { Task } from '../types';

/**
 * Create mock task
 */
function createMockTask(overrides?: Partial<Task>): Task {
  return {
    id: 'task_1',
    title: 'Search for information',
    pills: [],
    status: 'pending',
    ...overrides,
  };
}

describe('Task Title Validator', () => {
  describe('validateTaskTitle()', () => {
    it('should validate a good task title', () => {
      const result = validateTaskTitle('Search for information');

      expect(result.isValid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should reject empty title', () => {
      const result = validateTaskTitle('');

      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('non-empty'))).toBe(true);
    });

    it('should reject title with only whitespace', () => {
      const result = validateTaskTitle('   ');

      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('non-empty'))).toBe(true);
    });

    it('should reject title containing tool names', () => {
      const result = validateTaskTitle('Execute web_search for information');

      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('tool names'))).toBe(true);
    });

    it('should reject title without business language', () => {
      const result = validateTaskTitle('xyz abc 123');

      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('business-focused'))).toBe(true);
    });

    it('should accept various business-focused titles', () => {
      const titles = [
        'Search for information',
        'Analyze the results',
        'Generate a report',
        'Create a summary',
        'Review the data',
        'Validate the input',
        'Process the files',
        'Extract key information',
      ];

      titles.forEach((title) => {
        const result = validateTaskTitle(title);
        expect(result.isValid).toBe(true);
      });
    });
  });

  describe('containsToolName()', () => {
    it('should detect web_search', () => {
      expect(containsToolName('Execute web_search')).toBe(true);
    });

    it('should detect browser_use', () => {
      expect(containsToolName('Use browser_use to browse')).toBe(true);
    });

    it('should detect read_file', () => {
      expect(containsToolName('read_file from disk')).toBe(true);
    });

    it('should not detect partial matches', () => {
      expect(containsToolName('search for information')).toBe(false);
      expect(containsToolName('browser window')).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(containsToolName('Execute WEB_SEARCH')).toBe(true);
      expect(containsToolName('Use BROWSER_USE')).toBe(true);
    });
  });

  describe('hasBusinessLanguage()', () => {
    it('should detect business keywords', () => {
      expect(hasBusinessLanguage('Search for information')).toBe(true);
      expect(hasBusinessLanguage('Analyze the results')).toBe(true);
      expect(hasBusinessLanguage('Generate a report')).toBe(true);
    });

    it('should not detect non-business text', () => {
      expect(hasBusinessLanguage('xyz abc 123')).toBe(false);
      expect(hasBusinessLanguage('foo bar baz')).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(hasBusinessLanguage('SEARCH for information')).toBe(true);
      expect(hasBusinessLanguage('ANALYZE the results')).toBe(true);
    });
  });

  describe('areTaskTitlesDistinct()', () => {
    it('should return true for distinct titles', () => {
      const tasks = [
        createMockTask({ id: 'task_1', title: 'Search for information' }),
        createMockTask({ id: 'task_2', title: 'Analyze the results' }),
        createMockTask({ id: 'task_3', title: 'Generate a report' }),
      ];

      expect(areTaskTitlesDistinct(tasks)).toBe(true);
    });

    it('should return false for duplicate titles', () => {
      const tasks = [
        createMockTask({ id: 'task_1', title: 'Search for information' }),
        createMockTask({ id: 'task_2', title: 'Search for information' }),
      ];

      expect(areTaskTitlesDistinct(tasks)).toBe(false);
    });

    it('should return true for empty list', () => {
      expect(areTaskTitlesDistinct([])).toBe(true);
    });

    it('should return true for single task', () => {
      const tasks = [createMockTask({ title: 'Search for information' })];

      expect(areTaskTitlesDistinct(tasks)).toBe(true);
    });
  });

  describe('validateTaskTitles()', () => {
    it('should validate all task titles', () => {
      const tasks = [
        createMockTask({ id: 'task_1', title: 'Search for information' }),
        createMockTask({ id: 'task_2', title: 'Analyze the results' }),
      ];

      const result = validateTaskTitles(tasks);

      expect(result.isValid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should detect invalid titles', () => {
      const tasks = [
        createMockTask({ id: 'task_1', title: 'Search for information' }),
        createMockTask({ id: 'task_2', title: '' }),
      ];

      const result = validateTaskTitles(tasks);

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should detect duplicate titles', () => {
      const tasks = [
        createMockTask({ id: 'task_1', title: 'Search for information' }),
        createMockTask({ id: 'task_2', title: 'Search for information' }),
      ];

      const result = validateTaskTitles(tasks);

      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.errors.some((err) => err.includes('distinct')))).toBe(true);
    });

    it('should detect tool names in titles', () => {
      const tasks = [
        createMockTask({ id: 'task_1', title: 'Execute web_search' }),
      ];

      const result = validateTaskTitles(tasks);

      expect(result.isValid).toBe(false);
    });
  });

  describe('generateTaskTitle()', () => {
    it('should generate title from context', () => {
      const title = generateTaskTitle('search for information');

      expect(title).toBeDefined();
      expect(title.length).toBeGreaterThan(0);
    });

    it('should remove tool names from context', () => {
      const title = generateTaskTitle('execute web_search for information');

      expect(title).not.toContain('web_search');
    });

    it('should capitalize first letter', () => {
      const title = generateTaskTitle('search for information');

      expect(title.charAt(0)).toBe('S');
    });

    it('should handle empty context', () => {
      const title = generateTaskTitle('');

      expect(title).toBe('Execute Task');
    });

    it('should handle context with only tool names', () => {
      const title = generateTaskTitle('web_search browser_use');

      expect(title).toBe('Execute Task');
    });
  });

  describe('sanitizeTaskTitle()', () => {
    it('should remove tool names', () => {
      const sanitized = sanitizeTaskTitle('Execute web_search for information');

      expect(sanitized).not.toContain('web_search');
      expect(sanitized).toContain('information');
    });

    it('should clean up extra whitespace', () => {
      const sanitized = sanitizeTaskTitle('Search   for   information');

      expect(sanitized).toBe('Search for information');
    });

    it('should return original if no tool names', () => {
      const original = 'Search for information';
      const sanitized = sanitizeTaskTitle(original);

      expect(sanitized).toBe(original);
    });

    it('should return original if empty after sanitization', () => {
      const original = 'web_search browser_use';
      const sanitized = sanitizeTaskTitle(original);

      expect(sanitized).toBe(original.trim());
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long titles', () => {
      const longTitle = 'Search for information about ' + 'x'.repeat(100);
      const result = validateTaskTitle(longTitle);

      expect(result.isValid).toBe(true);
    });

    it('should handle titles with special characters', () => {
      const title = 'Search for information (with special chars)';
      const result = validateTaskTitle(title);

      expect(result.isValid).toBe(true);
    });

    it('should handle titles with numbers', () => {
      const title = 'Search for 2024 information';
      const result = validateTaskTitle(title);

      expect(result.isValid).toBe(true);
    });

    it('should handle titles with punctuation', () => {
      const title = 'Search for information!';
      const result = validateTaskTitle(title);

      expect(result.isValid).toBe(true);
    });
  });
});
