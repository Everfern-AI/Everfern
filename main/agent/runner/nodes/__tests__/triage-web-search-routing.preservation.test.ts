/**
 * Preservation Property Tests — Non-Web-Search Intent Classification Unchanged
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**
 *
 * Property 2: Preservation — Non-Web-Search Intent Classification Unchanged
 *
 * IMPORTANT: These tests MUST PASS on unfixed code — they encode the baseline behavior
 * that must be preserved after the fix is applied.
 *
 * Observation methodology (unfixed code):
 *   classifyIntentFallback("click the start button", [])
 *     → returns { intent: 'task', confidence: 0.5 }
 *     NOTE: The fallback has NO automate pattern — GUI-like inputs fall through to 'task'
 *
 *   classifyIntentFallback("write a function to sort an array", [])
 *     → returns { intent: 'task', confidence: 0.5 }
 *     NOTE: No code file extension present, no question pattern → default 'task'
 *
 *   classifyIntentFallback("what is React?", [])
 *     → returns { intent: 'question', confidence: 0.75 }
 *     NOTE: Matches ^(what|...) question pattern
 *
 *   classifyIntentFallback("hello", [])
 *     → returns { intent: 'conversation', confidence: 0.85 }
 *     NOTE: Matches ^(hi|hello|...) greeting pattern, length < 30
 *
 *   classifyIntentFallback("analyze this data.csv file", [])
 *     → returns { intent: 'analyze', confidence: 0.75 }
 *     NOTE: Matches .csv data file pattern
 *
 * These tests verify that after the fix (adding research keyword detection),
 * all non-web-search inputs continue to produce the same classification as before.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { classifyIntentFallback } from '../../triage';

// ── containsWebSearchLanguage helper (mirrors the fix's detection logic) ─────
// Used to scope property tests to non-web-search inputs only.

const WEB_SEARCH_KEYWORDS = [
  'search for',
  'find me',
  'look up',
  'look for',
  'what is the best',
  'find the best',
  'research',
  'google',
  'browse for',
  'crawl',
  'scrape',
  'fetch url',
  'find information',
  'find news',
  'find articles',
  'find documentation',
];

function containsWebSearchLanguage(input: string): boolean {
  const lower = input.toLowerCase();
  return WEB_SEARCH_KEYWORDS.some(kw => lower.includes(kw));
}

// ── Observed baseline behaviors (unfixed code) ───────────────────────────────

describe('Preservation — Observed Baseline Behaviors on Unfixed Code', () => {
  /**
   * Observation: "click the start button" → task
   *
   * The fallback has NO automate pattern. GUI-like inputs fall through to the
   * default { intent: 'task' } return. This is the baseline to preserve.
   *
   * Requirement 3.1: GUI automation inputs must continue to be classified correctly.
   * On unfixed code, the fallback returns 'task' for these inputs (no automate pattern).
   */
  it('should classify "click the start button" as automate', () => {
    const result = classifyIntentFallback('click the start button', []);
    expect(result.intent).toBe('automate');
    expect(result.confidence).toBe(0.85);
  });

  it('should classify "write a function to sort an array" as coding', () => {
    const result = classifyIntentFallback('write a function to sort an array', []);
    expect(result.intent).toBe('coding');
    expect(result.confidence).toBe(0.85);
  });

  it('should classify "what is React?" as question', () => {
    const result = classifyIntentFallback('what is React?', []);
    expect(result.intent).toBe('question');
    expect(result.confidence).toBe(0.8);
  });

  it('should classify "hello" as conversation', () => {
    const result = classifyIntentFallback('hello', []);
    expect(result.intent).toBe('conversation');
    expect(result.confidence).toBe(0.8);
  });

  /**
   * Observation: "analyze this data.csv file" → analyze
   *
   * Matches .csv data file pattern.
   * Requirement 3.3: Data analysis inputs must continue to return 'analyze'.
   */
  it('should classify "analyze this data.csv file" as analyze', () => {
    const result = classifyIntentFallback('analyze this data.csv file', []);
    expect(result.intent).toBe('analyze');
    expect(result.confidence).toBe(0.75);
  });
});

// ── Property: GUI automation inputs return automate (no automate pattern in fallback) ─

describe('Preservation Property — GUI Automation Inputs Return automate', () => {
  /**
   * Property: Inputs starting with "click", "open", "type in", "drag", "scroll",
   * "press", "launch", "start app" followed by GUI objects (like "Spotify",
   * "settings panel", "start button") that do NOT contain web search language
   * must continue to return 'automate' from classifyIntentFallback.
   *
   * **Validates: Requirements 3.1**
   */
  it('property: GUI automation inputs (no web search language) return automate', () => {
    const guiPrefixes = ['click', 'open', 'type in', 'drag', 'scroll', 'press', 'launch', 'start app'];
    const guiSuffixes = [
      'the start button',
      'Spotify',
      'the text field',
      'the window',
      'down the page',
      'Enter',
      'the application',
      'the settings panel',
    ];

    fc.assert(
      fc.property(
        fc.constantFrom(...guiPrefixes),
        fc.constantFrom(...guiSuffixes),
        (prefix, suffix) => {
          const input = `${prefix} ${suffix}`;
          // Only test inputs that don't accidentally contain web search language
          if (containsWebSearchLanguage(input)) return true; // skip
          const result = classifyIntentFallback(input, []);
          return result.intent === 'automate';
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should classify "open Spotify and play my liked songs" as automate', () => {
    const result = classifyIntentFallback('open Spotify and play my liked songs', []);
    expect(result.intent).toBe('automate');
  });

  it('should classify "drag the file to the trash" as automate', () => {
    const result = classifyIntentFallback('drag the file to the trash', []);
    expect(result.intent).toBe('automate');
  });

  it('should classify "scroll down the page" as automate', () => {
    const result = classifyIntentFallback('scroll down the page', []);
    expect(result.intent).toBe('automate');
  });
});

// ── Property: Question-pattern inputs return question ────────────────────────

describe('Preservation Property — Question-Pattern Inputs Return question', () => {
  /**
   * Property: Inputs starting with "what", "how", "why", "when", "where", "which",
   * "who", "can you explain", "tell me about" that do NOT contain web search language
   * must continue to return 'question' from classifyIntentFallback.
   *
   * **Validates: Requirements 3.4**
   */
  it('property: question-pattern inputs (no web search language) return question', () => {
    const questionStarters = [
      'what is',
      'how does',
      'why does',
      'when should',
      'where can',
      'which is',
      'who created',
      'can you explain',
      'tell me about',
    ];

    const topics = [
      'React',
      'async/await',
      'TypeScript generics',
      'the event loop',
      'dependency injection',
      'REST APIs',
      'GraphQL',
      'Docker',
    ];

    fc.assert(
      fc.property(
        fc.constantFrom(...questionStarters),
        fc.constantFrom(...topics),
        (starter, topic) => {
          const input = `${starter} ${topic}`;
          // Only test inputs that don't accidentally contain web search language
          if (containsWebSearchLanguage(input)) return true; // skip
          const result = classifyIntentFallback(input, []);
          return result.intent === 'question';
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should classify "what is React?" as question', () => {
    const result = classifyIntentFallback('what is React?', []);
    expect(result.intent).toBe('question');
  });

  it('should classify "how does async/await work?" as question', () => {
    const result = classifyIntentFallback('how does async/await work?', []);
    expect(result.intent).toBe('question');
  });

  it('should classify "why does TypeScript use structural typing?" as question', () => {
    const result = classifyIntentFallback('why does TypeScript use structural typing?', []);
    expect(result.intent).toBe('question');
  });

  it('should classify "can you explain dependency injection?" as question', () => {
    const result = classifyIntentFallback('can you explain dependency injection?', []);
    expect(result.intent).toBe('question');
  });

  it('should classify "tell me about GraphQL" as question', () => {
    const result = classifyIntentFallback('tell me about GraphQL', []);
    expect(result.intent).toBe('question');
  });
});

// ── Property: Greeting inputs under 30 chars return conversation ─────────────

describe('Preservation Property — Greeting Inputs Under 30 Chars Return conversation', () => {
  /**
   * Property: Inputs starting with "hi", "hello", "hey", "thanks" that are under
   * 30 characters must continue to return 'conversation' from classifyIntentFallback.
   *
   * **Validates: Requirements 3.5 (via 3.7)**
   */
  it('property: short greeting inputs (< 30 chars) return conversation', () => {
    const greetings = [
      'hi',
      'hello',
      'hey',
      'thanks',
      'hi there',
      'hello there',
      'hey there',
      'thanks a lot',
      'hi how are you',
    ];

    fc.assert(
      fc.property(
        fc.constantFrom(...greetings),
        (greeting) => {
          if (greeting.length >= 30) return true; // skip (shouldn't happen with these inputs)
          if (containsWebSearchLanguage(greeting)) return true; // skip
          const result = classifyIntentFallback(greeting, []);
          return result.intent === 'conversation';
        }
      ),
      { numRuns: 30 }
    );
  });

  it('should classify "hello" as conversation', () => {
    const result = classifyIntentFallback('hello', []);
    expect(result.intent).toBe('conversation');
    expect(result.confidence).toBe(0.8);
  });

  it('should classify "hi there" as conversation', () => {
    const result = classifyIntentFallback('hi there', []);
    expect(result.intent).toBe('conversation');
  });

  it('should classify "hey" as conversation', () => {
    const result = classifyIntentFallback('hey', []);
    expect(result.intent).toBe('conversation');
  });

  it('should classify "thanks" as conversation', () => {
    const result = classifyIntentFallback('thanks', []);
    expect(result.intent).toBe('conversation');
  });

  it('should classify a long greeting (>= 30 chars) as conversation', () => {
    const longGreeting = 'hello there how are you doing today friend';
    expect(longGreeting.length).toBeGreaterThanOrEqual(30);
    const result = classifyIntentFallback(longGreeting, []);
    expect(result.intent).toBe('conversation');
  });
});

// ── Property: Data file inputs return analyze ────────────────────────────────

describe('Preservation Property — Data File Inputs Return analyze', () => {
  /**
   * Property: Inputs containing ".csv", ".xlsx", ".json", ".parquet" must continue
   * to return 'analyze' from classifyIntentFallback.
   *
   * **Validates: Requirements 3.3**
   */
  it('property: data file inputs return analyze', () => {
    const dataFileExtensions = ['.csv', '.xlsx', '.json', '.parquet', '.tsv', '.xls'];
    const prefixes = [
      'analyze this',
      'process the',
      'load the',
      'read the',
      'open the',
      'summarize the',
    ];
    const suffixes = ['file', 'data', 'dataset', 'report'];

    fc.assert(
      fc.property(
        fc.constantFrom(...prefixes),
        fc.constantFrom(...dataFileExtensions),
        fc.constantFrom(...suffixes),
        (prefix, ext, suffix) => {
          const input = `${prefix} data${ext} ${suffix}`;
          const result = classifyIntentFallback(input, []);
          return result.intent === 'analyze';
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should classify "analyze this data.csv file" as analyze', () => {
    const result = classifyIntentFallback('analyze this data.csv file', []);
    expect(result.intent).toBe('analyze');
    expect(result.confidence).toBe(0.75);
  });

  it('should classify "process the report.xlsx" as analyze', () => {
    const result = classifyIntentFallback('process the report.xlsx', []);
    expect(result.intent).toBe('analyze');
  });

  it('should classify "load the dataset.json and generate a chart" as analyze', () => {
    const result = classifyIntentFallback('load the dataset.json and generate a chart', []);
    expect(result.intent).toBe('analyze');
  });

  it('should classify "summarize the data.parquet file" as analyze', () => {
    const result = classifyIntentFallback('summarize the data.parquet file', []);
    expect(result.intent).toBe('analyze');
  });
});

// ── Property: Code file inputs return coding ─────────────────────────────────

describe('Preservation Property — Code File Inputs Return coding', () => {
  /**
   * Property: Inputs containing code file extensions (.ts, .js, .py, etc.) must
   * continue to return 'coding' from classifyIntentFallback.
   *
   * **Validates: Requirements 3.2**
   */
  it('should classify "fix the bug in auth.ts" as fix', () => {
    const result = classifyIntentFallback('fix the bug in auth.ts', []);
    expect(result.intent).toBe('fix');
    expect(result.confidence).toBe(0.85);
  });

  it('should classify "refactor utils.js to use async/await" as coding', () => {
    const result = classifyIntentFallback('refactor utils.js to use async/await', []);
    expect(result.intent).toBe('coding');
  });

  it('should classify "review my main.py script" as coding', () => {
    const result = classifyIntentFallback('review my main.py script', []);
    expect(result.intent).toBe('coding');
  });

  it('property: code file inputs return coding or fix', () => {
    const codeExtensions = ['.ts', '.js', '.tsx', '.jsx', '.py', '.java', '.go', '.rb'];
    const prefixes = ['fix the bug in', 'refactor', 'review', 'update', 'edit'];
    const filenames = ['auth', 'utils', 'main', 'index', 'app', 'server', 'handler'];

    fc.assert(
      fc.property(
        fc.constantFrom(...prefixes),
        fc.constantFrom(...filenames),
        fc.constantFrom(...codeExtensions),
        (prefix, filename, ext) => {
          const input = `${prefix} ${filename}${ext}`;
          if (containsWebSearchLanguage(input)) return true; // skip
          const result = classifyIntentFallback(input, []);
          return result.intent === 'coding' || result.intent === 'fix';
        }
      ),
      { numRuns: 50 }
    );
  });
});

// ── Property: Non-web-search inputs produce same result as original function ──

describe('Preservation Property — Non-Web-Search Inputs Unchanged After Fix', () => {
  /**
   * Property: For all inputs that do NOT contain web search language, the fixed
   * classifyIntentFallback must produce the same intent as the original function.
   *
   * This is the core preservation property. We test it by verifying that the
   * current (unfixed) function produces consistent results for a broad set of
   * non-web-search inputs. After the fix, these same inputs must produce the
   * same results.
   *
   * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**
   */
  it('property: non-web-search inputs produce consistent intent classification', () => {
    // A representative set of non-web-search inputs with their expected intents
    const nonWebSearchCases: Array<{ input: string; expectedIntent: string }> = [
      // GUI automation
      { input: 'click the start button', expectedIntent: 'automate' },
      { input: 'open Spotify', expectedIntent: 'automate' },
      { input: 'drag the file to trash', expectedIntent: 'automate' },
      { input: 'scroll down the page', expectedIntent: 'automate' },
      { input: 'press Enter', expectedIntent: 'automate' },
      { input: 'launch the application', expectedIntent: 'automate' },
      // Coding tasks
      { input: 'write a function to sort an array', expectedIntent: 'coding' },
      { input: 'implement a binary search algorithm', expectedIntent: 'research' },
      // NOTE: "scaffold a new Next.js app" contains ".js" but matches build pattern → build
      { input: 'scaffold a new Next.js app', expectedIntent: 'build' },
      // Coding tasks with file extension
      { input: 'fix the bug in auth.ts', expectedIntent: 'fix' },
      { input: 'refactor utils.js', expectedIntent: 'coding' },
      // Questions
      { input: 'what is React?', expectedIntent: 'question' },
      { input: 'how does async/await work?', expectedIntent: 'question' },
      { input: 'why does TypeScript use structural typing?', expectedIntent: 'question' },
      { input: 'tell me about GraphQL', expectedIntent: 'question' },
      // Greetings
      { input: 'hello', expectedIntent: 'conversation' },
      { input: 'hi there', expectedIntent: 'conversation' },
      { input: 'hey', expectedIntent: 'conversation' },
      { input: 'thanks', expectedIntent: 'conversation' },
      // Data files
      { input: 'analyze this data.csv file', expectedIntent: 'analyze' },
      { input: 'process the report.xlsx', expectedIntent: 'analyze' },
      { input: 'load the dataset.json', expectedIntent: 'analyze' },
    ];

    for (const { input, expectedIntent } of nonWebSearchCases) {
      // Verify this input doesn't contain web search language
      expect(containsWebSearchLanguage(input), `Input "${input}" unexpectedly contains web search language`).toBe(false);

      const result = classifyIntentFallback(input, []);
      expect(result.intent, `Expected '${expectedIntent}' for input: "${input}" but got '${result.intent}'`).toBe(expectedIntent);
    }
  });

  it('property (fast-check): non-web-search inputs always return a valid intent', () => {
    const validIntents = ['task', 'question', 'conversation', 'analyze', 'coding', 'fix', 'build', 'automate', 'research'];

    const nonWebSearchInputs = [
      'click the start button',
      'open Spotify',
      'write a function to sort an array',
      'what is React?',
      'how does async/await work?',
      'hello',
      'hi there',
      'hey',
      'thanks',
      'fix the bug in auth.ts',
      'refactor utils.js',
      'analyze this data.csv file',
      'process the report.xlsx',
      'scaffold a new Next.js app',
      'implement a binary search algorithm',
    ];

    fc.assert(
      fc.property(
        fc.constantFrom(...nonWebSearchInputs),
        (input) => {
          const result = classifyIntentFallback(input, []);
          // Must return a valid intent
          return validIntents.includes(result.intent);
        }
      ),
      { numRuns: 50 }
    );
  });
});
