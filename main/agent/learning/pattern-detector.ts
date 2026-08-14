/**
 * EverFern Desktop — Pattern Detection System
 *
 * Detects recurring patterns across multiple interactions.
 */

import type {
  LearningContext,
  UserPreference,
  ToolUsagePattern,
  ProblemSolvingPattern,
  WorkflowPattern,
  LearnedKnowledge
} from './types';
import type { IPatternDetector } from './interfaces';

export class PatternDetector implements IPatternDetector {
  async detectUserPreferences(interactions: LearningContext[]): Promise<UserPreference[]> {
    const preferences: UserPreference[] = [];

    // Analyze formatting preferences
    const formattingPatterns = this.analyzeFormattingPatterns(interactions);
    preferences.push(...formattingPatterns);

    // Analyze workflow preferences
    const workflowPatterns = this.analyzeWorkflowPreferences(interactions);
    preferences.push(...workflowPatterns);

    return preferences;
  }

  async detectToolUsagePatterns(interactions: LearningContext[]): Promise<ToolUsagePattern[]> {
    const patterns: ToolUsagePattern[] = [];

    for (const interaction of interactions) {
      const toolSequence = interaction.tools.map(t => t.name);
      if (toolSequence.length > 1) {
        patterns.push({
          toolCombination: toolSequence,
          sequence: true,
          parallel: false,
          effectiveness: interaction.success ? 1.0 : 0.0,
          context: interaction.outcome.description,
          frequency: 1
        });
      }
    }

    return patterns;
  }

  async detectProblemSolvingPatterns(interactions: LearningContext[]): Promise<ProblemSolvingPattern[]> {
    const patterns: ProblemSolvingPattern[] = [];

    // Group interactions by problem type
    const problemGroups = this.groupByProblemType(interactions);

    for (const [problemType, problemInteractions] of problemGroups) {
      const successfulApproaches = problemInteractions
        .filter(i => i.success)
        .map(i => this.extractApproach(i));

      if (successfulApproaches.length > 0) {
        patterns.push({
          problemType,
          approach: successfulApproaches[0],
          steps: this.extractSteps(problemInteractions[0]),
          successRate: successfulApproaches.length / problemInteractions.length,
          applicableScenarios: [problemType]
        });
      }
    }

    return patterns;
  }

  async detectWorkflowOptimizations(interactions: LearningContext[]): Promise<WorkflowPattern[]> {
    const patterns: WorkflowPattern[] = [];
    const workflowGroups = this.groupByWorkflowType(interactions);

    for (const [workflowType, workflowInteractions] of workflowGroups) {
      const optimizations = this.identifyOptimizations(workflowInteractions);

      if (optimizations.length > 0) {
        patterns.push({
          workflowType,
          optimizations,
          timesSaved: this.calculateTimeSaved(workflowInteractions),
          applicableContexts: [workflowType]
        });
      }
    }

    return patterns;
  }

  async detectMetaPatterns(knowledge: LearnedKnowledge[]): Promise<LearnedKnowledge[]> {
    const metaPatterns: LearnedKnowledge[] = [];
    const categoryCounts = new Map<string, number>();

    for (const item of knowledge) {
      const cat = (item as any).category || item.metadata?.domain || item.type || 'general';
      categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + 1);
    }

    for (const [category, count] of categoryCounts.entries()) {
      if (count >= 3) {
        metaPatterns.push({
          id: `meta_${category}_${Date.now()}`,
          type: 'pattern',
          title: `High-density ${category} pattern cluster`,
          content: `Detected recurring pattern cluster with ${count} related observations in category "${category}".`,
          context: `meta_analysis_${category}`,
          applicabilityConditions: [`category:${category}`],
          confidence: 0.88,
          frequency: count,
          lastUsed: new Date(),
          created: new Date(),
          tags: ['meta_pattern', category],
          provenance: {
            sourceInteractions: [],
            extractionMethod: 'meta_cluster_analysis',
            validationScore: 0.88,
          },
          metadata: { domain: category }
        });
      }
    }

    return metaPatterns;
  }

  async validatePatterns(patterns: any[]): Promise<any[]> {
    return patterns.filter(p => (p.confidence ?? p.effectiveness ?? 1.0) >= 0.5);
  }

  private analyzeFormattingPatterns(interactions: LearningContext[]): UserPreference[] {
    const preferences: UserPreference[] = [];

    for (const interaction of interactions) {
      const userMsg = (interaction.messages || []).find((m: any) => m.role === 'user' || m.type === 'human');
      const query = ((interaction as any).userQuery || (typeof userMsg?.content === 'string' ? userMsg.content : '') || '').toLowerCase();
      if (query.includes('concise') || query.includes('short') || query.includes('bullet')) {
        preferences.push({
          category: 'formatting',
          description: 'User prefers concise, bulleted responses with minimal fluff.',
          confidence: 0.85,
          evidence: [query],
          applicableContexts: ['chat', 'coding', 'summary']
        });
      } else if (query.includes('table') || query.includes('markdown table')) {
        preferences.push({
          category: 'formatting',
          description: 'User prefers tabular representations for comparative data.',
          confidence: 0.90,
          evidence: [query],
          applicableContexts: ['data', 'comparison', 'summary']
        });
      }
    }

    return preferences;
  }

  private analyzeWorkflowPreferences(interactions: LearningContext[]): UserPreference[] {
    const preferences: UserPreference[] = [];

    for (const interaction of interactions) {
      const userMsg = (interaction.messages || []).find((m: any) => m.role === 'user' || m.type === 'human');
      const query = ((interaction as any).userQuery || (typeof userMsg?.content === 'string' ? userMsg.content : '') || '').toLowerCase();
      if (query.includes('auto') || query.includes('dont ask') || query.includes('skip confirm')) {
        preferences.push({
          category: 'workflow',
          description: 'User prefers automated execution without intermediate confirmations for standard tasks.',
          confidence: 0.82,
          evidence: [query],
          applicableContexts: ['automation', 'workflow']
        });
      }
    }

    return preferences;
  }

  private groupByProblemType(interactions: LearningContext[]): Map<string, LearningContext[]> {
    const groups = new Map<string, LearningContext[]>();

    for (const interaction of interactions) {
      const problemType = this.inferProblemType(interaction);
      if (!groups.has(problemType)) {
        groups.set(problemType, []);
      }
      groups.get(problemType)!.push(interaction);
    }

    return groups;
  }

  private groupByWorkflowType(interactions: LearningContext[]): Map<string, LearningContext[]> {
    const groups = new Map<string, LearningContext[]>();

    for (const interaction of interactions) {
      const workflowType = this.inferWorkflowType(interaction);
      if (!groups.has(workflowType)) {
        groups.set(workflowType, []);
      }
      groups.get(workflowType)!.push(interaction);
    }

    return groups;
  }

  private inferProblemType(interaction: LearningContext): string {
    const toolNames = interaction.tools.map(t => t.name);

    if (toolNames.some(name => name.includes('file') || name.includes('write'))) {
      return 'file-management';
    }
    if (toolNames.some(name => name.includes('terminal') || name.includes('shell') || name.includes('command'))) {
      return 'system-administration';
    }
    if (toolNames.some(name => name.includes('web') || name.includes('fetch') || name.includes('search'))) {
      return 'web-browsing';
    }

    return 'general';
  }

  private inferWorkflowType(interaction: LearningContext): string {
    return interaction.outcome.type === 'success' ? 'efficient' : 'inefficient';
  }

  private extractApproach(interaction: LearningContext): string {
    return interaction.outcome.description || 'Standard step-by-step resolution';
  }

  private extractSteps(interaction: LearningContext): string[] {
    return interaction.tools.map(t => `Use ${t.name}`);
  }

  private identifyOptimizations(interactions: LearningContext[]): string[] {
    const optimizations: string[] = [];
    const toolCounts = new Map<string, number>();

    for (const interaction of interactions) {
      for (const t of interaction.tools) {
        toolCounts.set(t.name, (toolCounts.get(t.name) || 0) + 1);
      }
    }

    const redundantTools = Array.from(toolCounts.entries())
      .filter(([_, count]) => count > 3)
      .map(([name]) => name);

    if (redundantTools.length > 0) {
      optimizations.push(`Batch calls for recurring tool: ${redundantTools.join(', ')}`);
    }

    optimizations.push('Parallelize independent tool step executions');
    return optimizations;
  }

  private calculateTimeSaved(interactions: LearningContext[]): number {
    let totalDuration = 0;
    for (const i of interactions) {
      const dur = (i as any).durationMs || (i.endTime && i.startTime ? i.endTime - i.startTime : (i.outcome?.metrics?.duration || 0));
      if (dur > 0) {
        totalDuration += Math.min(dur, 10_000);
      } else {
        totalDuration += 1_500;
      }
    }
    return Math.round(totalDuration * 0.35); // 35% efficiency optimization gain
  }
}

export const patternDetector = new PatternDetector();
