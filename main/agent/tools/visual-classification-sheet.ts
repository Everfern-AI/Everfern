import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import sharp from 'sharp';
import type { AgentTool, ToolResult } from '../runner/types';
import type { AIClient, ChatMessage } from '../../lib/ai-client';
import { doVisionChat, getVisionClient } from './analyze-image';

const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.tif', '.svg', '.avif',
]);

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'dist-electron', 'out', 'release',
  '.cache', '.venv', 'venv', '__pycache__',
]);

interface SheetImage {
  id: number;
  path: string;
  fileName: string;
  relativePath: string;
  size: number;
}

interface SheetRecord {
  sheetIndex: number;
  path: string;
  fileName: string;
  firstId: number;
  lastId: number;
  imageCount: number;
  width: number;
  height: number;
  dataUrl?: string;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'images';
}

function truncateMiddle(value: string, max: number): string {
  if (value.length <= max) return value;
  if (max <= 5) return value.slice(0, max);
  const head = Math.ceil((max - 1) * 0.62);
  const tail = Math.floor((max - 1) * 0.38);
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}

function wrapFilename(value: string, maxLineChars = 24, maxLines = 2): string[] {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (!clean) return [''];
  const words = clean.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (!current) {
      current = word;
    } else if ((current + ' ' + word).length <= maxLineChars) {
      current += ' ' + word;
    } else {
      lines.push(current);
      current = word;
    }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && current) lines.push(current);

  const joined = lines.join(' ');
  if (joined.length < clean.length && lines.length > 0) {
    lines[lines.length - 1] = truncateMiddle(lines[lines.length - 1], Math.max(8, maxLineChars - 1)) + '…';
  }
  return lines.slice(0, maxLines).map(line => truncateMiddle(line, maxLineChars));
}

async function collectImages(directory: string, recursive: boolean, maxImages: number): Promise<SheetImage[]> {
  const root = path.resolve(directory);
  const images: SheetImage[] = [];

  async function walk(dir: string): Promise<void> {
    if (images.length >= maxImages) return;
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    for (const entry of entries) {
      if (images.length >= maxImages) return;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (recursive && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          await walk(abs);
        }
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!SUPPORTED_IMAGE_EXTENSIONS.has(ext)) continue;
      try {
        const stat = await fs.stat(abs);
        images.push({
          id: images.length + 1,
          path: abs,
          fileName: entry.name,
          relativePath: path.relative(root, abs),
          size: stat.size,
        });
      } catch {
        // Skip files that disappear while scanning.
      }
    }
  }

  await walk(root);
  return images;
}

function buildOverlaySvg(params: {
  title: string;
  sheetIndex: number;
  sheetCount: number;
  firstOrdinal: number;
  totalImages: number;
  images: SheetImage[];
  tileDataUrls: string[];
  width: number;
  height: number;
  margin: number;
  headerH: number;
  columns: number;
  cellW: number;
  cellH: number;
  imageW: number;
  imageH: number;
  gapX: number;
  gapY: number;
}) {
  const {
    title, sheetIndex, sheetCount, firstOrdinal, totalImages, images, width, height,
    tileDataUrls, margin, headerH, columns, cellW, cellH, imageW, imageH, gapX, gapY,
  } = params;

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="100%" height="100%" fill="#f4f0e8"/>`,
    `<text x="${margin}" y="34" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="800" fill="#171717">${xmlEscape(title)} visual classification sheet ${sheetIndex + 1} (${firstOrdinal}-${firstOrdinal + images.length - 1} of ${totalImages})</text>`,
  ];

  images.forEach((img, idx) => {
    const col = idx % columns;
    const row = Math.floor(idx / columns);
    const x = margin + col * (cellW + gapX);
    const y = headerH + row * (cellH + gapY);
    const labelY = y + imageH + 24;
    const fileLines = wrapFilename(img.fileName);

    parts.push(`<rect x="${x}" y="${y}" width="${imageW}" height="${imageH}" fill="#fff" stroke="#c8c0b2" stroke-width="1"/>`);
    if (tileDataUrls[idx]) {
      parts.push(`<image x="${x}" y="${y}" width="${imageW}" height="${imageH}" href="${tileDataUrls[idx]}"/>`);
    }
    parts.push(`<text x="${x}" y="${labelY}" font-family="Inter, Arial, sans-serif" font-size="17" font-weight="800" fill="#111827">ID ${img.id}</text>`);
    fileLines.forEach((line, lineIdx) => {
      parts.push(`<text x="${x}" y="${labelY + 18 + lineIdx * 15}" font-family="Inter, Arial, sans-serif" font-size="12" font-weight="400" fill="#3f3f46">${xmlEscape(line)}</text>`);
    });
  });

  parts.push(`<text x="${width - margin}" y="${height - 14}" font-family="Inter, Arial, sans-serif" font-size="11" text-anchor="end" fill="#8a8176">Sheet ${sheetIndex + 1}/${sheetCount}</text>`);
  parts.push('</svg>');
  return Buffer.from(parts.join(''));
}

async function renderSheet(params: {
  title: string;
  sheetImages: SheetImage[];
  sheetIndex: number;
  sheetCount: number;
  firstOrdinal: number;
  totalImages: number;
  outputPath: string;
  columns: number;
}) {
  const columns = params.columns;
  const rows = Math.ceil(params.sheetImages.length / columns);
  const imageW = 212;
  const imageH = 170;
  const labelH = 54;
  const gapX = 26;
  const gapY = 26;
  const margin = 16;
  const headerH = 66;
  const cellW = imageW;
  const cellH = imageH + labelH;
  const width = margin * 2 + columns * cellW + (columns - 1) * gapX;
  const height = headerH + rows * cellH + Math.max(0, rows - 1) * gapY + 38;

  const tileDataUrls: string[] = [];
  for (let idx = 0; idx < params.sheetImages.length; idx++) {
    const image = params.sheetImages[idx];
    try {
      const thumb = await sharp(image.path, { animated: false, limitInputPixels: 90_000_000 })
        .rotate()
        .resize({
          width: imageW,
          height: imageH,
          fit: 'contain',
          background: { r: 255, g: 255, b: 255, alpha: 1 },
          withoutEnlargement: false,
        })
        .flatten({ background: '#ffffff' })
        .png()
        .toBuffer();
      tileDataUrls.push(`data:image/png;base64,${thumb.toString('base64')}`);
    } catch {
      const fallbackSvg = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${imageW}" height="${imageH}">
          <rect width="100%" height="100%" fill="#fff"/>
          <text x="50%" y="46%" text-anchor="middle" font-family="Arial" font-size="13" fill="#991b1b">Preview failed</text>
          <text x="50%" y="58%" text-anchor="middle" font-family="Arial" font-size="11" fill="#71717a">${xmlEscape(truncateMiddle(image.fileName, 24))}</text>
        </svg>`
      );
      tileDataUrls.push(`data:image/svg+xml;base64,${fallbackSvg.toString('base64')}`);
    }
  }

  const overlay = buildOverlaySvg({
    title: params.title,
    sheetIndex: params.sheetIndex,
    sheetCount: params.sheetCount,
    firstOrdinal: params.firstOrdinal,
    totalImages: params.totalImages,
    images: params.sheetImages,
    tileDataUrls,
    width,
    height,
    margin,
    headerH,
    columns,
    cellW,
    cellH,
    imageW,
    imageH,
    gapX,
    gapY,
  });

  const renderedBuffer = await sharp(overlay)
    .png({ compressionLevel: 8 })
    .toBuffer();

  await fs.writeFile(params.outputPath, renderedBuffer);
  return { width, height, pngBuffer: renderedBuffer };
}

async function analyzeSheetsWithVision(
  mainClient: AIClient,
  sheets: SheetRecord[],
  question: string,
  maxSheetsPerVisionCall: number,
  onUpdate?: (msg: string) => void,
) {
  const visionInfo = getVisionClient(mainClient);
  if (!visionInfo) {
    throw new Error('No vision-capable model or VLM provider is configured.');
  }

  const chunks: SheetRecord[][] = [];
  for (let i = 0; i < sheets.length; i += maxSheetsPerVisionCall) {
    chunks.push(sheets.slice(i, i + maxSheetsPerVisionCall));
  }

  const outputs: string[] = [];
  for (let idx = 0; idx < chunks.length; idx++) {
    const chunk = chunks[idx];
    onUpdate?.(`Analyzing visual sheet batch ${idx + 1}/${chunks.length} (${chunk.length} sheet${chunk.length === 1 ? '' : 's'})...`);

    const contentParts: any[] = [{
      type: 'text',
      text:
        `${question}\n\n` +
        'Each sheet is a numbered contact sheet. Return structured JSON rows keyed by the visible tile ID. ' +
        'Use this shape: [{"id": 1, "category": "...", "confidence": 0.0-1.0, "reason": "visual evidence"}]. ' +
        'Do not infer from filenames unless the visual content itself is ambiguous.',
    }];

    for (const sheet of chunk) {
      const raw = await fs.readFile(sheet.path);
      contentParts.push({ type: 'text', text: `--- Sheet ${sheet.sheetIndex + 1}: IDs ${sheet.firstId}-${sheet.lastId} ---` });
      contentParts.push({
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${raw.toString('base64')}`, detail: 'low' },
      });
    }

    const messages: ChatMessage[] = [{ role: 'user', content: contentParts }];
    const result = await doVisionChat(visionInfo.client, messages, onUpdate);
    outputs.push(result.content);
  }

  return outputs.join('\n\n');
}

export function createVisualClassificationSheetTool(mainClient: AIClient): AgentTool {
  return {
    name: 'visual_classification_sheet',
    description:
      'Create numbered visual contact sheets from all images in a directory so a vision model can classify many images much faster than checking every file separately. ' +
      'Use this BEFORE analyze_image for large folders (20+ images), image organization, anime/photo/screenshot sorting, or visual audits. ' +
      'The result includes sheet image paths plus a manifest mapping each visible ID back to the original file path. ' +
      'If `question` is provided, this tool also sends the generated sheet(s) to the configured vision grounding model and returns classification output keyed by tile ID.',
    parameters: {
      type: 'object',
      properties: {
        directory: {
          type: 'string',
          description: 'Absolute path to the directory containing images to sheet/classify.',
        },
        recursive: {
          type: 'boolean',
          description: 'Whether to scan subdirectories. Default false.',
        },
        outputDir: {
          type: 'string',
          description: 'Optional directory for generated sheet PNGs and manifest. Defaults to ~/.everfern/visual-sheets/<folder>-<timestamp>.',
        },
        title: {
          type: 'string',
          description: 'Optional title shown at the top of each sheet.',
        },
        imagesPerSheet: {
          type: 'number',
          description: 'Images per sheet. Default 20, min 4, max 30. Use 20 for reliable grid classification.',
        },
        columns: {
          type: 'number',
          description: 'Grid columns per sheet. Default 5, min 2, max 6.',
        },
        maxImages: {
          type: 'number',
          description: 'Maximum images to include to avoid giant accidental scans. Default 500, max 2000.',
        },
        startId: {
          type: 'number',
          description: 'First visible ID number. Default 1.',
        },
        question: {
          type: 'string',
          description: 'Optional vision question. If provided, the generated sheets are sent to the configured vision model for classification.',
        },
        maxSheetsPerVisionCall: {
          type: 'number',
          description: 'When question is provided, how many sheet images to send per vision call. Default 4, max 8.',
        },
      },
      required: ['directory'],
    },
    async execute(args: Record<string, unknown>, onUpdate?: (msg: string) => void): Promise<ToolResult> {
      try {
        const directory = String(args.directory || '').trim();
        if (!directory) {
          return { success: false, output: 'directory is required', error: 'missing_directory' };
        }

        const directoryAbs = path.resolve(directory);
        const stat = await fs.stat(directoryAbs);
        if (!stat.isDirectory()) {
          return { success: false, output: `Not a directory: ${directoryAbs}`, error: 'not_directory' };
        }

        const recursive = args.recursive === true;
        const maxImages = clampInt(args.maxImages, 500, 1, 2000);
        const columns = clampInt(args.columns, 5, 2, 6);
        const imagesPerSheet = clampInt(args.imagesPerSheet, 20, 4, 30);
        const startId = clampInt(args.startId, 1, 1, 999999);
        const title = String(args.title || path.basename(directoryAbs) || 'Images').trim();
        const question = typeof args.question === 'string' ? args.question.trim() : '';
        const maxSheetsPerVisionCall = clampInt(args.maxSheetsPerVisionCall, 4, 1, 8);

        onUpdate?.(`Scanning ${directoryAbs} for images...`);
        const images = await collectImages(directoryAbs, recursive, maxImages);
        images.forEach((img, idx) => { img.id = startId + idx; });

        if (images.length === 0) {
          return {
            success: true,
            output: `No supported image files found in ${directoryAbs}.`,
            data: { type: 'visual_classification_sheet', directory: directoryAbs, imageCount: 0, sheets: [] },
          };
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const outputDir = path.resolve(
          String(args.outputDir || '').trim() ||
          path.join(os.homedir(), '.everfern', 'visual-sheets', `${slugify(path.basename(directoryAbs))}-${timestamp}`)
        );
        await fs.mkdir(outputDir, { recursive: true });

        const chunks: SheetImage[][] = [];
        for (let i = 0; i < images.length; i += imagesPerSheet) {
          chunks.push(images.slice(i, i + imagesPerSheet));
        }

        const sheets: SheetRecord[] = [];
        for (let idx = 0; idx < chunks.length; idx++) {
          const sheetImages = chunks[idx];
          const firstOrdinal = idx * imagesPerSheet + 1;
          const sheetPath = path.join(outputDir, `visual-sheet-${String(idx + 1).padStart(3, '0')}.png`);
          onUpdate?.(`Rendering sheet ${idx + 1}/${chunks.length} (${sheetImages.length} images)...`);
          const rendered = await renderSheet({
            title,
            sheetImages,
            sheetIndex: idx,
            sheetCount: chunks.length,
            firstOrdinal,
            totalImages: images.length,
            outputPath: sheetPath,
            columns,
          });
          const firstSheetDataUrl = idx === 0
            ? `data:image/png;base64,${rendered.pngBuffer.toString('base64')}`
            : undefined;
          sheets.push({
            sheetIndex: idx,
            path: sheetPath,
            fileName: path.basename(sheetPath),
            firstId: sheetImages[0].id,
            lastId: sheetImages[sheetImages.length - 1].id,
            imageCount: sheetImages.length,
            width: rendered.width,
            height: rendered.height,
            dataUrl: firstSheetDataUrl,
          });
        }

        const manifest = {
          type: 'visual_classification_sheet_manifest',
          sourceDirectory: directoryAbs,
          outputDir,
          createdAt: new Date().toISOString(),
          recursive,
          imageCount: images.length,
          sheets: sheets.map(({ dataUrl, ...sheet }) => sheet),
          images: images.map(img => ({
            id: img.id,
            path: img.path,
            fileName: img.fileName,
            relativePath: img.relativePath,
            size: img.size,
            sheetIndex: Math.floor((img.id - startId) / imagesPerSheet) + 1,
          })),
        };
        const manifestPath = path.join(outputDir, 'manifest.json');
        await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

        let visionOutput = '';
        if (question) {
          visionOutput = await analyzeSheetsWithVision(mainClient, sheets, question, maxSheetsPerVisionCall, onUpdate);
        }

        const firstSheetJpegB64 = sheets[0]
          ? (await sharp(sheets[0].path).jpeg({ quality: 88 }).toBuffer()).toString('base64')
          : undefined;

        const sheetLines = sheets
          .map(sheet => `- Sheet ${sheet.sheetIndex + 1}: ${sheet.path} (IDs ${sheet.firstId}-${sheet.lastId})`)
          .join('\n');
        const idPreview = images.slice(0, 30).map(img => `${img.id}: ${img.relativePath}`).join('\n');
        const idPreviewSuffix = images.length > 30 ? `\n... ${images.length - 30} more entries in ${manifestPath}` : '';

        const output =
          `Success: created ${sheets.length} visual classification sheet${sheets.length === 1 ? '' : 's'} for ${images.length} image${images.length === 1 ? '' : 's'}.\n` +
          `Source: ${directoryAbs}\n` +
          `Output folder: ${outputDir}\n` +
          `Manifest: ${manifestPath}\n\n` +
          `${sheetLines}\n\n` +
          `ID map preview:\n${idPreview}${idPreviewSuffix}` +
          (visionOutput ? `\n\nVision classification output:\n${visionOutput}` : `\n\nNext step: call analyze_image with the sheet path(s) above and ask for JSON rows keyed by visible ID, then map IDs back through the manifest.`);

        return {
          success: true,
          output,
          base64Image: firstSheetJpegB64,
          data: {
            type: 'visual_classification_sheet',
            directory: directoryAbs,
            outputDir,
            manifestPath,
            imageCount: images.length,
            sheetCount: sheets.length,
            sheets,
            fileNames: sheets.map(sheet => sheet.path),
            images: sheets
              .filter(sheet => sheet.dataUrl)
              .map(sheet => ({ fileName: sheet.fileName, dataUrl: sheet.dataUrl! })),
            visionOutput,
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          output: `visual_classification_sheet failed: ${message}`,
          error: message,
        };
      }
    },
  };
}
