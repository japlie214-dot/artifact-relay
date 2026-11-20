# Artifact Relay on an MCP App

Run the unchanged Relay bridge inside an MCP App widget (a page a local MCP server shows in Claude Desktop's Code tab or Claude Code), so Claude can read, fill, click, wait for and screenshot it, with the same lock, steps and panel as an Artifact app.

## How it works

| Piece | Role |
|---|---|
| `widget/mcp-shim.js` | Connects the widget to its host with the MCP Apps client and defines `window.claude` (`use("db")`, `use("user")`, user id `local`) so `rc-wiring.js` and `bridge.js` run **unchanged**. Also exposes `window.RELAY_MCP.callTool(name, args)` for your own app code. |
| `widget/mcp-db.js` | The database API the bridge needs (doc get/set/update/delete/acquire, collection where/onSnapshot), implemented over one tool call. It polls about once a second. |
| `server/relay-store.mjs` | A small in-memory store with size limits and leases. |
| `server/relay-mcp.mjs` | `registerRelay(server, {z, registerAppTool, uri})` adds three tools: `relay_db` (widget only, strict path rules), and `relay_send` and `relay_result` for the agent. |
| `widget/assemble.mjs` | Builds one self-contained widget HTML: html2canvas, `bridge.js`, your actions, the MCP shim, your scripts, then `rc-wiring.js`, plus the panel markup and styles. |
| `starter/` | A complete tiny app and its test. Copy it. |

The agent writes a command through `relay_send`; the server stores it; the widget polls, the bridge runs it against the page, and writes the result; the server returns it in `structuredContent` (screenshots as image blocks). Nothing in `bridge.js` knows about MCP.

## Use it

1. Copy the **whole `kit` folder** somewhere you own (the starter imports `../server`, `../widget` and `../../multi-file/rc`).
2. In `kit/mcp-app/starter`: `npm install`, `node build-view.mjs`, `npm test`.
3. Replace the greeter: put your markup in `app.html` inside `<main id="app">` (every control with an `id`), your behaviour in `app-view.js` (call the server with `window.RELAY_MCP.callTool`), named actions in `actions.js`, and your tools in `server.mjs`. Widget-only tools use `visibility:["app"]`; the tool that shows the widget uses `visibility:["model"]`.
4. Register the server in the host. Claude Desktop: add under `mcpServers` in `claude_desktop_config.json` (Settings, Developer, Edit Config) with Claude Desktop **closed**, using absolute paths:
   ```json
   { "my-app": { "command": "C:\Program Files\nodejs\node.exe", "args": ["C:\path\to\kit\mcp-app\starter\server.mjs"] } }
   ```
   Claude Code: `claude mcp add my-app -- node /path/to/server.mjs`. Then restart the host.
5. In a new session in the Code tab: call the open tool, then ask Claude to drive it (see `prompts.md`, "MCP App widgets").

## Changing the widget

Edit, `node build-view.mjs`, restart the host. Hosts cache widget HTML by `ui://` URI and only render URIs the server advertised at startup; the starter hashes the bundle into the URI, so a rebuilt widget is a new URI the running host has never heard of. Changes to server tool logic only need the node process killed (the host starts it again on the next call). New or changed tool definitions need a new session.

## Limits and facts (observed in Claude Desktop)

- Local stdio only. Claude.ai chat cannot reach it; the Code tab and Claude Code can.
- The host shows the agent `structuredContent`, so results live there; the text block may be dropped.
- The widget must have been polling within the last 5 seconds or `relay_send` refuses. There is no push channel to the widget, so a step may start up to a second late.
- The store is in memory: closing the server forgets commands and results. One widget at a time per server.
- A widget can work while `document.visibilityState` is "hidden".
- html2canvas works inside the sandboxed widget iframe; screenshots come back as JPEG image blocks.
- Pinned: `@modelcontextprotocol/sdk` 1.32.2, `@modelcontextprotocol/ext-apps` 1.7.5, `zod` 4.1.12, `html2canvas` 1.4.1, `esbuild` 0.28.2.

A working larger example (a calculator with real arithmetic over MCP, live-verified) is in `examples/mcp-calculator` in the repository.
