/**
 * Unit tests for Dependency Manager
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DependencyManager, getDependencyManager, resetDependencyManager } from '../dependency-manager';

describe('DependencyManager', () => {
  let manager: DependencyManager;

  beforeEach(() => {
    resetDependencyManager();
    manager = getDependencyManager();
  });

  describe('Import Parsing', () => {
    it('should parse named imports correctly', () => {
      const content = `import { foo, bar as baz } from './utils';`;
      manager.addFile('src/test.ts', content);

      const imports = manager.getImports('src/test.ts');
      expect(imports).toHaveLength(1);
      expect(imports[0].importPath).toBe('./utils');
      expect(imports[0].specifiers).toHaveLength(2);
      expect(imports[0].specifiers[0].name).toBe('foo');
      expect(imports[0].specifiers[1].name).toBe('bar');
      expect(imports[0].specifiers[1].alias).toBe('baz');
    });

    it('should parse default imports correctly', () => {
      const content = `import React from 'react';`;
      manager.addFile('src/test.ts', content);

      const imports = manager.getImports('src/test.ts');
      expect(imports).toHaveLength(1);
      expect(imports[0].specifiers[0].name).toBe('React');
      expect(imports[0].specifiers[0].isDefault).toBe(true);
    });

    it('should parse namespace imports correctly', () => {
      const content = `import * as utils from './utils';`;
      manager.addFile('src/test.ts', content);

      const imports = manager.getImports('src/test.ts');
      expect(imports).toHaveLength(1);
      expect(imports[0].specifiers[0].name).toBe('utils');
      expect(imports[0].specifiers[0].isNamespace).toBe(true);
    });

    it('should detect type-only imports', () => {
      const content = `import type { User } from './types';`;
      manager.addFile('src/test.ts', content);

      const imports = manager.getImports('src/test.ts');
      expect(imports).toHaveLength(1);
      expect(imports[0].isTypeOnly).toBe(true);
    });

    it('should parse multi-line named imports and ignore trailing commas', () => {
      const content = `import {
        foo,
        bar as baz,
      } from './utils';`;
      manager.addFile('src/test.ts', content);

      const imports = manager.getImports('src/test.ts');
      expect(imports).toHaveLength(1);
      expect(imports[0].importPath).toBe('./utils');
      expect(imports[0].specifiers).toHaveLength(2);
      expect(imports[0].specifiers[0].name).toBe('foo');
      expect(imports[0].specifiers[1].name).toBe('bar');
      expect(imports[0].specifiers[1].alias).toBe('baz');
    });
  });

  describe('Export Parsing', () => {
    it('should parse named exports correctly', () => {
      const content = `export { foo, bar as baz };`;
      manager.addFile('src/test.ts', content);

      const exports = manager.getExports('src/test.ts');
      expect(exports).toHaveLength(1);
      expect(exports[0].specifiers).toHaveLength(2);
      expect(exports[0].specifiers[0].name).toBe('foo');
      expect(exports[0].specifiers[1].name).toBe('bar');
      expect(exports[0].specifiers[1].alias).toBe('baz');
    });

    it('should parse default exports correctly', () => {
      const content = `export default function foo() {}`;
      manager.addFile('src/test.ts', content);

      const exports = manager.getExports('src/test.ts');
      expect(exports.some(e => e.specifiers.some(s => s.isDefault))).toBe(true);
    });

    it('should parse export declarations correctly', () => {
      const content = `export const foo = 42;\nexport function bar() {}\nexport class Baz {}`;
      manager.addFile('src/test.ts', content);

      const exports = manager.getExports('src/test.ts');
      expect(exports.length).toBeGreaterThanOrEqual(3);
      const names = exports.flatMap(e => e.specifiers.map(s => s.name));
      expect(names).toContain('foo');
      expect(names).toContain('bar');
      expect(names).toContain('Baz');
    });

    it('should parse multi-line exports correctly and ignore trailing commas', () => {
      const content = `export {
        foo,
        bar as baz,
      };`;
      manager.addFile('src/test.ts', content);

      const exports = manager.getExports('src/test.ts');
      expect(exports).toHaveLength(1);
      expect(exports[0].specifiers).toHaveLength(2);
      expect(exports[0].specifiers[0].name).toBe('foo');
      expect(exports[0].specifiers[1].name).toBe('bar');
      expect(exports[0].specifiers[1].alias).toBe('baz');
    });
  });

  describe('Dependency Tracking', () => {
    it('should track dependencies between files', () => {
      manager.addFile('src/utils.ts', 'export const foo = 42;');
      manager.addFile('src/test.ts', `import { foo } from './utils';`);

      const deps = manager.getDependencies('src/test.ts');
      expect(deps).toContain('src/utils.ts');
    });

    it('should track dependents correctly', () => {
      manager.addFile('src/utils.ts', 'export const foo = 42;');
      manager.addFile('src/test.ts', `import { foo } from './utils';`);

      const dependents = manager.getDependents('src/utils.ts');
      expect(dependents).toContain('src/test.ts');
    });

    it('should update dependencies when file content changes', () => {
      manager.addFile('src/utils.ts', 'export const foo = 42;');
      manager.addFile('src/helper.ts', 'export const bar = 24;');
      manager.addFile('src/test.ts', `import { foo } from './utils';`);

      let deps = manager.getDependencies('src/test.ts');
      expect(deps).toContain('src/utils.ts');
      expect(deps).not.toContain('src/helper.ts');

      // Update test.ts to import from helper instead
      manager.addFile('src/test.ts', `import { bar } from './helper';`);

      deps = manager.getDependencies('src/test.ts');
      expect(deps).not.toContain('src/utils.ts');
      expect(deps).toContain('src/helper.ts');
    });
  });

  describe('Circular Dependency Detection', () => {
    it('should detect simple circular dependencies', () => {
      // Create files with proper structure
      manager.addFile('src/a.ts', `export const a = 1;`);
      manager.addFile('src/b.ts', `export const b = 2;`);

      // Now add imports after files exist
      manager.addFile('src/a.ts', `import { b } from './b';\nexport const a = 1;`);
      manager.addFile('src/b.ts', `import { a } from './a';\nexport const b = 2;`);

      const cycles = manager.detectCircularDependencies();
      expect(cycles.length).toBeGreaterThan(0);
      expect(cycles[0].cycle).toContain('src/a.ts');
      expect(cycles[0].cycle).toContain('src/b.ts');
    });

    it('should detect complex circular dependencies', () => {
      // Create files first
      manager.addFile('src/a.ts', `export const a = 1;`);
      manager.addFile('src/b.ts', `export const b = 2;`);
      manager.addFile('src/c.ts', `export const c = 3;`);

      // Add imports after files exist
      manager.addFile('src/a.ts', `import { b } from './b';\nexport const a = 1;`);
      manager.addFile('src/b.ts', `import { c } from './c';\nexport const b = 2;`);
      manager.addFile('src/c.ts', `import { a } from './a';\nexport const c = 3;`);

      const cycles = manager.detectCircularDependencies();
      expect(cycles.length).toBeGreaterThan(0);
      expect(cycles[0].cycle.length).toBeGreaterThanOrEqual(3);
    });

    it('should provide suggestions for circular dependencies', () => {
      // Create files first
      manager.addFile('src/a.ts', `export const a = 1;`);
      manager.addFile('src/b.ts', `export const b = 2;`);

      // Add imports after files exist
      manager.addFile('src/a.ts', `import { b } from './b';\nexport const a = 1;`);
      manager.addFile('src/b.ts', `import { a } from './a';\nexport const b = 2;`);

      const cycles = manager.detectCircularDependencies();
      expect(cycles[0].suggestion).toBeTruthy();
      expect(cycles[0].suggestion.length).toBeGreaterThan(0);
    });
  });

  describe('File Operations', () => {
    it('should remove file and update dependencies', () => {
      manager.addFile('src/utils.ts', 'export const foo = 42;');
      manager.addFile('src/test.ts', `import { foo } from './utils';`);

      expect(manager.getAllFiles()).toContain('src/utils.ts');
      expect(manager.getDependents('src/utils.ts')).toContain('src/test.ts');

      manager.removeFile('src/utils.ts');

      expect(manager.getAllFiles()).not.toContain('src/utils.ts');
      expect(manager.getDependents('src/utils.ts')).toHaveLength(0);
    });

    it('should identify files that need updates after file move', () => {
      manager.addFile('src/utils.ts', 'export const foo = 42;');
      manager.addFile('src/test.ts', `import { foo } from './utils';`);

      const filesToUpdate = manager.updateImportsForFileMove('src/utils.ts', 'src/lib/utils.ts');
      expect(filesToUpdate).toContain('src/test.ts');
    });
  });

  describe('Statistics', () => {
    it('should calculate dependency graph statistics', () => {
      manager.addFile('src/utils.ts', 'export const foo = 42;');
      manager.addFile('src/test1.ts', `import { foo } from './utils';`);
      manager.addFile('src/test2.ts', `import { foo } from './utils';`);
      manager.addFile('src/orphan.ts', 'const x = 1;');

      const stats = manager.getStats();
      expect(stats.totalFiles).toBe(4);
      expect(stats.orphanedFiles).toContain('src/orphan.ts');
      expect(stats.mostDepended.length).toBeGreaterThan(0);
      expect(stats.mostDepended[0].file).toBe('src/utils.ts');
      expect(stats.mostDepended[0].count).toBe(2);
    });
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const instance1 = getDependencyManager();
      const instance2 = getDependencyManager();
      expect(instance1).toBe(instance2);
    });

    it('should reset singleton correctly', () => {
      const instance1 = getDependencyManager();
      instance1.addFile('src/test.ts', 'export const foo = 42;');
      expect(instance1.getAllFiles()).toHaveLength(1);

      resetDependencyManager();
      const instance2 = getDependencyManager();
      expect(instance2.getAllFiles()).toHaveLength(0);
      expect(instance1).not.toBe(instance2);
    });
  });
});
