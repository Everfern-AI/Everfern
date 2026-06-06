import { TaskState, TaskResult, ExecutionPlan, OperatorTask } from './types';

export class TaskGraphManager {
    private tasks: Map<string, OperatorTask> = new Map();
    private states: Map<string, TaskState> = new Map();
    private adjacencyList: Map<string, string[]> = new Map(); // taskId -> dependents

    constructor() {}

    buildFromPlan(plan: ExecutionPlan) {
        this.tasks.clear();
        this.states.clear();
        this.adjacencyList.clear();

        for (const task of plan.tasks) {
            this.tasks.set(task.taskId, task);
            this.states.set(task.taskId, {
                status: 'pending',
                attempts: 0
            });
            this.adjacencyList.set(task.taskId, []);
        }

        // Add linear dependencies for now since our planning engine v1 just creates a sequential list
        for (let i = 0; i < plan.tasks.length - 1; i++) {
            const currentId = plan.tasks[i].taskId;
            const nextId = plan.tasks[i+1].taskId;
            this.adjacencyList.get(currentId)?.push(nextId);
        }
    }

    updateTaskState(taskId: string, state: Partial<TaskState>) {
        const existing = this.states.get(taskId);
        if (existing) {
            this.states.set(taskId, { ...existing, ...state });
        }
    }

    getTaskState(taskId: string): TaskState | undefined {
        return this.states.get(taskId);
    }

    getReadyTasks(): OperatorTask[] {
        const ready: OperatorTask[] = [];
        
        for (const [taskId, task] of this.tasks.entries()) {
            const state = this.states.get(taskId);
            if (state?.status === 'pending') {
                if (this.isTaskReady(taskId)) {
                    ready.push(task);
                }
            }
        }
        
        return ready;
    }

    isTaskReady(taskId: string): boolean {
        // A task is ready if all tasks that point to it (dependencies) are completed
        for (const [id, dependents] of this.adjacencyList.entries()) {
            if (dependents.includes(taskId)) {
                const depState = this.states.get(id);
                if (depState?.status !== 'completed' && depState?.status !== 'skipped') {
                    return false;
                }
            }
        }
        return true;
    }

    isGraphComplete(): boolean {
        for (const state of this.states.values()) {
            if (state.status !== 'completed' && state.status !== 'skipped') {
                return false;
            }
        }
        return true;
    }

    serialize(): any {
        return {
            tasks: Array.from(this.tasks.entries()),
            states: Array.from(this.states.entries()),
            adjacencyList: Array.from(this.adjacencyList.entries())
        };
    }

    deserialize(data: any) {
        this.tasks = new Map(data.tasks);
        this.states = new Map(data.states);
        this.adjacencyList = new Map(data.adjacencyList);
    }
}
