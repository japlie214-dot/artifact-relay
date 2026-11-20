# Relay Calculator MCP App

A local, stdio-only MCP App. `relay_smoke` still returns exactly one text item, `artifact-relay:ok`. `relay_open_calculator` advertises the sandboxed `ui://artifact-relay/calculator` resource. The view calls `relay_calculate` through the MCP host for typed arithmetic. Clear resets the current view only. No HTTP listener, credentials, external data, or runtime CDN is required.

## Build and verify locally

From `examples/mcp-calculator`, with Node.js 20 or newer:

```bash
npm ci --ignore-scripts --no-audit --no-fund
```

```bash
node build-view.mjs
```

```bash
node --test smoke.test.mjs calculator.test.mjs
```

The build inlines the pinned MCP Apps client and view script into the ignored `calculator.bundle.html`. Rebuild after changing the view. Once packages are cached, the install can run with `--offline`. A stdio client starts `node server.mjs` after the build; stdout is reserved for protocol frames.

## Desktop Chat entry — saved locally, restart pending

With user approval, this entry was saved under `mcpServers` in `claude_desktop_config.json` for `C:\Projects\artifact-relay`. All pre-existing configuration text was preserved. In Claude Desktop, **Settings → Developer → Edit Config** opens the file.

```json
{
  "artifact-relay-calculator": {
    "command": "C:\\Program Files\\nodejs\\node.exe",
    "args": ["C:\\Projects\\artifact-relay\\examples\\mcp-calculator\\server.mjs"]
  }
}
```

Registration and Desktop restart require explicit approval. Rollback after installation: remove only the added `artifact-relay-calculator` entry and restart Desktop. Leave all other entries and files untouched.

## Desktop acceptance — pending

1. In Desktop Chat, ask Claude to call `relay_smoke` and confirm `artifact-relay:ok`.
2. Ask Claude to open Relay Calculator. Allow the app display if prompted. Verify the native MCP App renders, not a text answer or a generic widget.
3. In the app, enter 7 and 6, choose ×, and calculate. Expect 42. Clear and verify both operands and the result reset. Enter 7 and 0, choose ÷, and verify `Cannot divide by zero.`

Local protocol tests do not establish Desktop discovery, host-mediated UI calls, or rendering. The Code tab does not render MCP Apps. Code tool visibility has not been tested and Code registration is not part of this change.

## Relay acceptance — agent drives the already-open view

Restart Desktop to reload the updated tool list, then open a fresh Relay Calculator in the thread. The view arms itself, shows `Relay listening · code …`, and renews itself every two minutes while idle (about ten minutes, then click **Arm Relay** to resume). No click or code is needed when exactly one calculator is listening. Then send:

> Use `relay_drive_calculator` on the already-open calculator: left `8`, operation `multiply`, right `9`. Do not open another calculator or answer with mental math. Then call `relay_calculator_receipt` with the returned request ID and `waitMs` 10000. Report success only if the receipt says `rendered`; otherwise report that the view has not confirmed it.

With two or more calculators listening the drive tool refuses; pass the `viewCode` shown in the intended widget. A closed widget stops counting after about five seconds without a poll. The widget keeps the last receipt on a separate line after it re-arms.

### Readback: the agent can see the widget

Two read-only tools complete the loop, as the original Relay's `read` and `screenshot` do. Each waits up to `waitMs` (default 10 s) for the view to answer, in one call:

- `relay_inspect_calculator` returns the view's own state read from its DOM: operands, operator, result line, the Relay status lines and whether its buttons are enabled.
- `relay_snapshot_calculator` returns a small JPEG of the view as an image the agent can look at (html2canvas 1.4.1, bundled; capped at 190,000 base64 characters). If the capture fails, the tool returns the reason instead of an image.

Both use the same one-command-per-arm path as `relay_drive_calculator`: the view takes the command, answers over MCP, then re-arms. A request sent in the short gap before it re-arms waits up to 3 s for the new code. The widget URI carries a hash of its bundle (`ui://artifact-relay/calculator-<hash>`), so a rebuilt widget cannot be served from a host's cache of an older one. Hosts also cache a session's tool list: after changing the tools, start a new conversation.

Acceptance, in a fresh conversation: open the calculator, call `relay_inspect_calculator` (expect empty fields), drive 8 × 9, call `relay_inspect_calculator` again (expect `8`, `multiply`, `9`, `8 × 9 = 72`), then call `relay_snapshot_calculator` and describe the image. The agent's description must match what the user sees. Inspect state is reported by the view, and the image shows what the view rendered into its own canvas, so neither is independent of the widget's code; the user's own look at the widget remains the reference.

The **same** view must show `8 × 9 = 72` and `Applied by Relay` with the matching receipt ID. The drive tool can only queue the action; the already-open view pulls it over MCP, computes locally, updates its fields and display, and sends back a receipt. A chat answer, an arithmetic tool result, or a `queued` or `delivered` receipt is not a pass. To check isolation, arm a second view if the host supports it and use only the first code; the second view must remain unchanged. Re-arm for each new action.

`relay_calculator_receipt` accepts `waitMs` (up to 15000) so the agent can wait for the view in one call. The server appends each arm, poll, drive, acknowledgement and receipt, with its process id, to the ignored `relay-debug.log` beside `server.mjs`, so you can tell whether the view's polls reach the same process that the agent's tools use.

The adapter is calculator-only and process-local. The host must allow the app's server tool calls and route them to the same stdio server instance used by Chat. The receipt is app-reported, not independent attestation; match it against the visible view. `visibility` metadata guides compatible hosts, not authorization against a raw MCP client. This is not generic UI control or a replacement for Relay's Artifact DB transport.
