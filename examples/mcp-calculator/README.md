# Relay Calculator MCP App

A local, stdio-only MCP App and the live proof that the **unchanged Artifact Relay kit** runs on MCP Apps. The calculator does real arithmetic through a server tool (`relay_calculate`, widget-only); the agent operates the widget through the kit's `relay_send` / `relay_result` tools. Server code is `server.mjs`; the Relay transport comes from `../../kit/mcp-app/` (see its README). No HTTP listener, credentials, external data or runtime CDN.

Tools: `relay_smoke` (returns exactly `artifact-relay:ok`), `relay_open_calculator` (shows the widget), `relay_calculate` (widget only), and from the kit `relay_send`, `relay_result`, `relay_db` (widget only).

## Build and verify locally

From `examples/mcp-calculator`, Node.js 20 or newer:

```bash
npm ci --ignore-scripts --no-audit --no-fund
node build-view.mjs
node --test smoke.test.mjs calculator.test.mjs
```

The build writes the ignored `app.bundle.html`; the widget URI is `ui://artifact-relay/calculator-<hash of the bundle>`. The tests run the real bridge over MCP (ping, fill, click, call, screenshot as an image, errors, the busy lock, release, a paused command read back with `relay_result`) and check that `relay_db` rejects bad paths and that `relay_send` refuses without a widget.

## Register in Claude Desktop

With Claude Desktop closed, add under `mcpServers` in `claude_desktop_config.json` (absolute paths):

```json
{
  "artifact-relay-calculator": {
    "command": "C:\\Program Files\\nodejs\\node.exe",
    "args": ["C:\\Projects\\artifact-relay\\examples\\mcp-calculator\\server.mjs"]
  }
}
```

Start Desktop. Roll back by removing only that entry. Changing the config is the person's decision.

## Acceptance (Code tab)

1. New session: ask Claude to call `relay_open_calculator`; the calculator renders with the Relay panel.
2. Ask Claude to drive it with `relay_send` only: ping, fill the operands, select the operator, click Calculate, wait_for the result, read and screenshot. Expect 8 × 9 = 72 on screen, the panel showing the lock, and a screenshot matching what you see.
3. Try 7 ÷ 0 (expect "Cannot divide by zero."), a named action (`call` `getState`), an element screenshot (`#app`), then `release:true`.

All of the above passed live in Claude Desktop's Code tab.

## Limits

Claude.ai chat cannot reach a local server. A rebuilt widget needs Desktop restarted (hosts cache widgets by URI). The store is in memory and serves one widget at a time. The widget is polled about once a second. See `../../kit/mcp-app/README.md`.
