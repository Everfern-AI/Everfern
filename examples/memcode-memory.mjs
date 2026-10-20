// Standalone example; EverFern does not load this module or connect by default.
const RESOURCE = 'https://mcp.memcode.in/i/everfern/mcp';

export async function openHostedMemcode() {
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import('@modelcontextprotocol/sdk/client/index.js'),
    import('@modelcontextprotocol/sdk/client/stdio.js'),
  ]);
  const client = new Client({ name: 'everfern-memory-example', version: '1.0.0' }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['-y', 'mcp-remote@0.14.3', RESOURCE],
  });
  try {
    await client.connect(transport);
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  }
  return {
    search: (query) => client.callTool({ name: 'search_memories', arguments: { query, mode: 'memories', top_k: 5 } }),
    save: (text) => client.callTool({ name: 'save_memory', arguments: { text } }),
    close: () => client.close(),
  };
}

/**
 * Call only after the user enables external memory for this session. The
 * example deliberately supports personal scope only: MemCode's personal MCP
 * tools do not provide project-level isolation, so project data is not sent.
 * `confirmWrite` must show the exact proposed note to the human and return
 * true only on explicit approval; it must not be model-supplied.
 */
export async function runOptInMemoryExample({ enabled, scope, query, proposedNote, confirmWrite, open = openHostedMemcode }) {
  if (!enabled) return { status: 'disabled', recall: null, ingest: null };
  if (scope !== 'personal') return { status: 'unsupported_scope', recall: null, ingest: null };
  if (typeof query !== 'string' || !query.trim()) return { status: 'invalid_query', recall: null, ingest: null };

  let connection;
  try {
    connection = await open();
    const recall = await connection.search(query.trim().slice(0, 500));
    if (recall.isError) return { status: 'unavailable', recall: null, ingest: null };

    let ingest = null;
    const note = typeof proposedNote === 'string' ? proposedNote.trim() : '';
    if (note && typeof confirmWrite === 'function' && await confirmWrite(note)) {
      ingest = await connection.save(note);
      if (ingest.isError) return { status: 'write_failed', recall, ingest: null };
    }
    return { status: 'ok', recall, ingest };
  } catch {
    // The local EverFern memory path remains available; no remote fallback
    // credential, retry write, or automatic upload is attempted here.
    return { status: 'unavailable', recall: null, ingest: null };
  } finally {
    if (connection) await connection.close().catch(() => {});
  }
}
