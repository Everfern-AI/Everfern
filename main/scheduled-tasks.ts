import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface ScheduledTask {
  id: string;
  name?: string;
  description: string;
  cron: string;
  prompt: string;
  enabled: boolean;
  nextRun?: string;
  endsAt?: string;
  projectId?: string;
}

export class ScheduledTasksManager {
  private tasksFile: string;

  constructor() {
    this.tasksFile = path.join(os.homedir(), '.everfern', 'scheduled_tasks.json');
    if (!fs.existsSync(this.tasksFile)) {
      try {
        const dir = path.dirname(this.tasksFile);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(this.tasksFile, '[]', 'utf-8');
      } catch (err) {
        console.error('[ScheduledTasksManager] Failed to create tasks file:', err);
      }
    }
  }

  private loadTasks(): ScheduledTask[] {
    try {
      if (fs.existsSync(this.tasksFile)) {
        return JSON.parse(fs.readFileSync(this.tasksFile, 'utf-8'));
      }
    } catch (err) {
      console.error('[ScheduledTasksManager] Failed to load tasks:', err);
    }
    return [];
  }

  private saveTasks(tasks: ScheduledTask[]): void {
    try {
      fs.writeFileSync(this.tasksFile, JSON.stringify(tasks, null, 2), 'utf-8');
    } catch (err) {
      console.error('[ScheduledTasksManager] Failed to save tasks:', err);
    }
  }

  public listTasks(projectId?: string): ScheduledTask[] {
    const tasks = this.loadTasks();
    if (projectId) {
      return tasks.filter(t => t.projectId === projectId || !t.projectId);
    }
    return tasks;
  }

  public getTask(id: string): ScheduledTask | null {
    const tasks = this.loadTasks();
    return tasks.find(t => t.id === id) || null;
  }

  public saveTask(task: ScheduledTask): ScheduledTask {
    const tasks = this.loadTasks();
    const index = tasks.findIndex(t => t.id === task.id);
    if (index !== -1) {
      tasks[index] = task;
    } else {
      tasks.push(task);
    }
    this.saveTasks(tasks);
    return task;
  }

  public deleteTask(id: string): { success: boolean; error?: string } {
    try {
      let tasks = this.loadTasks();
      tasks = tasks.filter(t => t.id !== id);
      this.saveTasks(tasks);
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  public registerIpcHandlers(): void {
    ipcMain.handle('scheduled-tasks:list', (_event, projectId?: string) => {
      return this.listTasks(projectId);
    });

    ipcMain.handle('scheduled-tasks:get', (_event, id: string) => {
      return this.getTask(id);
    });

    ipcMain.handle('scheduled-tasks:save', (_event, task: ScheduledTask) => {
      return this.saveTask(task);
    });

    ipcMain.handle('scheduled-tasks:delete', (_event, id: string) => {
      return this.deleteTask(id);
    });
  }
}

export const scheduledTasksManager = new ScheduledTasksManager();
