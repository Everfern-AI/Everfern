import { describe, test, expect, afterEach } from 'vitest';
import { searchMcpRegistryTool, connectMcpServerTool, listMcpToolsTool } from '../mcp-registry-tool';
import { mcpRegistry } from '../mcp';
import * as path from 'path';

describe('MCP Registry and Registry Tools', () => {
  afterEach(async () => {
    await mcpRegistry.disconnectAll();
  });

  describe('search_mcp_registry tool', () => {
    test('should find spotify connector', async () => {
      const result = await searchMcpRegistryTool.execute({ keyword: 'spotify' });
      expect(result.success).toBe(true);
      expect(result.output).toContain('SPOTIFY');
      expect(result.output).toContain('npx -y @modelcontextprotocol/server-spotify');
    });

    test('should return message when no connector found', async () => {
      const result = await searchMcpRegistryTool.execute({ keyword: 'nonexistent-app-xyz123' });
      expect(result.success).toBe(true);
      expect(result.output).toContain('No MCP connectors found');
    });
  });

  describe('connect_mcp_server and list_mcp_tools tools integration', () => {
    test('should connect to mock MCP server and list its tools using registry tools', async () => {
      const mockServerPath = path.resolve(__dirname, 'mock-mcp-server.mjs');

      // 1. Initially, listing tools should show nothing is connected
      const initialList = await listMcpToolsTool.execute({});
      expect(initialList.success).toBe(true);
      expect(initialList.output).toContain('No MCP servers are currently connected');

      // 2. Connect the mock server using the connect_mcp_server tool
      const connectResult = await connectMcpServerTool.execute({
        name: 'registry-mock-server',
        command: 'node',
        args: [mockServerPath]
      });

      expect(connectResult.success).toBe(true);
      expect(connectResult.output).toContain('Successfully connected to registry-mock-server');
      expect(connectResult.output).toContain('Registered 1 new tools');

      // 3. Listing tools now should show the mock server and its tools
      const activeList = await listMcpToolsTool.execute({});
      expect(activeList.success).toBe(true);
      expect(activeList.output).toContain('Connected MCP Servers (1): registry-mock-server');
      expect(activeList.output).toContain('registry-mock-server/calculate_sum');

      // 4. Verify getting the tool from the registry directly to execute it
      const tool = mcpRegistry.getTool('registry-mock-server/calculate_sum');
      expect(tool).toBeDefined();
      if (tool) {
        const result = await tool.execute({ a: 10, b: 20 });
        expect(result.success).toBe(true);
        expect(result.output).toBe('30');
      }
    });

    test('should handle connection failures gracefully and return failure result', async () => {
      const connectResult = await connectMcpServerTool.execute({
        name: 'failing-server',
        command: 'nonexistent-command-xyz123'
      });

      expect(connectResult.success).toBe(false);
      expect(connectResult.output).toContain('Failed to connect to failing-server');
    });
  });
});
