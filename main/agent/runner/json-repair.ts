/**
 * EverFern Desktop — JSON Repair Utility
 *
 * Robust JSON extraction and repair for LLM outputs.
 * LLMs frequently produce truncated, malformed, or wrapped JSON.
 * This utility tries multiple strategies to extract valid JSON.
 */

/**
 * Try to extract and parse JSON from LLM output using multiple strategies:
 * 1. Extract from ```json code blocks
 * 2. Match raw JSON object
 * 3. Parse entire response
 * 4. Repair truncated JSON by closing open brackets
 *
 * Returns null if all strategies fail.
 */
export function extractJsonFromLLM(responseText: string): any | null {
  // Strategy 1: Extract from ```json code blocks
  const codeBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    const result = tryParseOrRepair(codeBlockMatch[1].trim());
    if (result) return result;
  }

  // Strategy 2: Match raw JSON object
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    const result = tryParseOrRepair(jsonMatch[0]);
    if (result) return result;
  }

  // Strategy 3: Parse entire response
  const result = tryParseOrRepair(responseText.trim());
  if (result) return result;

  return null;
}

/**
 * Try to parse JSON, and if it fails, attempt to repair it.
 */
function tryParseOrRepair(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    return repairTruncatedJson(text);
  }
}

/**
 * Attempt to repair truncated JSON by closing open brackets/braces.
 * LLMs frequently produce JSON that gets cut off at the token limit.
 */
function repairTruncatedJson(text: string): any | null {
  try {
    // Remove trailing commas before closing brackets
    let cleaned = text.replace(/,\s*([}\]])/g, '$1');

    // Count open vs close brackets
    let openBraces = 0, openBrackets = 0;
    let inString = false, escaped = false;

    for (const ch of cleaned) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') openBraces++;
      if (ch === '}') openBraces--;
      if (ch === '[') openBrackets++;
      if (ch === ']') openBrackets--;
    }

    // If we're inside a string, close it
    if (inString) cleaned += '"';

    // Close any unclosed arrays, then objects
    while (openBrackets > 0) { cleaned += ']'; openBrackets--; }
    while (openBraces > 0) { cleaned += '}'; openBraces--; }

    // Try parsing the repaired JSON
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}
