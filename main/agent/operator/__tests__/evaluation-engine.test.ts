import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EvaluationEngine } from '../evaluation-engine';
import { OperatorTask, TaskResult, GoalDefinition } from '../types';
import { AIClient } from '../../../lib/ai-client';

describe('EvaluationEngine', () => {
    let mockClient: unknown;
    let engine: EvaluationEngine;

    const mockGoal: GoalDefinition = {
        description: 'Test Goal',
        id: 'g1',
        createdAt: Date.now()
    };

    const mockTask: OperatorTask = {
        taskId: 't1',
        description: 'Test Task',
        executorType: 'web_explorer',
        successCriteria: ['Criteria 1']
    };

    beforeEach(() => {
        mockClient = {
            chat: vi.fn()
        };
        engine = new EvaluationEngine(mockClient as AIClient);
    });

    it('returns failure evaluation when task result is not successful', async () => {
        const result: TaskResult = {
            taskId: 't1',
            success: false,
            error: new Error('Failed!'),
            output: null,
            durationMs: 100
        };

        const evalResult = await engine.evaluateProgress(mockTask, result, mockGoal);
        
        expect(evalResult.progressScore).toBe(0);
        expect(evalResult.goalDistance).toBe(1);
        expect(evalResult.unexpectedOutcomes[0].description).toBe('Failed!');
        expect((mockClient as any).chat).not.toHaveBeenCalled();
    });

    it('calls AI to evaluate successful task results', async () => {
        const result: TaskResult = {
            taskId: 't1',
            success: true,
            output: 'Success output',
            durationMs: 100
        };

        vi.mocked((mockClient as any).chat).mockResolvedValue({
            content: JSON.stringify({
                progressScore: 0.8,
                goalDistance: 0.2,
                confidenceLevel: 0.9,
                unexpectedOutcomes: [],
                metricsAchieved: { test: true },
                reasoning: 'Good job'
            })
        });

        const evalResult = await engine.evaluateProgress(mockTask, result, mockGoal);

        expect((mockClient as any).chat).toHaveBeenCalled();
        expect(evalResult.progressScore).toBe(0.8);
        expect(evalResult.goalDistance).toBe(0.2);
        expect(evalResult.reasoning).toBe('Good job');
    });

    it('falls back to default evaluation if AI fails to parse', async () => {
        const result: TaskResult = {
            taskId: 't1',
            success: true,
            output: 'Success output',
            durationMs: 100
        };

        vi.mocked((mockClient as any).chat).mockRejectedValue(new Error('API Error'));

        const evalResult = await engine.evaluateProgress(mockTask, result, mockGoal);

        expect(evalResult.progressScore).toBe(0.5);
        expect(evalResult.reasoning).toBe('Fallback evaluation (AI parsing failed).');
    });

    it('determines if replan is needed based on evaluation history', () => {
        expect(engine.shouldReplan([])).toBe(false);
        
        expect(engine.shouldReplan([
            { progressScore: 0.8 } as any,
            { progressScore: 0.1 } as any
        ])).toBe(false);

        expect(engine.shouldReplan([
            { progressScore: 0.8 } as any,
            { progressScore: 0.1 } as any,
            { progressScore: 0.1 } as any
        ])).toBe(true);
    });
});
