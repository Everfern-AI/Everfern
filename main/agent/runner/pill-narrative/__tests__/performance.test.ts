/**
 * Performance Tests for Pill-Based Narrative Timeline
 *
 * Tests performance optimizations and validates that the system
 * can handle large timelines efficiently.
 *
 * **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7**
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MemoizedStatusCalculator,
  LazyToolCallLoader,
  VirtualScroller,
  BatchStatusUpdater,
  PerformanceMonitor,
} from '../performance';
import type { ToolPill, Task } from '../types';

describe('Performance Optimizations', () => {
  describe('MemoizedStatusCalculator', () => {
    let calculator: MemoizedStatusCalculator;

    beforeEach(() => {
      calculator = new MemoizedStatusCalculator();
    });

    it('should calculate task status correctly', () => {
      const pills: ToolPill[] = [
        { id: 'p1', toolName: 'web_search', status: 'completed' },
        { id: 'p2', toolName: 'browser_use', status: 'completed' },
      ];

      const status = calculator.calculateTaskStatus('task_1', pills);
      expect(status).toBe('completed');
    });

    it('should return failed status if any pill fails', () => {
      const pills: ToolPill[] = [
        { id: 'p1', toolName: 'web_search', status: 'completed' },
        { id: 'p2', toolName: 'browser_use', status: 'failed' },
      ];

      const status = calculator.calculateTaskStatus('task_1', pills);
      expect(status).toBe('failed');
    });

    it('should return in-progress status if any pill is in-progress', () => {
      const pills: ToolPill[] = [
        { id: 'p1', toolName: 'web_search', status: 'completed' },
        { id: 'p2', toolName: 'browser_use', status: 'in-progress' },
      ];

      const status = calculator.calculateTaskStatus('task_1', pills);
      expect(status).toBe('in-progress');
    });

    it('should cache results for identical inputs', () => {
      const pills: ToolPill[] = [
        { id: 'p1', toolName: 'web_search', status: 'completed' },
        { id: 'p2', toolName: 'browser_use', status: 'completed' },
      ];

      const status1 = calculator.calculateTaskStatus('task_1', pills);
      const status2 = calculator.calculateTaskStatus('task_1', pills);

      expect(status1).toBe(status2);
      expect(calculator.getCacheSize()).toBeGreaterThan(0);
    });

    it('should calculate timeline status correctly', () => {
      const tasks: Task[] = [
        {
          id: 't1',
          title: 'Task 1',
          pills: [],
          status: 'completed',
        },
        {
          id: 't2',
          title: 'Task 2',
          pills: [],
          status: 'completed',
        },
      ];

      const status = calculator.calculateTimelineStatus('timeline_1', tasks);
      expect(status).toBe('completed');
    });

    it('should clear cache', () => {
      const pills: ToolPill[] = [
        { id: 'p1', toolName: 'web_search', status: 'completed' },
      ];

      calculator.calculateTaskStatus('task_1', pills);
      expect(calculator.getCacheSize()).toBeGreaterThan(0);

      calculator.clearCache();
      expect(calculator.getCacheSize()).toBe(0);
    });
  });

  describe('LazyToolCallLoader', () => {
    let loader: LazyToolCallLoader;

    beforeEach(() => {
      loader = new LazyToolCallLoader();
    });

    it('should track loaded pills', () => {
      expect(loader.isLoaded('pill_1')).toBe(false);

      loader.markLoaded('pill_1');
      expect(loader.isLoaded('pill_1')).toBe(true);
    });

    it('should track loading pills', () => {
      expect(loader.isLoading('pill_1')).toBe(false);

      loader.markLoading('pill_1');
      expect(loader.isLoading('pill_1')).toBe(true);

      loader.markLoaded('pill_1');
      expect(loader.isLoading('pill_1')).toBe(false);
    });

    it('should count loaded pills', () => {
      loader.markLoaded('pill_1');
      loader.markLoaded('pill_2');
      loader.markLoaded('pill_3');

      expect(loader.getLoadedCount()).toBe(3);
    });

    it('should clear loaded pills', () => {
      loader.markLoaded('pill_1');
      loader.markLoaded('pill_2');

      loader.clearLoaded();
      expect(loader.getLoadedCount()).toBe(0);
    });
  });

  describe('VirtualScroller', () => {
    let scroller: VirtualScroller;

    beforeEach(() => {
      scroller = new VirtualScroller(100, 600);
    });

    it('should calculate visible range', () => {
      scroller.setScrollTop(0);
      const range = scroller.getVisibleRange(100);

      expect(range.start).toBeLessThanOrEqual(range.end);
      expect(range.end).toBeLessThanOrEqual(100);
    });

    it('should update visible range on scroll', () => {
      scroller.setScrollTop(0);
      const range1 = scroller.getVisibleRange(100);

      scroller.setScrollTop(500);
      const range2 = scroller.getVisibleRange(100);

      expect(range2.start).toBeGreaterThan(range1.start);
    });

    it('should calculate item offset', () => {
      const offset = scroller.getItemOffset(5);
      expect(offset).toBe(500); // 5 * 100
    });

    it('should calculate total height', () => {
      const height = scroller.getTotalHeight(100);
      expect(height).toBe(10000); // 100 * 100
    });

    it('should handle scroll bounds', () => {
      scroller.setScrollTop(-100);
      expect(scroller.getVisibleRange(100).start).toBeGreaterThanOrEqual(0);

      scroller.setScrollTop(100000);
      const range = scroller.getVisibleRange(100);
      expect(range.end).toBeLessThanOrEqual(100);
    });
  });

  describe('BatchStatusUpdater', () => {
    it('should batch updates', async () => {
      const updates: any[] = [];
      const updater = new BatchStatusUpdater(5, 100, (batch) => {
        updates.push(...batch);
      });

      updater.addUpdate('mission_1', 'task_1', 'pill_1', 'completed');
      updater.addUpdate('mission_1', 'task_1', 'pill_2', 'completed');

      expect(updater.getPendingCount()).toBe(2);

      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(updates.length).toBe(2);
    });

    it('should flush when batch size is reached', async () => {
      const updates: any[] = [];
      const updater = new BatchStatusUpdater(2, 1000, (batch) => {
        updates.push(...batch);
      });

      updater.addUpdate('mission_1', 'task_1', 'pill_1', 'completed');
      updater.addUpdate('mission_1', 'task_1', 'pill_2', 'completed');

      // Should flush immediately when batch size is reached
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(updates.length).toBe(2);
      expect(updater.getPendingCount()).toBe(0);
    });

    it('should flush manually', () => {
      const updates: any[] = [];
      const updater = new BatchStatusUpdater(10, 1000, (batch) => {
        updates.push(...batch);
      });

      updater.addUpdate('mission_1', 'task_1', 'pill_1', 'completed');
      updater.addUpdate('mission_1', 'task_1', 'pill_2', 'completed');

      updater.flush();

      expect(updates.length).toBe(2);
      expect(updater.getPendingCount()).toBe(0);
    });
  });

  describe('PerformanceMonitor', () => {
    let monitor: PerformanceMonitor;

    beforeEach(() => {
      monitor = new PerformanceMonitor();
    });

    it('should measure timing', () => {
      monitor.startTiming('operation');

      // Simulate work
      let sum = 0;
      for (let i = 0; i < 1000000; i++) {
        sum += i;
      }

      const duration = monitor.endTiming('operation');
      expect(duration).toBeGreaterThan(0);
    });

    it('should calculate average time', () => {
      monitor.startTiming('op1');
      for (let i = 0; i < 100000; i++) {
        // work
      }
      monitor.endTiming('op1');

      monitor.startTiming('op1');
      for (let i = 0; i < 100000; i++) {
        // work
      }
      monitor.endTiming('op1');

      const avg = monitor.getAverageTime('op1');
      expect(avg).toBeGreaterThan(0);
    });

    it('should track max and min times', () => {
      monitor.startTiming('op');
      monitor.endTiming('op');

      monitor.startTiming('op');
      for (let i = 0; i < 100000; i++) {
        // work
      }
      monitor.endTiming('op');

      const max = monitor.getMaxTime('op');
      const min = monitor.getMinTime('op');

      expect(max).toBeGreaterThanOrEqual(min);
    });

    it('should get all metrics', () => {
      monitor.startTiming('op1');
      monitor.endTiming('op1');

      monitor.startTiming('op2');
      monitor.endTiming('op2');

      const metrics = monitor.getAllMetrics();
      expect(Object.keys(metrics).length).toBe(2);
      expect(metrics['op1']).toBeDefined();
      expect(metrics['op2']).toBeDefined();
    });

    it('should clear metrics', () => {
      monitor.startTiming('op');
      monitor.endTiming('op');

      expect(Object.keys(monitor.getAllMetrics()).length).toBeGreaterThan(0);

      monitor.clearMetrics();
      expect(Object.keys(monitor.getAllMetrics()).length).toBe(0);
    });
  });

  describe('Large Timeline Performance', () => {
    it('should handle 100+ pills efficiently', () => {
      const monitor = new PerformanceMonitor();
      const calculator = new MemoizedStatusCalculator();

      // Create 100 pills
      const pills: ToolPill[] = [];
      for (let i = 0; i < 100; i++) {
        pills.push({
          id: `pill_${i}`,
          toolName: 'web_search',
          status: i % 2 === 0 ? 'completed' : 'pending',
        });
      }

      // Measure status calculation
      monitor.startTiming('status_calculation');
      const status = calculator.calculateTaskStatus('task_1', pills);
      const duration = monitor.endTiming('status_calculation');

      expect(status).toBeDefined();
      expect(duration).toBeLessThan(10); // Should be very fast
    });

    it('should handle virtual scrolling with 1000 items', () => {
      const scroller = new VirtualScroller(100, 600);

      // Simulate scrolling through 1000 items
      const startTime = performance.now();

      for (let i = 0; i < 1000; i += 100) {
        scroller.setScrollTop(i);
        scroller.getVisibleRange(1000);
      }

      const duration = performance.now() - startTime;
      expect(duration).toBeLessThan(100); // Should be very fast
    });

    it('should batch 1000 updates efficiently', async () => {
      const updates: any[] = [];
      const updater = new BatchStatusUpdater(100, 50, (batch) => {
        updates.push(...batch);
      });

      const startTime = performance.now();

      // Add 1000 updates
      for (let i = 0; i < 1000; i++) {
        updater.addUpdate(`mission_${i % 10}`, `task_${i % 100}`, `pill_${i}`, 'completed');
      }

      updater.flush();

      const duration = performance.now() - startTime;

      expect(updates.length).toBe(1000);
      expect(duration).toBeLessThan(100); // Should be very fast
    });
  });
});
