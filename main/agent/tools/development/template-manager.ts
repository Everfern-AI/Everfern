/**
 * Template Management System for EverFern Full-Stack Development Platform
 *
 * Handles:
 * - Template loading from ~/.everfern/templates/
 * - Template metadata validation
 * - Variable substitution ({{PROJECT_NAME}}, {{PROJECT_NAME_CAMEL}}, etc.)
 * - Template resolution based on framework selection
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { AgentTool, ToolResult } from '../../runner/types';

// ── Types and Interfaces ─────────────────────────────────────────────────

export interface TemplateVariable {
  name: string;
  type: 'string' | 'boolean' | 'number';
  default?: string | boolean | number;
  description: string;
  required: boolean;
}

export interface TemplateMetadata {
  name: string;
  version: string;
  description: string;
  author?: string;
  framework: string;
  language: 'typescript' | 'javascript' | 'python';
  features: string[];
  variables: TemplateVariable[];
  hooks?: {
    postScaffold?: string[];
  };
  dependencies?: {
    required: string[];
    optional: string[];
  };
}

export interface TemplateFile {
  path: string;
  content: string;
}

export interface ResolvedTemplate {
  name: string;
  metadata: TemplateMetadata;
  files: TemplateFile[];
  templatePath: string;
}

export interface VariableSubstitutionContext {
  projectName: string;
  author?: string;
  year?: string;
  packageManager?: string;
  port?: string;
  [key: string]: string | undefined;
}

// ── Template Manager Class ───────────────────────────────────────────────

export class TemplateManager {
  private templatesDir: string;

  constructor(templatesDir?: string) {
    this.templatesDir =
      templatesDir || path.join(os.homedir(), '.everfern', 'templates');
  }

  /**
   * Get the templates directory path
   */
  getTemplatesDir(): string {
    return this.templatesDir;
  }

  /**
   * Ensure templates directory exists with proper structure
   */
  async ensureTemplatesDir(): Promise<void> {
    try {
      await fs.mkdir(this.templatesDir, { recursive: true });
    } catch (error) {
      throw new Error(`Failed to create templates directory: ${error}`);
    }
  }

  /**
   * List all available templates
   */
  async listTemplates(): Promise<TemplateMetadata[]> {
    try {
      await this.ensureTemplatesDir();
      const entries = await fs.readdir(this.templatesDir, {
        withFileTypes: true,
      });

      const templates: TemplateMetadata[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        try {
          const metadata = await this.loadMetadata(entry.name);
          templates.push(metadata);
        } catch (error) {
          // Skip templates with invalid metadata
          console.warn(`Failed to load template ${entry.name}:`, error);
        }
      }

      return templates;
    } catch (error) {
      throw new Error(`Failed to list templates: ${error}`);
    }
  }

  /**
   * Load template metadata
   */
  async loadMetadata(templateName: string): Promise<TemplateMetadata> {
    const metadataPath = path.join(
      this.templatesDir,
      templateName,
      'template.json'
    );

    try {
      const content = await fs.readFile(metadataPath, 'utf-8');
      const metadata = JSON.parse(content) as TemplateMetadata;

      // Validate metadata structure
      this.validateMetadata(metadata);

      return metadata;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(
          `Invalid JSON in template.json for ${templateName}: ${error.message}`
        );
      }
      throw new Error(`Failed to load metadata for template ${templateName}: ${error}`);
    }
  }

  /**
   * Validate template metadata against schema
   */
  private validateMetadata(metadata: TemplateMetadata): void {
    const required = ['name', 'version', 'description', 'framework', 'language', 'features', 'variables'];

    for (const field of required) {
      if (!(field in metadata)) {
        throw new Error(`Missing required field in template metadata: ${field}`);
      }
    }

    // Validate framework
    const validFrameworks = [
      'react',
      'nextjs',
      'vue',
      'express',
      'fastapi',
      'django',
      'flask',
    ];
    if (!validFrameworks.includes(metadata.framework)) {
      throw new Error(`Invalid framework: ${metadata.framework}`);
    }

    // Validate language
    const validLanguages = ['typescript', 'javascript', 'python'];
    if (!validLanguages.includes(metadata.language)) {
      throw new Error(`Invalid language: ${metadata.language}`);
    }

    // Validate variables
    if (!Array.isArray(metadata.variables)) {
      throw new Error('Variables must be an array');
    }

    for (const variable of metadata.variables) {
      if (!variable.name || !variable.type) {
        throw new Error('Each variable must have name and type');
      }
      if (!['string', 'boolean', 'number'].includes(variable.type)) {
        throw new Error(`Invalid variable type: ${variable.type}`);
      }
    }
  }

  /**
   * Resolve template by name
   */
  async resolveTemplate(templateName: string): Promise<ResolvedTemplate> {
    const templatePath = path.join(this.templatesDir, templateName);

    try {
      // Check if template directory exists
      const stats = await fs.stat(templatePath);
      if (!stats.isDirectory()) {
        throw new Error(`Template ${templateName} is not a directory`);
      }

      // Load metadata
      const metadata = await this.loadMetadata(templateName);

      // Load all template files
      const files = await this.loadTemplateFiles(templateName);

      return {
        name: templateName,
        metadata,
        files,
        templatePath,
      };
    } catch (error) {
      throw new Error(`Failed to resolve template ${templateName}: ${error}`);
    }
  }

  /**
   * Load all template files recursively
   */
  private async loadTemplateFiles(
    templateName: string,
    subDir: string = ''
  ): Promise<TemplateFile[]> {
    const templatePath = path.join(this.templatesDir, templateName);
    const currentDir = subDir ? path.join(templatePath, subDir) : templatePath;
    const files: TemplateFile[] = [];

    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        // Skip template.json and __hooks__ directory
        if (entry.name === 'template.json' || entry.name === '__hooks__') {
          continue;
        }

        const entryPath = path.join(currentDir, entry.name);
        const relativePath = subDir
          ? path.join(subDir, entry.name)
          : entry.name;

        if (entry.isDirectory()) {
          // Recursively load files from subdirectories
          const subFiles = await this.loadTemplateFiles(
            templateName,
            relativePath
          );
          files.push(...subFiles);
        } else {
          // Load file content
          const content = await fs.readFile(entryPath, 'utf-8');
          files.push({
            path: relativePath,
            content,
          });
        }
      }

      return files;
    } catch (error) {
      throw new Error(`Failed to load template files for ${templateName}: ${error}`);
    }
  }

  /**
   * Substitute template variables in content
   */
  substituteVariables(
    content: string,
    context: VariableSubstitutionContext
  ): string {
    let result = content;

    // Standard variable substitutions
    const substitutions: Record<string, string | undefined> = {
      PROJECT_NAME: context.projectName,
      PROJECT_NAME_CAMEL: this.toCamelCase(context.projectName),
      PROJECT_NAME_PASCAL: this.toPascalCase(context.projectName),
      AUTHOR: context.author || 'Developer',
      YEAR: context.year || new Date().getFullYear().toString(),
      PACKAGE_MANAGER: context.packageManager || 'npm',
      PORT: context.port || '3000',
    };

    // Add custom variables from context
    for (const [key, value] of Object.entries(context)) {
      if (
        ![
          'projectName',
          'author',
          'year',
          'packageManager',
          'port',
        ].includes(key)
      ) {
        substitutions[key.toUpperCase()] = value;
      }
    }

    // Replace all variables
    for (const [key, value] of Object.entries(substitutions)) {
      if (value !== undefined) {
        const pattern = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
        result = result.replace(pattern, value);
      }
    }

    return result;
  }

  /**
   * Substitute variables in all template files
   */
  substituteVariablesInFiles(
    files: TemplateFile[],
    context: VariableSubstitutionContext
  ): TemplateFile[] {
    return files.map((file) => ({
      ...file,
      path: this.substituteVariables(file.path, context),
      content: this.substituteVariables(file.content, context),
    }));
  }

  /**
   * Convert string to camelCase
   */
  private toCamelCase(str: string): string {
    return str
      .replace(/[^a-z0-9]+(.)/gi, (_, char) => char.toUpperCase())
      .replace(/^[A-Z]/, (char) => char.toLowerCase());
  }

  /**
   * Convert string to PascalCase
   */
  private toPascalCase(str: string): string {
    return str
      .replace(/[^a-z0-9]+(.)/gi, (_, char) => char.toUpperCase())
      .replace(/^[a-z]/, (char) => char.toUpperCase());
  }

  /**
   * Find template by framework and optional features
   */
  async findTemplate(
    framework: string,
    features?: string[]
  ): Promise<TemplateMetadata | null> {
    const templates = await this.listTemplates();

    // First try to find exact match by framework
    for (const template of templates) {
      if (
        template.framework === framework &&
        (!features || this.hasFeatures(template, features))
      ) {
        return template;
      }
    }

    // Fall back to any template with the framework
    for (const template of templates) {
      if (template.framework === framework) {
        return template;
      }
    }

    return null;
  }

  /**
   * Check if template has all required features
   */
  private hasFeatures(template: TemplateMetadata, features: string[]): boolean {
    return features.every((feature) => template.features.includes(feature));
  }
}

// ── Template Manager Tool (AgentTool) ────────────────────────────────────

export const templateManagerTool: AgentTool = {
  name: 'template_manager',
  description:
    'Manage project templates for scaffolding. Load templates from ~/.everfern/templates/, validate metadata, and perform variable substitution. Supports multiple frameworks (React, Next.js, Vue, Express, FastAPI, Django, Flask).',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description:
          'Action to perform: "list" (list all templates), "resolve" (resolve a specific template), "find" (find template by framework)',
        enum: ['list', 'resolve', 'find'],
      },
      templateName: {
        type: 'string',
        description: 'Name of template to resolve (used with "resolve" action)',
      },
      framework: {
        type: 'string',
        description:
          'Framework to search for (used with "find" action): react, nextjs, vue, express, fastapi, django, flask',
        enum: [
          'react',
          'nextjs',
          'vue',
          'express',
          'fastapi',
          'django',
          'flask',
        ],
      },
      substitutionContext: {
        type: 'object',
        description:
          'Variable substitution context (used with "resolve" action). Contains: projectName, author, year, packageManager, port',
        properties: {
          projectName: { type: 'string' },
          author: { type: 'string' },
          year: { type: 'string' },
          packageManager: { type: 'string' },
          port: { type: 'string' },
        },
      },
      features: {
        type: 'array',
        description: 'Features to search for (used with "find" action)',
        items: { type: 'string' },
      },
    },
    required: ['action'],
  },

  async execute(
    args: Record<string, unknown>,
    onUpdate?: (msg: string) => void
  ): Promise<ToolResult> {
    try {
      const manager = new TemplateManager();
      const action = String(args.action);

      switch (action) {
        case 'list': {
          onUpdate?.('Loading available templates...');
          const templates = await manager.listTemplates();

          if (templates.length === 0) {
            return {
              success: true,
              output: 'No templates found. Create templates in ~/.everfern/templates/',
              data: { templates: [] },
            };
          }

          const summary = templates
            .map((t) => `- ${t.name} (${t.framework}, ${t.language})`)
            .join('\n');

          return {
            success: true,
            output: `Found ${templates.length} templates:\n${summary}`,
            data: { templates },
          };
        }

        case 'resolve': {
          const templateName = String(args.templateName || '');
          if (!templateName) {
            return {
              success: false,
              output: 'templateName is required for "resolve" action',
              error: 'invalid_args',
            };
          }

          onUpdate?.(`Resolving template: ${templateName}...`);
          const resolved = await manager.resolveTemplate(templateName);

          // Apply variable substitution if context provided
          let files = resolved.files;
          if (args.substitutionContext) {
            const context = args.substitutionContext as VariableSubstitutionContext;
            onUpdate?.('Substituting variables...');
            files = manager.substituteVariablesInFiles(files, context);
          }

          return {
            success: true,
            output: `Resolved template "${templateName}" with ${files.length} files`,
            data: {
              template: {
                name: resolved.name,
                metadata: resolved.metadata,
                fileCount: files.length,
              },
              files,
            },
          };
        }

        case 'find': {
          const framework = String(args.framework || '');
          if (!framework) {
            return {
              success: false,
              output: 'framework is required for "find" action',
              error: 'invalid_args',
            };
          }

          onUpdate?.(`Searching for ${framework} template...`);
          const features = Array.isArray(args.features)
            ? (args.features as string[])
            : undefined;
          const found = await manager.findTemplate(framework, features);

          if (!found) {
            return {
              success: false,
              output: `No template found for framework: ${framework}`,
              error: 'template_not_found',
            };
          }

          return {
            success: true,
            output: `Found template: ${found.name}`,
            data: { template: found },
          };
        }

        default:
          return {
            success: false,
            output: `Unknown action: ${action}`,
            error: 'invalid_args',
          };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        output: `Template manager error: ${msg}`,
        error: 'execution_failed',
      };
    }
  },
};
