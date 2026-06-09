import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pptxGeneratorTool } from '../pptx-generator';

function tempPptxPath(name: string): string {
  const dir = path.join(os.tmpdir(), 'everfern-pptx-generator-tests');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, name);
}

describe('pptxGeneratorTool adaptive design engine', () => {
  it('generates an adaptive unique deck with varied slide intents', async () => {
    const outputPath = tempPptxPath('adaptive-anime-pitch.test.pptx');
    fs.rmSync(outputPath, { force: true });

    const result = await pptxGeneratorTool.execute({
      title: 'Neon Bento: Anime Discovery Pitch',
      subtitle: 'A cinematic product concept for fans who want smarter discovery',
      deckGoal: 'Pitch a unique anime discovery app to early investors',
      audience: 'consumer app investors and anime fan communities',
      visualDirection: 'cyberpunk anime editorial with kinetic neon UI panels',
      mood: 'cinematic, sharp, high-energy, premium',
      designMode: 'adaptive',
      outputPath,
      slides: [
        { title: 'Anime discovery is fragmented', intent: 'hero', content: ['Fans jump between ratings sites, social feeds, clips, and forums just to decide what to watch next.'], speakerNotes: 'Open with the current pain.' },
        { title: 'The signal is already there', intent: 'dataCallout', metric: '4x', metricLabel: 'more recommendation signals than a normal ratings list', stats: [{ value: 'Social', label: 'fan momentum' }, { value: 'Mood', label: 'watch intent' }] },
        { title: 'A personalized anime radar', intent: 'diagram', diagramNodes: ['Taste graph', 'Mood picker', 'Season tracker', 'Clip intelligence'] },
        { title: 'From browsing to obsession', intent: 'timeline', timelineItems: ['Open app', 'Pick vibe', 'Preview trailer moments', 'Save watchlist'] },
        { title: 'Build the fan-native discovery layer', intent: 'closing', content: ['Start with discovery, expand into community and commerce.'] },
      ],
    });

    expect(result.success).toBe(true);
    expect(fs.existsSync(outputPath)).toBe(true);
    expect(fs.statSync(outputPath).size).toBeGreaterThan(50_000);
    expect((result.data as any).designMode).toBe('adaptive');
    expect((result.data as any).deckType).toBe('investor pitch');
    expect((result.data as any).slideIntents).toEqual(['hero', 'dataCallout', 'diagram', 'timeline', 'closing']);
  });

  it('accepts legacy layout input and maps it to richer slide intents', async () => {
    const outputPath = tempPptxPath('legacy-layouts.test.pptx');
    fs.rmSync(outputPath, { force: true });

    const result = await pptxGeneratorTool.execute({
      title: 'Legacy Input Smoke',
      outputPath,
      theme: 'professional',
      slides: [
        { title: 'Overview', layout: 'titleContent', content: ['One', 'Two', 'Three'] },
        { title: 'Compare', layout: 'twoColumn', leftContent: ['A', 'B'], rightContent: ['C', 'D'] },
        { title: 'Quote', layout: 'quote', quote: 'Simple is not boring when designed well.', quoteAuthor: 'EverFern' },
      ],
    });

    expect(result.success).toBe(true);
    expect(fs.existsSync(outputPath)).toBe(true);
    expect(fs.statSync(outputPath).size).toBeGreaterThan(35_000);
    expect((result.data as any).slideIntents).toEqual(['splitNarrative', 'comparison', 'quote']);
  });
});
