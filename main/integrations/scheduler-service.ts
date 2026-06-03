/**
 * EverFern Desktop — Scheduler Service
 *
 * Manages the execution of scheduled tasks.
 */

import { scheduledTasksStore, ScheduledTask } from '../store/scheduled-tasks';
import { AgentRunner } from '../agent/runner/runner';
import { getPooledAIClient } from '../lib/ai-client';
import { ChatHistoryStore } from '../store/history';
import * as crypto from 'crypto';

export class SchedulerService {
  private interval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private runningTasks: Set<string> = new Set();

  /**
   * Start the scheduler.
   */
  start() {
    if (this.interval) return;

    console.log('[Scheduler] Starting scheduler service...');
    // Check every minute
    this.interval = setInterval(() => this.checkTasks(), 60000);
    this.checkTasks(); // Initial check
  }

  /**
   * Stop the scheduler.
   */
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /**
   * Check for tasks that need to be run.
   */
  private async checkTasks() {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      const tasks = await scheduledTasksStore.list();
      const now = new Date();

      for (const task of tasks) {
        if (!task.enabled) continue;

        // Check if task has expired
        if (task.endsAt && new Date() > new Date(task.endsAt)) {
          console.log(`[Scheduler] 🏁 Task expired: ${task.description} (${task.id})`);
          await scheduledTasksStore.save({ id: task.id, enabled: false });
          continue;
        }

        if (this.shouldRun(task, now)) {
          if (!this.runningTasks.has(task.id)) {
            // Do not await, let it run in background to allow other tasks to start
            this.runTask(task).catch(err => console.error('[Scheduler] runTask error:', err));
          } else {
            console.log(`[Scheduler] ⏳ Task ${task.id} is already running, skipping this interval.`);
          }
        }
      }
    } catch (err) {
      console.error('[Scheduler] Error checking tasks:', err);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Determine if a task should run now.
   */
  private shouldRun(task: ScheduledTask, now: Date): boolean {
    // 1. If explicitly disabled, don't run
    if (!task.enabled) return false;

    // 2. If it has a nextRun time and we've reached it, run it
    if (task.nextRun && now >= new Date(task.nextRun)) {
      return true;
    }

    // 3. If it has NO nextRun (new task) and NO lastRun, 
    // it might be due if now >= startsAt
    if (!task.nextRun && !task.lastRun) {
      if (task.startsAt && now >= new Date(task.startsAt)) {
        return true;
      }
      // If not due yet, initialize its nextRun so the UI/scheduler knows
      const nextRun = SchedulerService.calculateNextRun(task.cron, undefined, task.startsAt);
      scheduledTasksStore.updateRunTimes(task.id, '', nextRun.toISOString());
      return false;
    }

    return false;
  }

  /**
   * Calculate the next run time based on frequency.
   * Static so it can be used by the Store or other services.
   */
  public static calculateNextRun(cron: string, lastRun?: Date, startsAt?: string): Date {
    const now = new Date();
    let baseDate: Date;

    if (lastRun) {
      baseDate = new Date(lastRun);
    } else if (startsAt) {
      baseDate = new Date(startsAt);
    } else {
      baseDate = now;
    }

    const next = new Date(baseDate);

    if (cron === 'daily') {
      if (startsAt) {
        const startTime = new Date(startsAt);
        next.setHours(startTime.getHours(), startTime.getMinutes(), 0, 0);
      }
      
      // If it already ran at this time, or this time has already passed today
      if ((lastRun && next <= baseDate) || next <= now) {
        next.setDate(next.getDate() + 1);
      }
    } else if (cron.startsWith('weekly:')) {
      const dayName = cron.split(':')[1].toLowerCase();
      const days: Record<string, number> = {
        sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6
      };
      const targetDay = days[dayName];
      
      if (targetDay !== undefined) {
        if (startsAt) {
          const startTime = new Date(startsAt);
          next.setHours(startTime.getHours(), startTime.getMinutes(), 0, 0);
        }
        
        // Find next occurrence of that day
        let diff = targetDay - next.getDay();
        if (diff < 0 || (diff === 0 && ((lastRun && next <= baseDate) || next <= now))) {
          diff += 7;
        }
        next.setDate(next.getDate() + diff);
      }
    } else if (cron.startsWith('every ')) {
      const parts = cron.split(' ');
      const value = parseInt(parts[1]);
      const unit = parts[2];

      if (unit.startsWith('minute')) {
        next.setMinutes(next.getMinutes() + value);
      } else if (unit.startsWith('hour')) {
        next.setHours(next.getHours() + value);
      } else if (unit.startsWith('day')) {
        next.setDate(next.getDate() + value);
      }

      // Ensure we don't return a time in the past if no lastRun
      while (!lastRun && next <= now) {
        if (unit.startsWith('minute')) next.setMinutes(next.getMinutes() + value);
        else if (unit.startsWith('hour')) next.setHours(next.getHours() + value);
        else if (unit.startsWith('day')) next.setDate(next.getDate() + value);
      }
    } else {
      // Default fallback
      next.setHours(next.getHours() + 1);
    }

    return next;
  }

  private async runTask(task: ScheduledTask, attempt: number = 1) {
    if (this.runningTasks.has(task.id) && attempt === 1) return;
    this.runningTasks.add(task.id);
    
    console.log(`[Scheduler] 🏃 Running task: ${task.name || task.description} (${task.id}) - Attempt ${attempt}`);

    try {
      // 1. Create a new conversation for this task
      const conversationId = `scheduled-${task.id}-${Date.now()}`;
      const historyStore = new ChatHistoryStore();
      
      await historyStore.save({
        id: conversationId,
        title: `Scheduled: ${task.name || task.description}`,
        projectId: task.projectId,
        provider: 'ollama',
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      // 2. Initialize AgentRunner
      const client = getPooledAIClient({ provider: 'ollama', model: 'llama3' });
      const runner = new AgentRunner(client);

      // 3. Update next run time IMMEDIATELY to prevent double execution 
      // if the checkTasks interval hits again before updating
      if (attempt === 1) {
        const now = new Date();
        const nextRun = SchedulerService.calculateNextRun(task.cron, now, task.startsAt);
        await scheduledTasksStore.updateRunTimes(task.id, now.toISOString(), nextRun.toISOString());
      }

      // 4. Run the prompt in the background
      console.log(`[Scheduler] 🤖 Agent starting task execution...`);
      
      const MAX_RETRIES = 3;

      (async () => {
        try {
          const stream = runner.runStream(task.prompt, [], client.model, conversationId, undefined, task.projectId, false, undefined, true);
          for await (const event of stream) {
            // Processing...
          }
          console.log(`[Scheduler] ✅ Task completed: ${task.name || task.description}`);
          this.runningTasks.delete(task.id);
        } catch (err) {
          console.error(`[Scheduler] ❌ Task failed: ${task.name || task.description}`, err);
          this.runningTasks.delete(task.id);
          
          if (attempt < MAX_RETRIES) {
            const delayMs = Math.pow(2, attempt) * 5000; // 10s, 20s
            console.log(`[Scheduler] 🔄 Retrying task ${task.id} in ${delayMs}ms (Attempt ${attempt + 1}/${MAX_RETRIES})...`);
            setTimeout(() => this.runTask(task, attempt + 1), delayMs);
          }
        }
      })();

    } catch (err) {
      console.error(`[Scheduler] Failed to start task ${task.id}:`, err);
      this.runningTasks.delete(task.id);
    }
  }
}

export const schedulerService = new SchedulerService();
