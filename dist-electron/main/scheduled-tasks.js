"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduledTasksManager = exports.ScheduledTasksManager = void 0;
const electron_1 = require("electron");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
class ScheduledTasksManager {
    tasksFile;
    constructor() {
        this.tasksFile = path.join(os.homedir(), '.everfern', 'scheduled_tasks.json');
        if (!fs.existsSync(this.tasksFile)) {
            try {
                const dir = path.dirname(this.tasksFile);
                if (!fs.existsSync(dir))
                    fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(this.tasksFile, '[]', 'utf-8');
            }
            catch (err) {
                console.error('[ScheduledTasksManager] Failed to create tasks file:', err);
            }
        }
    }
    loadTasks() {
        try {
            if (fs.existsSync(this.tasksFile)) {
                return JSON.parse(fs.readFileSync(this.tasksFile, 'utf-8'));
            }
        }
        catch (err) {
            console.error('[ScheduledTasksManager] Failed to load tasks:', err);
        }
        return [];
    }
    saveTasks(tasks) {
        try {
            fs.writeFileSync(this.tasksFile, JSON.stringify(tasks, null, 2), 'utf-8');
        }
        catch (err) {
            console.error('[ScheduledTasksManager] Failed to save tasks:', err);
        }
    }
    listTasks(projectId) {
        const tasks = this.loadTasks();
        if (projectId) {
            return tasks.filter(t => t.projectId === projectId || !t.projectId);
        }
        return tasks;
    }
    getTask(id) {
        const tasks = this.loadTasks();
        return tasks.find(t => t.id === id) || null;
    }
    saveTask(task) {
        const tasks = this.loadTasks();
        const index = tasks.findIndex(t => t.id === task.id);
        if (index !== -1) {
            tasks[index] = task;
        }
        else {
            tasks.push(task);
        }
        this.saveTasks(tasks);
        return task;
    }
    deleteTask(id) {
        try {
            let tasks = this.loadTasks();
            tasks = tasks.filter(t => t.id !== id);
            this.saveTasks(tasks);
            return { success: true };
        }
        catch (err) {
            return { success: false, error: String(err) };
        }
    }
    registerIpcHandlers() {
        electron_1.ipcMain.handle('scheduled-tasks:list', (_event, projectId) => {
            return this.listTasks(projectId);
        });
        electron_1.ipcMain.handle('scheduled-tasks:get', (_event, id) => {
            return this.getTask(id);
        });
        electron_1.ipcMain.handle('scheduled-tasks:save', (_event, task) => {
            return this.saveTask(task);
        });
        electron_1.ipcMain.handle('scheduled-tasks:delete', (_event, id) => {
            return this.deleteTask(id);
        });
    }
}
exports.ScheduledTasksManager = ScheduledTasksManager;
exports.scheduledTasksManager = new ScheduledTasksManager();
