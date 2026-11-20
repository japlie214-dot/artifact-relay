import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const uriPattern = /^ui:\/\/artifact-relay\/calculator-[0-9a-f]{8}$/; // hash of the bundle, so hosts cannot serve a stale widget
const timeout = { timeout: 10_000 };

test('stdio host discovers the app, reads its bundled view, and calls typed arithmetic', { timeout: 35_000 }, async () => {
  const client = new Client({ name: 'calculator-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath, args: [fileURLToPath(new URL('./server.mjs', import.meta.url))],
  });
  const call = (name, args = {}) => client.callTool({ name, arguments: args }, undefined, timeout);
  const arithmetic = (left, operation, right) => call('relay_calculate', { left, operation, right });
  try {
    await client.connect(transport, timeout);
    const { tools } = await client.listTools({}, timeout);
    assert.deepEqual(tools.map(({ name }) => name).sort(), [
      'relay_ack_view', 'relay_arm_view', 'relay_calculate', 'relay_calculator_receipt',
      'relay_drive_calculator', 'relay_inspect_calculator', 'relay_open_calculator', 'relay_poll_view',
      'relay_smoke', 'relay_snapshot_calculator',
    ]);
    const open = tools.find(({ name }) => name === 'relay_open_calculator');
    const uri = open._meta.ui.resourceUri;
    assert.match(uri, uriPattern);
    assert.deepEqual(open._meta.ui, { resourceUri: uri, visibility: ['model'] });
    assert.deepEqual(tools.find(({ name }) => name === 'relay_calculate')._meta.ui,
      { resourceUri: uri, visibility: ['app'] });
    assert.notEqual((await call(open.name)).isError, true);
    const { resources } = await client.listResources({}, timeout);
    assert.deepEqual(resources.map((item) => item.uri), [uri]);
    const { contents: [view] } = await client.readResource({ uri }, timeout);
    assert.equal(view.mimeType, 'text/html;profile=mcp-app');
    assert.match(view.text, /<title>Relay Calculator<\/title>/);
    assert.match(view.text, /<script>[\s\S]+relay_calculate[\s\S]+<\/script>/);
    assert.doesNotMatch(view.text, /<script[^>]+src=|<!-- CALCULATOR_SCRIPT -->/);

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

test('Relay queues one typed action and records only the targeted view receipt', { timeout: 40_000 }, async () => {
  const client = new Client({ name: 'relay-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath, args: [fileURLToPath(new URL('./server.mjs', import.meta.url))],
  });
  const call = (name, args = {}) => client.callTool({ name, arguments: args }, undefined, timeout);
  const ok = async (name, args) => {
    const result = await call(name, args);
    assert.notEqual(result.isError, true, JSON.stringify(result.content));
    return result.structuredContent;
  };
  const rejected = async (name, args) => assert.equal((await call(name, args)).isError, true);
  const arm = async () => {
    const { viewCode, viewToken } = await ok('relay_arm_view');
    return { viewCode, viewToken };
  };
  try {
    await client.connect(transport, timeout);
    const { tools } = await client.listTools({}, timeout);
    const uri = tools.find(({ name }) => name === 'relay_open_calculator')._meta.ui.resourceUri;
    for (const name of ['relay_arm_view', 'relay_poll_view', 'relay_ack_view']) {
      assert.deepEqual(tools.find((tool) => tool.name === name)._meta.ui, { resourceUri: uri, visibility: ['app'] });
    }
    assert.equal(tools.find((tool) => tool.name === 'relay_drive_calculator')._meta?.ui?.resourceUri, undefined);
    const action = { left: 8, operation: 'multiply', right: 9 };
    await rejected('relay_drive_calculator', action); // nothing is listening yet
    const a = await arm();
    const b = await arm();
    assert.notEqual(a.viewCode, b.viewCode);
    await rejected('relay_drive_calculator', action); // two listeners: ambiguous without a code
    const target = { viewCode: a.viewCode, ...action };
    await rejected('relay_drive_calculator', { ...target, operation: 'power' });
    await rejected('relay_drive_calculator', { ...target, selector: 'body' });
    const queued = await ok('relay_drive_calculator', target);
    assert.deepEqual(queued, { phase: 'queued', id: queued.id, viewCode: a.viewCode });
    const receipt = { viewCode: a.viewCode, id: queued.id };
    assert.equal((await ok('relay_calculator_receipt', receipt)).phase, 'queued');
    await rejected('relay_drive_calculator', target);
    await rejected('relay_poll_view', { ...a, viewToken: b.viewToken });
    assert.deepEqual(await ok('relay_poll_view', b), { phase: 'armed' });
    const delivery = await ok('relay_poll_view', a);
    assert.equal(delivery.id, queued.id);
    assert.deepEqual(delivery.command, { kind: 'drive', ...action });
    assert.deepEqual(await ok('relay_poll_view', a), { phase: 'delivered' });
    const ack = { ...a, id: queued.id, proof: delivery.proof, result: { kind: 'drive', displayed: { value: 72 } } };
    await rejected('relay_ack_view', { ...ack, viewToken: b.viewToken });
    await rejected('relay_ack_view', { ...ack, proof: queued.id });
    assert.equal((await ok('relay_calculator_receipt', receipt)).phase, 'delivered');
    assert.equal((await ok('relay_ack_view', ack)).phase, 'rendered');
    assert.deepEqual(await ok('relay_calculator_receipt', receipt), { ...receipt, phase: 'rendered', displayed: { value: 72 } });
    await rejected('relay_ack_view', ack);
    assert.deepEqual(await ok('relay_poll_view', b), { phase: 'armed' });

    // A waiting receipt resolves in one call once the view acknowledges, and times out cleanly otherwise.
    const second = await ok('relay_drive_calculator', { viewCode: b.viewCode, left: 3, operation: 'add', right: 4 });
    const waited = call('relay_calculator_receipt', { viewCode: b.viewCode, id: second.id, waitMs: 8000 });
    const started = Date.now();
    const next = await ok('relay_poll_view', b);
    await ok('relay_ack_view', { ...b, id: second.id, proof: next.proof, result: { kind: 'drive', displayed: { value: 7 } } });
    const finished = await waited;
    assert.notEqual(finished.isError, true);
    assert.equal(finished.structuredContent.phase, 'rendered');
    assert.ok(Date.now() - started < 4000);
    // With a and b already used, a third view is the only one listening: no code is needed.
    const c = await arm();
    const idle = await ok('relay_drive_calculator', { left: 1, operation: 'add', right: 1 });
    assert.equal(idle.viewCode, c.viewCode);
    const timedOut = await ok('relay_calculator_receipt', { id: idle.id, waitMs: 500 }); // found by id alone
    assert.deepEqual([timedOut.phase, timedOut.viewCode], ['queued', c.viewCode]);
    await rejected('relay_calculator_receipt', { id: idle.id, waitMs: 60_000 });
  } finally {
    await client.close();
  }
});

test('Relay readback: inspect state and snapshot image reach the agent, and bad answers do not', { timeout: 40_000 }, async () => {
  const client = new Client({ name: 'readback-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath, args: [fileURLToPath(new URL('./server.mjs', import.meta.url))],
  });
  const call = (name, args = {}) => client.callTool({ name, arguments: args }, undefined, timeout);
  const ok = async (name, args) => {
    const result = await call(name, args);
    assert.notEqual(result.isError, true, JSON.stringify(result.content));
    return result.structuredContent;
  };
  const rejected = async (name, args) => assert.equal((await call(name, args)).isError, true);
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const arm = async () => {
    const { viewCode, viewToken } = await ok('relay_arm_view');
    return { viewCode, viewToken };
  };
  // The view's side: take the delivered command.
  const take = async (view) => {
    for (let i = 0; i < 50; i++) {
      const delivery = await ok('relay_poll_view', view);
      if (delivery.phase === 'delivered') return delivery;
      await pause(100);
    }
    throw new Error('nothing was delivered');
  };
  const state = {
    left: '8', operation: 'multiply', right: '9', result: '8 × 9 = 72',
    relayStatus: 'Relay listening · code abc', relayLast: 'Applied by Relay', connection: '',
    calculateDisabled: false, armDisabled: true,
  };
  try {
    await client.connect(transport, timeout);

    // Inspect: the agent gets the view's own state back in one call.
    const v1 = await arm();
    const inspecting = call('relay_inspect_calculator', { waitMs: 8000 });
    const delivery = await take(v1);
    assert.deepEqual(delivery.command, { kind: 'inspect' });
    const ack = { ...v1, id: delivery.id, proof: delivery.proof };
    await rejected('relay_ack_view', { ...ack, result: { kind: 'snapshot', jpeg: 'AAAA' } }); // wrong kind for this command
    await rejected('relay_ack_view', { ...ack, result: { kind: 'inspect', state: { ...state, extra: 1 } } }); // unknown field
    await rejected('relay_ack_view', { ...ack, result: { kind: 'inspect', state: { ...state, operation: 'power' } } });
    await ok('relay_ack_view', { ...ack, result: { kind: 'inspect', state } });
    const inspected = await inspecting;
    assert.notEqual(inspected.isError, true);
    assert.deepEqual(inspected.structuredContent, { viewCode: v1.viewCode, id: delivery.id, phase: 'rendered', state });
    assert.match(inspected.content[0].text, /8 × 9 = 72/);

    // The view re-arms after answering; a request sent in that gap waits for the new code.
    const gap = call('relay_inspect_calculator', { waitMs: 8000 });
    await pause(700);
    const v2 = await arm();
    const second = await take(v2);
    await ok('relay_ack_view', { ...v2, id: second.id, proof: second.proof, result: { kind: 'failed', reason: 'cannot read' } });
    const failed = await gap;
    assert.equal(failed.isError, true);
    assert.match(failed.content[0].text, /cannot read/);

    // Snapshot: the agent receives a real image content block, with the data kept out of structured output.
    const jpeg = Buffer.from('not really a jpeg, but valid base64').toString('base64');
    const v3 = await arm();
    const picturing = call('relay_snapshot_calculator', { viewCode: v3.viewCode, waitMs: 8000 });
    const picture = await take(v3);
    assert.deepEqual(picture.command, { kind: 'snapshot' });
    const shot = { ...v3, id: picture.id, proof: picture.proof };
    await rejected('relay_ack_view', { ...shot, result: { kind: 'snapshot', jpeg: 'not base64!!' } });
    await rejected('relay_ack_view', { ...shot, result: { kind: 'snapshot', jpeg: 'A'.repeat(190_001) } });
    await ok('relay_ack_view', { ...shot, result: { kind: 'snapshot', jpeg } });
    const image = await picturing;
    assert.notEqual(image.isError, true);
    assert.deepEqual(image.content[0], { type: 'image', data: jpeg, mimeType: 'image/jpeg' });
    assert.equal(image.content[1].type, 'text');
    assert.deepEqual(image.structuredContent, { viewCode: v3.viewCode, id: picture.id, phase: 'rendered', bytes: jpeg.length });

    // A view that never answers times out cleanly and says so; a stale code is refused.
    await arm();
    const silent = await call('relay_snapshot_calculator', { waitMs: 400 });
    assert.equal(silent.isError, true);
    assert.equal(silent.structuredContent.phase, 'queued');
    await rejected('relay_inspect_calculator', { viewCode: v1.viewCode, waitMs: 0 });
  } finally {
    await client.close();
  }
});
