/**
 * Build Tool Configuration System
 *
 * Implements framework-specific build tool selection, TypeScript configuration generation,
 * and build script generation for package.json.
 *
 * Supports: Vite, Webpack, Next.js, Express, FastAPI, Django, Flask
 * References: Requirements 4.1, 4.2, 4.4, 4.6, 20.4
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { AgentTool, ToolResult } from '../../runner/types';

// ── Type Definitions ──────────────────────────────────────────────────────

export type Framework =
  | 'react-vite'
  | 'nextjs'
  | 'vue-vite'
  | 'express'
  | 'fastapi'
  | 'django'
  | 'flask';

export type BuildTool =
  | 'vite'
  | 'webpack'
  | 'esbuild'
  | 'rollup'
  | 'nextjs'
  | 'tsc'
  | 'none';

export interface BuildToolConfig {
  buildTool: BuildTool;
  configFile?: string;
  devCommand: string;
  buildCommand: string;
  testCommand?: string;
}

export interface TypeScriptConfig {
  compilerOptions: Record<string, any>;
  include: string[];
  exclude: string[];
}

export interface PackageJsonScripts {
  dev?: string;
  build?: string;
  test?: string;
  lint?: string;
  preview?: string;
  start?: string;
  format?: string;
  migrate?: string;
  [key: string]: string | undefined; // Allow any additional scripts
}

export interface BuildConfigResult {
  framework: Framework;
  buildTool: BuildTool;
  configsGenerated: string[];
  scriptsGenerated: PackageJsonScripts;
  tsConfigPath?: string;
  buildConfigPath?: string;
}

// ── Framework Configuration Database ──────────────────────────────────────

const FRAMEWORK_BUILD_CONFIGS: Record<Framework, BuildToolConfig> = {
  'react-vite': {
    buildTool: 'vite',
    configFile: 'vite.config.ts',
    devCommand: 'vite',
    buildCommand: 'vite build',
    testCommand: 'vitest',
  },
  'nextjs': {
    buildTool: 'nextjs',
    devCommand: 'next dev',
    buildCommand: 'next build',
    testCommand: 'next test',
  },
  'vue-vite': {
    buildTool: 'vite',
    configFile: 'vite.config.ts',
    devCommand: 'vite',
    buildCommand: 'vite build',
    testCommand: 'vitest',
  },
  'express': {
    buildTool: 'tsc',
    devCommand: 'tsx watch src/index.ts',
    buildCommand: 'tsc',
    testCommand: 'jest',
  },
  'fastapi': {
    buildTool: 'none',
    devCommand: 'uvicorn main:app --reload',
    buildCommand: '',
    testCommand: 'pytest',
  },
  'django': {
    buildTool: 'none',
    devCommand: 'python manage.py runserver',
    buildCommand: '',
    testCommand: 'python manage.py test',
  },
  'flask': {
    buildTool: 'none',
    devCommand: 'flask run --reload',
    buildCommand: '',
    testCommand: 'pytest',
  },
};

// ── Configuration Generators ──────────────────────────────────────────────

/**
 * Generate Vite configuration based on framework and project type
 */
function generateViteConfig(framework: Framework): string {
  const isReact = framework === 'react-vite';
  const isVue = framework === 'vue-vite';

  return `import { defineConfig } from 'vite'
${isReact ? "import react from '@vitejs/plugin-react'\n" : ''}${isVue ? "import vue from '@vitejs/plugin-vue'\n" : ''}import path from 'path'

export default defineConfig({
  plugins: [${isReact ? 'react()' : isVue ? 'vue()' : ''}],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    strictPort: false,
    open: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'terser',
  },
})
`;
}

/**
 * Generate TypeScript configuration based on project type
 */
function generateTypeScriptConfig(framework: Framework): TypeScriptConfig {
  const isFrontend = ['react-vite', 'nextjs', 'vue-vite'].includes(framework);
  const isBackend = ['express', 'fastapi', 'django', 'flask'].includes(framework);

  if (framework === 'nextjs') {
    return {
      compilerOptions: {
        target: 'ES2020',
        useDefineForClassFields: true,
        lib: ['ES2020', 'DOM', 'DOM.Iterable'],
        module: 'ESNext',
        skipLibCheck: true,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        strict: true,
        resolveJsonModule: true,
        isolatedModules: true,
        jsx: 'react-jsx',
        noEmit: true,
        moduleResolution: 'bundler',
        paths: {
          '@/*': ['./*'],
        },
      },
      include: ['next-env.d.ts', '**/*.ts', '**/*.tsx'],
      exclude: ['node_modules'],
    };
  }

  if (isFrontend) {
    return {
      compilerOptions: {
        target: 'ES2020',
        useDefineForClassFields: true,
        lib: ['ES2020', 'DOM', 'DOM.Iterable'],
        module: 'ESNext',
        skipLibCheck: true,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        strict: true,
        resolveJsonModule: true,
        isolatedModules: true,
        jsx: 'react-jsx',
        noEmit: true,
        moduleResolution: 'bundler',
        paths: {
          '@/*': ['./src/*'],
        },
      },
      include: ['src'],
      exclude: ['node_modules', 'dist'],
    };
  }

  // Backend TypeScript config
  return {
    compilerOptions: {
      target: 'ES2020',
      module: 'commonjs',
      lib: ['ES2020'],
      outDir: './dist',
      rootDir: './src',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      resolveJsonModule: true,
      declaration: true,
      declarationMap: true,
      sourceMap: true,
      noImplicitAny: true,
      strictNullChecks: true,
      strictFunctionTypes: true,
      paths: {
        '@/*': ['./src/*'],
      },
    },
    include: ['src/**/*'],
    exclude: ['node_modules', 'dist', '**/*.test.ts'],
  };
}

/**
 * Generate build scripts for package.json based on framework
 */
function generateBuildScripts(framework: Framework): PackageJsonScripts {
  const config = FRAMEWORK_BUILD_CONFIGS[framework];

  const scripts: PackageJsonScripts = {
    dev: config.devCommand,
    build: config.buildCommand,
    test: config.testCommand,
  };

  // Add framework-specific scripts
  switch (framework) {
    case 'react-vite':
    case 'vue-vite':
      scripts.preview = 'vite preview';
      scripts.lint = 'eslint src --ext .ts,.tsx,.vue';
      break;

    case 'nextjs':
      scripts.lint = 'next lint';
      scripts.start = 'next start';
      break;

    case 'express':
      scripts.lint = 'eslint src --ext .ts';
      scripts.start = 'node dist/index.js';
      break;

    case 'fastapi':
      scripts.lint = 'pylint app';
      scripts.format = 'black .';
      break;

    case 'django':
      scripts.lint = 'pylint .';
      scripts.format = 'black .';
      scripts.migrate = 'python manage.py migrate';
      break;

    case 'flask':
      scripts.lint = 'pylint app';
      scripts.format = 'black .';
      break;
  }

  return scripts;
}

/**
 * Generate Webpack configuration for custom setups
 */
function generateWebpackConfig(): string {
  return `const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  mode: process.env.NODE_ENV || 'development',
  entry: './src/index.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].[contenthash].js',
    clean: true,
  },
  module: {
    rules: [
      {
        test: /\\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
      {
        test: /\\.css$/,
        use: ['style-loader', 'css-loader'],
      },
    ],
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    alias: {
      '@': path.resolve(__dirname, 'src/'),
    },
  },
  devServer: {
    port: 3000,
    open: true,
    hot: true,
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './public/index.html',
    }),
  ],
  devtool: 'source-map',
};
`;
}

/**
 * Generate ESLint configuration for TypeScript/JavaScript
 */
function generateESLintConfig(framework: Framework): string {
  const isFrontend = ['react-vite', 'nextjs', 'vue-vite'].includes(framework);

  if (framework === 'nextjs') {
    return `{
  "extends": ["next/core-web-vitals"],
  "rules": {
    "react/react-in-jsx-scope": "off"
  }
}
`;
  }

  if (isFrontend) {
    return `{
  "root": true,
  "env": {
    "browser": true,
    "es2020": true
  },
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended"
  ],
  "ignorePatterns": ["dist", ".eslintignore"],
  "parser": "@typescript-eslint/parser",
  "plugins": ["@typescript-eslint"],
  "rules": {
    "@typescript-eslint/no-explicit-any": "warn"
  }
}
`;
  }

  // Backend/Express ESLint config
  return `{
  "root": true,
  "env": {
    "node": true,
    "es2020": true
  },
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended"
  ],
  "parser": "@typescript-eslint/parser",
  "plugins": ["@typescript-eslint"],
  "rules": {
    "@typescript-eslint/no-explicit-any": "warn"
  }
}
`;
}

/**
 * Validate build configuration for a project
 */
async function validateBuildConfig(projectRoot: string, framework: Framework): Promise<{ valid: boolean; issues: string[] }> {
  const issues: string[] = [];

  try {
    // Check package.json exists for npm/yarn projects
    if (!['fastapi', 'django', 'flask'].includes(framework)) {
      const packageJsonPath = path.join(projectRoot, 'package.json');
      try {
        await fs.access(packageJsonPath);
      } catch {
        issues.push('package.json not found - required for JavaScript/TypeScript projects');
      }
    }

    // Check TypeScript config for TypeScript projects
    if (['react-vite', 'nextjs', 'vue-vite', 'express'].includes(framework)) {
      const tsConfigPath = path.join(projectRoot, 'tsconfig.json');
      try {
        await fs.access(tsConfigPath);
      } catch {
        issues.push('tsconfig.json not found - required for TypeScript projects');
      }
    }

    // Check framework-specific files
    if (framework === 'nextjs') {
      const appPath = path.join(projectRoot, 'app');
      const pagesPath = path.join(projectRoot, 'pages');
      try {
        await fs.access(appPath);
      } catch {
        try {
          await fs.access(pagesPath);
        } catch {
          issues.push('Next.js app/ or pages/ directory not found');
        }
      }
    }

    if (framework === 'express') {
      const srcPath = path.join(projectRoot, 'src');
      try {
        await fs.access(srcPath);
      } catch {
        issues.push('src/ directory not found - required for Express projects');
      }
    }
  } catch (error) {
    issues.push(`Validation error: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

// ── Build Tool Configuration Tool ─────────────────────────────────────────

export const buildToolConfigTool: AgentTool = {
  name: 'build_tool_config',
  description: `Generate build tool configuration for a project. Creates:
1. Framework-specific build tool configs (Vite, Webpack, Next.js, etc.)
2. TypeScript configuration (tsconfig.json) based on project type
3. Build scripts in package.json for dev/production/test
4. Linting configuration (ESLint, Pylint)

Supports: React+Vite, Next.js, Vue+Vite, Express, FastAPI, Django, Flask
Output includes configuration file paths and script definitions.`,

  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Action to perform: "configure" (generate all configs), "validate" (check existing), "update" (update only scripts)',
        enum: ['configure', 'validate', 'update'],
      },
      projectRoot: {
        type: 'string',
        description: 'Absolute path to the project root directory',
      },
      framework: {
        type: 'string',
        description: 'Target framework: react-vite, nextjs, vue-vite, express, fastapi, django, flask',
        enum: ['react-vite', 'nextjs', 'vue-vite', 'express', 'fastapi', 'django', 'flask'],
      },
      generateViteConfig: {
        type: 'boolean',
        description: 'For Vite projects, generate vite.config.ts (default: true)',
      },
      generateTSConfig: {
        type: 'boolean',
        description: 'Generate tsconfig.json (default: true for TypeScript projects)',
      },
      generateESLintConfig: {
        type: 'boolean',
        description: 'Generate .eslintrc.json (default: true)',
      },
    },
    required: ['action', 'projectRoot', 'framework'],
  },

  async execute(
    args: Record<string, unknown>,
    onUpdate?: (msg: string) => void,
  ): Promise<ToolResult> {
    try {
      const action = String(args.action);
      const projectRoot = String(args.projectRoot);
      const framework = String(args.framework) as Framework;
      const generateViteConfig = args.generateViteConfig !== false;
      const generateTSConfig = args.generateTSConfig !== false;
      const generateESLintConfig = args.generateESLintConfig !== false;

      // Validate framework
      if (!FRAMEWORK_BUILD_CONFIGS[framework]) {
        return {
          success: false,
          output: `Unknown framework: ${framework}`,
          error: 'invalid_framework',
        };
      }

      // Validate project root
      try {
        await fs.access(projectRoot);
      } catch {
        return {
          success: false,
          output: `Project root not found: ${projectRoot}`,
          error: 'project_not_found',
        };
      }

      // Execute action
      if (action === 'validate') {
        return handleValidate(projectRoot, framework);
      }

      if (action === 'configure') {
        return handleConfigure(
          projectRoot,
          framework,
          generateViteConfig,
          generateTSConfig,
          generateESLintConfig,
          onUpdate,
        );
      }

      if (action === 'update') {
        return handleUpdate(projectRoot, framework, onUpdate);
      }

      return {
        success: false,
        output: `Unknown action: ${action}`,
        error: 'invalid_action',
      };
    } catch (error) {
      return {
        success: false,
        output: `Error configuring build tools: ${error instanceof Error ? error.message : String(error)}`,
        error: 'execution_error',
      };
    }
  },
};

// ── Action Handlers ──────────────────────────────────────────────────────

async function handleValidate(projectRoot: string, framework: Framework): Promise<ToolResult> {
  const result = await validateBuildConfig(projectRoot, framework);

  if (!result.valid) {
    return {
      success: false,
      output: `Build configuration validation failed:\n${result.issues.join('\n')}`,
      error: 'validation_failed',
      data: { issues: result.issues },
    };
  }

  return {
    success: true,
    output: 'Build configuration is valid',
    data: { valid: true, framework },
  };
}

async function handleConfigure(
  projectRoot: string,
  framework: Framework,
  shouldGenerateViteConfig: boolean,
  shouldGenerateTSConfig: boolean,
  shouldGenerateESLintConfig: boolean,
  onUpdate?: (msg: string) => void,
): Promise<ToolResult> {
  const configsGenerated: string[] = [];
  const buildConfig = FRAMEWORK_BUILD_CONFIGS[framework];

  try {
    // Generate Vite config if needed
    if (shouldGenerateViteConfig && buildConfig.configFile === 'vite.config.ts') {
      onUpdate?.('Generating vite.config.ts...');
      const viteConfig = generateViteConfig(framework);
      const viteConfigPath = path.join(projectRoot, 'vite.config.ts');
      await fs.writeFile(viteConfigPath, viteConfig, 'utf-8');
      configsGenerated.push('vite.config.ts');
    }

    // Generate TypeScript config
    if (shouldGenerateTSConfig && ['react-vite', 'nextjs', 'vue-vite', 'express'].includes(framework)) {
      onUpdate?.('Generating tsconfig.json...');
      const tsConfig = generateTypeScriptConfig(framework);
      const tsConfigPath = path.join(projectRoot, 'tsconfig.json');
      await fs.writeFile(tsConfigPath, JSON.stringify(tsConfig, null, 2), 'utf-8');
      configsGenerated.push('tsconfig.json');
    }

    // Generate ESLint config
    if (shouldGenerateESLintConfig) {
      onUpdate?.('Generating .eslintrc.json...');
      const eslintConfig = generateESLintConfig(framework);
      const eslintPath = path.join(projectRoot, '.eslintrc.json');
      await fs.writeFile(eslintPath, eslintConfig, 'utf-8');
      configsGenerated.push('.eslintrc.json');
    }

    // Update package.json with build scripts
    if (!['fastapi', 'django', 'flask'].includes(framework)) {
      onUpdate?.('Updating package.json with build scripts...');
      const packageJsonPath = path.join(projectRoot, 'package.json');
      let packageJson: any = {};

      try {
        const content = await fs.readFile(packageJsonPath, 'utf-8');
        packageJson = JSON.parse(content);
      } catch {
        // package.json may not exist yet
      }

      const scripts = generateBuildScripts(framework);
      packageJson = {
        ...packageJson,
        scripts: { ...packageJson.scripts, ...scripts },
      };

      await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2), 'utf-8');
      configsGenerated.push('package.json (scripts updated)');
    }

    // Validate the generated configuration
    const validation = await validateBuildConfig(projectRoot, framework);

    const output = [
      'Build tool configuration generated successfully!',
      `Framework: ${framework}`,
      `Build tool: ${buildConfig.buildTool}`,
      `Files created: ${configsGenerated.join(', ')}`,
    ];

    if (!validation.valid) {
      output.push(`\nWarnings:\n${validation.issues.join('\n')}`);
    }

    return {
      success: true,
      output: output.join('\n'),
      data: {
        framework,
        buildTool: buildConfig.buildTool,
        configsGenerated,
        scriptsGenerated: generateBuildScripts(framework),
      },
    };
  } catch (error) {
    return {
      success: false,
      output: `Failed to generate build configuration: ${error instanceof Error ? error.message : String(error)}`,
      error: 'generation_failed',
    };
  }
}

async function handleUpdate(
  projectRoot: string,
  framework: Framework,
  onUpdate?: (msg: string) => void,
): Promise<ToolResult> {
  try {
    onUpdate?.('Updating package.json with build scripts...');
    const packageJsonPath = path.join(projectRoot, 'package.json');

    let packageJson = {};
    try {
      const content = await fs.readFile(packageJsonPath, 'utf-8');
      packageJson = JSON.parse(content);
    } catch {
      return {
        success: false,
        output: 'package.json not found',
        error: 'package_json_not_found',
      };
    }

    const scripts = generateBuildScripts(framework);
    packageJson = {
      ...packageJson,
      scripts: { ...(packageJson as any).scripts, ...scripts },
    };

    await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2), 'utf-8');

    return {
      success: true,
      output: 'Build scripts updated in package.json',
      data: {
        framework,
        scriptsGenerated: scripts,
      },
    };
  } catch (error) {
    return {
      success: false,
      output: `Failed to update build scripts: ${error instanceof Error ? error.message : String(error)}`,
      error: 'update_failed',
    };
  }
}
