---
name: build-remote-app
description: Build and publish a new Claude app (artifact) that Claude can operate remotely, or add remote control to an existing app. Use when asked for a Claude app with remote control, a remote-controllable artifact, or the remote-control panel.
---

# Building a remote-controllable Claude app

Everything you need is in this plugin's `kit` folder: `${CLAUDE_PLUGIN_ROOT}/kit`. Read `${CLAUDE_PLUGIN_ROOT}/kit/README.md` first, then follow it.

## Steps

1. **Start from the skeleton.** Copy `${CLAUDE_PLUGIN_ROOT}/kit/starter.html` (one file) or `${CLAUDE_PLUGIN_ROOT}/kit/multi-file/` (app plus an `rc/` folder) into a working folder of your own. Do not edit files inside the plugin. Replace what is inside `#app` with the real app and give every control an `id`.
2. **Pick a panel look.** Open `${CLAUDE_PLUGIN_ROOT}/kit/panel-styles.html` or read the CSS files in `${CLAUDE_PLUGIN_ROOT}/kit/styles/`. To change the look, replace `rc/rc-panel.css` (or the `#rc` rules in a single-file app) with one of them. The default is `hairline`.
3. **Add named actions only if needed.** `${CLAUDE_PLUGIN_ROOT}/kit/actions.example.js` shows the safe pattern (idempotent, validated, small JSON).
4. **Publish** with the settings in `${CLAUDE_PLUGIN_ROOT}/kit/publish/capabilities.json` (db with two rules, plus user). If the app calls a connector, use `capabilities.with-connector.json` and change the connector name and tools. If it saves files, add `"downloads": true`. For the multi-file layout, publish `rc/bridge.js`, `rc/rc-wiring.js`, `rc/rc-panel.css` as supporting files at the same paths. Load the `artifact-design` and `artifact-capabilities` skills before writing the page.
5. **Verify through the channel.** Use the `operate-remote-app` skill: ping, read, fill and read back, a click on something disabled (must fail clearly), a command with a typo (must be `invalid`), a screenshot you actually look at.
6. **Review** against `${CLAUDE_PLUGIN_ROOT}/kit/CHECKLIST.md` and, for the reasoning, `${CLAUDE_PLUGIN_ROOT}/docs/best-practices.html`.

## Rules that matter

- Keep the panel, the bridge and the wiring together and unmodified. `window.REMOTE_ACTIONS` must be defined before the wiring script runs.
- The channel is private per person: `data/users/<id>/rc`. Never put secrets in commands or results.
- Ask the person before publishing a shared or public app. Artifacts start private.
