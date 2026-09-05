/**
 * Ollama tool-schema sanitizer (_formatOllamaTools).
 *
 * Ollama's native /api/chat rejects schemas containing:
 * - boolean `required` on properties (must be hoisted to the parent's required[])
 * - array-typed `type` unions like ["string","null"]
 * - $schema/$id/examples meta keys
 *
 * These specs lock the sanitizer against all nesting shapes: depth 1/2/3
 * properties, items.properties, anyOf branches, unions and $schema keys.
 */

import { describe, it, expect } from 'vitest';
import { _formatOllamaTools } from '../lib/ai-client';

/** Deep-walks any JS value, returning every object node reachable (cycle-safe). */
function allObjectNodes(root: any): any[] {
  const out: any[] = [];
  const seen = new Set<any>();
  const visit = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);
    out.push(node);
    for (const key of Object.keys(node)) visit(node[key]);
  };
  visit(root);
  return out;
}

function countBooleanRequireds(formatted: any[]): number {
  return allObjectNodes(formatted).filter((n) => typeof n.required === 'boolean').length;
}

function countArrayTypes(formatted: any[]): number {
  return allObjectNodes(formatted).filter((n) => Array.isArray(n.type)).length;
}

function countMetaKeys(formatted: any[]): number {
  return allObjectNodes(formatted).filter(
    (n) => '$schema' in n || '$id' in n || 'examples' in n
  ).length;
}

describe('_formatOllamaTools schema sanitization', () => {
  it('hoists depth-1 boolean required, collapses type unions, strips $schema', () => {
    const tools = [
      {
        type: 'function',
        function: {
          name: 'search',
          description: 'Search things',
          parameters: {
            $schema: 'http://json-schema.org/draft-07/schema#',
            type: 'object',
            properties: {
              query: { type: ['string', 'null'], required: true },
              limit: { type: 'number' },
            },
          },
        },
      },
    ];

    const out = _formatOllamaTools(tools);

    // Root envelope shape intact
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      type: 'function',
      function: {
        name: 'search',
        description: 'Search things',
        parameters: expect.objectContaining({
          type: 'object',
          properties: expect.any(Object),
          required: expect.any(Array),
        }),
      },
    });

    // Zero boolean requireds / array types / meta keys anywhere in the tree
    expect(countBooleanRequireds(out)).toBe(0);
    expect(countArrayTypes(out)).toBe(0);
    expect(countMetaKeys(out)).toBe(0);

    // Valid required[] hoisting
    expect(out[0].function.parameters.required).toEqual(['query']);
    const props = out[0].function.parameters.properties;
    expect(props.query.type).toBe('string'); // ["string","null"] -> first non-null
  });

  it('sanitizes boolean required at depth 2 and 3 inside nested properties', () => {
    const tools = [
      {
        name: 'nested',
        parameters: {
          type: 'object',
          properties: {
            filter: {
              type: 'object',
              properties: {
                name: { type: 'string', required: true },
                range: {
                  type: 'object',
                  properties: {
                    min: { type: 'number', required: true },
                  },
                },
              },
            },
          },
        },
      },
    ];

    const out = _formatOllamaTools(tools);
    expect(countBooleanRequireds(out)).toBe(0);

    const params = out[0].function.parameters;
    expect(params.properties.filter.properties.name.required).toBeUndefined();
    expect(params.properties.filter.required).toEqual(['name']);
    expect(params.properties.filter.properties.range.required).toEqual(['min']);

    // No stray required entries introduced at the root where nothing was required
    expect(Array.isArray(params.required)).toBe(true);
    expect(params.required).toEqual([]);
  });

  it('descends into items.properties and hoists there', () => {
    const tools = [
      {
        name: 'tag',
        parameters: {
          type: 'object',
          properties: {
            tags: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: ['number', 'null'], required: true },
                },
              },
            },
          },
        },
      },
    ];

    const out = _formatOllamaTools(tools);
    expect(countBooleanRequireds(out)).toBe(0);
    expect(countArrayTypes(out)).toBe(0);

    const tags = out[0].function.parameters.properties.tags;
    expect(tags.items.required).toEqual(['id']);
    expect(tags.items.properties.id.type).toBe('number');
  });

  it('sanitizes inside anyOf branches (and leaves non-object branches intact)', () => {
    const tools = [
      {
        name: 'flexible',
        parameters: {
          type: ['object', 'null'],
          properties: {
            target: {
              anyOf: [
                {
                  type: 'object',
                  $schema: 'http://json-schema.org/draft-07/schema#',
                  properties: { mode: { type: 'string', required: true } },
                },
                { type: 'null' },
              ],
            },
          },
        },
      },
    ];

    const out = _formatOllamaTools(tools);
    expect(countBooleanRequireds(out)).toBe(0);
    expect(countArrayTypes(out)).toBe(0);
    expect(countMetaKeys(out)).toBe(0);

    const params = out[0].function.parameters;
    expect(params.type).toBe('object'); // union collapsed
    const branch = params.properties.target.anyOf[0];
    expect(branch.required).toEqual(['mode']);
    expect(branch.properties.mode.required).toBeUndefined();
    expect(params.properties.target.anyOf[1]).toEqual({ type: 'null' });
  });

  it('handles mixed batches of bare and enveloped tool definitions', () => {
    const out = _formatOllamaTools([
      { name: 'bare', parameters: { type: 'object', properties: {} } },
      {
        type: 'function',
        function: {
          name: 'wrapped',
          description: '',
          parameters: {
            type: 'object',
            properties: { q: { type: 'string', required: true } },
          },
        },
      },
    ]);

    expect(out.map((t: any) => t.function.name)).toEqual(['bare', 'wrapped']);
    expect(countBooleanRequireds(out)).toBe(0);
    expect(out[1].function.parameters.required).toEqual(['q']);
    for (const t of out) {
      expect(t.type).toBe('function');
      expect(typeof t.function.name).toBe('string');
      expect(t.function.parameters).toEqual(
        expect.objectContaining({
          type: 'object',
          properties: expect.any(Object),
          required: expect.any(Array),
        })
      );
    }
  });
});
