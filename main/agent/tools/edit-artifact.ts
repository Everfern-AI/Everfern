/**
 * EverFern Desktop — Edit Artifact Tool
 *
 * Enables the AI agent to edit existing HTML artifacts.
 * Supports natural language references, targeted modifications,
 * and atomic updates with comprehensive error handling.
 */

import type { AgentTool, ToolResult } from '../runner/types';
import { ArtifactResolver } from './artifact-resolver';
import { ArtifactParser } from './artifact-parser';
import { ArtifactEditor, type EditArtifactArgs } from './artifact-editor';
import { readArtifact, writeArtifactAtomic, updateArtifactTimestamp } from '../../store/artifacts';
import * as cheerio from 'cheerio';

export const editArtifactTool = (runner?: any): AgentTool => ({
  name: 'edit_artifact',
  description:
    'Edit existing HTML artifacts (dashboards, reports, charts, galleries). ' +
    'Reference artifacts naturally ("the artifact", "sales dashboard") or by exact filename. ' +
    'Supports adding content, removing elements, modifying elements, updating styles/scripts, and changing metadata. ' +
    'Changes are applied atomically and the updated artifact is auto-presented.',

  parameters: {
    type: 'object',
    properties: {
      reference: {
        type: 'string',
        description: 'Natural language reference to artifact (e.g., "the artifact", "sales dashboard"). ' +
          'Use "the", "that", "this", or "it" to reference the most recent artifact.'
      },
      filename: {
        type: 'string',
        description: 'Exact filename of artifact to edit (e.g., "sales-dashboard.html"). ' +
          'Takes priority over reference parameter.'
      },
      addContent: {
        type: 'string',
        description: 'HTML content to add to the artifact body. ' +
          'Use Tailwind classes for styling.'
      },
      removeSelector: {
        type: 'string',
        description: 'CSS selector for elements to remove (e.g., ".old-section", "#deprecated").'
      },
      modifySelector: {
        type: 'string',
        description: 'CSS selector for elements to modify. Must be used with modifyContent.'
      },
      modifyContent: {
        type: 'string',
        description: 'New HTML content for elements matching modifySelector.'
      },
      updateStyles: {
        type: 'string',
        description: 'CSS to add or update. Accumulates with existing custom styles.'
      },
      updateScript: {
        type: 'string',
        description: 'JavaScript to add or update. Accumulates with existing custom scripts.'
      },
      title: {
        type: 'string',
        description: 'New title for the artifact.'
      },
      description: {
        type: 'string',
        description: 'New description for the artifact (metadata only).'
      }
    },
    required: []
  },

  async execute(
    args: Record<string, unknown>,
    onUpdate?: (msg: string) => void,
    emitEvent?: (event: any) => void,
    toolCallId?: string
  ): Promise<ToolResult> {
    try {
      const sessionId = runner?.currentConversationId || 'default';
      const projectPath = runner?.workspaceDir;
      
      const operations: EditArtifactArgs = {
        reference: args.reference ? String(args.reference) : undefined,
        filename: args.filename ? String(args.filename) : undefined,
        addContent: args.addContent ? String(args.addContent) : undefined,
        removeSelector: args.removeSelector ? String(args.removeSelector) : undefined,
        modifySelector: args.modifySelector ? String(args.modifySelector) : undefined,
        modifyContent: args.modifyContent ? String(args.modifyContent) : undefined,
        updateStyles: args.updateStyles ? String(args.updateStyles) : undefined,
        updateScript: args.updateScript ? String(args.updateScript) : undefined,
        title: args.title ? String(args.title) : undefined,
        description: args.description ? String(args.description) : undefined
      };

      // Validate that at least one edit operation is provided
      const hasEditOperation = !!(
        operations.addContent ||
        operations.removeSelector ||
        (operations.modifySelector && operations.modifyContent) ||
        operations.updateStyles ||
        operations.updateScript ||
        operations.title
      );

      if (!hasEditOperation) {
        return {
          success: false,
          output: '❌ No edit operations specified. Please provide at least one of: ' +
            'addContent, removeSelector, modifySelector+modifyContent, updateStyles, updateScript, or title.',
          error: 'NO_EDIT_OPERATIONS'
        };
      }

      // Phase 1: Artifact Resolution
      onUpdate?.('🔍 Resolving artifact reference...');
      const resolver = new ArtifactResolver();

      let artifactRef;
      try {
        artifactRef = await resolver.resolve(sessionId, operations.reference, operations.filename, projectPath);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          output: `❌ ${msg}`,
          error: 'AMBIGUOUS_REFERENCE'
        };
      }

      if (!artifactRef) {
        const available = await resolver.listArtifacts(sessionId, projectPath);
        const availableList = available.length > 0
          ? '\n\nAvailable artifacts:\n' + available.map(a => `- ${a.title || a.filename}`).join('\n')
          : '\n\nNo artifacts found in this session.';

        return {
          success: false,
          output: `❌ Artifact not found: '${operations.reference || operations.filename}'${availableList}`,
          error: 'ARTIFACT_NOT_FOUND'
        };
      }

      // Phase 2: Loading and Parsing
      onUpdate?.(`📖 Loading artifact: ${artifactRef.title || artifactRef.filename}...`);
      
      // Determine which path to use (project vs global)
      const isProjectArtifact = artifactRef.chatId === 'project';
      const effectiveChatId = isProjectArtifact ? 'project' : sessionId;
      const effectiveProjectPath = isProjectArtifact ? projectPath : undefined;
      
      const htmlContent = await readArtifact(effectiveChatId, artifactRef.filename, effectiveProjectPath);

      if (!htmlContent) {
        return {
          success: false,
          output: `❌ Failed to read artifact file: ${artifactRef.filename}`,
          error: 'FILE_READ_ERROR'
        };
      }

      const parser = new ArtifactParser();
      let parsed;
      try {
        parsed = parser.parse(htmlContent);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          output: `❌ Failed to parse artifact HTML: ${msg}\n` +
            'The artifact file may be corrupted or contain invalid HTML.',
          error: 'PARSE_ERROR'
        };
      }

      // Phase 3: Edit Application
      onUpdate?.('✏️ Applying edits...');
      const editor = new ArtifactEditor();

      // Validate selectors before applying edits
      if (operations.removeSelector) {
        const count = parsed.dom(operations.removeSelector).length;
        if (count === 0) {
          return {
            success: false,
            output: `❌ Invalid CSS selector: '${operations.removeSelector}'\n` +
              'No elements found matching this selector.',
            error: 'INVALID_SELECTOR'
          };
        }
      }

      if (operations.modifySelector) {
        const count = parsed.dom(operations.modifySelector).length;
        if (count === 0) {
          return {
            success: false,
            output: `❌ Invalid CSS selector: '${operations.modifySelector}'\n` +
              'No elements found matching this selector.',
            error: 'INVALID_SELECTOR'
          };
        }
      }

      const { parsed: updatedParsed, changes } = editor.applyEdits(parsed, operations);

      // Phase 4: Serialization and Persistence
      onUpdate?.('💾 Saving updated artifact...');
      const updatedHTML = parser.serialize(updatedParsed);

      // Validate HTML structure before writing
      try {
        cheerio.load(updatedHTML);
      } catch (err) {
        return {
          success: false,
          output: '❌ Generated invalid HTML. Edit operation aborted.\n' +
            'The original artifact remains unchanged.',
          error: 'INVALID_HTML_GENERATED'
        };
      }

      // Write atomically
      const writeResult = await writeArtifactAtomic(effectiveChatId, artifactRef.filename, updatedHTML, effectiveProjectPath);
      if (!writeResult.success) {
        return {
          success: false,
          output: `❌ Failed to save artifact: ${writeResult.error}\n` +
            'The original artifact remains unchanged.',
          error: 'WRITE_ERROR'
        };
      }

      // Update timestamp
      await updateArtifactTimestamp(effectiveChatId, artifactRef.filename, effectiveProjectPath);

      // Update most recent artifact
      resolver.setMostRecent(sessionId, artifactRef.filename);

      // Phase 5: Feedback and Presentation
      onUpdate?.(`✅ Artifact updated: ${updatedParsed.title}`);

      const changesList = changes.map(c => `  • ${c}`).join('\n');
      const output = `✅ Artifact updated: **${updatedParsed.title}**\n\n` +
        `📝 Changes made:\n${changesList}\n\n` +
        `📁 Saved to: \`${artifactRef.path}\`\n` +
        `🎁 Auto-presented to user.`;

      // Emit presentation event
      emitEvent?.({
        type: 'edit_artifact',
        path: artifactRef.path,
        title: updatedParsed.title,
        changes
      });

      return {
        success: true,
        output,
        data: {
          type: 'edit_artifact',
          path: artifactRef.path,
          title: updatedParsed.title,
          changes
        }
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        output: `❌ Unexpected error: ${msg}`,
        error: msg
      };
    }
  }
});
