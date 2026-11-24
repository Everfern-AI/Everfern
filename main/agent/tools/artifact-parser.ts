/**
 * EverFern Desktop — Artifact Parser
 *
 * Parses and serializes HTML artifacts using Cheerio.
 * Extracts body content, custom CSS, and custom JavaScript.
 * Detects template type and preserves structure.
 */

import type * as cheerio from 'cheerio';
import type * as beautifyNs from 'js-beautify';

// cheerio (with undici) and js-beautify are heavy; load them on first parse.
const loadCheerio = (): typeof cheerio => require('cheerio');
const loadBeautify = (): typeof beautifyNs => require('js-beautify');

export interface ParsedArtifact {
  template: 'blank' | 'dashboard' | 'report' | 'chart' | 'gallery' | 'slides';
  title: string;
  bodyContent: string;
  customCSS: string;
  customJS: string;
  dom: cheerio.Root;
}

export class ArtifactParser {
  /**
   * Parses HTML artifact into structured representation.
   * @throws Error if HTML is malformed
   */
  parse(html: string): ParsedArtifact {
    try {
      // Load HTML with Cheerio
      const $ = loadCheerio().load(html, {
        decodeEntities: false,
        xmlMode: false
      });

      // Extract metadata
      const title = $('title').text() || 'Untitled';
      const template = this.detectTemplate($);

      // Extract custom CSS (exclude CDN links)
      let customCSS = '';
      $('style').each((_, el) => {
        const content = $(el).html();
        if (content) {
          customCSS += content + '\n';
        }
      });

      // Extract custom JavaScript (exclude CDN scripts)
      let customJS = '';
      $('script').each((_, el) => {
        const src = $(el).attr('src');
        // Only include scripts without src attribute (inline scripts)
        if (!src) {
          const content = $(el).html();
          if (content) {
            customJS += content + '\n';
          }
        }
      });

      // Extract body content
      const bodyContent = this.extractBodyContent($);

      return {
        template,
        title,
        bodyContent: bodyContent.trim(),
        customCSS: customCSS.trim(),
        customJS: customJS.trim(),
        dom: $
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to parse artifact HTML: ${msg}`);
    }
  }

  /**
   * Serializes parsed artifact back to complete HTML document.
   */
  serialize(parsed: ParsedArtifact): string {
    const head = this.getTemplateHead(parsed.template, parsed.title);

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${parsed.title}</title>
  ${head}
  ${parsed.customCSS ? `<style>${parsed.customCSS}</style>` : ''}
</head>
<body class="font-['Figtree']" style="font-family:'Figtree',sans-serif">
  ${parsed.bodyContent}
  ${parsed.customJS ? `<script>${parsed.customJS}</script>` : ''}
</body>
</html>`;

    return this.formatHTML(html);
  }

  /**
   * Extracts body content from DOM.
   */
  private extractBodyContent($: cheerio.Root): string {
    const bodyHtml = $('body').html();
    return bodyHtml || '';
  }

  /**
   * Detects template type from HTML structure.
   */
  private detectTemplate($: cheerio.Root): 'blank' | 'dashboard' | 'report' | 'chart' | 'gallery' | 'slides' {
    // Check for Reveal.js (slides)
    if ($('script[src*="reveal.js"]').length > 0) {
      return 'slides';
    }

    // Check for Chart.js usage in scripts
    const scriptText = $('script').text();
    if (scriptText.includes('new Chart') || scriptText.includes('Chart.')) {
      return 'chart';
    }

    // Check for grid layouts (dashboard)
    if ($('[class*="grid"]').length > 3) {
      return 'dashboard';
    }

    // Check for article/section tags (report)
    if ($('article').length > 0 || $('section').length > 2) {
      return 'report';
    }

    // Check for image grids (gallery)
    if ($('img').length > 5 && $('[class*="grid"]').length > 0) {
      return 'gallery';
    }

    // Default to blank
    return 'blank';
  }

  /**
   * Gets template head with CDN dependencies.
   */
  private getTemplateHead(template: string, title: string): string {
    const baseAssets = `
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Figtree:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.js"></script>
  `;

    const slidesExtra = `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@4.5.0/dist/reveal.css"><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@4.5.0/dist/theme/white.css"><script src="https://cdn.jsdelivr.net/npm/reveal.js@4.5.0/dist/reveal.js"></script>`;

    const templates: Record<string, string> = {
      blank: baseAssets,
      dashboard: baseAssets,
      report: baseAssets,
      chart: baseAssets,
      gallery: baseAssets,
      slides: slidesExtra + baseAssets,
    };

    return templates[template] ?? baseAssets;
  }

  /**
   * Formats HTML with proper indentation.
   */
  private formatHTML(html: string): string {
    return loadBeautify().html(html, {
      indent_size: 2,
      wrap_line_length: 0,
      preserve_newlines: true,
      max_preserve_newlines: 2
    });
  }
}
