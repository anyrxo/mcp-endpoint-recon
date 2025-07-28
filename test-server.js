#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new Server(
  {
    name: 'test-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Test if we can list tools
server.setRequestHandler('tools/list', async () => ({
  tools: [
    {
      name: 'test_tool',
      description: 'Test tool',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string' }
        }
      }
    }
  ]
}));

// Test tool handler
server.setRequestHandler('tools/call', async (request) => {
  if (request.params.name === 'test_tool') {
    return {
      content: [
        {
          type: 'text',
          text: `Test response: ${request.params.arguments.message}`
        }
      ]
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Test server running...');
}

main().catch(console.error);