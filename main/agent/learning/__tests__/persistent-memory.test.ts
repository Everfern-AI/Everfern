import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  loadMemoryGraph,
  saveMemoryGraph,
  addOrUpdateMemory,
  findMatchingSensitivePreference,
  getMemoryDir,
  deleteMemoryNode,
} from '../memory/persistent-memory';

const testDir = path.join(__dirname, 'temp_test_memory');

describe('PersistentMemory', () => {
  beforeEach(() => {
    vi.spyOn(os, 'homedir').mockReturnValue(testDir);
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should return empty graph if no file exists', () => {
    const graph = loadMemoryGraph();
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
  });

  it('should save and load graph', () => {
    const graph = {
      nodes: [{ id: 'n1', type: 'preference' as const, category: 'test', name: 'test', value: 'val' }],
      edges: [{ source: 'n1', target: 'file_test', type: 'linked_to' as const }]
    };
    saveMemoryGraph(graph);

    const loaded = loadMemoryGraph();
    expect(loaded.nodes.length).toBe(1);
    expect(loaded.nodes[0].value).toBe('val');
    expect(loaded.edges.length).toBe(1);
  });

  it('should add memory node and update appropriate markdown file', () => {
    addOrUpdateMemory('preference', 'airline', 'prefers Delta Airlines', 'TRAVEL.md');

    const graph = loadMemoryGraph();
    expect(graph.nodes.length).toBe(2);
    const prefNode = graph.nodes.find(n => n.type === 'preference');
    expect(prefNode).toBeDefined();
    expect(prefNode?.value).toBe('prefers Delta Airlines');
    expect(prefNode?.category).toBe('airline');

    const fileNode = graph.nodes.find(n => n.type === 'file');
    expect(fileNode).toBeDefined();
    expect(fileNode?.name).toBe('TRAVEL.md');

    expect(graph.edges.length).toBe(1);
    expect(graph.edges[0].source).toBe(prefNode?.id);
    expect(graph.edges[0].target).toBe(fileNode?.id);

    const mdPath = path.join(getMemoryDir(), 'TRAVEL.md');
    expect(fs.existsSync(mdPath)).toBe(true);
    const mdContent = fs.readFileSync(mdPath, 'utf-8');
    expect(mdContent).toContain('prefers Delta Airlines');
    expect(mdContent).toContain('[airline]');
  });

  it('should update existing node if category matches', () => {
    addOrUpdateMemory('preference', 'airline', 'prefers Delta Airlines', 'TRAVEL.md');
    addOrUpdateMemory('preference', 'airline', 'prefers United Airlines', 'TRAVEL.md');

    const graph = loadMemoryGraph();
    const prefNodes = graph.nodes.filter(n => n.type === 'preference');
    expect(prefNodes.length).toBe(1);
    expect(prefNodes[0].value).toBe('prefers United Airlines');

    const mdPath = path.join(getMemoryDir(), 'TRAVEL.md');
    const mdContent = fs.readFileSync(mdPath, 'utf-8');
    expect(mdContent).toContain('prefers Delta Airlines');
    expect(mdContent).toContain('prefers United Airlines');
  });

  it('should find sensitive preference matching query', () => {
    addOrUpdateMemory('preference', 'airline', 'prefers Delta Airlines', 'TRAVEL.md');
    addOrUpdateMemory('preference', 'payment', 'use Visa ending in 4242', 'PAYMENTS.md');

    expect(findMatchingSensitivePreference('hello there')).toBeNull();

    const airlineMatch = findMatchingSensitivePreference('book a flight to Paris');
    expect(airlineMatch).not.toBeNull();
    expect(airlineMatch?.category).toBe('airline');
    expect(airlineMatch?.value).toBe('prefers Delta Airlines');

    const paymentMatch = findMatchingSensitivePreference('pay for subscription');
    expect(paymentMatch).not.toBeNull();
    expect(paymentMatch?.category).toBe('payments');
    expect(paymentMatch?.value).toBe('use Visa ending in 4242');
  });

  it('should delete memory node and clean up orphaned file nodes', () => {
    addOrUpdateMemory('preference', 'airline', 'prefers Delta Airlines', 'TRAVEL.md');

    let graph = loadMemoryGraph();
    expect(graph.nodes.length).toBe(2); // prefNode + fileNode
    expect(graph.edges.length).toBe(1);

    const prefNode = graph.nodes.find(n => n.type === 'preference')!;
    deleteMemoryNode(prefNode.id);

    graph = loadMemoryGraph();
    expect(graph.nodes.length).toBe(0); // both nodes should be deleted because fileNode is orphaned
    expect(graph.edges.length).toBe(0);
  });
});

