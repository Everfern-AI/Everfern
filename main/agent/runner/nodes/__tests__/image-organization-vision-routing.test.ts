import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function readRepoFile(filePath: string): string {
  return fs.readFileSync(path.join(root, filePath), 'utf-8');
}

describe('image organization vision routing', () => {
  it('keeps anime/downloads image organization in brain with batched vision grounding', () => {
    const brain = readRepoFile('main/agent/runner/nodes/brain.ts');

    expect(brain).toContain('move anime pictures into anime folder');
    expect(brain).toContain('ALWAYS use "continue_brain"');
    expect(brain).toContain('For 20+ images, use visual_classification_sheet');
    expect(brain).toContain('analyze_image to classify by actual visual content in batches of 10-20');
    expect(brain).toContain('Never classify anime/photos from filenames or metadata');
    expect(brain).toContain('spawn generic sub-agents to classify independent sheet batches');
  });

  it('documents the anime folder workflow as visual classification, not filename sorting', () => {
    const prompt = readRepoFile('main/agent/prompts/SYSTEM_PROMPT.md');
    const imageSkill = readRepoFile('main/skills/image-viewer/SKILL.md');

    expect(prompt).toContain('Batch vision grounding');
    expect(prompt).toContain('prefer `visual_classification_sheet` to build numbered contact sheets');
    expect(prompt).toContain('classify in batches of 10-20 files per `analyze_image` call');
    expect(prompt).toContain('Anime sorting rule');
    expect(prompt).toContain('Filenames like `anime_01.png`, metadata, dimensions, or file extensions are not evidence');
    expect(prompt).toContain('Image organization exception');
    expect(prompt).toContain('first use `visual_classification_sheet` to create numbered contact sheets and a manifest');

    expect(imageSkill).toContain('Anime-specific rule');
    expect(imageSkill).toContain('For **batch organization with 20+ images**, use `visual_classification_sheet` first');
    expect(imageSkill).toContain('classify the pixels as anime/manga/anime-style art with vision');
    expect(imageSkill).toContain('Do not');
    expect(imageSkill).toContain('trust filenames, folders, extensions, dimensions, EXIF, or metadata as evidence');
    expect(imageSkill).toContain('return only JSON rows with `file`, `category`,');
  });
});
