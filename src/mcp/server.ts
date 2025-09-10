import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { VERSION } from '../version.js';
import { registerRunProfiler } from './tools.js';

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: 'uniprof',
    version: VERSION,
  });

  registerRunProfiler(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
