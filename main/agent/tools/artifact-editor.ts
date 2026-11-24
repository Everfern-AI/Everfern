/**
 * EverFern Desktop — Artifact Editor
 *
 * Applies edit operations to parsed artifacts:
 * - Add content
 * - Remove elements
 * - Modify elements
 * - Update styles
 * - Update scripts
 */

import type * as cheerio from 'cheerio';
import type { ParsedArtifact } from './artifact-parser';

export interface EditArtifactArgs {
  // Artifact identification
  reference?: string;
  filename?: string;

  // Edit operations
  addContent?: string;
  removeSelector?: string;
  modifySelector?: string;
  modifyContent?: string;
  updateStyles?: string;
  updateScript?: string;

  // Metadata updates
  title?: string;
  description?: string;
}

export class ArtifactEditor {
  /**
   * Applies edit operations to parsed artifact.
   * Returns updated artifact and list of changes made.
   */
  applyEdits(
    parsed: ParsedArtifact,
    operations: EditArtifactArgs
  ): { parsed: ParsedArtifact; changes: string[] } {
    const changes: string[] = [];
    const $ = parsed.dom;

    // 1. Add content
    if (operations.addContent) {
      this.addContent($, operations.addContent);
      changes.push('Added new content to body');
    }

    // 2. Remove elements
    if (operations.removeSelector) {
      const count = this.removeElements($, operations.removeSelector);
      changes.push(`Removed ${count} element(s) matching '${operations.removeSelector}'`);
    }

    // 3. Modify elements
    if (operations.modifySelector && operations.modifyContent) {
      const count = this.modifyElements($, operations.modifySelector, operations.modifyContent);
      changes.push(`Modified ${count} element(s) matching '${operations.modifySelector}'`);
    }

    // 4. Update styles
    if (operations.updateStyles) {
      this.updateStyles(parsed, operations.updateStyles);
      changes.push('Updated custom styles');
    }

    // 5. Update script
    if (operations.updateScript) {
      this.updateScript(parsed, operations.updateScript);
      changes.push('Updated custom JavaScript');
    }

    // 6. Update metadata
    if (operations.title) {
      parsed.title = operations.title;
      changes.push(`Updated title to '${operations.title}'`);
    }

    // Update body content from modified DOM
    parsed.bodyContent = $('body').html() || '';

    return { parsed, changes };
  }

  /**
   * Adds content to artifact body.
   */
  private addContent($: cheerio.Root, content: string): void {
    $('body').append(content);
  }

  /**
   * Removes elements matching selector.
   * Returns count of removed elements.
   */
  private removeElements($: cheerio.Root, selector: string): number {
    const count = $(selector).length;
    $(selector).remove();
    return count;
  }

  /**
   * Modifies elements matching selector.
   * Returns count of modified elements.
   */
  private modifyElements($: cheerio.Root, selector: string, content: string): number {
    const count = $(selector).length;
    $(selector).html(content);
    return count;
  }

  /**
   * Updates or adds CSS styles.
   */
  private updateStyles(parsed: ParsedArtifact, css: string): void {
    if (parsed.customCSS) {
      parsed.customCSS += '\n' + css;
    } else {
      parsed.customCSS = css;
    }
  }

  /**
   * Updates or adds JavaScript code.
   */
  private updateScript(parsed: ParsedArtifact, js: string): void {
    if (parsed.customJS) {
      parsed.customJS += '\n' + js;
    } else {
      parsed.customJS = js;
    }
  }
}
