import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { createVisualClassificationSheetTool } from '../visual-classification-sheet';

async function makeFixtureImage(filePath: string, color: string) {
  await sharp({
    create: {
      width: 72,
      height: 48,
      channels: 4,
      background: color,
    },
  })
    .png()
    .toFile(filePath);
}

describe('visual_classification_sheet tool', () => {
  it('creates numbered sheet files and a manifest for a directory of images', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'everfern-visual-sheet-'));
    const imageDir = path.join(tmpRoot, 'images');
    const outputDir = path.join(tmpRoot, 'sheets');
    await fs.mkdir(imageDir, { recursive: true });

    await makeFixtureImage(path.join(imageDir, 'blue.png'), '#2563eb');
    await makeFixtureImage(path.join(imageDir, 'green.png'), '#16a34a');
    await makeFixtureImage(path.join(imageDir, 'red.png'), '#dc2626');

    const tool = createVisualClassificationSheetTool({} as any);
    const result = await tool.execute({
      directory: imageDir,
      outputDir,
      title: 'Fixture Images',
      imagesPerSheet: 4,
      columns: 2,
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Success: created 1 visual classification sheet');
    expect(result.base64Image).toBeTruthy();

    const data = result.data as any;
    expect(data.type).toBe('visual_classification_sheet');
    expect(data.imageCount).toBe(3);
    expect(data.sheetCount).toBe(1);
    expect(data.manifestPath).toBe(path.join(outputDir, 'manifest.json'));

    const manifestRaw = await fs.readFile(data.manifestPath, 'utf-8');
    const manifest = JSON.parse(manifestRaw);
    expect(manifest.images.map((image: any) => image.id)).toEqual([1, 2, 3]);
    expect(manifest.images.map((image: any) => image.fileName)).toEqual(['blue.png', 'green.png', 'red.png']);

    const sheetPath = data.sheets[0].path;
    await expect(fs.access(sheetPath)).resolves.toBeUndefined();
  }, 30000);
});
