import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import type { AgentTool, ToolResult } from '../runner/types';
import { translateLinuxPathToHost, translateWindowsPathToLinux, runInLinuxVM } from './linux-vm-executor';

const ARTIFACTS_DIR = () => path.join(os.homedir(), '.everfern', 'artifacts');

interface ArtifactSpec {
  /** HTML content or template */
  html?: string;
  /** Title for the artifact */
  title?: string;
  /** Description for the user */
  description?: string;
  /** CSS to inject */
  css?: string;
  /** JavaScript to inject */
  js?: string;
  /** Template type - defaults to 'blank' */
  template?: 'blank' | 'dashboard' | 'report' | 'chart' | 'gallery' | 'slides';
}

function ensureArtifactsDir(sessionId: string): string {
  const dir = path.join(ARTIFACTS_DIR(), sessionId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getTemplateHead(template: string, title: string): string {
  // ALWAYS include Tailwind CDN + Google Fonts Figtree (as per system prompt requirement)
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
 * If the agent passes a full HTML document (<!DOCTYPE html>...) as the html arg,
 * extract just the <body> content so we don't double-wrap it.
 * Also strips any <head> CDN links the agent included — our wrapper provides them.
 */
function extractBodyContent(html: string): string {
  const trimmed = html.trim();
  if (!trimmed.toLowerCase().startsWith('<!doctype') && !trimmed.toLowerCase().startsWith('<html')) {
    return html; // already body-only content
  }
  // Extract <body>...</body>
  const bodyMatch = trimmed.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch) {
    return bodyMatch[1].trim();
  }
  // No <body> tag — strip outer wrappers best-effort
  return trimmed
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<html[^>]*>/gi, '')
    .replace(/<\/html>/gi, '')
    .replace(/<head>[\s\S]*?<\/head>/gi, '')
    .trim();
}

function wrapInHtml(spec: ArtifactSpec): string {
  const title = spec.title || 'EverFern Artifact';
  const head = getTemplateHead(spec.template || 'blank', title);
  const bodyContent = extractBodyContent(spec.html || '');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  ${head}
  ${spec.css ? `<style>${spec.css}</style>` : ''}
</head>
<body class="font-['Figtree']" style="font-family:'Figtree',sans-serif">
  ${bodyContent}
  ${spec.js ? `<script>${spec.js}<\/script>` : ''}
</body>
</html>`;
}

export const createArtifactTool = (runner?: any): AgentTool => ({
  name: 'create_artifact',
  description:
    'Create HTML artifacts (dashboards, reports, charts, galleries) that display in the UI. ' +
    'The tool can either create a new artifact using standard templates, or reference an already generated file (by path) to present it as an artifact. ' +
    'Tailwind CSS, Figtree font, and Chart.js are auto-injected for templates.',

  parameters: {
    type: 'object',
    properties: {
      html: {
        type: 'string',
        description: 'Body content ONLY — no <!DOCTYPE>, <html>, <head>, or <body> tags. ' +
          'Required unless path is specified. Tailwind CSS, Figtree font, and Chart.js are already injected.'
      },
      path: {
        type: 'string',
        description: 'Absolute or relative path to an already generated HTML/content file. ' +
          'If provided, the tool reads the content from this path. Can be a path inside the Linux VM or host.'
      },
      title: { type: 'string', description: 'Title for the artifact. Auto-derived from the file/title if omitted.' },
      description: { type: 'string', description: 'Description shown to user.' },
      template: { type: 'string', enum: ['blank', 'dashboard', 'report', 'chart', 'gallery', 'slides'], description: 'Template to use.' },
      css: { type: 'string', description: 'Additional CSS to inject (use sparingly — prefer Tailwind classes).' },
      js: { type: 'string', description: 'Custom JavaScript to inject (Chart.js is already available as Chart).' }
    },
    required: []
  },

  async execute(args: Record<string, unknown>, onUpdate?: (msg: string) => void, emitEvent?: (event: any) => void, toolCallId?: string): Promise<ToolResult> {
    try {
      const sessionId = runner?.currentConversationId || 'default';
      
      // If we have a project context, save to the project's .everfern/artifacts folder
      // otherwise fallback to the global ~/.everfern/artifacts folder
      let artifactsDir: string;
      if (runner?.workspaceDir) {
        artifactsDir = path.join(runner.workspaceDir, '.everfern', 'artifacts');
        console.log(`[CreateArtifact] Saving to project directory: ${artifactsDir}`);
      } else {
        artifactsDir = path.join(ARTIFACTS_DIR(), sessionId);
        console.log(`[CreateArtifact] Saving to global artifacts directory: ${artifactsDir}`);
      }
      
      fs.mkdirSync(artifactsDir, { recursive: true });

      let content = '';
      let isFullHtml = false;

      if (args.path) {
        const filePathParam = String(args.path);
        let fileRead = false;

        if (process.platform === 'win32') {
          // Check if path is a WSL-internal path (starts with / and not /mnt/)
          const isWslInternal = filePathParam.startsWith('/') && !filePathParam.startsWith('/mnt/');
          if (isWslInternal) {
            try {
              onUpdate?.(`📖 Reading WSL file: ${filePathParam}...`);
              const res = await runInLinuxVM(`cat "${filePathParam}"`);
              if (res.exitCode === 0) {
                content = res.stdout;
                fileRead = true;
              } else {
                console.warn(`[CreateArtifact] Failed to cat WSL file ${filePathParam}: ${res.stderr}`);
              }
            } catch (err) {
              console.warn(`[CreateArtifact] Failed to read WSL file:`, err);
            }
          }
        } else if (process.platform === 'darwin') {
          // Check if the path is Docker-container-internal
          const isDockerInternal = filePathParam.startsWith('/') && !filePathParam.startsWith('/host/Users/') && !filePathParam.startsWith('/mnt/');
          if (isDockerInternal) {
            try {
              onUpdate?.(`📖 Reading Docker file: ${filePathParam}...`);
              const { execSync } = require('child_process');
              content = execSync(`docker exec everfern-ubuntu cat "${filePathParam}"`, { encoding: 'utf-8', timeout: 30000 });
              fileRead = true;
            } catch (err) {
              console.warn(`[CreateArtifact] Failed to read Docker file:`, err);
            }
          }
        }

        if (!fileRead) {
          // Standard host file read (handles /mnt/c/ via translateLinuxPathToHost)
          try {
            const hostPath = translateLinuxPathToHost(filePathParam);
            onUpdate?.(`📖 Reading file: ${hostPath}...`);
            if (fs.existsSync(hostPath)) {
              content = fs.readFileSync(hostPath, 'utf-8');
              fileRead = true;
            } else {
              console.warn(`[CreateArtifact] File not found: ${hostPath}`);
            }
          } catch (err) {
            console.warn(`[CreateArtifact] Failed to read file:`, err);
          }
        }

        if (!fileRead) {
          return {
            success: false,
            output: `Failed to read file from path: ${filePathParam}`,
            error: `File not found or unreadable at path: ${filePathParam}`
          };
        }

        // Detect if it is already a full HTML document
        isFullHtml = /<html/i.test(content) || /<!doctype/i.test(content);
      } else if (args.html) {
        content = String(args.html);
      } else {
        return {
          success: false,
          output: 'Failed to create artifact: either "html" or "path" parameter must be provided.',
          error: 'Missing required parameters: html or path'
        };
      }

      // Auto-extract/determine title
      let title = String(args.title || '');
      if (!title && content) {
        const titleMatch = content.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        if (titleMatch && titleMatch[1]) {
          title = titleMatch[1].trim();
        }
      }
      if (!title && args.path) {
        const baseName = path.basename(String(args.path));
        title = baseName.replace(/\.[^/.]+$/, ""); // strip extension
      }
      if (!title) {
        title = 'artifact';
      }

      // Determine final HTML content
      let htmlContent: string;
      if (isFullHtml) {
        htmlContent = content;
      } else {
        htmlContent = wrapInHtml({
          html: content,
          title: title,
          description: args.description ? String(args.description) : undefined,
          template: String(args.template || 'blank') as any,
          css: args.css ? String(args.css) : undefined,
          js: args.js ? String(args.js) : undefined
        });
      }

      const safeTitle = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

      const filename = `${safeTitle || 'artifact'}.html`;
      const filePath = path.join(artifactsDir, filename);

      fs.writeFileSync(filePath, htmlContent, 'utf-8');

      onUpdate?.(`🎨 Created artifact: ${filename}`);

      return {
        success: true,
        output: `✅ Artifact created: **${title}**\n` +
               `📁 Saved to: \`${filePath}\`\n` +
               `🎁 Auto-presented to user.`,
        data: {
          type: 'create_artifact',
          path: filePath,
          title: title,
          description: args.description
        }
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        output: `Failed to create artifact: ${msg}`,
        error: msg
      };
    }
  }
});


