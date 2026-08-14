/**
 * EverFern Desktop — Context Engine Registry
 *
 * Factory-based registry for pluggable context engine implementations.
 * Engines are registered by ID and resolved per-session.
 */

import type { ContextEngine } from './types';
import { DefaultContextEngine } from './default';
import { CompactingContextEngine } from './compacting';
import { VectorContextEngine, HybridContextEngine } from './vector';

export type ContextEngineFactory = () => ContextEngine;

// ── Registry State ───────────────────────────────────────────────────

const registry = new Map<string, ContextEngineFactory>();
let _defaultId = 'default';

// Initialize default engines
registry.set('default', () => new DefaultContextEngine());
registry.set('compacting', () => new CompactingContextEngine());
registry.set('vector', () => new VectorContextEngine());
registry.set('hybrid', () => new HybridContextEngine());

// ── Registration ─────────────────────────────────────────────────────

/**
 * Register a context engine factory under a given ID.
 * Override existing registrations with `force: true`.
 */
export function registerContextEngine(
  id: string,
  factory: ContextEngineFactory,
  options: { force?: boolean } = {},
): void {
  if (registry.has(id) && !options.force) {
    console.warn(`[ContextEngine] Registry: engine "${id}" already registered. Use force:true to override.`);
    return;
  }
  registry.set(id, factory);
  console.log(`[ContextEngine] Registered engine: "${id}"`);
}

/**
 * Set the default engine ID to use when none is specified.
 */
export function setDefaultContextEngine(id: string): void {
  _defaultId = id;
}

/**
 * Resolve and instantiate a context engine by ID.
 * Falls back to the default engine if the ID is not found.
 */
export function resolveContextEngine(id?: string): ContextEngine {
  const targetId = id ?? _defaultId;
  const factory = registry.get(targetId) ?? registry.get(_defaultId);

  if (!factory) {
    throw new Error(
      `[ContextEngine] No engine registered for id "${targetId}" and no default is set. ` +
      `Call registerContextEngine("default", ...) during app startup.`,
    );
  }

  return factory();
}

/**
 * List all registered engine IDs.
 */
export function listContextEngineIds(): string[] {
  return [...registry.keys()];
}
