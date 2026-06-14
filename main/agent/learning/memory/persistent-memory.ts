import fs from 'fs';
import path from 'path';
import os from 'os';

export interface GraphNode {
  id: string;
  type: 'preference' | 'habit' | 'fact' | 'file';
  category: string;
  name: string;
  value: string;
  metadata?: Record<string, any>;
  linkedFile?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: 'linked_to' | 'prefers' | 'related_to';
}

export interface MemoryGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function getMemoryDir(): string {
  const dir = path.join(os.homedir(), '.everfern', 'memory');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getGraphPath(): string {
  return path.join(getMemoryDir(), 'memory_graph.json');
}

export function loadMemoryGraph(): MemoryGraph {
  const filePath = getGraphPath();
  if (!fs.existsSync(filePath)) {
    return { nodes: [], edges: [] };
  }
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Failed to load memory graph:', err);
    return { nodes: [], edges: [] };
  }
}

export function saveMemoryGraph(graph: MemoryGraph): void {
  const filePath = getGraphPath();
  try {
    fs.writeFileSync(filePath, JSON.stringify(graph, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save memory graph:', err);
  }
}

export function addOrUpdateMemory(
  type: 'preference' | 'habit' | 'fact',
  category: string,
  value: string,
  linkedFile: string,
  metadata: Record<string, any> = {}
): void {
  const graph = loadMemoryGraph();
  const memoryDir = getMemoryDir();
  const now = new Date().toISOString();

  // Find if there is an existing node of same type and category
  const existingNodeIndex = graph.nodes.findIndex(
    n => n.type === type && n.category.toLowerCase() === category.toLowerCase()
  );

  let id: string;
  if (existingNodeIndex !== -1) {
    const oldNode = graph.nodes[existingNodeIndex];
    oldNode.value = value;
    oldNode.metadata = {
      ...oldNode.metadata,
      ...metadata,
      lastUpdated: now
    };
    id = oldNode.id;
    console.log(`[PersistentMemory] Updated existing memory node: ${id}`);
  } else {
    id = `${type}_${category.toLowerCase()}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newNode: GraphNode = {
      id,
      type,
      category,
      name: `${category} ${type}`,
      value,
      linkedFile,
      metadata: {
        ...metadata,
        created: now,
        lastUpdated: now
      }
    };
    graph.nodes.push(newNode);

    // Ensure there is a node representing the linked markdown file
    const fileNodeId = `file_${linkedFile.toLowerCase()}`;
    let fileNode = graph.nodes.find(n => n.id === fileNodeId);
    if (!fileNode) {
      fileNode = {
        id: fileNodeId,
        type: 'file',
        category: 'file',
        name: linkedFile,
        value: path.join(memoryDir, linkedFile)
      };
      graph.nodes.push(fileNode);
    }

    // Add edge linking memory to file node
    graph.edges.push({
      source: id,
      target: fileNodeId,
      type: 'linked_to'
    });

    console.log(`[PersistentMemory] Added new memory node: ${id}`);
  }

  saveMemoryGraph(graph);

  // Write/append to the corresponding markdown file
  const filePath = path.join(memoryDir, linkedFile);
  const title = getMarkdownFileTitle(linkedFile);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, `# ${title}\n\nThis file persists your ${linkedFile.split('.')[0].toLowerCase()} details.\n\n`, 'utf-8');
  }

  const timestamp = new Date().toISOString();
  const entry = `\n### [${category}] (${timestamp})\n- ${value}\n`;
  fs.appendFileSync(filePath, entry, 'utf-8');
}

function getMarkdownFileTitle(fileName: string): string {
  switch (fileName.toUpperCase()) {
    case 'PAYMENTS.md': return 'Payment Preferences & Billing';
    case 'TRAVEL.md': return 'Travel & Airline Preferences';
    case 'USER_PROFILE.md': return 'User Profile & App Preferences';
    case 'PROJECT_STATE.md': return 'Project State & Facts';
    default: return `${fileName.split('.')[0]} Details`;
  }
}

export interface SensitiveMatch {
  nodeId: string;
  category: 'payments' | 'airline' | string;
  value: string;
  linkedFile: string;
}

export function findMatchingSensitivePreference(query: string): SensitiveMatch | null {
  const graph = loadMemoryGraph();
  const lowerQuery = query.toLowerCase();

  const isPaymentQuery = /\b(pay|billing|visa|card|credit|checkout|purchase|subscription|invoice|payments)\b/i.test(lowerQuery);
  const isAirlineQuery = /\b(flight|airline|book|trip|delta|united|emirates|travel|american|lufthansa|singapore|airlines)\b/i.test(lowerQuery);

  if (!isPaymentQuery && !isAirlineQuery) {
    return null;
  }

  for (const node of graph.nodes) {
    if (node.type !== 'preference') continue;
    const catLower = node.category.toLowerCase();
    
    if (isPaymentQuery && (catLower === 'payment' || catLower === 'payments' || catLower === 'billing')) {
      return {
        nodeId: node.id,
        category: 'payments',
        value: node.value,
        linkedFile: node.linkedFile || 'PAYMENTS.md'
      };
    }

    if (isAirlineQuery && (catLower === 'airline' || catLower === 'airlines' || catLower === 'travel')) {
      return {
        nodeId: node.id,
        category: 'airline',
        value: node.value,
        linkedFile: node.linkedFile || 'TRAVEL.md'
      };
    }
  }

  return null;
}

export function deleteMemoryNode(id: string): void {
  const graph = loadMemoryGraph();
  const nodeToDelete = graph.nodes.find(n => n.id === id);
  if (!nodeToDelete) return;

  // Filter out the node
  graph.nodes = graph.nodes.filter(n => n.id !== id);

  // Filter out any edges connected to this node
  graph.edges = graph.edges.filter(e => e.source !== id && e.target !== id);

  // Clean up any file nodes that no longer have incoming links
  const fileNodes = graph.nodes.filter(n => n.type === 'file');
  for (const fileNode of fileNodes) {
    const hasLinks = graph.edges.some(e => e.target === fileNode.id || e.source === fileNode.id);
    if (!hasLinks) {
      graph.nodes = graph.nodes.filter(n => n.id !== fileNode.id);
    }
  }

  saveMemoryGraph(graph);
}

