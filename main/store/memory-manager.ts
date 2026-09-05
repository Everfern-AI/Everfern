import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AIClient } from '../lib/ai-client';
import { ChatMessage } from '../acp/types';

// Learning system interfaces
export interface LearnedKnowledge {
  id: string;
  type: 'pattern' | 'preference' | 'workflow' | 'tool_combination';
  content: string;
  context: string;
  applicabilityConditions: string[];
  confidence: number;
  frequency: number;
  lastUsed: Date;
  created: Date;
  provenance: {
    sourceInteractions: string[];
    extractionMethod: string;
    validationScore: number;
  };
  metadata: {
    domain?: string;
    toolsInvolved?: string[];
    userPreference?: boolean;
    encrypted?: boolean;
  };
}

export interface LearningMemoryExtension {
  storeLearning(knowledge: LearnedKnowledge): Promise<void>;
  retrieveLearning(query: string, limit?: number): Promise<LearnedKnowledge[]>;
  updateLearningConfidence(id: string, delta: number): Promise<void>;
  pruneLowConfidenceKnowledge(threshold: number): Promise<void>;
  queryUserPreferences(userId?: string): Promise<LearnedKnowledge[]>;
}

const MEMORY_FILE_PATH = path.join(os.homedir(), '.everfern', 'MEMORY.md');
const LEARNING_DB_PATH = path.join(os.homedir(), '.everfern', 'learning.json');

// Signals that indicate the agent failed or didn't actually do anything useful
const FAILURE_SIGNALS = [
  'cannot_proceed',
  'cannot proceed',
  'task failed',
  'error occurred',
  'i was unable',
  'i could not',
  'i cannot',
  'i don\'t have',
  'i do not have',
  'token limit',
  'response was cut off',
  'technical failure',
  'timed out',
  'no_new_memory',
  '[error:',
  '❌',
  '🛑 stopped by user',
];

// Signals that indicate the agent actually completed something meaningful
const SUCCESS_SIGNALS = [
  'created',
  'generated',
  'written',
  'saved',
  'completed',
  'analyzed',
  'processed',
  'built',
  'fixed',
  'updated',
  'installed',
  'deployed',
  'executed',
  'found',
  'downloaded',
];

function isSuccessfulInteraction(userInput: string, response: string): boolean {
  const combined = (userInput + ' ' + response).toLowerCase();

  // Skip if response is empty or very short (nothing happened)
  if (!response || response.trim().length < 50) return false;

  // Skip if response contains failure signals
  for (const signal of FAILURE_SIGNALS) {
    if (combined.includes(signal.toLowerCase())) return false;
  }

  // Only store if response contains success signals
  return SUCCESS_SIGNALS.some(signal => combined.includes(signal));
}

/**
 * Learning Memory Manager - Extends existing memory system with learning capabilities
 */
export class LearningMemoryManager implements LearningMemoryExtension {
  private learningData: Map<string, LearnedKnowledge> = new Map();
  private initialized = false;

  constructor() {
    this.initializeLearningStorage();
  }

  private async initializeLearningStorage(): Promise<void> {
    try {
      const dir = path.dirname(LEARNING_DB_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (fs.existsSync(LEARNING_DB_PATH)) {
        const data = fs.readFileSync(LEARNING_DB_PATH, 'utf8');
        const parsed = JSON.parse(data);

        for (const [id, knowledge] of Object.entries(parsed)) {
          this.learningData.set(id, knowledge as LearnedKnowledge);
        }
      }

      this.initialized = true;
      console.log('[Learning Memory] 🧠 Learning storage initialized');
    } catch (error) {
      console.error('[Learning Memory] ❌ Failed to initialize learning storage:', error);
    }
  }

  private async persistLearningData(): Promise<void> {
    try {
      const data = Object.fromEntries(this.learningData);
      fs.writeFileSync(LEARNING_DB_PATH, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('[Learning Memory] ❌ Failed to persist learning data:', error);
    }
  }

  async storeLearning(knowledge: LearnedKnowledge): Promise<void> {
    if (!this.initialized) {
      await this.initializeLearningStorage();
    }

    this.learningData.set(knowledge.id, knowledge);
    await this.persistLearningData();
    console.log(`[Learning Memory] 📚 Stored learning: ${knowledge.type} - ${knowledge.content.substring(0, 50)}...`);
  }

  async retrieveLearning(query: string, limit: number = 10): Promise<LearnedKnowledge[]> {
    if (!this.initialized) {
      await this.initializeLearningStorage();
    }

    const queryLower = query.toLowerCase();
    const results: Array<{ knowledge: LearnedKnowledge; score: number }> = [];

    for (const knowledge of this.learningData.values()) {
      let score = 0;

      // Content matching
      if (knowledge.content.toLowerCase().includes(queryLower)) score += 3;
      if (knowledge.context.toLowerCase().includes(queryLower)) score += 2;

      // Applicability conditions matching
      for (const condition of knowledge.applicabilityConditions) {
        if (condition.toLowerCase().includes(queryLower)) score += 2;
      }

      // Metadata matching
      if (knowledge.metadata.domain?.toLowerCase().includes(queryLower)) score += 1;
      if (knowledge.metadata.toolsInvolved?.some(tool => tool.toLowerCase().includes(queryLower))) score += 1;

      // Boost score by confidence and frequency
      score *= knowledge.confidence * Math.log(knowledge.frequency + 1);

      if (score > 0) {
        results.push({ knowledge, score });
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(r => r.knowledge);
  }

  async updateLearningConfidence(id: string, delta: number): Promise<void> {
    const knowledge = this.learningData.get(id);
    if (knowledge) {
      knowledge.confidence = Math.max(0, Math.min(1, knowledge.confidence + delta));
      knowledge.lastUsed = new Date();
      knowledge.frequency += 1;
      await this.persistLearningData();
    }
  }

  async pruneLowConfidenceKnowledge(threshold: number): Promise<void> {
    const toRemove: string[] = [];

    for (const [id, knowledge] of this.learningData) {
      if (knowledge.confidence < threshold) {
        toRemove.push(id);
      }
    }

    for (const id of toRemove) {
      this.learningData.delete(id);
    }

    if (toRemove.length > 0) {
      await this.persistLearningData();
      console.log(`[Learning Memory] 🧹 Pruned ${toRemove.length} low-confidence knowledge entries`);
    }
  }

  async queryUserPreferences(userId?: string): Promise<LearnedKnowledge[]> {
    if (!this.initialized) {
      await this.initializeLearningStorage();
    }

    return Array.from(this.learningData.values())
      .filter(knowledge =>
        knowledge.type === 'preference' ||
        knowledge.metadata.userPreference === true
      )
      .sort((a, b) => b.confidence - a.confidence);
  }

  // Get all learning data for debugging/transparency
  async getAllLearning(): Promise<LearnedKnowledge[]> {
    if (!this.initialized) {
      await this.initializeLearningStorage();
    }
    return Array.from(this.learningData.values());
  }

  // Clear all learning data (for user control)
  async clearAllLearning(): Promise<void> {
    this.learningData.clear();
    await this.persistLearningData();
    console.log('[Learning Memory] 🗑️ All learning data cleared');
  }
}

// Global instance for learning memory
export const learningMemoryManager = new LearningMemoryManager();
/**
 * Non-blocking memory reflection.
 * Only stores memories when the agent actually accomplished something meaningful.
 * Skips errors, failures, and "cannot proceed" states to avoid polluting memory.
 */
export function reflectAndRemember(
  history: ChatMessage[],
  userInput: string | unknown,
  response: string,
  client: AIClient
): void {
  // Coerce userInput to string early — it may be ContentPart[] when attachments are present
  const safeInput = typeof userInput === 'string'
    ? userInput
    : Array.isArray(userInput)
      ? (userInput as any[]).map((p: any) => (typeof p === 'string' ? p : p?.text ?? '')).join(' ')
      : String(userInput ?? '');

  // Skip reflection entirely if the interaction wasn't successful
  if (!isSuccessfulInteraction(safeInput, response)) {
    console.log('[Memory] ⏭️ Skipping reflection — no meaningful work was done or errors occurred');
    return;
  }

  // Fire and forget - do not await
  (async () => {
    try {
      const prompt = `Analyze this SUCCESSFUL interaction and extract ONLY durable user preferences or project facts for long-term memory.

STRICT RULES — ONLY store these categories:
✅ User preferences: coding style, preferred tools, languages, formatting choices, communication style
✅ User personal facts: name, role, timezone, recurring workflows

NEVER store any of these — they are session-specific and will cause confusion in future chats:
❌ What files were created, generated, or saved (e.g. "report.html was created at C:\\...")
❌ File paths, artifact locations, or directory structures
❌ What the agent built, analyzed, or delivered in this session
❌ Task results, data summaries, or report contents
❌ Project architecture details tied to a specific task
❌ Anything that implies a task was "already done" for future sessions

If nothing from the ✅ categories was learned, respond with "NO_NEW_MEMORY".

Interaction:
User: "${safeInput.substring(0, 500)}"
Assistant: "${response.substring(0, 800)}..."

Respond with ONLY new memory entries in Markdown bullet format, or "NO_NEW_MEMORY".`;

      const analysis = await client.chat({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        maxTokens: 300,
      });

      const content = typeof analysis.content === 'string' ? analysis.content : '';
      if (!content || content.trim().toUpperCase().includes('NO_NEW_MEMORY')) return;

      // Strip any lines that snuck through containing file paths, artifact locations, or task results
      const PATH_PATTERNS = [
        /c:\\[^\s]*/i,            // Windows absolute paths
        /\.everfern[^\s]*/i,      // .everfern directory references
        /artifacts[^\s]*/i,       // artifact paths
        /\.html\b/i,              // HTML file references
        /\.py\b/i,                // Python file references
        /what worked:/i,          // "What Worked" sections
        /project architecture:/i, // "Project Architecture" sections
        /successfully deliver/i,  // task result language
        /report.*generated/i,     // report generation results
        /file.*saved/i,           // file save results
      ];

      const filteredLines = content.split('\n').filter(line => {
        const lower = line.toLowerCase();
        return !PATH_PATTERNS.some(p => p.test(line)) &&
               !lower.includes('c:\\') &&
               !lower.includes('.everfern') &&
               !lower.includes('artifact') &&
               !lower.includes('was generated') &&
               !lower.includes('was created') &&
               !lower.includes('was saved') &&
               !lower.includes('was built') &&
               !lower.includes('report.html') &&
               !lower.includes('file path');
      });

      const filteredContent = filteredLines.join('\n').trim();
      if (!filteredContent || filteredContent.toUpperCase().includes('NO_NEW_MEMORY')) return;

      const timestamp = new Date().toISOString().split('T')[0];
      const entry = `\n\n### ${timestamp}\n${content}`;

      const dir = path.dirname(MEMORY_FILE_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      fs.appendFileSync(MEMORY_FILE_PATH, entry);
      console.log('[Memory] 🧠 User preference/project fact logged to MEMORY.md');
    } catch (err) {
      console.error('[Memory] ❌ Reflection failed:', err);
    }
  })();
}
