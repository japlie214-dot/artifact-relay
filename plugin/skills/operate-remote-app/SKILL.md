---
name: operate-remote-app
description: Operate a published Claude app (artifact) that has the remote-control panel. Use when asked to click, type into, read, inspect, test or screenshot such an app, or to send commands to its private channel (data/users/me/rc/cmd).
---

# Operating a remote-controlled Claude app

The app keeps a private command channel in its database. You write a command document, the open page runs it, and you read the answer. You need the app's artifact URL and the `ArtifactData` tool (load it with ToolSearch `select:ArtifactData` if it is deferred).

> This skill is for published artifacts (`ArtifactData`). If the app is an MCP App widget and you have `relay_send` / `relay_result` tools, use the `relay-mcp-app` skill instead; the steps are the same.

## The loop

1. **Look first.** Write a command with only `{"action":"ping"}`. It never takes the app. Read `results[0].lock`: if another session holds the app, wait and try again. Do not use `takeover` unless the person says so.
2. **Read the page.** `{"action":"read"}` returns controls with selectors and current values, lists and tables. Never guess a selector.
3. **Act, then check.** Send fills, clicks and waits. After each, check `accepted`, `warning` and the final status.
4. **Release.** Put `"release": true` on your last command so the app is free for others (it also frees itself after two minutes of inactivity).

## Writing a command

`ArtifactData` action `set`, collection `data/users/me/rc/cmd`, a NEW unique `doc_id` each time (for example `s001`, `s002`), data:

```json
{"status":"pending","steps":[{"action":"fill","selector":"#name","value":"Ada"},{"action":"click","selector":"#greet"},{"action":"wait_for","selector":"#greeting","timeoutMs":5000},{"action":"read"}]}
```

Read the answer from collection `data/users/me/rc/res`, same doc id (wait a few seconds and retry). Status is `done`, `error`, `invalid` (nothing ran), `busy` (another session holds the app, nothing ran), `expired` or `interrupted`.

Steps: `ping`, `read`, `inspect`, `fill`, `click`, `check`, `select`, `press`, `wait`, `wait_for`, `text`, `call` (a named action the app defines), `screenshot`. Useful fields: `selector`, `index` (when several match), `force`, `optional` (carry on if it fails), `value`, `label`, `timeoutMs`, `ms`, `name`/`args`. Command fields: `release`, `takeover`, `expires`.

## Who you are

If the remote-control plugin hook is active, it stamps every command with your real session id automatically, so you do not need to write one. If your command comes back `invalid` asking who you are, the hook is not active: add `"agent":"<your session name>"` yourself.

## Facts to respect

- `read` and `text` give exact values. A screenshot is an approximation for layout only.
- A command that was `interrupted` may have partly run: read the page before sending anything again. The bridge never retries.
- Screenshots live in `data/users/me/rc/snap/<id>`; decode with the `decode-snap.mjs` script that ships with the kit.
- The first call to a connector from the app shows an Allow prompt that only the person can click. Never try to click it; tell them.
- If the page is closed, commands wait as `pending`. Show the artifact pane and open the app, wait up to a minute, and if nothing answers, ask the person to open it.
- Never type secrets into commands.
