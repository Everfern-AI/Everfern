import { describe, test, expect, afterEach } from 'vitest';
import { mcpRegistry, MCPConfig } from '../mcp';
import * as path from 'path';

describe('Real MCP Server Integration', () => {
  afterEach(async () => {
    await mcpRegistry.disconnectAll();
  });

  test('should connect to mock MCP server, discover tools, execute calculate_sum, and disconnect', async () => {
    // Locate the mock server script absolute path
    const mockServerPath = path.resolve(__dirname, 'mock-mcp-server.mjs');
    
    const config: MCPConfig = {
      name: 'real-mock-server',
      command: 'node',
      args: [mockServerPath]
    };

    console.log(`[Test] Connecting to server with command: node ${mockServerPath}`);

    // Register & Connect
    const toolCount = await mcpRegistry.registerServer(config);
    console.log(`[Test] Registered server. Tool count: ${toolCount}`);
    
    // Expect tools to be registered (we registered 1 tool: calculate_sum)
    expect(toolCount).toBe(1);

    // List tools
    const tools = mcpRegistry.listAllTools();
    console.log(`[Test] Available tools:`, tools);
    expect(tools).toContain('real-mock-server/calculate_sum');

    // Get and execute the tool
    const tool = mcpRegistry.getTool('real-mock-server/calculate_sum');
    expect(tool).toBeDefined();

    if (tool) {
      console.log(`[Test] Executing calculate_sum with arguments { a: 5, b: 7 }`);
      const result = await tool.execute({ a: 5, b: 7 });
      console.log(`[Test] Tool execution result:`, result);

      expect(result.success).toBe(true);
      expect(result.output).toBe('12');
    }

    // Disconnect
    await mcpRegistry.disconnectAll();
    expect(mcpRegistry.getServers().length).toBe(0);
    expect(mcpRegistry.listAllTools().length).toBe(0);
  });
});
