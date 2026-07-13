import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getActiveFilesFromHistory, getWorkspaceProjection } from '../workspace-projection';

describe('DWSP (Dynamic Workspace State Projection) Context Engine', () => {
  describe('getActiveFilesFromHistory', () => {
    it('should extract unique active file paths from tool history', () => {
      const history = [
        {
          toolName: 'read_file',
          args: { path: 'src/components/Sidebar.tsx' }
        },
        {
          toolName: 'replace_file_content',
          args: { TargetFile: 'src/utils/helpers.ts' }
        },
        {
          toolName: 'write_to_file',
          args: { TargetFile: 'src/components/Sidebar.tsx' } // Duplicate
        },
        {
          toolName: 'run_command',
          args: { CommandLine: 'npm test' } // No file path
        }
      ];

      const activeFiles = getActiveFilesFromHistory(history);
      expect(activeFiles).toContain('src/components/Sidebar.tsx');
      expect(activeFiles).toContain('src/utils/helpers.ts');
      expect(activeFiles).toHaveLength(2);
    });

    it('should limit active files to top 10', () => {
      const history = Array.from({ length: 15 }, (_, i) => ({
        toolName: 'read_file',
        args: { path: `src/file_${i}.ts` }
      }));

      const activeFiles = getActiveFilesFromHistory(history);
      expect(activeFiles.length).toBeLessThanOrEqual(10);
    });
  });

  describe('getWorkspaceProjection', () => {
    it('should generate environment info containing process platform and node version', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'everfern-dwsp-test'));
      try {
        const projection = await getWorkspaceProjection(tmpDir, []);
        expect(projection.environmentInfo).toContain('Node Version');
        expect(projection.environmentInfo).toContain('Platform');
        expect(projection.environmentInfo).toContain(tmpDir.replace(/\\/g, '/'));
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should parse TS/JS imports and Python imports to map dependencies on-the-fly', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'everfern-dwsp-test'));
      try {
        const fileATs = path.join(tmpDir, 'fileA.ts');
        const fileBPy = path.join(tmpDir, 'fileB.py');

        // Write TS/JS file with ES6 imports
        fs.writeFileSync(fileATs, `
          import { helper } from './utils/helper';
          import * as api from '@/api/client';
          const a = 1;
        `, 'utf-8');

        // Write Python file with imports
        fs.writeFileSync(fileBPy, `
          import sys
          from os import path
          from api.client import fetch_data
        `, 'utf-8');

        const projection = await getWorkspaceProjection(tmpDir, ['fileA.ts', 'fileB.py']);
        
        expect(projection.activeDependencies).toContain('`fileA.ts` dependencies:');
        expect(projection.activeDependencies).toContain('./utils/helper');
        expect(projection.activeDependencies).toContain('@/api/client');

        expect(projection.activeDependencies).toContain('`fileB.py` dependencies:');
        expect(projection.activeDependencies).toContain('sys');
        expect(projection.activeDependencies).toContain('os');
        expect(projection.activeDependencies).toContain('api.client');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
