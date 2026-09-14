import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { redactSecretText, redactConfigSecrets } from '../lib/secret-redaction';

/**
 * MP-SEC-11 — message feedback store.
 *
 * Persists 'up'/'down' message feedback (type, reason, customReason, and a
 * capped slice of conversation context) to ~/.everfern/feedback.json. The
 * DB analytics store (usage_events) only models token/cost usage events and
 * has no feedback table, so a dedicated JSON store follows the existing
 * tool-approvals.json pattern instead of a new migration.
 *
 * All free-text fields are scrubbed with secret-redaction before persist:
 * token-shaped secrets (sk-…, ghp_…, Bearer …) are replaced even when the
 * user pastes one into a reason or the context messages contain one.
 */

export interface FeedbackEntry {
  id: string;
  feedbackType: string;
  reason: string;
  customReason: string;
  contextData: unknown;
  createdAt: string;
}

const FEEDBACK_FILE_PATH = path.join(os.homedir(), '.everfern', 'feedback.json');

/** Cap on persisted entries — oldest dropped beyond this. */
const MAX_ENTRIES = 100;

export class FeedbackStore {
  private filePath: string;
  private maxEntries: number;

  constructor(filePath?: string, maxEntries?: number) {
    this.filePath = filePath || FEEDBACK_FILE_PATH;
    this.maxEntries = maxEntries ?? MAX_ENTRIES;
  }

  private load(): FeedbackEntry[] {
    if (!fs.existsSync(this.filePath)) {
      return [];
    }
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.warn('[FeedbackStore] ⚠️ Malformed feedback.json — resetting to empty:', err);
      return [];
    }
  }

  private save(entries: FeedbackEntry[]): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // Atomic-ish write: temp file + rename so a crash mid-write never
    // truncates the existing feedback history.
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(entries, null, 2), 'utf-8');
    fs.renameSync(tmpPath, this.filePath);
  }

  /**
   * Append one redacted, validated feedback entry. Entries beyond
   * maxEntries are dropped oldest-first.
   */
  addEntry(entry: Omit<FeedbackEntry, 'id' | 'createdAt'>): FeedbackEntry {
    const newEntry: FeedbackEntry = {
      ...entry,
      id: `feedback-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      createdAt: new Date().toISOString(),
    };
    const entries = this.load();
    entries.push(newEntry);
    while (entries.length > this.maxEntries) {
      entries.shift();
    }
    this.save(entries);
    return newEntry;
  }

  /** All persisted entries (oldest first). */
  getEntries(): FeedbackEntry[] {
    return this.load();
  }
}

export const feedbackStore = new FeedbackStore();

// ── Validation + redaction (main-side, before persistence) ─────────────────

export const FEEDBACK_LIMITS = {
  feedbackTypeMax: 64,
  reasonMax: 256,
  customReasonMax: 1024,
  contextDataMax: 4096,
} as const;

/**
 * Validate and redact a feedback submission. Returns an error string when
 * the payload violates a limit or type constraint; otherwise returns the
 * sanitized entry ready for persistence.
 */
export function sanitizeFeedbackPayload(
  feedbackType: unknown,
  reason: unknown,
  customReason: unknown,
  contextData: unknown
): { error: string } | { entry: Omit<FeedbackEntry, 'id' | 'createdAt'> } {
  if (typeof feedbackType !== 'string' || feedbackType.length === 0) {
    return { error: 'feedbackType must be a non-empty string' };
  }
  if (feedbackType.length > FEEDBACK_LIMITS.feedbackTypeMax) {
    return { error: `feedbackType exceeds ${FEEDBACK_LIMITS.feedbackTypeMax} characters` };
  }
  if (typeof reason !== 'string') {
    return { error: 'reason must be a string' };
  }
  if (reason.length > FEEDBACK_LIMITS.reasonMax) {
    return { error: `reason exceeds ${FEEDBACK_LIMITS.reasonMax} characters` };
  }
  if (typeof customReason !== 'string') {
    return { error: 'customReason must be a string' };
  }
  if (customReason.length > FEEDBACK_LIMITS.customReasonMax) {
    return { error: `customReason exceeds ${FEEDBACK_LIMITS.customReasonMax} characters` };
  }

  let context: unknown = contextData;
  if (contextData !== null && contextData !== undefined) {
    let serialized: string;
    try {
      serialized = JSON.stringify(contextData);
    } catch {
      return { error: 'contextData must be JSON-serializable' };
    }
    if (serialized === undefined) {
      return { error: 'contextData must be JSON-serializable' };
    }
    if (serialized.length > FEEDBACK_LIMITS.contextDataMax) {
      return { error: `contextData exceeds ${FEEDBACK_LIMITS.contextDataMax} characters serialized` };
    }
    // Key-named secrets inside context objects (apiKey, token, …) become
    // SecretViews; token-shaped secrets inside string values are scrubbed
    // below via redactSecretText on the re-parsed tree.
    context = redactConfigSecrets(contextData);
    context = redactSecretTextDeep(context);
  }

  return {
    entry: {
      feedbackType,
      reason: redactSecretText(reason),
      customReason: redactSecretText(customReason),
      contextData: context,
    },
  };
}

/**
 * Walk a JSON tree and run redactSecretText over every string leaf, so
 * secrets pasted into message content are scrubbed before disk.
 */
function redactSecretTextDeep(value: unknown): unknown {
  if (typeof value === 'string') return redactSecretText(value);
  if (Array.isArray(value)) return value.map(redactSecretTextDeep);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactSecretTextDeep(v);
    }
    return out;
  }
  return value;
}
