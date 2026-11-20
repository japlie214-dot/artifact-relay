# Artifact Relay starter kit

Everything you need to let Claude operate, read and screenshot a Claude app. Three ways to use it, from fastest to most flexible.

## Files

| File | What it is |
|---|---|
| `starter.html` | A one-file skeleton app with the remote control already wired in. |
| `multi-file/index.html` | The same skeleton, split into separate files (for apps that already have several files). |
| `multi-file/rc/bridge.js` | The bridge: listens for commands and carries them out. |
| `multi-file/rc/rc-wiring.js` | Connects the bridge to your page and to the status panel. |
| `multi-file/rc/rc-panel.css` | Styles for the status panel. Uses your colour tokens if you have them. |
| `multi-file/rc/rc-panel.html` | The status panel markup to paste into your page. |
| `actions.example.js` | A skeleton for named actions (`call` steps), with the safety rules. |
| `publish/capabilities.json` | The publish settings (db rules and user). |
| `publish/capabilities.with-connector.json` | The same plus a connector (Snowflake shown). |
| `prompts.md` | Copy-paste sentences to say to Claude. |
| `CHECKLIST.md` | Before you publish, before you rely on it, before you share it. |
| `mcp-app/` | The same remote control for MCP App widgets: server tools, widget shim, assembler and a starter app. |

## Way A: start from `starter.html` (fastest)

1. Copy `starter.html`. Replace everything inside `<section id="app">` with your app, and the demo code under `YOUR APP LOGIC`.
2. Give every control Claude should use an `id`.
3. Ask Claude to publish it with `publish/capabilities.json` (see `prompts.md`).
4. Open the app. The panel should say `on`. Ask Claude to `ping`, then `read`.

## Way B: multi-file

1. Copy the `multi-file` folder.
2. Ask Claude to publish `multi-file/index.html` and to include `rc/bridge.js`, `rc/rc-wiring.js` and `rc/rc-panel.css` as supporting files (see `prompts.md`).
3. Edit only the app part of `index.html`. Leave `rc/` alone, so you can update the bridge later by replacing those files.

## Way C: add it to an app you already have

1. Add the panel: paste `rc/rc-panel.html` into your page and the contents of `rc/rc-panel.css` into your styles.
2. Add the screenshot library before your scripts:
   `<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>`
3. Paste `rc/bridge.js` into a `<script>` (or load it with `<script src>`).
4. Define `window.REMOTE_ACTIONS` (use `actions.example.js` as a guide; an empty `{}` is fine).
5. Paste `rc/rc-wiring.js` **after** the bridge and your actions.
6. Wrap your app in an element with `id="app"` and give the controls ids.
7. Publish with `publish/capabilities.json` (or the `with-connector` version).

## Way D: an MCP App widget

For a widget shown by a local MCP server (Claude Desktop's Code tab, Claude Code) instead of a published artifact. The same bridge runs unchanged; only the database is replaced by a small server-side store. Copy the whole kit, start from `mcp-app/starter/` and read `mcp-app/README.md`. The agent uses the `relay_send` / `relay_result` tools.

## Conventions the bridge relies on

- **`#app`** is the default area for `read` and `inspect`. If your app has no `#app`, the whole page is used.
- **Ids or `data-rc` attributes** on controls give Claude stable selectors. `read` reports a selector for every control.
- **The `hidden` attribute** for things that should not be seen. Visibility is checked for real, so CSS hiding works too.
- **A clear "finished" element** (a results table, a "Saved" message) so a `wait_for` has something to wait for.
- **Small results.** Documents are limited to 256 KB. Use selectors to read less.

## Changing limits

Set `window.RC_OPTIONS = { limits: { maxSteps: 20, stepTimeoutMs: 60000 } }` before `rc-wiring.js` runs. See the `limits` object at the top of `createBridge` in `bridge.js` for everything you can change.

## Updating the bridge later

Replace the bridge code (or `rc/bridge.js`) with a newer copy. The wiring and panel do not need to change unless the release notes say so.

## Step reference

Every step is an object with an `action`. Common extra fields:

| Field | Used by | Meaning |
|---|---|---|
| `selector` | most | CSS selector. Prefer `#id`. |
| `index` | most | Which match to use when the selector matches several (0 is the first). |
| `force` | click, fill... | Act even if the element is hidden. Use rarely. |
| `optional` | any | If this step fails, record it and carry on instead of stopping the command. |
| `value`, `label` | fill, select | What to type or which option to choose. |
| `timeoutMs`, `ms` | wait_for, wait | How long to wait. |
| `name`, `args` | call | A named action from `window.REMOTE_ACTIONS`. |

Fields on the command itself (next to `steps`): `agent` (your name), `release` (free the app when done), `takeover` (take the app from another agent; only if the person says so), `expires` (epoch ms after which the command must not run).

## Saving files from your app (for example a chart as PNG)

A published page cannot rely on a plain download link. Add the `downloads` capability to your publish settings (`"downloads": true`) and follow the artifact-capabilities skill on how a page hands a file to the viewer. A finished example is in `examples/chart-maker/` (Export PNG).

## Agent names

The kit makes the `agent` field required. Agents should use their session name. The bridge cannot see session IDs or verify the name, so it is a label, not proof of identity; ask each session to use a distinct one.

## Changing the look of the panel

Open `panel-styles.html` to see six looks (hairline, enterprise, quiet-dark, ops-dashboard, control-room, minimal), then copy one CSS file from `styles/` over `rc/rc-panel.css` (or over the `#rc` rules in a single-file app).
