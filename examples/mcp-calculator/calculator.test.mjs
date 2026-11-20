import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createMcpDb } from '../../kit/mcp-app/widget/mcp-db.js';

const serverPath = fileURLToPath(new URL('./server.mjs', import.meta.url));
const bridgeSource = readFileSync(fileURLToPath(new URL('../../kit/multi-file/rc/bridge.js', import.meta.url)), 'utf8');
const base = 'data/users/local/rc';
const timeout = { timeout: 10_000 };
const uriPattern = /^ui:\/\/artifact-relay\/calculator-[0-9a-f]{8}$/; // hash of the bundle, so hosts cannot serve a stale widget
const jpeg = Buffer.from('not really a jpeg, but valid base64').toString('base64');

async function connect() {
  const client = new Client({ name: 'calculator-test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverPath] }), timeout);
  const call = (name, args = {}) => client.callTool({ name, arguments: args }, undefined, timeout);
  return { client, call };
}

// The widget's side, run in Node: the real, unmodified bridge.js on top of the MCP database shim.
// Only what ping, call and screenshot need is faked (a document-like root and the snapshot function).
function startWidget(call, { actions = {} } = {}) {
  const callRelay = async (args) => {
    const r = await call('relay_db', args);
    if (r.isError) throw Object.assign(new Error(r.structuredContent?.message ?? 'relay_db failed'), { code: r.structuredContent?.code });
    return r.structuredContent;
  };
  const unref = (timer) => { timer.unref?.(); return timer; };
  const context = vm.createContext({
    console, document: {}, window: {},
    setTimeout: (f, ms) => unref(setTimeout(f, ms)), setInterval: (f, ms) => unref(setInterval(f, ms)),
    clearTimeout, clearInterval,
  });
  const { createBridge } = vm.runInContext(bridgeSource + '\n({ createBridge })', context);
  const states = [];
  const logs = [];
  const bridge = createBridge({
    db: createMcpDb(callRelay, { pollMs: 100 }), base,
    root: { ownerDocument: { visibilityState: 'visible', defaultView: {} } },
    limits: { requireAgent: true, leaseMs: 5_000 },
    actions, snapshot: async () => 'data:image/jpeg;base64,' + jpeg,
    onState: (s, d) => states.push([s, d]), onLog: (l) => logs.push(l),
  });
  return { bridge, states, logs };
}

test('stdio host discovers the app, reads its bundled widget, and calls typed arithmetic', { timeout: 35_000 }, async () => {
  const { client, call } = await connect();
  const arithmetic = (left, operation, right) => call('relay_calculate', { left, operation, right });
  try {
    const { tools } = await client.listTools({}, timeout);
    assert.deepEqual(tools.map(({ name }) => name).sort(), [
      'relay_calculate', 'relay_db', 'relay_open_calculator', 'relay_result', 'relay_send', 'relay_smoke',
    ]);
    const open = tools.find(({ name }) => name === 'relay_open_calculator');
    const uri = open._meta.ui.resourceUri;
    assert.match(uri, uriPattern);
    assert.deepEqual(open._meta.ui, { resourceUri: uri, visibility: ['model'] });
    for (const name of ['relay_calculate', 'relay_db']) {
      assert.deepEqual(tools.find((t) => t.name === name)._meta.ui, { resourceUri: uri, visibility: ['app'] }, name);
    }
    for (const name of ['relay_send', 'relay_result']) assert.equal(tools.find((t) => t.name === name)._meta?.ui, undefined, name);
    assert.notEqual((await call(open.name)).isError, true);

    const { resources } = await client.listResources({}, timeout);
    assert.deepEqual(resources.map((item) => item.uri), [uri]);
    const { contents: [view] } = await client.readResource({ uri }, timeout);
    assert.equal(view.mimeType, 'text/html;profile=mcp-app');
    assert.match(view.text, /<title>Relay Calculator<\/title>/);
    for (const part of ['REMOTE CONTROL BRIDGE v2', 'REMOTE CONTROL WIRING', 'relay_db', 'relay_calculate', 'id="rc-state"', 'REMOTE_ACTIONS']) {
      assert.ok(view.text.includes(part), `the widget should contain ${part}`);
    }
    assert.doesNotMatch(view.text, /<script[^>]+src=|<!-- RELAY_(PANEL|SCRIPTS) -->/);

    const product = await arithmetic(7, 'multiply', 6);
    assert.notEqual(product.isError, true);
    assert.deepEqual(product.structuredContent, { value: 42 });
    assert.equal(product.content[0].text, '7 × 6 = 42');
    for (const [operation, expected] of [['add', 12], ['subtract', 2], ['divide', 1.4]]) {
      assert.deepEqual((await arithmetic(7, operation, 5)).structuredContent, { value: expected });
    }
    const zero = await arithmetic(7, 'divide', 0);
    assert.equal(zero.isError, true);
    assert.deepEqual(zero.structuredContent, { error: 'Cannot divide by zero.' });
    for (const args of [
      { left: 7, operation: 'power', right: 2 },
      { left: '7', operation: 'multiply', right: 6 },
      { left: 7, operation: 'multiply', right: 6, extra: true },
      { left: 7, operation: 'multiply', right: Infinity },
      { left: Number.MAX_VALUE, operation: 'multiply', right: 2 },
    ]) {
      const invalid = await call('relay_calculate', args);
      assert.equal(invalid.isError, true);
      assert.equal(invalid.structuredContent?.value, undefined);
    }
  } finally {
    await client.close();
  }
});

test('the unchanged kit bridge runs over MCP: ping, named action, screenshot as an image, lock, pause', { timeout: 45_000 }, async () => {
  const { client, call } = await connect();
  const ok = async (name, args) => {
    const r = await call(name, args);
    assert.notEqual(r.isError, true, JSON.stringify(r.content));
    return r;
  };
  const widget = startWidget(call, {
    actions: { getState: async () => ({ result: '8 × 9 = 72' }), boom: async () => { throw new Error('nope'); } },
  });
  try {
    assert.equal(await widget.bridge.start(), true);
    assert.deepEqual(widget.states.at(-1), ['on', 'waiting for commands']);

    // ping: the agent's tool reaches the widget's bridge and back
    const ping = await ok('relay_send', { steps: [{ action: 'ping' }], agent: 'tester', waitMs: 8000 });
    const pinged = JSON.parse(ping.content[0].text);
    assert.equal(pinged.status, 'done');
    assert.equal(pinged.results[0].pong, true);
    assert.equal(pinged.results[0].version, '2.2');
    assert.equal(ping.structuredContent.finished, true);
    // The host may show the agent only structuredContent, so the results must be there too.
    assert.equal(ping.structuredContent.results[0].pong, true);

    // a named action, then a screenshot that arrives as an image the agent can look at
    const second = await ok('relay_send', { steps: [{ action: 'call', name: 'getState' }, { action: 'screenshot' }], agent: 'tester', waitMs: 8000 });
    const done = JSON.parse(second.content[0].text);
    assert.deepEqual(done.results[0].result, { result: '8 × 9 = 72' });
    assert.equal(done.results[1].ok, true);
    assert.ok(!second.content[0].text.includes(jpeg), 'image data must not be repeated in the text');
    assert.deepEqual(second.content[1], { type: 'image', data: jpeg, mimeType: 'image/jpeg' });

    // errors stay errors: an action that throws, an unknown action, a command that names no agent
    const boom = await call('relay_send', { steps: [{ action: 'call', name: 'boom' }], agent: 'tester', waitMs: 8000 });
    assert.equal(boom.isError, true);
    assert.equal(JSON.parse(boom.content[0].text).status, 'error');
    assert.match(JSON.parse(boom.content[0].text).error, /nope/);
    const unknown = await call('relay_send', { steps: [{ action: 'eval', code: '1' }], agent: 'tester', waitMs: 8000 });
    assert.equal(unknown.isError, true);
    assert.equal(JSON.parse(unknown.content[0].text).status, 'invalid');
    assert.equal((await call('relay_send', { steps: [{ action: 'ping' }] })).isError, true);

    // the busy lock: tester still holds the app, so another agent is told to wait; takeover and release work
    const busy = await call('relay_send', { steps: [{ action: 'call', name: 'getState' }], agent: 'other', waitMs: 8000 });
    assert.equal(busy.isError, true);
    assert.equal(JSON.parse(busy.content[0].text).status, 'busy');
    await ok('relay_send', { steps: [{ action: 'call', name: 'getState' }], agent: 'tester', release: true, waitMs: 8000 });
    await ok('relay_send', { steps: [{ action: 'call', name: 'getState' }], agent: 'other', release: true, waitMs: 8000 });

    // pause holds a command; the agent gets its id back and fetches the result later
    widget.bridge.pause(true);
    const held = await ok('relay_send', { steps: [{ action: 'call', name: 'getState' }], agent: 'tester', waitMs: 400 });
    assert.equal(held.structuredContent.finished, false);
    widget.bridge.pause(false);
    const later = await ok('relay_result', { id: held.structuredContent.id, waitMs: 8000 });
    assert.equal(JSON.parse(later.content[0].text).status, 'done');
    assert.equal((await call('relay_result', { id: 'no_such_command' })).isError, true);
  } finally {
    widget.bridge.stop();
    await client.close();
  }
});

test('the widget database accepts only Relay paths and sizes, and relay_send refuses without a widget', { timeout: 30_000 }, async () => {
  const { client, call } = await connect();
  const refused = async (args) => assert.equal((await call('relay_db', args)).isError, true, JSON.stringify(args));
  try {
    const none = await call('relay_send', { steps: [{ action: 'ping' }], agent: 'tester' });
    assert.equal(none.isError, true);
    assert.match(none.content[0].text, /No Relay widget is connected/);

    for (const path of ['data/users/other/rc/cmd/x', `${base}/cmd/../x`, `${base}/cmd/a/b`, `${base}/other/x`, `${base}/cmd/`, 'rc/cmd/x']) {
      await refused({ op: 'set', path, data: { status: 'pending' } });
    }
    await refused({ op: 'update', path: `${base}/res/missing`, data: { status: 'done' } });          // update needs an existing document
    await refused({ op: 'set', path: `${base}/res/big`, data: { text: 'x'.repeat(262_200) } });       // over 256 KiB
    await refused({ op: 'query', collection: `${base}/res`, field: 'status', value: 'done' });        // only the command list can be listed
    await refused({ op: 'query', collection: `${base}/cmd`, field: 'agent', value: 'x' });
    await refused({ op: 'acquire', path: `${base}/cmd/x`, holder: 'h', ttlMs: 5 });
    await refused({ op: 'drop', path: `${base}/cmd/x` });

    // leases: a second holder cannot take a live lease; the same holder can renew it
    const path = `${base}/cmd/lease1`;
    const lease = async (holder) => (await call('relay_db', { op: 'acquire', path, holder, ttlMs: 5_000 })).structuredContent.acquired;
    assert.deepEqual([await lease('a'), await lease('b'), await lease('a')], [true, false, true]);
  } finally {
    await client.close();
  }
});
