import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { calculate, calculatorInput } from './calculator.mjs';
import { registerCalculatorRelay } from './relay.mjs';

const server = new McpServer({ name: 'artifact-relay-calculator', version: '0.0.0' });

server.registerTool('relay_smoke', { inputSchema: {} }, async () => ({
  content: [{ type: 'text', text: 'artifact-relay:ok' }],
}));

// The widget URI carries a hash of its bundle: hosts cache widget HTML by URI, so every rebuilt widget gets a fresh one.
const bundle = await readFile(new URL('./calculator.bundle.html', import.meta.url), 'utf8');
const uri = `ui://artifact-relay/calculator-${createHash('sha256').update(bundle).digest('hex').slice(0, 8)}`;
registerAppTool(server, 'relay_open_calculator', {
  title: 'Open Relay Calculator',
  description: 'Open the interactive Relay Calculator. Use this tool when asked to show the calculator.',
  inputSchema: {},
  _meta: { ui: { resourceUri: uri, visibility: ['model'] } },
}, async () => ({ content: [{ type: 'text', text: 'Relay Calculator is ready in an MCP Apps host.' }] }));

registerAppTool(server, 'relay_calculate', {
  title: 'Calculate',
  description: 'Calculate with two finite numbers and one of add, subtract, multiply, or divide.',
  inputSchema: calculatorInput,
  _meta: { ui: { resourceUri: uri, visibility: ['app'] } },
}, async (input) => calculate(input));

registerAppResource(server, 'Relay Calculator', uri, {}, async () => ({
  contents: [{
    uri,
    mimeType: RESOURCE_MIME_TYPE,
    text: bundle,
  }],
}));

registerCalculatorRelay(server, registerAppTool, uri);
// Tell a host that cached an older tool list to re-list once the handshake is done.
server.server.oninitialized = () => { server.sendToolListChanged().catch(() => {}); };
await server.connect(new StdioServerTransport());
