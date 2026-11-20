# Remote-control checklist

Tick these off in order. Each line exists because skipping it caused a real problem.

## Before you publish

- [ ] Every control Claude should use has an `id` (or a `data-rc` attribute).
- [ ] The app is wrapped in an element with `id="app"`.
- [ ] Things that should be hidden use the `hidden` attribute.
- [ ] Slow actions show a clear "finished" element (results table, "Saved" message), so waits have something to wait for.
- [ ] You pasted the panel, the bridge, and the wiring, in that order, with `window.REMOTE_ACTIONS` defined before the wiring.
- [ ] Any named action is safe to run twice, validates its args, and returns small JSON.
- [ ] Nothing secret is typed into commands or stored in results.
- [ ] Publish settings: `db` with the two rules, `user`, and `mcp` only if you call a connector.

## First run

- [ ] The panel says `on` (not `off`). If it says `off`, read the reason next to it.
- [ ] `ping` answers, and `visibility` is `visible`.
- [ ] `read` returns your controls with the right selectors and values.
- [ ] A fill then read-back shows `accepted: true`.
- [ ] A click on a disabled control fails with a clear message (try it once on purpose).
- [ ] A command with a typo is reported `invalid` and nothing in it runs.
- [ ] A `wait_for` on something that never appears fails the command (try it once on purpose).
- [ ] A screenshot arrives, and you looked at it.
- [ ] If a connector is involved: the Allow prompt appeared and you clicked it.

## Before you rely on it

- [ ] Every agent has its own name in the `agent` field, and you saw a second agent get `busy` (nothing ran) while the first held the app.
- [ ] Agents send `release: true` on their last command, and you know the app frees itself after 2 minutes of inactivity (`lockIdleMs`).
- [ ] You tried closing the page and sending a command. It waits as `pending` and runs when the page opens.
- [ ] You know what `interrupted` means and you read the page before sending anything again.
- [ ] You use `read` or `text` for exact values and screenshots only for layout.
- [ ] Commands that must not run late have `expires`.
- [ ] Someone knows how to delete old `cmd`, `res` and `snap` documents (the app holds at most 25,000 documents).
- [ ] You ran the stress tests (`tests/stress-tests.html`) and, if you changed the bridge, you added a test for the change.

## Before you share the app

- [ ] Everyone who should use remote control has Contributor access or higher. Viewers can use the app, but their panel says `off`.
- [ ] Each person knows they connect their own connector and click their own Allow.
- [ ] You told people their channel is private, including from you.
- [ ] No secrets are typed into commands or kept anywhere in the app's database, because anything you share the app's shared data with could see shared documents.

## When you change the app

- [ ] Selectors you or Claude used still exist (send `read`).
- [ ] You are not republishing while a command is running. A republish reloads open pages.

## MCP App widgets (`mcp-app/`)

- [ ] You copied the whole `kit` folder (the starter imports `../server`, `../widget`, `../../multi-file/rc`), ran `npm install`, `node build-view.mjs` and `npm test`.
- [ ] `app.html` has `id="app"`, every control has an `id`, and both marker comments (`RELAY_PANEL`, `RELAY_SCRIPTS`) are present.
- [ ] Widget-only tools use `visibility:["app"]`; the agent-facing open tool uses `visibility:["model"]`.
- [ ] The widget URI includes a hash of the bundle, and you know a rebuilt widget needs the host restarted.
- [ ] Only the person edits `claude_desktop_config.json`, with Claude Desktop closed. The entry points at your `server.mjs` with an absolute path.
- [ ] After the host restarts: open tool shows the widget, the panel says `on`, and `relay_send` with `ping` answers.
- [ ] `relay_send` before the widget is open is refused with a clear message (try it once).
- [ ] You drove the real widget with fill, click, wait_for, read and a screenshot through `relay_send`, and the person saw the same state on screen.
- [ ] A second session gets `busy` while the first holds the app; `release:true` frees it.
- [ ] You did not edit `bridge.js` or the panel to make it work; only `mcp-app/` files differ from an Artifact app.
