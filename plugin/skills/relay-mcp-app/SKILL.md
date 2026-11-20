---
name: relay-mcp-app
description: Build or operate an MCP App (a widget a local MCP server shows inside Claude Desktop or Claude Code) with Artifact Relay. Use when asked to make a Relay-enabled MCP widget, to click, fill, read, test or screenshot an MCP widget, or when tools named relay_send / relay_result / relay_db exist.
---

# Artifact Relay on an MCP App

The same Relay bridge that operates a published artifact also runs inside an MCP App widget. Only the transport differs: the page's database is a small in-memory store inside your MCP server, reached through the server's own tools. The bridge, the panel, the lock and all step actions are unchanged.

## Operating an open widget

The tools are `relay_send` and `relay_result` (and `relay_db`, which belongs to the widget: never call it). They exist only when the server was built with the kit's `registerRelay`. If the tools are missing, the server is not registered in this host or the session started before it was (see Facts).

1. **Open the widget first.** Call the server's own open tool (for example `app_open`). `relay_send` refuses with "no widget connected" until the widget has been on screen and polling in the last few seconds. Do not retry in a loop; show the widget, then try once.
2. **Look first.** `relay_send` with `{"agent":"<your session name>","steps":[{"action":"ping"}]}`. `results[0].lock` says who holds the app. Do not set `takeover` unless the person says so.
3. **Read before acting.** A step `{"action":"read"}` returns controls with selectors and values. Never guess a selector.
4. **Act, then check.** Send fills, clicks, `wait_for` and a final `read` or `text` in one call (up to 40 steps). Check `status` and each step's `ok`.
5. **Release** with `"release": true` on your last call.

Step actions are exactly the Artifact ones: `ping`, `read`, `inspect`, `fill`, `click`, `check`, `select`, `press`, `wait`, `wait_for`, `text`, `call` (a named action in the app's `actions.js`), `screenshot`. Fields: `selector`, `index`, `force`, `optional`, `value`, `label`, `timeoutMs`, `ms`, `name`/`args`. Call fields: `agent` (required unless the hook stamps you), `release`, `takeover`, `expires`, `waitMs`.

Results come back in `structuredContent` (`id`, `status`, `results`), and screenshots as image content. If a command outlives `waitMs` you get its `id` with `finished:false`: call `relay_result` with that id. A result with `status:"interrupted"` may have partly run: read the page before sending again. Status `busy` means another session holds the app and nothing ran.

## Facts to respect

- `read`/`text` give exact values; a screenshot is for layout only. Never type secrets into steps.
- Hosts cache a widget's HTML by its `ui://` URI and only render URIs the server advertised when the host started it. The kit's example gives each build a hashed URI, so **a rebuilt widget needs the host restarted**. Server tool logic that is not the widget only needs the node process killed (the host respawns it on the next call). New or changed tool definitions need a new session.
- The host shows you `structuredContent`; the text block may be dropped. Keep anything you need in `structuredContent`.
- A widget can work while `document.visibilityState` is "hidden". There is no push channel to the widget; it polls about once a second, so a step can start up to a second late.
- Claude.ai chat cannot reach a local stdio server. Claude Desktop's Code tab and Claude Code render and drive widgets.
- Never edit `claude_desktop_config.json` while Claude Desktop runs: it rewrites the file on quit and your edit is lost.
- Registering a server in the person's Claude Desktop config changes their settings: describe the exact entry and get a yes first.

## Building one

Start from `kit/mcp-app/starter/` (see `kit/mcp-app/README.md`; copy the whole `kit` folder, because the starter imports `../server` and `../widget`). It is a complete working app: `server.mjs`, `app.html` with the two marker comments, `app-view.js`, `actions.js`, `build-view.mjs`, and a test. Then:

1. `npm install`, `node build-view.mjs`, `npm test`.
2. Replace the greeter: keep every control in `#app` with an `id`; call your server through `window.RELAY_MCP.callTool(name, args)`; hide widget-only tools with `visibility:["app"]`.
3. Define small `REMOTE_ACTIONS` for state the page cannot show plainly.
4. Prove it with the real bridge: after the person restarts the host, drive your own app with `relay_send` (fill, click, wait_for, read, screenshot) and compare with what the person sees. A test that never ran the bridge does not count.

Reuse the kit's `server/relay-mcp.mjs` and `widget/*` unchanged. Do not edit `bridge.js`.
