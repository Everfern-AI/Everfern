/**
 * Navis — Step Executor
 *
 * Extracted from orchestrator.ts. Handles action dispatch from AI decisions,
 * duplicate click blocking, and state change detection.
 */

import type { BrowserControlAdapter, BrowserActionResult } from '../core/types';

export interface StepExecutionResult {
  actions: Array<{ name: string; args: Record<string, unknown>; result: BrowserActionResult }>;
  done: boolean;
  doneResult?: { success: boolean; text: string };
  stateChanged: boolean;
  navigationOccurred: boolean;
}

export interface DuplicateClickTracker {
  clickedElements: Map<string, { step: number; stateChanged: boolean }>;
  lastClickedRefKey: string;
}

/**
 * Execute a batch of actions from an AI decision.
 * Returns the results of each action and whether the task is done.
 */
export async function executeActions(
  actions: Array<Record<string, unknown>>,
  adapter: BrowserControlAdapter,
  step: number,
  maxSteps: number,
  maxActionsPerStep: number,
  tracker: DuplicateClickTracker,
): Promise<StepExecutionResult> {
  const results: StepExecutionResult = {
    actions: [],
    done: false,
    stateChanged: false,
    navigationOccurred: false,
  };

  const actionsToRun = actions.slice(0, maxActionsPerStep);

  for (const actionObj of actionsToRun) {
    if (results.done) break;

    const [actionName, actionArgs] = Object.entries(actionObj)[0] as [string, Record<string, unknown>];
    if (!actionName) continue;

    // Duplicate click blocking
    if (actionName === 'click_element' || actionName === 'smart_click') {
      const refKey = (actionArgs?.ref || actionArgs?.text || actionArgs?.target || '') as string;
      if (refKey && tracker.clickedElements.has(refKey)) {
        const prev = tracker.clickedElements.get(refKey)!;
        if (!prev.stateChanged && prev.step >= step - 2) {
          console.log(`[Navis] Blocking duplicate click on ${refKey} (step ${prev.step}, no state change)`);
          continue;
        }
      }
    }

    const result = await adapter.executeAction(actionName as any, actionArgs || {}, step, maxSteps);
    results.actions.push({ name: actionName, args: actionArgs || {}, result });

    // Track clicks for duplicate blocking
    if (actionName === 'click_element' || actionName === 'smart_click') {
      const refKey = (actionArgs?.ref || actionArgs?.text || actionArgs?.target || '') as string;
      if (refKey) {
        tracker.lastClickedRefKey = refKey;
        tracker.clickedElements.set(refKey, { step, stateChanged: false });
      }
    }

    if (result.stateChanged) {
      results.stateChanged = true;
    }

    if (actionName === 'done') {
      results.done = true;
      results.doneResult = {
        success: actionArgs?.success !== false,
        text: String(actionArgs?.text || 'Done'),
      };
    }

    // Navigation actions always mark state changed
    if (['go_to_url', 'go_back', 'open_tab', 'switch_tab', 'close_tab'].includes(actionName)) {
      results.navigationOccurred = true;
    }
  }

  return results;
}
