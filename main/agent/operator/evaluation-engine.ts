import { GoalDefinition, OperatorSession, OperatorTask, TaskResult } from './types';
import { AIClient } from '../../lib/ai-client';

export interface EvaluationResult {
  taskId: string;
  timestamp: number;
  progressScore: number; // 0.0 to 1.0, higher = more progress
  goalDistance: number; // 0.0 = goal achieved, 1.0 = no progress
  confidenceLevel: number; // 0.0 to 1.0
  unexpectedOutcomes: any[];
  metricsAchieved: Record<string, any>;
  reasoning: string;
}

const EVALUATION_PROMPT = `You are the Operator Evaluation Engine.
Your job is to assess the progress of an executed task against its success criteria and the overall goal.

OVERALL GOAL: "{GOAL}"
TASK: "{TASK_DESC}"
SUCCESS CRITERIA: {CRITERIA}

ACTUAL RESULT:
"{RESULT}"

Respond with ONLY valid JSON in this format:
{
  "progressScore": 0.8,
  "goalDistance": 0.5,
  "confidenceLevel": 0.9,
  "metricsAchieved": {"signups": 10},
  "unexpectedOutcomes": [],
  "reasoning": "The task succeeded and brought us closer to the goal."
}
`;

function extractJSONObject(text: string): string | null {
    let cleaned = text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
    const match = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (match) cleaned = match[1].trim();
    
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace) {
        return cleaned.substring(firstBrace, lastBrace + 1);
    }
    return null;
}

export class EvaluationEngine {
    constructor(private client: AIClient) {}

    async evaluateProgress(task: OperatorTask, result: TaskResult, goal: GoalDefinition): Promise<EvaluationResult> {
        if (!result.success) {
            return {
                taskId: task.taskId,
                timestamp: Date.now(),
                progressScore: 0,
                goalDistance: 1,
                confidenceLevel: 1,
                unexpectedOutcomes: [{ type: 'error', description: result.error?.message || 'Task failed' }],
                metricsAchieved: {},
                reasoning: 'Task failed to execute successfully.'
            };
        }

        const prompt = EVALUATION_PROMPT
            .replace('{GOAL}', goal.description)
            .replace('{TASK_DESC}', task.description)
            .replace('{CRITERIA}', JSON.stringify(task.successCriteria))
            .replace('{RESULT}', JSON.stringify(result.output));

        try {
            const response = await this.client.chat({
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.1,
                maxTokens: 1000
            }) as any;

            const content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content || '');
            const jsonStr = extractJSONObject(content);

            if (jsonStr) {
                const parsed = JSON.parse(jsonStr);
                return {
                    taskId: task.taskId,
                    timestamp: Date.now(),
                    progressScore: parsed.progressScore || 0,
                    goalDistance: parsed.goalDistance || 1,
                    confidenceLevel: parsed.confidenceLevel || 0.5,
                    unexpectedOutcomes: parsed.unexpectedOutcomes || [],
                    metricsAchieved: parsed.metricsAchieved || {},
                    reasoning: parsed.reasoning || 'Evaluated successfully.'
                };
            }
        } catch (err) {
            console.warn(`[EvaluationEngine] Failed to evaluate: ${err}`);
        }

        // Fallback
        return {
            taskId: task.taskId,
            timestamp: Date.now(),
            progressScore: 0.5,
            goalDistance: 0.5,
            confidenceLevel: 0.5,
            unexpectedOutcomes: [],
            metricsAchieved: {},
            reasoning: 'Fallback evaluation (AI parsing failed).'
        };
    }

    shouldReplan(evaluationHistory: EvaluationResult[]): boolean {
        if (evaluationHistory.length < 2) return false;
        
        // If the last 2 evaluations show 0 progress score, trigger replan
        const lastTwo = evaluationHistory.slice(-2);
        return lastTwo.every(e => e.progressScore < 0.2);
    }
}
