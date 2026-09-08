// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { shouldRefreshArtifacts } from '../artifacts-watch-filter';

describe('shouldRefreshArtifacts (NR-PERF-07)', () => {
    it('refreshes on a global event regardless of projectPath', () => {
        expect(shouldRefreshArtifacts({ source: 'global' }, '/work/proj')).toBe(true);
        expect(shouldRefreshArtifacts({ source: 'global' })).toBe(true);
    });

    it('refreshes on a project event matching projectPath', () => {
        expect(shouldRefreshArtifacts({ source: 'project', projectPath: '/work/proj' }, '/work/proj')).toBe(true);
    });

    it('skips a project event for a different projectPath', () => {
        expect(shouldRefreshArtifacts({ source: 'project', projectPath: '/work/other' }, '/work/proj')).toBe(false);
    });

    it('refreshes on a project event when no projectPath prop is set', () => {
        expect(shouldRefreshArtifacts({ source: 'project', projectPath: '/work/proj' })).toBe(true);
        expect(shouldRefreshArtifacts({ source: 'project', projectPath: '/work/proj' }, undefined)).toBe(true);
    });

    it('refreshes on a project event with no event.projectPath (global-ish fallback)', () => {
        expect(shouldRefreshArtifacts({ source: 'project' }, '/work/proj')).toBe(true);
        expect(shouldRefreshArtifacts({ source: 'project', projectPath: undefined }, '/work/proj')).toBe(true);
    });

    it('does not refresh on an invalid source', () => {
        expect(shouldRefreshArtifacts({ source: 'bogus' }, '/work/proj')).toBe(false);
        expect(shouldRefreshArtifacts({ source: '' }, '/work/proj')).toBe(false);
        expect(shouldRefreshArtifacts({} as any, '/work/proj')).toBe(false);
    });
});
