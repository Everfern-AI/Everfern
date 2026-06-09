import * as fs from 'fs';
import { describe, expect, it } from 'vitest';
import {
  buildDomParserPrompt,
  createFallbackMarkdown,
  getNavisReportDirectory,
  parseDomSnapshotToMarkdown,
  writeNavisExtractionReport,
  type NavisDomExtractionSnapshot,
} from '../content-extraction-report';
import { executeAction } from '../actions';

const snapshot: NavisDomExtractionSnapshot = {
  url: 'https://example.com/flights',
  title: 'Example Flights',
  capturedAt: '2026-06-09T10:00:00.000Z',
  goal: 'Extract live flight prices',
  metaDescription: 'Flight results',
  mainText: 'Flight A departs 10:00 and costs $512. Flight B departs 14:30 and costs $488.',
  headings: ['Flight results', 'Best options'],
  links: [{ text: 'Book Flight B', href: 'https://example.com/book-b' }],
  buttons: ['Select', 'Book'],
  formFields: [{ label: 'From', type: 'text', name: 'from', placeholder: 'City', value: 'Rotterdam' }],
  tables: [{ headers: ['Airline', 'Price'], rows: [['Example Air', '$488']] }],
};

describe('Navis content extraction report', () => {
  it('builds a DOM parser prompt that asks for markdown and preserves the extraction goal', () => {
    const prompt = buildDomParserPrompt(snapshot, 'Extract live flight prices');

    expect(prompt).toContain('Navis Content Parser');
    expect(prompt).toContain('Return Markdown only');
    expect(prompt).toContain('Extract live flight prices');
    expect(prompt).toContain('$488');
  });

  it('uses the parser AI response as markdown without fences', async () => {
    const aiClient: any = {
      chat: async () => ({ content: '```markdown\n# Flight Prices\n\n- Example Air: $488\n```' }),
    };

    const result = await parseDomSnapshotToMarkdown(snapshot, 'Extract live flight prices', aiClient);

    expect(result.usedAI).toBe(true);
    expect(result.markdown).toBe('# Flight Prices\n\n- Example Air: $488');
  });

  it('strips model thinking blocks from parser AI markdown', async () => {
    const aiClient: any = {
      chat: async () => ({ content: '<think>I should parse the flight list first.</think>\n# Flight Prices\n\n- Example Air: $488' }),
    };

    const result = await parseDomSnapshotToMarkdown(snapshot, 'Extract live flight prices', aiClient);

    expect(result.usedAI).toBe(true);
    expect(result.markdown).toBe('# Flight Prices\n\n- Example Air: $488');
    expect(result.markdown).not.toContain('<think>');
  });

  it('falls back to deterministic markdown if parser AI is unavailable', async () => {
    const result = await parseDomSnapshotToMarkdown(snapshot, 'Extract live flight prices');

    expect(result.usedAI).toBe(false);
    expect(result.markdown).toContain('# Navis Extraction Report');
    expect(result.markdown).toContain('$512');
    expect(result.markdown).toContain('https://example.com/book-b');
  });

  it('writes temporary markdown reports to the Navis report directory', async () => {
    const markdown = createFallbackMarkdown(snapshot, snapshot.goal);
    const reportPath = await writeNavisExtractionReport(markdown, snapshot);

    expect(reportPath).toContain(getNavisReportDirectory());
    expect(reportPath.endsWith('.md')).toBe(true);
    expect(fs.existsSync(reportPath)).toBe(true);
    expect(fs.readFileSync(reportPath, 'utf8')).toContain('Navis Extraction Report');

    fs.rmSync(reportPath, { force: true });
  });

  it('wires the actual extract_content action to a temporary markdown report', async () => {
    const aiClient: any = {
      chat: async () => ({ content: '# Parsed DOM Report\n\n- Extracted through the action path.' }),
    };
    const page: any = {
      evaluate: async () => {
        throw new Error('No DOM in unit test');
      },
      url: () => 'https://example.com/action-path',
      title: async () => 'Action Path Page',
    };

    const result = await executeAction(
      'extract_content',
      { goal: 'Extract action path data' },
      page,
      {} as any,
      undefined,
      1,
      3,
      aiClient,
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain('Temporary Markdown report:');
    expect((result.data as any).reportPath).toContain(getNavisReportDirectory());
    expect(fs.existsSync((result.data as any).reportPath)).toBe(true);
    expect(fs.readFileSync((result.data as any).reportPath, 'utf8')).toContain('Parsed DOM Report');

    fs.rmSync((result.data as any).reportPath, { force: true });
  });
});
