import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { calculatorInput } from './calculator.mjs';

const code = z.string().regex(/^[a-f0-9]{10}$/i).transform((value) => value.toLowerCase());
const token = z.string().uuid();
const text = (max) => z.string().max(max);
const waitSchema = z.number().int().min(0).max(15_000).optional();
export const listenMs = 120_000;
const debugLog = process.env.RELAY_DEBUG_LOG ?? fileURLToPath(new URL('./relay-debug.log', import.meta.url));
// Diagnostics only: which calls reach this process, and when. Never stdout, never secrets (no tokens, no image data).
const trace = (event, detail = '') => {
  try { appendFileSync(debugLog, `${new Date().toISOString()} pid=${process.pid} ${event} ${detail}\n`); } catch { /* best effort */ }
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// What a view may send back for the command it was handed. 'failed' is allowed for any command.
const outcome = z.union([
  z.strictObject({ kind: z.literal('drive'), displayed: z.union([z.strictObject({ value: z.number().finite() }), z.strictObject({ error: text(120) })]) }),
  z.strictObject({
    kind: z.literal('inspect'),
    state: z.strictObject({
      left: text(60), operation: z.enum(['add', 'subtract', 'multiply', 'divide']), right: text(60),
      result: text(300), relayStatus: text(300), relayLast: text(300), connection: text(120),
      calculateDisabled: z.boolean(), armDisabled: z.boolean(),
    }),
  }),
  z.strictObject({ kind: z.literal('snapshot'), jpeg: z.string().max(190_000).regex(/^[A-Za-z0-9+/]+={0,2}$/) }),
  z.strictObject({ kind: z.literal('failed'), reason: text(200) }),
]);

export function registerCalculatorRelay(server, registerAppTool, uri, { now = Date.now } = {}) {
  // This map lives only in the local stdio process. An armed view handles one command, then re-arms itself.
  const views = new Map();
  const app = (name, description, inputSchema, handler) => registerAppTool(server, name, {
    description, inputSchema, _meta: { ui: { resourceUri: uri, visibility: ['app'] } },
  }, async (args) => handler(args));
  const model = (name, description, inputSchema, handler) => server.registerTool(name, {
    description, inputSchema,
  }, async (args) => handler(args));
  const reply = (message, data, isError = false) => ({
    content: [{ type: 'text', text: message }], ...(data && { structuredContent: data }), ...(isError && { isError }),
  });
  const missing = () => reply('No active Relay view or request matches. Arm the open calculator again.', null, true);
  const live = () => {
    for (const [key, view] of views) if (view.expires <= now()) views.delete(key);
    return views;
  };
  const owner = (viewCode, viewToken) => {
    const view = live().get(viewCode);
    return view?.token === viewToken ? view : undefined;
  };

  app('relay_arm_view', 'Arm this calculator view for one Relay command.', {}, () => {
    if (live().size >= 32) return reply('Too many armed calculator views. Try again later.', null, true);
    let viewCode;
    do { viewCode = randomBytes(5).toString('hex'); } while (views.has(viewCode));
    const viewToken = randomUUID();
    views.set(viewCode, { token: viewToken, expires: now() + listenMs, phase: 'armed', lastPoll: now() });
    trace('arm', `view=${viewCode}`);
    return reply('View armed.', { viewCode, viewToken, listenMs });
  });
  const credentials = { viewCode: code, viewToken: token };
  app('relay_poll_view', 'Take the one queued command for this calculator view.', z.strictObject(credentials), ({ viewCode, viewToken }) => {
    const view = owner(viewCode, viewToken);
    trace('poll', `view=${viewCode} ${view ? `phase=${view.phase}` : 'unknown-or-expired'}`);
    if (!view) return missing();
    view.lastPoll = now();
    if (view.phase !== 'queued') return reply('No queued command.', { phase: view.phase });
    view.phase = 'delivered';
    view.proof = randomUUID();
    return reply('Carry out this command in the current view.', { phase: view.phase, id: view.id, command: view.command, proof: view.proof });
  });
  app('relay_ack_view', 'Report the outcome of the delivered command for this calculator view.', z.strictObject({
    ...credentials, id: token, proof: token, result: outcome,
  }), ({ viewCode, viewToken, id, proof, result }) => {
    const view = owner(viewCode, viewToken);
    trace('ack', `view=${viewCode} ${view ? `phase=${view.phase}` : 'unknown-or-expired'} kind=${result.kind}`);
    if (!view || view.phase !== 'delivered' || view.id !== id || view.proof !== proof) return missing();
    if (result.kind !== 'failed' && result.kind !== view.command.kind) return reply('The result does not match the delivered command.', null, true);
    view.phase = 'rendered';
    view.result = result;
    view.expires = now() + listenMs; // Leave time for the agent to read the outcome.
    return reply('Outcome recorded.', { phase: view.phase });
  });

  // Implicit targeting counts only armed views that polled recently, so a closed widget cannot cause ambiguity.
  const listening = () => [...live()].filter(([, view]) => view.phase === 'armed' && now() - view.lastPoll < 5_000);
  // Find the view to command. A view re-arms right after it answers, so wait briefly for that.
  async function acquire(viewCode) {
    const until = Date.now() + 3_000;
    for (;;) {
      if (viewCode) {
        const view = live().get(viewCode);
        if (!view) return { problem: missing() };
        if (view.phase === 'armed') return { target: viewCode, view };
        if (view.phase !== 'rendered' || Date.now() >= until) {
          return { problem: reply('That view already has a request. It re-arms with a new code after answering; omit viewCode or use the new code.', null, true) };
        }
      } else {
        const candidates = listening();
        if (candidates.length > 1) return { problem: reply(`${candidates.length} calculators are listening. Pass the viewCode shown in the intended widget.`, null, true) };
        if (candidates.length === 1) return { target: candidates[0][0], view: candidates[0][1] };
        if (Date.now() >= until) return { problem: reply('No calculator is listening. Open one with relay_open_calculator, wait a moment, and try again.', null, true) };
      }
      await pause(200);
    }
  }
  function queue(view, command) {
    view.phase = 'queued';
    view.id = randomUUID();
    view.command = command;
    view.expires = Math.max(view.expires, now() + 30_000);
    return view.id;
  }
  async function settle(viewCode, id, waitMs) {
    const until = Date.now() + waitMs;
    let view = live().get(viewCode);
    while (view?.id === id && view.phase !== 'rendered' && Date.now() < until) {
      await pause(250);
      view = live().get(viewCode);
    }
    return view?.id === id ? view : undefined;
  }

  const target = 'Omit viewCode when exactly one calculator is open and listening; if there are several, pass the code shown in the widget.';
  model('relay_drive_calculator', `Send one typed arithmetic command to an already-open Relay Calculator. Does not calculate or open a view. ${target} Then call relay_calculator_receipt with waitMs to confirm the view applied it.`, z.strictObject({
    viewCode: code.optional(), ...calculatorInput.shape,
  }), async ({ viewCode, ...action }) => {
    const found = await acquire(viewCode);
    trace('drive', found.problem ? 'refused' : `view=${found.target}`);
    if (found.problem) return found.problem;
    const id = queue(found.view, { kind: 'drive', ...action });
    return reply('Queued only; not yet verified in the UI.', { phase: 'queued', id, viewCode: found.target });
  });
  model('relay_calculator_receipt', 'Check whether the already-open view acknowledged the exact Relay request. Pass waitMs (up to 15000) to wait for the view in this one call. Only rendered means an acknowledgement was received.', z.strictObject({
    viewCode: code.optional(), id: token, waitMs: waitSchema,
  }), async ({ viewCode: given, id, waitMs = 0 }) => {
    const find = () => given ?? [...live()].find(([, entry]) => entry.id === id)?.[0];
    let viewCode = find();
    const until = Date.now() + waitMs;
    let view = live().get(viewCode);
    while (view?.id === id && view.phase !== 'rendered' && Date.now() < until) {
      await pause(250);
      viewCode = find();
      view = live().get(viewCode);
    }
    trace('receipt', `view=${viewCode} ${view ? `phase=${view.phase}` : 'unknown-or-expired'}`);
    if (!view || view.id !== id) return missing();
    const shown = view.phase === 'rendered' && view.result?.kind === 'drive' ? { displayed: view.result.displayed } : {};
    return reply(view.phase === 'rendered' ? 'The targeted calculator view acknowledged the update.' : 'The view has not acknowledged the update.', {
      phase: view.phase, viewCode, id, ...shown,
    });
  });

  model('relay_inspect_calculator', `Read the current state of an already-open Relay Calculator: the two operands, the operator, the result line, its Relay status lines and whether its buttons are enabled. Read-only; changes nothing. ${target} Waits up to waitMs (default 10000) for the view to answer.`, z.strictObject({
    viewCode: code.optional(), waitMs: waitSchema,
  }), async ({ viewCode, waitMs = 10_000 }) => {
    const found = await acquire(viewCode);
    trace('inspect', found.problem ? 'refused' : `view=${found.target}`);
    if (found.problem) return found.problem;
    const id = queue(found.view, { kind: 'inspect' });
    const view = await settle(found.target, id, waitMs);
    const base = { viewCode: found.target, id };
    if (view?.phase !== 'rendered') return reply(`The view did not answer within ${waitMs} ms.`, { ...base, phase: view?.phase ?? 'expired' }, true);
    if (view.result.kind === 'failed') return reply(`The view could not report its state: ${view.result.reason}`, { ...base, phase: 'failed' }, true);
    return reply(`Calculator state: ${JSON.stringify(view.result.state)}`, { ...base, phase: 'rendered', state: view.result.state });
  });
  model('relay_snapshot_calculator', `Take a picture of an already-open Relay Calculator and return it as an image you can look at. Read-only; changes nothing. ${target} Waits up to waitMs (default 10000) for the view to answer.`, z.strictObject({
    viewCode: code.optional(), waitMs: waitSchema,
  }), async ({ viewCode, waitMs = 10_000 }) => {
    const found = await acquire(viewCode);
    trace('snapshot', found.problem ? 'refused' : `view=${found.target}`);
    if (found.problem) return found.problem;
    const id = queue(found.view, { kind: 'snapshot' });
    const view = await settle(found.target, id, waitMs);
    const base = { viewCode: found.target, id };
    if (view?.phase !== 'rendered') return reply(`The view did not answer within ${waitMs} ms.`, { ...base, phase: view?.phase ?? 'expired' }, true);
    if (view.result.kind === 'failed') return reply(`The view could not take a picture: ${view.result.reason}`, { ...base, phase: 'failed' }, true);
    return {
      content: [
        { type: 'image', data: view.result.jpeg, mimeType: 'image/jpeg' },
        { type: 'text', text: `Snapshot of calculator view ${found.target} (${view.result.jpeg.length} base64 characters).` },
      ],
      structuredContent: { ...base, phase: 'rendered', bytes: view.result.jpeg.length },
    };
  });
}
