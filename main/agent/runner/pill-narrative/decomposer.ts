/**
 * Pill-Based Task Decomposer
 *
 * This module provides the PillBasedTaskDecomposer class which transforms
 * user requests into pill-based narrative timelines with business-focused tasks
 * and tool pills representing individual tool executions.
 */

import {
  NarrativeTimeline,
  Task,
  ToolPill,
  ExecutionStatus,
} from './types';

// AIClient type - can be any object with chat method
export interface AIClient {
  chat(request: any): Promise<any>;
}

/**
 * Interface for AI-generated task structure
 */
interface AIGeneratedTask {
  title: string;
  description?: string;
  pills: Array<{
    toolName: string;
    label?: string;
    icon?: string;
    dependsOn?: string[];
  }>;
}

/**
 * PillBasedTaskDecomposer generates pill-based narrative timelines from user requests
 */
export class PillBasedTaskDecomposer {
  private client: AIClient;

  constructor(client: AIClient) {
    this.client = client;
  }

  /**
   * Decompose a user request into a pill-based narrative timeline
   */
  async decompose(userRequest: string, missionId: string): Promise<NarrativeTimeline> {
    // Generate tasks from the user request
    const tasks = await this.generateTasks(userRequest);

    // Create the narrative timeline
    const timeline: NarrativeTimeline = {
      missionId,
      tasks,
      status: 'pending',
      startTime: Date.now(),
      metadata: {
        userRequest,
        agent: 'pill-based-decomposer',
      },
    };

    return timeline;
  }

  /**
   * Generate tasks with business-focused titles from a user request
   */
  async generateTasks(userRequest: string): Promise<Task[]> {
    const prompt = `Decompose this user request into business-focused tasks. Each task should have a clear, non-technical title that describes what will be accomplished.

Respond with ONLY a valid JSON array of tasks (no markdown, no explanation):

[
  {
    "title": "Business-focused task title",
    "description": "Optional description of what this task accomplishes",
    "pills": [
      {"toolName": "web_search", "label": "Search", "icon": "🔍"},
      {"toolName": "browser_use", "label": "Browse", "icon": "🌐", "dependsOn": ["web_search"]}
    ]
  }
]

User request: "${userRequest.slice(0, 500)}"

Requirements:
- Task titles should be business-focused (e.g., "Search for Discord bots" not "Execute web_search")
- Avoid technical jargon in titles
- Group related tool executions under common tasks
- Include dependencies between pills where appropriate
- Each pill should have a toolName (web_search, browser_use, read_file, write_file, python_execute, terminal_execute, etc.)
- Provide appropriate labels and icons for each pill

Respond with ONLY the JSON array, nothing else.`;

    try {
      const response = await this.client.chat({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        maxTokens: 2000,
      }) as any;

      const rawContent = (typeof response.content === 'string' ? response.content : JSON.stringify(response.content || '')).trim();

      // Extract JSON array
      const firstBracket = rawContent.indexOf('[');
      const lastBracket = rawContent.lastIndexOf(']');
      if (firstBracket !== -1 && lastBracket !== -1 && lastBracket >= firstBracket) {
        const jsonStr = rawContent.substring(firstBracket, lastBracket + 1);
        const aiTasks = JSON.parse(jsonStr) as AIGeneratedTask[];

        if (Array.isArray(aiTasks) && aiTasks.length > 0) {
          return this.convertAITasksToTasks(aiTasks);
        }
      }

      throw new Error('No valid JSON array found in response');
    } catch (err) {
      console.warn(`[PillBasedTaskDecomposer] generateTasks failed: ${err instanceof Error ? err.message : String(err)}`);
      // Fallback: create a single generic task
      return this.createFallbackTasks(userRequest);
    }
  }

  /**
   * Convert AI-generated tasks to Task objects with pills
   */
  private convertAITasksToTasks(aiTasks: AIGeneratedTask[]): Task[] {
    return aiTasks.map((aiTask, taskIndex) => {
      const taskId = `task_${taskIndex + 1}`;
      const pills = this.generatePills(aiTask.pills, taskId);

      const task: Task = {
        id: taskId,
        title: this.validateTaskTitle(aiTask.title),
        description: aiTask.description,
        pills,
        status: 'pending',
      };

      return task;
    });
  }

  /**
   * Generate pills for a task
   */
  private generatePills(aiPills: Array<{ toolName: string; label?: string; icon?: string; dependsOn?: string[] }>, taskId: string): ToolPill[] {
    return aiPills.map((aiPill, pillIndex) => {
      const pillId = `${taskId}_pill_${pillIndex + 1}`;

      const pill: ToolPill = {
        id: pillId,
        toolName: aiPill.toolName,
        status: 'pending',
        label: aiPill.label || this.generateDefaultLabel(aiPill.toolName),
        icon: aiPill.icon || this.generateDefaultIcon(aiPill.toolName),
        dependsOn: aiPill.dependsOn ? this.mapDependencies(aiPill.dependsOn, taskId) : undefined,
      };

      return pill;
    });
  }

  /**
   * Map dependency references to actual pill IDs
   */
  private mapDependencies(dependsOn: string[], taskId: string): string[] {
    return dependsOn.map((dep) => {
      // If it's already a full pill ID, return as-is
      if (dep.includes('_pill_')) {
        return dep;
      }
      // Otherwise, assume it's a tool name and convert to pill ID
      // This is a simplified mapping - in practice, you'd need more context
      return `${taskId}_pill_${dep}`;
    });
  }

  /**
   * Generate a default label for a tool
   */
  private generateDefaultLabel(toolName: string): string {
    const labels: Record<string, string> = {
      web_search: 'Search',
      browser_use: 'Browse',
      read_file: 'Read',
      write_file: 'Write',
      python_execute: 'Execute',
      terminal_execute: 'Terminal',
      computer_use: 'Computer',
      file_read: 'Read',
      file_write: 'Write',
    };
    return labels[toolName] || toolName;
  }

  /**
   * Generate a default icon for a tool
   */
  private generateDefaultIcon(toolName: string): string {
    const icons: Record<string, string> = {
      web_search: '🔍',
      browser_use: '🌐',
      read_file: '📖',
      write_file: '✍️',
      python_execute: '🐍',
      terminal_execute: '⌨️',
      computer_use: '💻',
      file_read: '📖',
      file_write: '✍️',
    };
    return icons[toolName] || '⚙️';
  }

  /**
   * Validate and clean task title
   */
  private validateTaskTitle(title: string): string {
    // Ensure title is non-empty
    if (!title || title.trim().length === 0) {
      return 'Execute Task';
    }

    // Remove any tool names from the title
    const toolNames = [
      'web_search',
      'browser_use',
      'read_file',
      'write_file',
      'python_execute',
      'terminal_execute',
      'computer_use',
      'file_read',
      'file_write',
    ];

    let cleanedTitle = title.trim();
    for (const toolName of toolNames) {
      const regex = new RegExp(`\\b${toolName}\\b`, 'gi');
      cleanedTitle = cleanedTitle.replace(regex, '');
    }

    // Clean up extra whitespace
    cleanedTitle = cleanedTitle.replace(/\s+/g, ' ').trim();

    // If title is empty after cleaning, use original
    if (cleanedTitle.length === 0) {
      return title.trim();
    }

    return cleanedTitle;
  }

  /**
   * Create fallback tasks when AI decomposition fails
   */
  private createFallbackTasks(userRequest: string): Task[] {
    const taskId = 'task_1';
    const pills: ToolPill[] = [
      {
        id: `${taskId}_pill_1`,
        toolName: 'web_search',
        status: 'pending',
        label: 'Search',
        icon: '🔍',
      },
    ];

    const task: Task = {
      id: taskId,
      title: this.validateTaskTitle(userRequest.substring(0, 80)),
      description: userRequest,
      pills,
      status: 'pending',
    };

    return [task];
  }
}

/**
 * Factory function to create a new decomposer
 */
export function createPillBasedTaskDecomposer(client: AIClient): PillBasedTaskDecomposer {
  return new PillBasedTaskDecomposer(client);
}
