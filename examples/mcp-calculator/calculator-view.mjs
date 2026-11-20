import { App } from '@modelcontextprotocol/ext-apps';
import html2canvas from 'html2canvas';
import { calculate } from './calculator.mjs';

const form = document.getElementById('calculator');
const left = document.getElementById('left');
const operation = document.getElementById('operation');
const right = document.getElementById('right');
const submit = document.getElementById('calculate');
const result = document.getElementById('result');
const connection = document.getElementById('connection');
const arm = document.getElementById('arm');
const relayStatus = document.getElementById('relay-status');
const relayLast = document.getElementById('relay-last');
const app = new App({ name: 'Relay Calculator', version: '0.2.0' });
const maxIdleRenewals = 5; // About ten minutes of idle listening, then wait for a click.
let connected = false;
let revision = 0;
let listening = false;
let idleRenewals = 0;

form.addEventListener('reset', () => {
  revision++;
  result.textContent = '';
  submit.disabled = !connected;
  left.focus();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (submit.disabled) return;
  const request = ++revision;
  const args = { left: left.valueAsNumber, operation: operation.value, right: right.valueAsNumber };
  if (!Number.isFinite(args.left) || !Number.isFinite(args.right)) {
    result.textContent = 'Enter two finite numbers.';
    return;
  }
  submit.disabled = true;
  result.textContent = 'Calculating…';
  try {
    const response = await app.callServerTool({ name: 'relay_calculate', arguments: args });
    if (request !== revision) return;
    const data = response.structuredContent;
    result.textContent = typeof data?.error === 'string' ? data.error
      : !response.isError && Number.isFinite(data?.value) ? String(data.value)
      : response.content?.find(({ type }) => type === 'text')?.text ?? 'Calculation failed.';
  } catch {
    if (request === revision) result.textContent = 'Unable to reach the calculator tool.';
  } finally {
    if (request === revision) submit.disabled = !connected;
  }
});

async function relayCall(name, args = {}) {
  const response = await app.callServerTool({ name, arguments: args }, { timeout: 10_000 });
  if (response.isError || !response.structuredContent) {
    throw new Error(response.content?.find(({ type }) => type === 'text')?.text ?? 'Host did not return Relay data.');
  }
  return response.structuredContent;
}

// What this view shows right now, read from its own DOM. Strings are capped to what the server accepts.
const cap = (value, max = 300) => String(value ?? '').slice(0, max);
function inspectState() {
  return {
    left: cap(left.value, 60), operation: operation.value, right: cap(right.value, 60),
    result: cap(result.textContent), relayStatus: cap(relayStatus.textContent), relayLast: cap(relayLast.textContent),
    connection: cap(connection.textContent, 120), calculateDisabled: submit.disabled, armDisabled: arm.disabled,
  };
}

// A small JPEG of this view as bare base64, kept under the server's size limit.
async function snapshot() {
  const full = await html2canvas(document.body, { backgroundColor: getComputedStyle(document.body).backgroundColor, scale: 1, logging: false });
  const small = document.createElement('canvas');
  small.width = Math.min(full.width, 640);
  small.height = Math.max(1, Math.round(full.height * small.width / full.width));
  small.getContext('2d').drawImage(full, 0, 0, small.width, small.height);
  for (const quality of [0.8, 0.6, 0.4]) {
    const url = small.toDataURL('image/jpeg', quality);
    const jpeg = url.slice(url.indexOf(',') + 1);
    if (jpeg.length <= 190_000) return jpeg;
  }
  throw new Error('image too large');
}

// Listen for exactly one typed command, carry it out here, report the outcome, then re-arm.
async function listen() {
  if (listening || !connected) return;
  listening = true;
  arm.disabled = true;
  let renew = false;
  let updated = false;
  try {
    relayStatus.textContent = 'Arming this calculator…';
    const { viewCode, viewToken, listenMs } = await relayCall('relay_arm_view');
    const credentials = { viewCode, viewToken };
    const deadline = performance.now() + listenMs;
    relayStatus.textContent = `Relay listening · code ${viewCode}`;
    while (performance.now() < deadline) {
      const delivery = await relayCall('relay_poll_view', credentials);
      if (delivery.phase === 'delivered') {
        const { command, id, proof } = delivery;
        let report;
        let note;
        if (command.kind === 'drive') {
          ++revision; // Ignore any earlier in-flight manual calculation.
          left.value = String(command.left);
          operation.value = command.operation;
          right.value = String(command.right);
          const calculation = calculate(command); // Runs in this view, not in the agent tool.
          result.textContent = calculation.content[0].text;
          submit.disabled = !connected;
          updated = true;
          report = { kind: 'drive', displayed: calculation.structuredContent };
          note = `Applied by Relay · view ${viewCode} · receipt ${id}`;
        } else if (command.kind === 'inspect') {
          report = { kind: 'inspect', state: inspectState() };
          note = `Read by Relay · view ${viewCode} · receipt ${id}`;
        } else if (command.kind === 'snapshot') {
          try {
            report = { kind: 'snapshot', jpeg: await snapshot() };
            note = `Pictured by Relay · view ${viewCode} · receipt ${id}`;
          } catch (error) {
            report = { kind: 'failed', reason: cap(`capture failed: ${error?.message ?? error}`, 200) };
            note = `Picture failed · view ${viewCode} · receipt ${id}`;
          }
        } else {
          report = { kind: 'failed', reason: cap(`unsupported command ${command.kind}`, 200) };
          note = `Unsupported Relay command · receipt ${id}`;
        }
        await relayCall('relay_ack_view', { ...credentials, id, proof, result: report });
        relayLast.textContent = note;
        idleRenewals = 0;
        renew = true;
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(1000, Math.max(0, deadline - performance.now()))));
    }
    if (++idleRenewals <= maxIdleRenewals) renew = true;
    else relayStatus.textContent = 'Relay stopped listening after being idle. Click Arm to resume.';
  } catch (error) {
    relayStatus.textContent = updated ? 'The view updated, but its receipt was not confirmed.' : `Relay unavailable: ${error.message}`;
  } finally {
    listening = false;
    arm.disabled = !connected;
    if (renew) listen();
  }
}

arm.addEventListener('click', () => { idleRenewals = 0; listen(); });

app.connect().then(() => {
  connected = true;
  submit.disabled = false;
  connection.textContent = '';
  listen();
}).catch(() => {
  connection.textContent = 'Could not connect to the MCP host.';
});
