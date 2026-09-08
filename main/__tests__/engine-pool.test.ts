// @vitest-environment node

/**
 * AI-PERF-03: context engine memoization — resolveContextEngine('default')
 * returns the same instance across calls; vector/hybrid stay per-call
 * (stateful assemble); registerContextEngine(force) resets the memo.
 */

import { describe, expect, it } from 'vitest';
import {
  resolveContextEngine,
  registerContextEngine,
  listContextEngineIds,
} from '../context-engine/registry';
import { DefaultContextEngine } from '../context-engine/default';

describe('Context engine pool (AI-PERF-03)', () => {
  it('resolveContextEngine("default") twice → same instance (Object.is)', () => {
    const a = resolveContextEngine('default');
    const b = resolveContextEngine('default');
    expect(Object.is(a, b)).toBe(true);
    expect(a.info.id).toBe('default');
  });

  it('resolveContextEngine("compacting") twice → same instance (Object.is)', () => {
    const a = resolveContextEngine('compacting');
    const b = resolveContextEngine('compacting');
    expect(Object.is(a, b)).toBe(true);
    expect(a.info.id).toBe('compacting');
  });

  it('default-id resolution (no arg) memoizes like the explicit id', () => {
    const explicit = resolveContextEngine('default');
    const implicit = resolveContextEngine();
    expect(Object.is(explicit, implicit)).toBe(true);
  });

  it('vector and hybrid engines are NOT memoized (stateful assemble)', () => {
    // VectorContextEngine.assemble() writes per-session state (lastAssemble);
    // memoizing it would bleed state across sessions, so it must stay
    // per-call instantiation.
    const v1 = resolveContextEngine('vector');
    const v2 = resolveContextEngine('vector');
    expect(Object.is(v1, v2)).toBe(false);

    const h1 = resolveContextEngine('hybrid');
    const h2 = resolveContextEngine('hybrid');
    expect(Object.is(h1, h2)).toBe(false);
  });

  it('memoized engines are independent of each other', () => {
    expect(Object.is(resolveContextEngine('default'), resolveContextEngine('compacting'))).toBe(false);
  });

  it('registerContextEngine(force:true) resets the memoized instance', () => {
    const before = resolveContextEngine('default');
    const marker = { info: { id: 'default', name: 'Test Override', version: '0.0.0', ownsCompaction: false } };
    registerContextEngine('default', () => marker as any, { force: true });
    try {
      const after = resolveContextEngine('default');
      expect(Object.is(before, after)).toBe(false);
      expect(Object.is(after, marker)).toBe(true);
      expect(after.info.name).toBe('Test Override');
    } finally {
      // Restore the real default engine and clear the test memo.
      registerContextEngine('default', () => new DefaultContextEngine(), { force: true });
    }
  });

  it('registerContextEngine without force keeps the memoized instance', () => {
    const before = resolveContextEngine('default');
    const marker = { info: { id: 'default', name: 'Ignored Override', version: '0.0.0', ownsCompaction: false } };
    registerContextEngine('default', () => marker as any); // no force → ignored
    const after = resolveContextEngine('default');
    expect(Object.is(before, after)).toBe(true);
  });

  it('registry still lists all default engine ids', () => {
    const ids = listContextEngineIds();
    expect(ids).toContain('default');
    expect(ids).toContain('compacting');
    expect(ids).toContain('vector');
    expect(ids).toContain('hybrid');
  });
});
