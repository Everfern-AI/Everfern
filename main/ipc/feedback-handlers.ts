import { ipcMain } from 'electron';
import { feedbackStore, sanitizeFeedbackPayload } from '../store/feedback';

/**
 * MP-SEC-11 — main-side feedback:submit handler.
 *
 * preload/preload.ts bridges 'feedback:submit' (feedbackType, reason,
 * customReason, contextData) but until now no ipcMain.handle existed, so the
 * renderer always fell back to alert(). This handler validates the payload
 * (type + length caps), redacts secrets from every free-text field via
 * secret-redaction, and persists to ~/.everfern/feedback.json (capped at
 * 100 entries, oldest dropped). Return shape mirrors sibling handlers:
 * { success: true } | { success: false, error }.
 */
export function registerFeedbackHandlers() {
  ipcMain.handle(
    'feedback:submit',
    async (_event, feedbackType: unknown, reason: unknown, customReason: unknown, contextData: unknown) => {
      try {
        const result = sanitizeFeedbackPayload(feedbackType, reason, customReason, contextData);
        if ('error' in result) {
          return { success: false, error: result.error };
        }
        feedbackStore.addEntry(result.entry);
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );
}
