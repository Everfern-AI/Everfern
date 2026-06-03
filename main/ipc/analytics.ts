import { ipcMain } from 'electron';
import { getAnalyticsSummary, getModelPricingList, recordUsage, getModelPricing, ensurePricingFresh } from '../store/analytics';

export function registerAnalyticsHandlers() {
  ipcMain.handle('analytics:get-summary', async () => {
    try {
      const summary = await getAnalyticsSummary();
      return { success: true, data: summary };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('analytics:get-model-pricing', async () => {
    try {
      const pricing = await getModelPricingList();
      return { success: true, data: pricing };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('analytics:record-usage', async (_event, params: {
    conversationId?: string;
    model: string;
    provider: string;
    promptTokens: number;
    completionTokens: number;
  }) => {
    try {
      await recordUsage(params);
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // Look up context window + pricing for a single model by ID/name
  // Uses OpenRouter public data with fuzzy matching
  ipcMain.handle('analytics:get-model-info', async (_event, modelId: string) => {
    try {
      await ensurePricingFresh();
      const pricing = getModelPricing(modelId);
      return {
        success: true,
        data: {
          contextWindow: pricing.contextWindow,
          inputCostPer1M: pricing.inputCostPer1M,
          outputCostPer1M: pricing.outputCostPer1M,
        }
      };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });
}
