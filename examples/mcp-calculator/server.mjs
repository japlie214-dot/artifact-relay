import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { calculate, calculatorInput } from './calculator.mjs';
import { registerRelay } from '../../kit/mcp-app/server/relay-mcp.mjs';

const server = new McpServer({ name: 'artifact-relay-calculator', version: '0.1.0' });

server.registerTool('relay_smoke', { inputSchema: {} }, async () => ({
  content: [{ type: 'text', text: 'artifact-relay:ok' }],
}));

// The widget URI carries a hash of its bundle: hosts cache widget HTML by URI, so every rebuilt widget gets a fresh one.
const bundle = await readFile(new URL('./app.bundle.html', import.meta.url), 'utf8');
const uri = `ui://artifact-relay/calculator-${createHash('sha256').update(bundle).digest('hex').slice(0, 8)}`;

registerAppTool(server, 'relay_open_calculator', {
  title: 'Open Relay Calculator',
  description: 'Open the interactive Relay Calculator widget. Open it before using relay_send, which operates the open widget.',
  inputSchema: {},
  _meta: { ui: { resourceUri: uri, visibility: ['model'] } },
}, async () => ({ content: [{ type: 'text', text: 'Relay Calculator is ready in an MCP Apps host.' }] }));

// What the calculator's Calculate button calls. The widget calls it through the host; the agent does not see it.
registerAppTool(server, 'relay_calculate', {
  title: 'Calculate',
  description: 'Calculate with two finite numbers and one of add, subtract, multiply, or divide.',
  inputSchema: calculatorInput,
  _meta: { ui: { resourceUri: uri, visibility: ['app'] } },
}, async (input) => calculate(input));

registerAppResource(server, 'Relay Calculator', uri, {}, async () => ({
  contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: bundle }],
}));

// Artifact Relay for MCP Apps: the unchanged kit bridge in the widget, plus relay_send / relay_result for the agent.
// Diagnostics only: which calls reach this process and when. No document contents, no image data.
const debugLog = process.env.RELAY_DEBUG_LOG ?? fileURLToPath(new URL('./relay-debug.log', import.meta.url));
const trace = (event, detail = '') => {
  try { appendFileSync(debugLog, `${new Date().toISOString()} pid=${process.pid} ${event} ${detail}\n`); } catch { /* best effort */ }
};
registerRelay(server, { z, registerAppTool, uri, trace });

// Tell a host that cached an older tool list to re-list once the handshake is done.
server.server.oninitialized = () => { server.sendToolListChanged().catch(() => {}); };
await server.connect(new StdioServerTransport());
