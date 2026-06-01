import * as fs from 'fs';
import * as path from 'path';
import type { AgentTool, ToolResult } from '../runner/types';
import { AIClient, type AIClientConfig, type ChatMessage } from '../../lib/ai-client';

const SUPPORTED_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.tif', '.svg'
]);

function mimeType(ext: string): string {
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png', '.gif': 'image/gif',
    '.bmp': 'image/bmp', '.webp': 'image/webp',
    '.tiff': 'image/tiff', '.tif': 'image/tiff',
    '.svg': 'image/svg+xml',
  };
  return map[ext] || 'image/jpeg';
}

type VisionClient = AIClient;

function getVisionClient(mainClient: AIClient): { client: VisionClient; isFallback: boolean } | null {
  if (mainClient.supportsVision()) {
    return { client: mainClient, isFallback: false };
  }
  const config = mainClient.getFullConfig();
  if (config.vlm) {
    const mappedProvider = (
      config.vlm.engine === 'cloud' && config.vlm.provider === 'ollama' ? 'ollama-cloud' :
      config.vlm.engine === 'cloud' && config.vlm.provider === 'everfern' ? 'everfern' :
      config.vlm.provider
    ) as any;
    const vlmClient = new AIClient({
      provider: mappedProvider,
      model: config.vlm.model,
      baseUrl: (mappedProvider === 'everfern' || mappedProvider === 'openrouter') ? undefined : config.vlm.baseUrl,
      apiKey: config.vlm.apiKey,
    });
    return { client: vlmClient, isFallback: true };
  }
  return null;
}

function readAndEncode(filePath: string): { dataUrl: string; b64: string; mime: string; fileName: string } | { error: string } {
  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    return { error: `File not found: ${filePath}` };
  }
  const ext = path.extname(resolvedPath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    return { error: `Unsupported format: ${ext} for ${filePath}. Supported: ${[...SUPPORTED_EXTENSIONS].join(', ')}` };
  }
  const rawBuffer = fs.readFileSync(resolvedPath);
  const b64 = rawBuffer.toString('base64');
  const mime = mimeType(ext);
  return { dataUrl: `data:${mime};base64,${b64}`, b64, mime, fileName: path.basename(resolvedPath) };
}

async function doVisionChat(
  client: VisionClient,
  messages: ChatMessage[],
  onUpdate?: (msg: string) => void,
): Promise<{ content: string; b64Images: string[] }> {
  const response = await client.chat({
    messages,
    temperature: 0.3,
    maxTokens: 4096,
  });
  const content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
  return { content, b64Images: [] };
}

export function createAnalyzeImageTool(
  mainClient: AIClient,
  runner?: any
): AgentTool {
  return {
    name: 'analyze_image',
    description:
      'Analyze ONE or MULTIPLE images using AI vision. ' +
      'Use `imagePath` for a single image, or `images` array to analyze many at once (much faster than calling one-by-one). ' +
      'The vision model sees ALL images and can classify, compare, or describe them. ' +
      'Supports: JPG, PNG, GIF, BMP, WebP, TIFF, SVG. ' +
      'CRITICAL: For CONTENT classification or ORGANIZATION (e.g. "organize images by content", "is this anime?", "find screenshots", ' +
      '"are there people in these photos?", "sort memes from photos"), ' +
      'you MUST use this tool — do NOT guess from file names, file size, or metadata. ' +
      'If the user says "organize these images" or "sort my pictures" without specifying "by type/format", ' +
      'assume they mean by CONTENT and use this tool. ' +
      'However, for FORMAT-based queries (e.g. "organize all SVGs", "find JPEGs", "separate PNGs from JPGs"), ' +
      'skip this tool entirely — just filter by file extension, no vision needed.',
    parameters: {
      type: 'object',
      properties: {
        imagePath: {
          type: 'string',
          description: 'Path to a single image file. Use this OR `images`, not both.'
        },
        images: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of image file paths to analyze in one batch. Use this OR `imagePath`, not both. All images are sent to the vision model together for efficient batch analysis.'
        },
        question: {
          type: 'string',
          description: 'Question about the image(s). For batch analysis, ask the vision model to classify each image individually (e.g. "For each image, tell me if it is anime/manga, a photograph, a screenshot, or an illustration. List results per filename.") Default: "Describe this image in detail."'
        }
      },
      required: []
    },

    async execute(
      args: Record<string, unknown>,
      onUpdate?: (msg: string) => void
    ): Promise<ToolResult> {
      const imagePath = args.imagePath as string | undefined;
      const images = args.images as string[] | undefined;
      const question = (args.question as string) || 'Describe this image in detail.';

      const paths: string[] = [];
      if (imagePath && images) {
        return { success: false, output: 'Provide either imagePath (single) or images (batch), not both.', error: 'Conflicting parameters' };
      }
      if (imagePath) {
        paths.push(imagePath);
      } else if (images && images.length > 0) {
        paths.push(...images);
      } else {
        return { success: false, output: 'Provide either imagePath (single) or images (batch).', error: 'Missing imagePath or images' };
      }

      // Read and encode all images
      const encoded: { dataUrl: string; fileName: string }[] = [];
      for (const p of paths) {
        const result = readAndEncode(p);
        if ('error' in result) {
          return { success: false, output: result.error, error: result.error };
        }
        encoded.push({ dataUrl: result.dataUrl, fileName: result.fileName });
      }

      const isBatch = encoded.length > 1;
      onUpdate?.(`📷 Analyzing ${encoded.length} image(s) via vision model...`);

      try {
        // Get a vision-capable client
        const visionInfo = getVisionClient(mainClient);
        if (!visionInfo) {
          // Try EverFern Cloud vision grounding as last resort (single image only)
          const fullConfig = mainClient.getFullConfig();
          if (fullConfig.provider === 'everfern' && encoded.length === 1) {
            onUpdate?.(`🔄 Using EverFern Cloud vision grounding...`);
            try {
              const result = await mainClient.everfernCloudVisionGrounding({
                screenshot: encoded[0].dataUrl,
                objective: question,
                apiBaseUrl: 'http://localhost:5000',
                token: fullConfig.apiKey,
              });
              return {
                success: true,
                output: result.instruction,
                data: { method: 'everfern_vision_grounding', fileName: encoded[0].fileName }
              };
            } catch (vgErr: any) {
              return { success: false, output: `Vision grounding failed: ${vgErr.message || vgErr}`, error: String(vgErr) };
            }
          }
          return {
            success: false,
            output: 'I tried to analyze an image, but the current AI model cannot process images. To analyze images (including pasted clipboard images), configure a vision-capable model (e.g. GPT-4V, Claude 3 Vision, Gemini) or set up a separate VLM provider in Settings > AI Model.',
            error: 'No vision-capable model available'
          };
        }

        // Build message with all images
        const contentParts: any[] = [];
        if (isBatch) {
          // For batch, include filenames so the model can reference each image
          contentParts.push({
            type: 'text' as const,
            text: `I have ${encoded.length} images to analyze.\n\n${question}\n\nFor each image, please identify it by its filename and provide your analysis.`
          });
          for (const img of encoded) {
            contentParts.push({
              type: 'text' as const,
              text: `--- Image: ${img.fileName} ---`
            });
            contentParts.push({
              type: 'image_url' as const,
              image_url: { url: img.dataUrl, detail: 'low' as const }
            });
          }
        } else {
          contentParts.push({ type: 'text' as const, text: question });
          contentParts.push({
            type: 'image_url' as const,
            image_url: { url: encoded[0].dataUrl, detail: 'auto' as const }
          });
        }

        const messages: ChatMessage[] = [{ role: 'user', content: contentParts }];
        const result = await doVisionChat(visionInfo.client, messages, onUpdate);

        onUpdate?.(`✅ Analysis complete for ${encoded.length} image(s)`);
        return {
          success: true,
          output: result.content,
          data: {
            method: visionInfo.isFallback ? 'vlm_fallback' : 'direct_vision',
            imageCount: encoded.length,
            fileNames: encoded.map(e => e.fileName),
            images: encoded.map(e => ({ fileName: e.fileName, dataUrl: e.dataUrl })),
          }
        };

      } catch (err: any) {
        const msg = err.message || String(err);
        return { success: false, output: `Image analysis failed: ${msg}`, error: msg };
      }
    }
  };
}
