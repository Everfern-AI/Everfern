import PptxGenJS from 'pptxgenjs';
import { AgentTool, ToolResult } from '../runner/types';
import * as path from 'path';
import * as fs from 'fs';

type LegacyLayout = 'title' | 'titleContent' | 'twoColumn' | 'imageText' | 'quote' | 'blank';
type SlideIntent =
  | LegacyLayout
  | 'hero'
  | 'sectionBreak'
  | 'bigNumber'
  | 'timeline'
  | 'map'
  | 'diagram'
  | 'comparison'
  | 'storyboard'
  | 'gallery'
  | 'dataCallout'
  | 'splitNarrative'
  | 'closing';

interface BrandSpec {
  name?: string;
  colors?: string[];
  font?: string;
  logoPath?: string;
}

export interface SlideContent {
  title: string;
  subtitle?: string;
  kicker?: string;
  content?: string[];
  layout?: LegacyLayout;
  intent?: SlideIntent;
  visualIdea?: string;
  layoutStrategy?: string;
  leftContent?: string[];
  rightContent?: string[];
  imageUrl?: string;
  imagePath?: string;
  images?: string[];
  quote?: string;
  quoteAuthor?: string;
  bullets?: string[];
  notes?: string;
  speakerNotes?: string;
  metric?: string;
  metricLabel?: string;
  stats?: Array<{ label?: string; value?: string; detail?: string }>;
  timelineItems?: Array<{ label?: string; title?: string; detail?: string } | string>;
  diagramNodes?: Array<{ label?: string; detail?: string } | string>;
  comparison?: {
    leftTitle?: string;
    rightTitle?: string;
    left?: string[];
    right?: string[];
  };
}

export interface PresentationRequest {
  title: string;
  subtitle?: string;
  author?: string;
  outputPath: string;
  slides: SlideContent[];
  theme?:
    | 'professional'
    | 'modern'
    | 'creative'
    | 'minimal'
    | 'dark'
    | 'gradient'
    | 'editorial-dark'
    | 'studio-light'
    | 'executive-minimal'
    | 'magazine'
    | 'product-launch'
    | 'data-room';
  includeTitleSlide?: boolean;
  deckGoal?: string;
  audience?: string;
  visualDirection?: string;
  brand?: string | BrandSpec;
  mood?: string;
  sourceMaterial?: string;
  designMode?: 'adaptive';
}

interface Palette {
  background: string;
  surface: string;
  surfaceAlt: string;
  primary: string;
  secondary: string;
  accent: string;
  accent2: string;
  text: string;
  muted: string;
  inverse: string;
}

interface StyleGuide {
  name: string;
  deckType: string;
  visualDirection: string;
  visualMetaphor: string;
  motif: 'editorial' | 'orbital' | 'neon' | 'luxury' | 'playful' | 'grid' | 'organic';
  isDark: boolean;
  palette: Palette;
  fonts: {
    heading: string;
    body: string;
    accent: string;
  };
}

interface NormalizedSlide extends SlideContent {
  intent: SlideIntent;
  displayContent: string[];
  notesText: string;
  visualIdea: string;
}

const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const M = 0.58;

const classicThemes: Record<string, Palette> = {
  professional: {
    primary: '2E86AB',
    secondary: 'A23B72',
    accent: 'F18F01',
    accent2: '5BC0EB',
    background: 'FFFFFF',
    surface: 'F7FAFC',
    surfaceAlt: 'EAF4F8',
    text: '27323A',
    muted: '667085',
    inverse: 'FFFFFF',
  },
  modern: {
    primary: '00A8CC',
    secondary: 'F08181',
    accent: '111827',
    accent2: 'F7B267',
    background: 'F7F7F7',
    surface: 'FFFFFF',
    surfaceAlt: 'E9F7FB',
    text: '2C3E50',
    muted: '718096',
    inverse: 'FFFFFF',
  },
  creative: {
    primary: 'FF6B6B',
    secondary: '4ECDC4',
    accent: 'FFE66D',
    accent2: '7C3AED',
    background: 'FFFFFF',
    surface: 'FFF7ED',
    surfaceAlt: 'ECFEFF',
    text: '253141',
    muted: '64748B',
    inverse: '111827',
  },
  minimal: {
    primary: '34495E',
    secondary: '7F8C8D',
    accent: 'BDC3C7',
    accent2: '111827',
    background: 'FFFFFF',
    surface: 'F8FAFC',
    surfaceAlt: 'EEF2F7',
    text: '2C3E50',
    muted: '667085',
    inverse: 'FFFFFF',
  },
  dark: {
    primary: '3498DB',
    secondary: 'E74C3C',
    accent: '1ABC9C',
    accent2: 'F59E0B',
    background: '121626',
    surface: '1A1F33',
    surfaceAlt: '242B45',
    text: 'ECF0F1',
    muted: 'AAB4C8',
    inverse: '0B1020',
  },
  gradient: {
    primary: '667EEA',
    secondary: '764BA2',
    accent: 'F093FB',
    accent2: '45E3FF',
    background: 'FFFFFF',
    surface: 'F8FAFF',
    surfaceAlt: 'EEF2FF',
    text: '2D3748',
    muted: '718096',
    inverse: 'FFFFFF',
  },
};

const adaptivePalettes: Record<string, { palette: Palette; motif: StyleGuide['motif']; isDark: boolean; fonts?: Partial<StyleGuide['fonts']> }> = {
  anime: {
    motif: 'neon',
    isDark: true,
    palette: {
      background: '0B1020',
      surface: '141A33',
      surfaceAlt: '1C2450',
      primary: '8B5CF6',
      secondary: '06B6D4',
      accent: 'F472B6',
      accent2: 'A7F3D0',
      text: 'F8FAFC',
      muted: 'B6C3DA',
      inverse: '0B1020',
    },
  },
  luxury: {
    motif: 'luxury',
    isDark: false,
    palette: {
      background: 'F8F2E8',
      surface: 'FFFDF8',
      surfaceAlt: 'EFE2CF',
      primary: '171412',
      secondary: '7C5A2D',
      accent: 'C79A3B',
      accent2: '8B7355',
      text: '1E1A16',
      muted: '756A5D',
      inverse: 'FFFFFF',
    },
    fonts: { heading: 'Georgia', accent: 'Georgia' },
  },
  climate: {
    motif: 'orbital',
    isDark: true,
    palette: {
      background: '07111F',
      surface: '0E2238',
      surfaceAlt: '123654',
      primary: '7DD3FC',
      secondary: '34D399',
      accent: 'FDE68A',
      accent2: '60A5FA',
      text: 'EFF6FF',
      muted: 'B9C7D8',
      inverse: '07111F',
    },
  },
  startup: {
    motif: 'grid',
    isDark: false,
    palette: {
      background: 'FBFCFF',
      surface: 'FFFFFF',
      surfaceAlt: 'EEF2FF',
      primary: '3730A3',
      secondary: '0F766E',
      accent: 'A3E635',
      accent2: '38BDF8',
      text: '101828',
      muted: '667085',
      inverse: 'FFFFFF',
    },
  },
  playful: {
    motif: 'playful',
    isDark: false,
    palette: {
      background: 'FFF7ED',
      surface: 'FFFFFF',
      surfaceAlt: 'FEF3C7',
      primary: 'E11D48',
      secondary: '2563EB',
      accent: 'FACC15',
      accent2: '22C55E',
      text: '1F2937',
      muted: '6B7280',
      inverse: 'FFFFFF',
    },
  },
  executive: {
    motif: 'editorial',
    isDark: false,
    palette: {
      background: 'F6F7F9',
      surface: 'FFFFFF',
      surfaceAlt: 'E8ECF2',
      primary: '111827',
      secondary: '334155',
      accent: '2563EB',
      accent2: '14B8A6',
      text: '111827',
      muted: '64748B',
      inverse: 'FFFFFF',
    },
  },
  data: {
    motif: 'grid',
    isDark: true,
    palette: {
      background: '0A0F1A',
      surface: '101827',
      surfaceAlt: '172033',
      primary: '38BDF8',
      secondary: 'A78BFA',
      accent: '22C55E',
      accent2: 'F59E0B',
      text: 'E5F0FF',
      muted: '95A3B8',
      inverse: '0A0F1A',
    },
  },
  magazine: {
    motif: 'editorial',
    isDark: false,
    palette: {
      background: 'FAFAF7',
      surface: 'FFFFFF',
      surfaceAlt: 'EFEDE7',
      primary: '111111',
      secondary: '6D28D9',
      accent: 'EF4444',
      accent2: 'F59E0B',
      text: '18181B',
      muted: '71717A',
      inverse: 'FFFFFF',
    },
    fonts: { heading: 'Georgia', accent: 'Georgia' },
  },
};

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function listValue(...values: unknown[]): string[] {
  for (const value of values) {
    if (Array.isArray(value)) {
      return value.map((item) => stringValue(item)).filter(Boolean);
    }
  }
  return [];
}

function cleanHex(value: string | undefined, fallback: string): string {
  const raw = (value || '').replace('#', '').trim();
  return /^[0-9a-f]{6}$/i.test(raw) ? raw.toUpperCase() : fallback;
}

function shorten(text: string, max = 92): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, Math.max(0, max - 1)).trim()}...` : clean;
}

function titleCase(text: string): string {
  return text
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

function safeBrandName(brand: PresentationRequest['brand']): string {
  if (!brand) return '';
  return typeof brand === 'string' ? brand : stringValue(brand.name);
}

function inferDeckType(text: string): string {
  const lower = text.toLowerCase();
  if (/\b(investor|fundraise|seed|series|pitch)\b/.test(lower)) return 'investor pitch';
  if (/\b(lesson|class|school|lecture|teach|student)\b/.test(lower)) return 'lecture';
  if (/\b(report|briefing|analysis|research|memo)\b/.test(lower)) return 'briefing';
  if (/\b(product|launch|feature|roadmap|saas)\b/.test(lower)) return 'product launch';
  if (/\b(portfolio|case study|showcase)\b/.test(lower)) return 'portfolio';
  if (/\b(strategy|executive|board|leadership)\b/.test(lower)) return 'executive strategy';
  return 'editorial presentation';
}

function chooseStyleKey(request: PresentationRequest): string {
  const text = [
    request.title,
    request.subtitle,
    request.deckGoal,
    request.audience,
    request.visualDirection,
    request.mood,
    request.sourceMaterial,
    safeBrandName(request.brand),
    request.theme,
  ].filter(Boolean).join(' ').toLowerCase();

  if (/(anime|manga|cyberpunk|neon|game|gaming|esports|sci-fi|sci fi)/.test(text)) return 'anime';
  if (/(luxury|fashion|real estate|hotel|resort|premium|jewelry|watch|villa)/.test(text)) return 'luxury';
  if (/(climate|earth|nasa|space|science|environment|ocean|energy)/.test(text)) return 'climate';
  if (/(startup|saas|product|launch|founder|growth|investor|pitch)/.test(text)) return 'startup';
  if (/(school|gen z|kids|playful|fun|creative|festival|club)/.test(text)) return 'playful';
  if (/(data|analytics|dashboard|metrics|finance|forecast|market)/.test(text)) return 'data';
  if (/(magazine|editorial|story|culture|brand|campaign)/.test(text)) return 'magazine';
  if (request.theme && adaptivePalettes[request.theme]) return request.theme;
  return 'executive';
}

function buildStyleGuide(request: PresentationRequest): StyleGuide {
  const styleKey = chooseStyleKey(request);
  const selected = adaptivePalettes[styleKey] || adaptivePalettes.executive;
  const classic = request.theme && classicThemes[request.theme] ? classicThemes[request.theme] : undefined;
  const brand = typeof request.brand === 'object' ? request.brand : undefined;
  const brandColors = brand?.colors?.filter(Boolean) || [];

  const palette: Palette = {
    ...(classic || selected.palette),
    primary: cleanHex(brandColors[0], (classic || selected.palette).primary),
    secondary: cleanHex(brandColors[1], (classic || selected.palette).secondary),
    accent: cleanHex(brandColors[2], (classic || selected.palette).accent),
  };

  const topicText = [
    request.title,
    request.subtitle,
    request.deckGoal,
    request.audience,
    request.visualDirection,
    request.mood,
    request.sourceMaterial,
  ].filter(Boolean).join(' ');

  return {
    name: styleKey,
    deckType: inferDeckType(topicText),
    visualDirection: request.visualDirection || `${titleCase(styleKey)} editorial system`,
    visualMetaphor: request.visualDirection || request.mood || inferMetaphor(topicText, styleKey),
    motif: selected.motif,
    isDark: selected.isDark || request.theme === 'dark',
    palette,
    fonts: {
      heading: brand?.font || selected.fonts?.heading || 'Aptos Display',
      body: brand?.font || selected.fonts?.body || 'Aptos',
      accent: brand?.font || selected.fonts?.accent || 'Aptos Display',
    },
  };
}

function inferMetaphor(text: string, styleKey: string): string {
  const lower = text.toLowerCase();
  if (/(climate|earth|space|science)/.test(lower)) return 'orbital data systems and field notes';
  if (/(anime|game|cyberpunk)/.test(lower)) return 'kinetic neon panels and cinematic frames';
  if (/(luxury|fashion|real estate)/.test(lower)) return 'gallery-grade editorial spreads';
  if (/(startup|product|launch)/.test(lower)) return 'clean product narrative with momentum lines';
  if (/(data|analytics|finance)/.test(lower)) return 'control-room metrics and signal paths';
  if (styleKey === 'playful') return 'bright modular stickers and classroom energy';
  return 'magazine-style hierarchy and purposeful white space';
}

function normalizeSlides(request: PresentationRequest, style: StyleGuide): NormalizedSlide[] {
  const rawSlides = Array.isArray(request.slides) && request.slides.length > 0
    ? request.slides
    : [{
        title: 'Overview',
        content: [request.sourceMaterial || request.deckGoal || request.subtitle || request.title],
      }];

  let previousIntent = '';
  return rawSlides.map((raw, index) => {
    const content = listValue(raw.content, raw.bullets);
    const displayContent = content.slice(0, 5).map((item) => shorten(item, 88));
    const explicitIntent = raw.intent || raw.layout;
    let intent = inferSlideIntent(raw, index, rawSlides.length, previousIntent, style, Boolean(explicitIntent));
    previousIntent = intent;

    const notesText = [
      raw.speakerNotes,
      raw.notes,
      content.length > displayContent.length ? content.slice(displayContent.length).join('\n') : '',
      raw.visualIdea ? `Visual idea: ${raw.visualIdea}` : '',
      raw.layoutStrategy ? `Layout strategy: ${raw.layoutStrategy}` : '',
    ].filter(Boolean).join('\n\n');

    return {
      ...raw,
      title: stringValue(raw.title) || `Slide ${index + 1}`,
      intent,
      displayContent,
      notesText,
      visualIdea: raw.visualIdea || buildSlideVisualIdea(raw, intent, style),
    };
  });
}

function inferSlideIntent(
  slide: SlideContent,
  index: number,
  total: number,
  previousIntent: string,
  style: StyleGuide,
  respectExplicit: boolean,
): SlideIntent {
  const requested = slide.intent || mapLegacyLayout(slide.layout);
  if (requested && respectExplicit) return requested;

  const text = [slide.title, ...(slide.content || []), ...(slide.bullets || [])].join(' ').toLowerCase();
  let inferred: SlideIntent;

  if (index === total - 1 && /(next|closing|summary|thank|final|action|call)/.test(text)) inferred = 'closing';
  else if (index === 0 && total > 2) inferred = 'hero';
  else if (/(phase|roadmap|timeline|history|journey|milestone|year|month|step)/.test(text)) inferred = 'timeline';
  else if (/( vs |versus|compare|comparison|before|after|pros|cons|tradeoff)/.test(text)) inferred = 'comparison';
  else if (/(quote|said|believe)/.test(text) || slide.quote) inferred = 'quote';
  else if (/(%|\$|x\b|million|billion|growth|metric|kpi|number|data|stat)/.test(text) || slide.metric || slide.stats?.length) inferred = 'dataCallout';
  else if (/(system|architecture|workflow|ecosystem|model|loop|process|framework)/.test(text) || slide.diagramNodes?.length) inferred = 'diagram';
  else if (/(map|region|market|geography|global|country)/.test(text)) inferred = 'map';
  else if (slide.images?.length || slide.imagePath || slide.imageUrl) inferred = 'gallery';
  else if (/(section|chapter|part\s+\d)/.test(text)) inferred = 'sectionBreak';
  else inferred = index % 3 === 1 ? 'splitNarrative' : index % 3 === 2 ? 'bigNumber' : 'storyboard';

  if (inferred === previousIntent) {
    const rotation: SlideIntent[] = style.motif === 'grid'
      ? ['splitNarrative', 'dataCallout', 'diagram', 'comparison']
      : ['storyboard', 'bigNumber', 'splitNarrative', 'diagram'];
    inferred = rotation[index % rotation.length];
  }
  return inferred;
}

function mapLegacyLayout(layout?: LegacyLayout): SlideIntent | undefined {
  switch (layout) {
    case 'title': return 'sectionBreak';
    case 'titleContent': return 'splitNarrative';
    case 'twoColumn': return 'comparison';
    case 'imageText': return 'gallery';
    case 'quote': return 'quote';
    case 'blank': return 'diagram';
    default: return undefined;
  }
}

function buildSlideVisualIdea(slide: SlideContent, intent: SlideIntent, style: StyleGuide): string {
  const subject = slide.title || intent;
  if (intent === 'timeline') return `A paced sequence showing how ${subject} unfolds over time.`;
  if (intent === 'diagram') return `A system diagram for ${subject} using ${style.visualMetaphor}.`;
  if (intent === 'dataCallout' || intent === 'bigNumber') return `A bold metric moment that makes ${subject} instantly memorable.`;
  if (intent === 'comparison') return `A side-by-side editorial contrast for ${subject}.`;
  if (intent === 'gallery' || intent === 'storyboard') return `A visual storyboard around ${subject}.`;
  return `${style.visualDirection}: ${subject}.`;
}

function addText(slide: any, text: string, options: any, style: StyleGuide): void {
  if (!text) return;
  slide.addText(text, {
    margin: 0,
    breakLine: false,
    fit: 'shrink',
    color: options.color || style.palette.text,
    fontFace: options.fontFace || style.fonts.body,
    ...options,
  });
}

function addShape(slide: any, pres: any, shapeName: string, options: any): void {
  const shapeType = (pres.ShapeType as any)?.[shapeName] || shapeName;
  slide.addShape(shapeType, options);
}

function addLine(slide: any, pres: any, x1: number, y1: number, x2: number, y2: number, color: string, width = 1.4): void {
  addShape(slide, pres, 'line', {
    x: x1,
    y: y1,
    w: x2 - x1,
    h: y2 - y1,
    line: { color, width, transparency: 18 },
  });
}

function addCard(slide: any, pres: any, x: number, y: number, w: number, h: number, style: StyleGuide, options?: { color?: string; line?: string; transparency?: number }): void {
  addShape(slide, pres, 'roundRect', {
    x,
    y,
    w,
    h,
    rectRadius: 0.08,
    fill: { color: options?.color || style.palette.surface, transparency: options?.transparency ?? 0 },
    line: { color: options?.line || style.palette.surfaceAlt, transparency: 15, width: 0.75 },
  });
}

function addKicker(slide: any, text: string, x: number, y: number, w: number, style: StyleGuide): void {
  if (!text) return;
  addText(slide, text.toUpperCase(), {
    x,
    y,
    w,
    h: 0.22,
    fontSize: 8.5,
    bold: true,
    charSpace: 1.4,
    color: style.palette.accent,
    fontFace: style.fonts.body,
  }, style);
}

function addFooter(slide: any, pres: any, request: PresentationRequest, style: StyleGuide, index: number, total: number): void {
  const brandName = safeBrandName(request.brand) || request.author || 'EverFern';
  addShape(slide, pres, 'rect', {
    x: M,
    y: SLIDE_H - 0.42,
    w: 0.18,
    h: 0.035,
    fill: { color: style.palette.accent },
    line: { color: style.palette.accent },
  });
  addText(slide, brandName, {
    x: M + 0.28,
    y: SLIDE_H - 0.5,
    w: 3.2,
    h: 0.18,
    fontSize: 7.5,
    color: style.palette.muted,
  }, style);
  addText(slide, `${index}/${total}`, {
    x: SLIDE_W - 1.05,
    y: SLIDE_H - 0.5,
    w: 0.5,
    h: 0.18,
    fontSize: 7.5,
    align: 'right',
    color: style.palette.muted,
  }, style);
}

function addBackground(slide: any, pres: any, style: StyleGuide, variant = 0): void {
  slide.background = { color: style.palette.background };

  if (style.motif === 'neon') {
    addShape(slide, pres, 'ellipse', {
      x: 8.6,
      y: -0.8,
      w: 4.6,
      h: 4.6,
      fill: { color: style.palette.primary, transparency: 54 },
      line: { color: style.palette.primary, transparency: 100 },
    });
    addShape(slide, pres, 'ellipse', {
      x: -1.2,
      y: 5.0,
      w: 4.2,
      h: 4.2,
      fill: { color: style.palette.accent, transparency: 62 },
      line: { color: style.palette.accent, transparency: 100 },
    });
  } else if (style.motif === 'luxury') {
    addShape(slide, pres, 'rect', {
      x: 0,
      y: 0,
      w: 0.18,
      h: SLIDE_H,
      fill: { color: style.palette.accent },
      line: { color: style.palette.accent },
    });
    addShape(slide, pres, 'arc', {
      x: 8.0,
      y: -0.4,
      w: 4.8,
      h: 4.8,
      adjustPoint: 0.22,
      line: { color: style.palette.accent, transparency: 20, width: 1.2 },
      fill: { color: style.palette.background, transparency: 100 },
    });
  } else if (style.motif === 'orbital') {
    addShape(slide, pres, 'ellipse', {
      x: 7.8,
      y: 0.3,
      w: 5.2,
      h: 5.2,
      fill: { color: style.palette.background, transparency: 100 },
      line: { color: style.palette.primary, transparency: 48, width: 1 },
    });
    addShape(slide, pres, 'ellipse', {
      x: 9.25,
      y: 1.72,
      w: 0.24,
      h: 0.24,
      fill: { color: style.palette.accent },
      line: { color: style.palette.accent },
    });
  } else if (style.motif === 'playful') {
    const colors = [style.palette.accent, style.palette.secondary, style.palette.accent2];
    colors.forEach((color, i) => {
      addShape(slide, pres, 'roundRect', {
        x: 9.2 + i * 0.72,
        y: 0.45 + (i % 2) * 0.38,
        w: 1.05,
        h: 0.42,
        rotate: -8 + i * 13,
        fill: { color, transparency: 12 },
        line: { color, transparency: 100 },
      });
    });
  } else if (style.motif === 'grid') {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><defs><pattern id="g" width="72" height="72" patternUnits="userSpaceOnUse"><path d="M72 0H0V72" fill="none" stroke="#${style.palette.surfaceAlt}" stroke-width="1" opacity=".38"/></pattern></defs><rect width="1600" height="900" fill="url(#g)"/><path d="M1130 0 1600 0 1600 280 C1420 250 1270 170 1130 0Z" fill="#${style.palette.primary}" opacity=".11"/></svg>`;
    try {
      slide.addImage({ data: svgDataUri(svg), x: 0, y: 0, w: SLIDE_W, h: SLIDE_H });
    } catch {
      // Some PowerPoint renderers are strict about SVG data. The slide still has shape-based design.
    }
  } else {
    addShape(slide, pres, 'rect', {
      x: 0,
      y: variant % 2 === 0 ? 0 : SLIDE_H - 0.18,
      w: SLIDE_W,
      h: 0.16,
      fill: { color: style.palette.primary, transparency: 8 },
      line: { color: style.palette.primary, transparency: 100 },
    });
  }
}

function addGeneratedVisual(slide: any, style: StyleGuide, title: string, x: number, y: number, w: number, h: number, mode: 'panel' | 'diagram' | 'image' = 'panel'): void {
  const label = escapeXml(shorten(title, 44));
  const bg = style.isDark ? style.palette.surfaceAlt : style.palette.surface;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
  <defs>
    <linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#${style.palette.primary}" stop-opacity=".86"/><stop offset=".55" stop-color="#${style.palette.secondary}" stop-opacity=".72"/><stop offset="1" stop-color="#${style.palette.accent}" stop-opacity=".82"/></linearGradient>
    <pattern id="dots" width="42" height="42" patternUnits="userSpaceOnUse"><circle cx="4" cy="4" r="2" fill="#${style.palette.inverse}" opacity=".16"/></pattern>
  </defs>
  <rect width="1200" height="800" rx="42" fill="#${bg}"/>
  <rect width="1200" height="800" fill="url(#dots)"/>
  <circle cx="930" cy="95" r="210" fill="url(#a)" opacity=".72"/>
  <circle cx="215" cy="660" r="260" fill="#${style.palette.accent2}" opacity=".22"/>
  <path d="M80 540 C260 430 340 640 520 510 S825 295 1120 398" fill="none" stroke="#${style.palette.accent}" stroke-width="18" stroke-linecap="round" opacity=".75"/>
  ${mode === 'diagram' ? '<g opacity=".9"><circle cx="600" cy="390" r="92" fill="url(#a)"/><circle cx="300" cy="280" r="58" fill="#fff" opacity=".9"/><circle cx="890" cy="300" r="58" fill="#fff" opacity=".9"/><circle cx="438" cy="590" r="58" fill="#fff" opacity=".9"/><circle cx="790" cy="590" r="58" fill="#fff" opacity=".9"/></g>' : ''}
  <text x="80" y="120" font-family="Aptos, Arial, sans-serif" font-size="38" font-weight="700" fill="#${style.palette.text}" opacity=".92">${label}</text>
  <text x="82" y="172" font-family="Aptos, Arial, sans-serif" font-size="20" fill="#${style.palette.muted}" opacity=".9">${escapeXml(style.visualMetaphor)}</text>
</svg>`;
  try {
    slide.addImage({ data: svgDataUri(svg), x, y, w, h });
  } catch {
    // Fallback: leave the shape-based composition intact.
  }
}

function addImageIfAvailable(slide: any, imagePath: string | undefined, imageUrl: string | undefined, x: number, y: number, w: number, h: number): boolean {
  const sourcePath = imagePath && fs.existsSync(imagePath) ? imagePath : '';
  try {
    if (sourcePath) {
      slide.addImage({ path: sourcePath, x, y, w, h });
      return true;
    }
    if (imageUrl && imageUrl.startsWith('data:')) {
      slide.addImage({ data: imageUrl, x, y, w, h });
      return true;
    }
    if (imageUrl && /^https?:\/\//i.test(imageUrl)) {
      slide.addImage({ path: imageUrl, x, y, w, h });
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function addBulletStack(slide: any, pres: any, items: string[], x: number, y: number, w: number, style: StyleGuide, options?: { max?: number; fontSize?: number; color?: string }): void {
  const visible = items.slice(0, options?.max ?? 4);
  const fontSize = options?.fontSize ?? 13;
  visible.forEach((item, i) => {
    const top = y + i * 0.48;
    addShape(slide, pres, 'ellipse', {
      x,
      y: top + 0.08,
      w: 0.11,
      h: 0.11,
      fill: { color: i % 2 === 0 ? style.palette.accent : style.palette.secondary },
      line: { color: i % 2 === 0 ? style.palette.accent : style.palette.secondary },
    });
    addText(slide, shorten(item, 86), {
      x: x + 0.22,
      y: top,
      w,
      h: 0.36,
      fontSize,
      color: options?.color || style.palette.text,
      breakLine: false,
    }, style);
  });
}

function setSpeakerNotes(slide: any, notes: string): void {
  const clean = stringValue(notes);
  if (!clean) return;
  try {
    if (typeof slide.addNotes === 'function') {
      slide.addNotes(clean);
    } else {
      slide.notes = clean;
    }
  } catch {
    slide.notes = clean;
  }
}

function renderTitleSlide(pres: any, request: PresentationRequest, style: StyleGuide): void {
  const slide = pres.addSlide();
  addBackground(slide, pres, style, 0);

  addKicker(slide, [style.deckType, request.audience].filter(Boolean).join(' / '), M, 0.72, 6, style);
  addText(slide, request.title, {
    x: M,
    y: 1.3,
    w: 7.3,
    h: 1.8,
    fontSize: 39,
    bold: true,
    fontFace: style.fonts.heading,
    color: style.palette.text,
    margin: 0,
    fit: 'shrink',
  }, style);

  if (request.subtitle || request.deckGoal) {
    addText(slide, shorten(request.subtitle || request.deckGoal || '', 150), {
      x: M,
      y: 3.28,
      w: 5.9,
      h: 0.72,
      fontSize: 16,
      color: style.palette.muted,
      breakLine: false,
    }, style);
  }

  addGeneratedVisual(slide, style, request.visualDirection || request.title, 8.05, 0.85, 4.65, 4.95, 'image');

  addCard(slide, pres, M, 5.6, 5.35, 0.78, style, { color: style.palette.surfaceAlt, transparency: style.isDark ? 10 : 0 });
  addText(slide, style.visualMetaphor, {
    x: M + 0.28,
    y: 5.82,
    w: 4.8,
    h: 0.24,
    fontSize: 10.8,
    color: style.palette.text,
    bold: true,
  }, style);

  if (request.author) {
    addText(slide, request.author, {
      x: SLIDE_W - 3.2,
      y: SLIDE_H - 0.62,
      w: 2.55,
      h: 0.22,
      fontSize: 9,
      align: 'right',
      color: style.palette.muted,
    }, style);
  }
}

function renderHero(slide: any, pres: any, request: PresentationRequest, style: StyleGuide, s: NormalizedSlide, index: number, total: number): void {
  addKicker(slide, s.kicker || s.intent, M, 0.72, 4, style);
  addText(slide, s.title, {
    x: M,
    y: 1.08,
    w: 6.35,
    h: 1.35,
    fontSize: 32,
    bold: true,
    fontFace: style.fonts.heading,
  }, style);
  addText(slide, shorten(s.subtitle || s.displayContent[0] || s.visualIdea, 155), {
    x: M,
    y: 2.7,
    w: 5.55,
    h: 0.92,
    fontSize: 15,
    color: style.palette.muted,
  }, style);
  addGeneratedVisual(slide, style, s.visualIdea, 7.35, 0.72, 5.25, 5.35, 'image');
  addBulletStack(slide, pres, s.displayContent.slice(1), M, 4.32, 5.6, style, { max: 3, fontSize: 12.6 });
  addFooter(slide, pres, request, style, index, total);
}

function renderSplitNarrative(slide: any, pres: any, request: PresentationRequest, style: StyleGuide, s: NormalizedSlide, index: number, total: number): void {
  addKicker(slide, s.kicker || 'Narrative', M, 0.66, 4, style);
  addText(slide, s.title, {
    x: M,
    y: 1.02,
    w: 4.6,
    h: 1.15,
    fontSize: 26,
    bold: true,
    fontFace: style.fonts.heading,
  }, style);
  addText(slide, shorten(s.subtitle || s.visualIdea, 126), {
    x: M,
    y: 2.4,
    w: 4.25,
    h: 0.9,
    fontSize: 12.7,
    color: style.palette.muted,
  }, style);

  addCard(slide, pres, 5.45, 0.85, 6.95, 5.6, style, { color: style.palette.surface, transparency: style.isDark ? 6 : 0 });
  addShape(slide, pres, 'rect', {
    x: 5.45,
    y: 0.85,
    w: 0.08,
    h: 5.6,
    fill: { color: style.palette.accent },
    line: { color: style.palette.accent },
  });
  addBulletStack(slide, pres, s.displayContent.length ? s.displayContent : [s.visualIdea], 5.88, 1.38, 5.82, style, { max: 5, fontSize: 14 });
  addFooter(slide, pres, request, style, index, total);
}

function extractMetric(s: NormalizedSlide): { value: string; label: string } {
  if (s.metric) return { value: s.metric, label: s.metricLabel || s.title };
  const joined = [s.title, ...s.displayContent].join(' ');
  const match = joined.match(/(\$?\d+(?:[.,]\d+)?\s?(?:%|x|k|m|b|million|billion|years?|days?)?)/i);
  return {
    value: match ? match[1].trim() : '01',
    label: s.metricLabel || (match ? joined.replace(match[1], '').trim() : s.title),
  };
}

function renderBigNumber(slide: any, pres: any, request: PresentationRequest, style: StyleGuide, s: NormalizedSlide, index: number, total: number): void {
  const metric = extractMetric(s);
  addKicker(slide, s.kicker || 'Signal', M, 0.7, 4, style);
  addText(slide, metric.value, {
    x: M,
    y: 1.28,
    w: 5.6,
    h: 1.45,
    fontSize: 55,
    bold: true,
    fontFace: style.fonts.heading,
    color: style.palette.primary,
  }, style);
  addText(slide, shorten(metric.label || s.title, 110), {
    x: M + 0.05,
    y: 3.03,
    w: 5.25,
    h: 0.76,
    fontSize: 15,
    bold: true,
    color: style.palette.text,
  }, style);

  const stats = s.stats?.length ? s.stats : s.displayContent.slice(0, 3).map((item, i) => ({ value: `${i + 1}`, label: item }));
  stats.slice(0, 3).forEach((stat, i) => {
    const x = 6.35 + i * 2.05;
    addCard(slide, pres, x, 1.35 + (i % 2) * 0.45, 1.75, 3.55, style, { color: i === 1 ? style.palette.surfaceAlt : style.palette.surface });
    addText(slide, shorten(stat.value || `${i + 1}`, 24), {
      x: x + 0.2,
      y: 1.75 + (i % 2) * 0.45,
      w: 1.35,
      h: 0.55,
      fontSize: 24,
      bold: true,
      color: i === 1 ? style.palette.secondary : style.palette.accent,
      align: 'center',
    }, style);
    addText(slide, shorten(stat.label || (stat as any).detail || '', 74), {
      x: x + 0.18,
      y: 2.58 + (i % 2) * 0.45,
      w: 1.4,
      h: 1.15,
      fontSize: 10,
      color: style.palette.muted,
      align: 'center',
    }, style);
  });
  addFooter(slide, pres, request, style, index, total);
}

function renderTimeline(slide: any, pres: any, request: PresentationRequest, style: StyleGuide, s: NormalizedSlide, index: number, total: number): void {
  addKicker(slide, s.kicker || 'Sequence', M, 0.65, 4, style);
  addText(slide, s.title, {
    x: M,
    y: 0.98,
    w: 7.4,
    h: 0.62,
    fontSize: 25,
    bold: true,
    fontFace: style.fonts.heading,
  }, style);

  const items = (s.timelineItems?.length ? s.timelineItems : s.displayContent).slice(0, 5);
  const steps = items.map((item, i) => typeof item === 'string'
    ? { label: `0${i + 1}`, title: item, detail: '' }
    : { label: item.label || `0${i + 1}`, title: item.title || item.detail || `Step ${i + 1}`, detail: item.detail || '' });

  const y = 3.28;
  addLine(slide, pres, 1.15, y, 12.1, y, style.palette.primary, 1.5);
  steps.forEach((step, i) => {
    const x = 1.0 + i * (10.75 / Math.max(1, steps.length - 1));
    addShape(slide, pres, 'ellipse', {
      x: x - 0.14,
      y: y - 0.14,
      w: 0.28,
      h: 0.28,
      fill: { color: i % 2 ? style.palette.secondary : style.palette.accent },
      line: { color: style.palette.background, width: 1 },
    });
    addText(slide, step.label || `${i + 1}`, {
      x: x - 0.38,
      y: y - 0.62,
      w: 0.78,
      h: 0.18,
      fontSize: 8,
      bold: true,
      align: 'center',
      color: style.palette.muted,
    }, style);
    addCard(slide, pres, x - 0.92, i % 2 ? y + 0.34 : y - 1.42, 1.85, 0.9, style);
    addText(slide, shorten(step.title || '', 48), {
      x: x - 0.74,
      y: i % 2 ? y + 0.58 : y - 1.18,
      w: 1.48,
      h: 0.32,
      fontSize: 9.5,
      bold: true,
      align: 'center',
      color: style.palette.text,
    }, style);
  });
  addFooter(slide, pres, request, style, index, total);
}

function renderComparison(slide: any, pres: any, request: PresentationRequest, style: StyleGuide, s: NormalizedSlide, index: number, total: number): void {
  addKicker(slide, s.kicker || 'Compare', M, 0.65, 4, style);
  addText(slide, s.title, {
    x: M,
    y: 0.98,
    w: 8.3,
    h: 0.68,
    fontSize: 25,
    bold: true,
    fontFace: style.fonts.heading,
  }, style);

  const left = s.comparison?.left || s.leftContent || s.displayContent.slice(0, Math.ceil(s.displayContent.length / 2));
  const right = s.comparison?.right || s.rightContent || s.displayContent.slice(Math.ceil(s.displayContent.length / 2));
  const leftTitle = s.comparison?.leftTitle || 'Before';
  const rightTitle = s.comparison?.rightTitle || 'After';
  const cards = [
    { x: 0.82, title: leftTitle, items: left, accent: style.palette.secondary },
    { x: 6.85, title: rightTitle, items: right.length ? right : s.displayContent, accent: style.palette.accent },
  ];

  cards.forEach((card) => {
    addCard(slide, pres, card.x, 2.02, 5.35, 3.82, style);
    addShape(slide, pres, 'rect', {
      x: card.x,
      y: 2.02,
      w: 5.35,
      h: 0.12,
      fill: { color: card.accent },
      line: { color: card.accent },
    });
    addText(slide, card.title, {
      x: card.x + 0.35,
      y: 2.42,
      w: 4.45,
      h: 0.35,
      fontSize: 17,
      bold: true,
      color: style.palette.text,
    }, style);
    addBulletStack(slide, pres, card.items, card.x + 0.38, 3.1, 4.3, style, { max: 4, fontSize: 11.2 });
  });
  addFooter(slide, pres, request, style, index, total);
}

function renderDiagram(slide: any, pres: any, request: PresentationRequest, style: StyleGuide, s: NormalizedSlide, index: number, total: number): void {
  addKicker(slide, s.kicker || 'System', M, 0.65, 4, style);
  addText(slide, s.title, {
    x: M,
    y: 0.98,
    w: 7.9,
    h: 0.65,
    fontSize: 25,
    bold: true,
    fontFace: style.fonts.heading,
  }, style);

  const nodes = (s.diagramNodes?.length ? s.diagramNodes : s.displayContent).slice(0, 5)
    .map((node, i) => typeof node === 'string' ? { label: node, detail: '' } : { label: node.label || node.detail || `Node ${i + 1}`, detail: node.detail || '' });

  const cx = 6.7;
  const cy = 4.0;
  addGeneratedVisual(slide, style, s.visualIdea, 0.82, 2.02, 4.35, 3.7, 'diagram');
  addShape(slide, pres, 'ellipse', {
    x: cx - 0.92,
    y: cy - 0.92,
    w: 1.84,
    h: 1.84,
    fill: { color: style.palette.primary, transparency: 5 },
    line: { color: style.palette.primary, transparency: 15 },
  });
  addText(slide, shorten(s.title, 32), {
    x: cx - 0.68,
    y: cy - 0.25,
    w: 1.36,
    h: 0.42,
    fontSize: 10.2,
    bold: true,
    align: 'center',
    color: style.palette.inverse,
  }, style);

  nodes.forEach((node, i) => {
    const angle = (-90 + i * (360 / Math.max(1, nodes.length))) * Math.PI / 180;
    const x = cx + Math.cos(angle) * 3.02;
    const y = cy + Math.sin(angle) * 1.62;
    addLine(slide, pres, cx, cy, x, y, style.palette.surfaceAlt, 1);
    addCard(slide, pres, x - 0.82, y - 0.36, 1.64, 0.72, style, { color: style.palette.surfaceAlt });
    addText(slide, shorten(node.label || '', 36), {
      x: x - 0.68,
      y: y - 0.14,
      w: 1.36,
      h: 0.24,
      fontSize: 8.8,
      bold: true,
      align: 'center',
      color: style.palette.text,
    }, style);
  });
  addFooter(slide, pres, request, style, index, total);
}

function renderQuote(slide: any, pres: any, request: PresentationRequest, style: StyleGuide, s: NormalizedSlide, index: number, total: number): void {
  const quote = s.quote || s.displayContent[0] || s.title;
  addShape(slide, pres, 'rect', {
    x: 0,
    y: 0,
    w: 0.34,
    h: SLIDE_H,
    fill: { color: style.palette.accent },
    line: { color: style.palette.accent },
  });
  addText(slide, `"${shorten(quote, 210)}"`, {
    x: 1.2,
    y: 1.72,
    w: 10.6,
    h: 1.9,
    fontSize: 28,
    italic: true,
    color: style.palette.text,
    fontFace: style.fonts.accent,
    align: 'center',
  }, style);
  addText(slide, s.quoteAuthor || s.subtitle || s.title, {
    x: 3.0,
    y: 4.18,
    w: 7.35,
    h: 0.28,
    fontSize: 12,
    bold: true,
    color: style.palette.muted,
    align: 'center',
  }, style);
  addFooter(slide, pres, request, style, index, total);
}

function renderGallery(slide: any, pres: any, request: PresentationRequest, style: StyleGuide, s: NormalizedSlide, index: number, total: number): void {
  addKicker(slide, s.kicker || 'Visual story', M, 0.65, 4, style);
  addText(slide, s.title, {
    x: M,
    y: 0.98,
    w: 7.7,
    h: 0.65,
    fontSize: 25,
    bold: true,
    fontFace: style.fonts.heading,
  }, style);

  const images = [s.imagePath, s.imageUrl, ...(s.images || [])].filter(Boolean) as string[];
  const cards = [0, 1, 2].map((i) => ({
    x: 0.82 + i * 4.05,
    y: i === 1 ? 2.18 : 2.48,
    title: s.displayContent[i] || s.visualIdea,
    image: images[i],
  }));

  cards.forEach((card, i) => {
    addCard(slide, pres, card.x, card.y, 3.45, 3.34, style);
    const added = addImageIfAvailable(slide, card.image && fs.existsSync(card.image) ? card.image : undefined, card.image && !fs.existsSync(card.image) ? card.image : undefined, card.x + 0.18, card.y + 0.18, 3.08, 2.02);
    if (!added) addGeneratedVisual(slide, style, card.title, card.x + 0.18, card.y + 0.18, 3.08, 2.02, 'image');
    addText(slide, shorten(card.title, 68), {
      x: card.x + 0.25,
      y: card.y + 2.52,
      w: 2.92,
      h: 0.48,
      fontSize: 10.5,
      bold: true,
      color: style.palette.text,
      align: 'center',
    }, style);
    addShape(slide, pres, 'ellipse', {
      x: card.x + 0.16,
      y: card.y + 0.16,
      w: 0.24,
      h: 0.24,
      fill: { color: i % 2 ? style.palette.secondary : style.palette.accent },
      line: { color: i % 2 ? style.palette.secondary : style.palette.accent },
    });
  });
  addFooter(slide, pres, request, style, index, total);
}

function renderMap(slide: any, pres: any, request: PresentationRequest, style: StyleGuide, s: NormalizedSlide, index: number, total: number): void {
  addKicker(slide, s.kicker || 'Landscape', M, 0.65, 4, style);
  addText(slide, s.title, {
    x: M,
    y: 0.98,
    w: 7.7,
    h: 0.65,
    fontSize: 25,
    bold: true,
    fontFace: style.fonts.heading,
  }, style);
  addGeneratedVisual(slide, style, s.visualIdea, 0.9, 1.9, 7.2, 4.35, 'diagram');
  addCard(slide, pres, 8.75, 2.05, 3.5, 3.95, style);
  addBulletStack(slide, pres, s.displayContent.length ? s.displayContent : [s.visualIdea], 9.1, 2.55, 2.75, style, { max: 5, fontSize: 10.8 });
  addFooter(slide, pres, request, style, index, total);
}

function renderClosing(slide: any, pres: any, request: PresentationRequest, style: StyleGuide, s: NormalizedSlide, index: number, total: number): void {
  addKicker(slide, s.kicker || 'Close', M, 0.75, 4, style);
  addText(slide, s.title, {
    x: M,
    y: 1.35,
    w: 8.9,
    h: 1.25,
    fontSize: 35,
    bold: true,
    fontFace: style.fonts.heading,
  }, style);
  addText(slide, shorten(s.subtitle || s.displayContent[0] || request.deckGoal || 'Ready for the next step.', 150), {
    x: M,
    y: 3.0,
    w: 6.8,
    h: 0.72,
    fontSize: 15,
    color: style.palette.muted,
  }, style);
  addGeneratedVisual(slide, style, request.title, 8.55, 1.15, 3.75, 4.55, 'panel');
  addFooter(slide, pres, request, style, index, total);
}

function renderStoryboard(slide: any, pres: any, request: PresentationRequest, style: StyleGuide, s: NormalizedSlide, index: number, total: number): void {
  addKicker(slide, s.kicker || 'Frame by frame', M, 0.65, 4, style);
  addText(slide, s.title, {
    x: M,
    y: 0.98,
    w: 8.1,
    h: 0.65,
    fontSize: 25,
    bold: true,
    fontFace: style.fonts.heading,
  }, style);

  const items = s.displayContent.length ? s.displayContent.slice(0, 4) : [s.visualIdea, 'Key context', 'Visible proof', 'Audience takeaway'];
  items.forEach((item, i) => {
    const x = 0.8 + (i % 2) * 6.05;
    const y = 2.02 + Math.floor(i / 2) * 1.78;
    addCard(slide, pres, x, y, 5.45, 1.22, style, { color: i % 2 ? style.palette.surfaceAlt : style.palette.surface });
    addText(slide, `0${i + 1}`, {
      x: x + 0.25,
      y: y + 0.33,
      w: 0.52,
      h: 0.32,
      fontSize: 16,
      bold: true,
      color: i % 2 ? style.palette.secondary : style.palette.accent,
    }, style);
    addText(slide, shorten(item, 92), {
      x: x + 0.95,
      y: y + 0.32,
      w: 4.05,
      h: 0.44,
      fontSize: 12.2,
      bold: true,
      color: style.palette.text,
    }, style);
  });
  addFooter(slide, pres, request, style, index, total);
}

function renderAdaptiveSlide(pres: any, request: PresentationRequest, style: StyleGuide, slideData: NormalizedSlide, index: number, total: number): void {
  const slide = pres.addSlide();
  addBackground(slide, pres, style, index);

  switch (slideData.intent) {
    case 'hero':
    case 'sectionBreak':
    case 'title':
      renderHero(slide, pres, request, style, slideData, index, total);
      break;
    case 'bigNumber':
    case 'dataCallout':
      renderBigNumber(slide, pres, request, style, slideData, index, total);
      break;
    case 'timeline':
      renderTimeline(slide, pres, request, style, slideData, index, total);
      break;
    case 'comparison':
    case 'twoColumn':
      renderComparison(slide, pres, request, style, slideData, index, total);
      break;
    case 'diagram':
    case 'blank':
      renderDiagram(slide, pres, request, style, slideData, index, total);
      break;
    case 'quote':
      renderQuote(slide, pres, request, style, slideData, index, total);
      break;
    case 'gallery':
    case 'imageText':
      renderGallery(slide, pres, request, style, slideData, index, total);
      break;
    case 'map':
      renderMap(slide, pres, request, style, slideData, index, total);
      break;
    case 'storyboard':
      renderStoryboard(slide, pres, request, style, slideData, index, total);
      break;
    case 'closing':
      renderClosing(slide, pres, request, style, slideData, index, total);
      break;
    case 'titleContent':
    case 'splitNarrative':
    default:
      renderSplitNarrative(slide, pres, request, style, slideData, index, total);
      break;
  }

  setSpeakerNotes(slide, slideData.notesText || slideData.speakerNotes || slideData.notes || '');
}

function buildToolOutput(request: PresentationRequest, style: StyleGuide, slides: NormalizedSlide[]): string {
  const intents = slides.map((slide) => slide.intent).join(', ');
  return [
    `Successfully created adaptive presentation "${request.title}" with ${slides.length} content slides.`,
    `Path: ${request.outputPath}`,
    `Design direction: ${style.visualDirection}`,
    `Deck type: ${style.deckType}`,
    `Slide intents: ${intents}`,
  ].join('\n');
}

export const pptxGeneratorTool: AgentTool = {
  name: 'pptx_generator',
  description:
    'Create adaptive, editorial-quality editable PowerPoint presentations using PptxGenJS. The tool infers a custom visual direction, story rhythm, palette, and slide treatments from the request instead of repeating static templates. Prefer designMode="adaptive" and use concise slide text with speakerNotes for dense detail.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'The main title of the presentation.' },
      subtitle: { type: 'string', description: 'Optional subtitle for the presentation.' },
      author: { type: 'string', description: 'Optional author name.' },
      outputPath: { type: 'string', description: 'Full file path where the PPTX should be saved.' },
      deckGoal: { type: 'string', description: 'What the deck should accomplish, e.g. pitch, teach, brief, persuade, summarize.' },
      audience: { type: 'string', description: 'Who will see the presentation.' },
      visualDirection: { type: 'string', description: 'Custom art direction, e.g. NASA climate briefing, luxury editorial, cyberpunk anime pitch.' },
      brand: {
        type: 'object',
        description: 'Optional brand information. Can include name, colors, font, and logoPath.',
        properties: {
          name: { type: 'string', description: 'Brand name.' },
          colors: { type: 'array', description: 'Brand colors as hex strings.', items: { type: 'string' } },
          font: { type: 'string', description: 'Preferred font family.' },
          logoPath: { type: 'string', description: 'Local logo path.' },
        },
      },
      mood: { type: 'string', description: 'Mood words, e.g. premium, playful, urgent, cinematic, academic.' },
      sourceMaterial: { type: 'string', description: 'Optional source text or context used to build speaker notes and visual direction.' },
      designMode: { type: 'string', enum: ['adaptive'], description: 'Use adaptive for unique editorial decks. This is the default.' },
      slides: {
        type: 'array',
        description:
          'Slide content. Use intent, visualIdea, layoutStrategy, and speakerNotes to create varied presentation-ready slides. Avoid dense bullet lists.',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short slide headline.' },
            subtitle: { type: 'string', description: 'Optional support line.' },
            kicker: { type: 'string', description: 'Small section label.' },
            intent: {
              type: 'string',
              enum: ['hero', 'sectionBreak', 'bigNumber', 'timeline', 'map', 'diagram', 'quote', 'comparison', 'storyboard', 'gallery', 'dataCallout', 'splitNarrative', 'closing'],
              description: 'Slide role. Use varied intents instead of repeated bullet slides.',
            },
            layout: {
              type: 'string',
              enum: ['title', 'titleContent', 'twoColumn', 'imageText', 'quote', 'blank'],
              description: 'Legacy layout field, still supported.',
            },
            visualIdea: { type: 'string', description: 'The visual treatment or metaphor for the slide.' },
            layoutStrategy: { type: 'string', description: 'How the slide should be composed.' },
            content: { type: 'array', items: { type: 'string' }, description: 'Concise visible points.' },
            bullets: { type: 'array', items: { type: 'string' }, description: 'Legacy bullet list, still supported.' },
            leftContent: { type: 'array', items: { type: 'string' }, description: 'Left column or comparison content.' },
            rightContent: { type: 'array', items: { type: 'string' }, description: 'Right column or comparison content.' },
            imagePath: { type: 'string', description: 'Local image path.' },
            imageUrl: { type: 'string', description: 'Image URL or data URI.' },
            images: { type: 'array', items: { type: 'string' }, description: 'Optional image paths or data URIs.' },
            quote: { type: 'string', description: 'Quote text.' },
            quoteAuthor: { type: 'string', description: 'Quote attribution.' },
            metric: { type: 'string', description: 'Big number value.' },
            metricLabel: { type: 'string', description: 'Big number label.' },
            stats: { type: 'array', description: 'Metric cards.', items: { type: 'object' } },
            timelineItems: { type: 'array', description: 'Timeline labels/items.', items: { type: 'object' } },
            diagramNodes: { type: 'array', description: 'Diagram node labels/items.', items: { type: 'object' } },
            comparison: { type: 'object', description: 'Comparison content and headings.' },
            notes: { type: 'string', description: 'Legacy speaker notes.' },
            speakerNotes: { type: 'string', description: 'Speaker notes. Put dense details here, not on the slide.' },
          },
          required: ['title'],
        },
      },
      theme: {
        type: 'string',
        enum: ['professional', 'modern', 'creative', 'minimal', 'dark', 'gradient', 'editorial-dark', 'studio-light', 'executive-minimal', 'magazine', 'product-launch', 'data-room'],
        description: 'Optional theme hint. Adaptive mode can infer a custom style without this.',
      },
      includeTitleSlide: { type: 'boolean', description: 'Whether to include a title slide. Default true.' },
    },
    required: ['title', 'outputPath', 'slides'],
  },
  async execute(args: Record<string, unknown>, onUpdate?: (msg: string) => void): Promise<ToolResult> {
    try {
      const request = args as unknown as PresentationRequest;
      if (!stringValue(request.title) || !stringValue(request.outputPath)) {
        return {
          success: false,
          output: 'Failed to create presentation: title and outputPath are required.',
        };
      }

      request.title = stringValue(request.title);
      request.outputPath = stringValue(request.outputPath);
      request.designMode = 'adaptive';

      onUpdate?.(`Designing adaptive presentation: ${request.title}`);

      const style = buildStyleGuide(request);
      const normalizedSlides = normalizeSlides(request, style);
      const pres = new PptxGenJS();
      pres.layout = 'LAYOUT_WIDE';
      pres.author = request.author || 'EverFern AI';
      pres.title = request.title;
      pres.subject = request.subtitle || request.deckGoal || '';
      pres.company = safeBrandName(request.brand) || 'EverFern';
      pres.theme = {
        headFontFace: style.fonts.heading,
        bodyFontFace: style.fonts.body,
      };

      const includeTitleSlide = request.includeTitleSlide !== false;
      if (includeTitleSlide) renderTitleSlide(pres, request, style);

      const totalForFooter = normalizedSlides.length + (includeTitleSlide ? 1 : 0);
      normalizedSlides.forEach((slide, idx) => {
        renderAdaptiveSlide(pres, request, style, slide, idx + (includeTitleSlide ? 2 : 1), totalForFooter);
      });

      const outputDir = path.dirname(request.outputPath);
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

      await pres.writeFile({ fileName: request.outputPath });

      onUpdate?.(`Presentation created: ${request.outputPath}`);

      return {
        success: true,
        output: buildToolOutput(request, style, normalizedSlides),
        data: {
          path: request.outputPath,
          title: request.title,
          slideCount: normalizedSlides.length + (includeTitleSlide ? 1 : 0),
          designMode: request.designMode,
          designDirection: style.visualDirection,
          deckType: style.deckType,
          slideIntents: normalizedSlides.map((slide) => slide.intent),
          type: 'presentation',
        },
      };
    } catch (err: any) {
      return {
        success: false,
        output: `Failed to create presentation: ${err?.message || String(err)}`,
      };
    }
  },
};
