/**
 * EverFern Desktop — Learning Node
 *
 * Main orchestrator for the continuous learning system.
 */

import type {
  LearningContext,
  LearnedKnowledge,
  LearningNode as ILearningNode
} from './types';
import type { ILearningAgent } from './interfaces';
import { InteractionAnalyzer } from './interaction-analyzer';
import { backgroundProcessor } from './background-processor';
import { getLearningConfig } from './config';
import { loadMemoryGraph } from './memory/persistent-memory';

export class LearningNode implements ILearningNode, ILearningAgent {
  private readonly analyzer = new InteractionAnalyzer();
  private readonly config = getLearningConfig();

  async analyzeInteraction(context: LearningContext): Promise<void> {
    if (!this.config.getConfig().enabled) {
      return;
    }

    // Queue analysis task for background processing
    await backgroundProcessor.queueLearningTask({
      id: `analyze_${context.interactionId}`,
      type: 'analyze',
      priority: 5,
      data: context,
      retryCount: 0,
      maxRetries: 3,
      createdAt: new Date()
    });
  }

  async processLearningQueue(): Promise<void> {
    await backgroundProcessor.processQueue();
  }

  async retrieveRelevantKnowledge(query: string, limit: number = 10): Promise<LearnedKnowledge[]> {
    const graph = loadMemoryGraph();
    const lowerQuery = query.toLowerCase();
    const results: LearnedKnowledge[] = [];

    for (const node of graph.nodes) {
      const matchScore = 
        node.name.toLowerCase().includes(lowerQuery) ||
        node.category.toLowerCase().includes(lowerQuery) ||
        node.value.toLowerCase().includes(lowerQuery) ? 0.85 : 0;

      if (matchScore > 0 || !query.trim()) {
        results.push({
          id: node.id,
          type: node.type as any,
          category: node.category,
          name: node.name,
          value: node.value,
          confidence: matchScore || 0.7,
          metadata: node.metadata || {},
          lastUpdated: new Date()
        } as any);
      }

      if (results.length >= limit) break;
    }

    return results;
  }

  async explainDecisionInfluence(decisionId: string): Promise<string> {
    const graph = loadMemoryGraph();
    const matchingNode = graph.nodes.find(n => n.id === decisionId || n.name.toLowerCase().includes(decisionId.toLowerCase()));

    if (matchingNode) {
      return `Decision ${decisionId} was influenced by learned memory node "${matchingNode.name}" (Type: ${matchingNode.type}, Category: ${matchingNode.category}): "${matchingNode.value}"`;
    }

    return `No active memory graph influence record found matching decision identifier "${decisionId}".`;
  }

  async getStatus(): Promise<any> {
    const queueStatus = backgroundProcessor.getQueueStatus();
    const resourceUsage = backgroundProcessor.getResourceUsage();
    const graph = loadMemoryGraph();

    return {
      enabled: this.config.getConfig().enabled,
      queueDepth: queueStatus.pendingTasks,
      resourceUsage,
      knowledgeCount: graph.nodes.length,
      lastProcessingTime: new Date(),
      errorCount: 0,
      successRate: 1.0
    };
  }

  async updateConfig(config: any): Promise<void> {
    this.config.updateConfig(config);
  }
}

export const learningNode = new LearningNode();
