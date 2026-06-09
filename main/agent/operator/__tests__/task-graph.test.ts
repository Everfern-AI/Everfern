import { describe, it, expect, beforeEach } from 'vitest';
import { TaskGraphManager } from '../task-graph';
import { OperatorTask, ExecutionPlan } from '../types';

describe('TaskGraphManager', () => {
    let manager: TaskGraphManager;

    beforeEach(() => {
        manager = new TaskGraphManager();
    });

    const createMockPlan = (): ExecutionPlan => ({
        id: 'plan-1',
        tasks: [
            { taskId: 't1', description: 'Task 1', executorType: 'web_explorer', successCriteria: [] },
            { taskId: 't2', description: 'Task 2', executorType: 'data_analyst', successCriteria: [] },
            { taskId: 't3', description: 'Task 3', executorType: 'coding_specialist', successCriteria: [] }
        ],
        createdAt: Date.now()
    });

    it('builds a graph with linear dependencies from plan', () => {
        const plan = createMockPlan();
        manager.buildFromPlan(plan);

        expect(manager.getTaskState('t1')?.status).toBe('pending');
        expect(manager.getTaskState('t2')?.status).toBe('pending');
        expect(manager.getTaskState('t3')?.status).toBe('pending');
        
        // t1 is ready since nothing points to it
        expect(manager.isTaskReady('t1')).toBe(true);
        // t2 is not ready because t1 points to it
        expect(manager.isTaskReady('t2')).toBe(false);
    });

    it('returns ready tasks correctly', () => {
        manager.buildFromPlan(createMockPlan());

        let ready = manager.getReadyTasks();
        expect(ready.length).toBe(1);
        expect(ready[0].taskId).toBe('t1');

        manager.updateTaskState('t1', { status: 'completed' });

        ready = manager.getReadyTasks();
        expect(ready.length).toBe(1);
        expect(ready[0].taskId).toBe('t2');

        manager.updateTaskState('t2', { status: 'skipped' });

        ready = manager.getReadyTasks();
        expect(ready.length).toBe(1);
        expect(ready[0].taskId).toBe('t3');
    });

    it('identifies when graph is complete', () => {
        manager.buildFromPlan(createMockPlan());
        expect(manager.isGraphComplete()).toBe(false);

        manager.updateTaskState('t1', { status: 'completed' });
        manager.updateTaskState('t2', { status: 'completed' });
        expect(manager.isGraphComplete()).toBe(false);

        manager.updateTaskState('t3', { status: 'completed' });
        expect(manager.isGraphComplete()).toBe(true);
    });

    it('serializes and deserializes graph state', () => {
        manager.buildFromPlan(createMockPlan());
        manager.updateTaskState('t1', { status: 'in_progress', attempts: 1 });

        const data = manager.serialize();
        
        const newManager = new TaskGraphManager();
        newManager.deserialize(data);

        expect(newManager.getTaskState('t1')).toEqual({ status: 'in_progress', attempts: 1 });
        expect(newManager.getTaskState('t2')).toEqual({ status: 'pending', attempts: 0 });
        expect(newManager.isTaskReady('t1')).toBe(true);
        expect(newManager.isTaskReady('t2')).toBe(false);
    });
});
