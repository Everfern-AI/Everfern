/**
 * Navis — Configuration Module
 *
 * Configuration options for NAVIS hybrid system features.
 * Can be loaded from environment variables or defaults.
 */

export interface NavisConfig {
  fullScreenCapture: boolean;
  hybridClick: boolean;
  visionModel: string;
  confidenceThreshold: number;
  nearbySearchRadius: number;
}

export const defaultConfig: NavisConfig = {
  fullScreenCapture: true,
  hybridClick: true,
  visionModel: 'gpt-4-vision-preview',
  confidenceThreshold: 0.7,
  nearbySearchRadius: 5,
};

/**
 * Load configuration from environment variables or defaults
 */
export function loadConfig(): NavisConfig {
  return {
    fullScreenCapture:
      process.env.NAVIS_FULL_SCREEN_CAPTURE === 'true' ||
      (process.env.NAVIS_FULL_SCREEN_CAPTURE === undefined && defaultConfig.fullScreenCapture),
    hybridClick:
      process.env.NAVIS_HYBRID_CLICK === 'true' ||
      (process.env.NAVIS_HYBRID_CLICK === undefined && defaultConfig.hybridClick),
    visionModel: process.env.NAVIS_VISION_MODEL || defaultConfig.visionModel,
    confidenceThreshold: parseFloat(
      process.env.NAVIS_CONFIDENCE_THRESHOLD || String(defaultConfig.confidenceThreshold)
    ),
    nearbySearchRadius: parseInt(
      process.env.NAVIS_NEARBY_SEARCH_RADIUS || String(defaultConfig.nearbySearchRadius),
      10
    ),
  };
}

/**
 * Validate configuration values
 */
export function validateConfig(config: NavisConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (config.confidenceThreshold < 0 || config.confidenceThreshold > 1) {
    errors.push('confidenceThreshold must be between 0 and 1');
  }

  if (config.nearbySearchRadius < 0 || config.nearbySearchRadius > 20) {
    errors.push('nearbySearchRadius must be between 0 and 20');
  }

  if (!config.visionModel || config.visionModel.trim().length === 0) {
    errors.push('visionModel must be specified');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
