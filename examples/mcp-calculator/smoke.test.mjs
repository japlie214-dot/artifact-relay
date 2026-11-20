import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { JSONRPCMessageSchema, LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';

const serverPath = fileURLToPath(new URL('./server.mjs', import.meta.url));
const requestOptions = { timeout: 10_000, maxTotalTimeout: 10_000 };
const expectedContent = [{ type: 'text', text: 'artifact-relay:ok' }];

test('SDK discovers, calls, rejects unknown tools, and closes its child', { timeout: 50_000 }, async (t) => {
  const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath] });
  const client = new Client({ name: 'artifact-relay-smoke-test', version: '0.0.0' });
  const protocolErrors = [];
  client.onerror = (error) => protocolErrors.push(error.message);
  try {
    await client.connect(transport, requestOptions);
    assert.ok(Number.isInteger(transport.pid));
    const { tools } = await client.listTools({}, requestOptions);
    assert.equal(tools.filter(({ name }) => name === 'relay_smoke').length, 1);
    t.diagnostic('discovered relay_smoke');

    const result = await client.callTool({ name: 'relay_smoke', arguments: {} }, undefined, requestOptions);
    assert.notEqual(result.isError, true);
    assert.deepEqual(result.content, expectedContent);
    t.diagnostic(`content: ${JSON.stringify(result.content)}`);

    const unknown = await client.callTool({ name: 'not_registered', arguments: {} }, undefined, requestOptions);
    assert.equal(unknown.isError, true);
    assert.ok(!unknown.content.some((item) => item.type === 'text' && item.text === 'artifact-relay:ok'));
    t.diagnostic(`unknown tool: ${JSON.stringify(unknown)}`);
  } finally {
    const pid = transport.pid;
    await client.close();
    if (pid !== null) {
      assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
      t.diagnostic('SDK child exited after client closure');
    }
  }
  assert.deepEqual(protocolErrors, []);
});

test('node server.mjs emits only protocol frames and exits cleanly on stdin EOF', { timeout: 15_000 }, async (t) => {
  const child = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = once(child, 'close');
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  const deadline = setTimeout(() => child.kill(), 10_000);
  try {
    child.stdin.end(`${JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'stdout-check', version: '0.0.0' } },
    })}\n`);
    const [code, signal] = await closed;
    assert.equal(signal, null);
    assert.equal(code, 0, stderr);
    assert.equal(stderr, '');
    assert.ok(stdout.endsWith('\n'));
    const frames = stdout.slice(0, -1).split('\n').map((line) => JSONRPCMessageSchema.parse(JSON.parse(line)));
    assert.equal(frames.length, 1);
    assert.equal(frames[0].id, 1);
    assert.equal(frames[0].result.serverInfo.name, 'artifact-relay-calculator');
    assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
    t.diagnostic('stdout: one valid JSON-RPC initialize response; stderr empty; EOF exit 0; child absent');
  } finally {
    clearTimeout(deadline);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await closed;
    }
  }
});
