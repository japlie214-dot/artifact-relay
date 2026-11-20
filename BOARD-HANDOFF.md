# Artifact Relay — board handoff

Snapshot: 2026-11-19. Summarized from `C:\Projects\Board Notes\artifact-relay`. The board remains the source of truth for approvals, live run status, and ticket acceptance. This is not a copy of the board or a new authorization.

## What is already done

- **Onboarding T001 was accepted in the managed checkout.** The board records the approved 96-path import, with only 17 branding paths changed and the original left untouched. Independent QA passed 45 offline tests twice and reproduced 52 generated files byte for byte. Live Artifact behavior and plugin activation were not verified.
- **MCP Apps T001 has a smoke fixture, not a calculator.** [`examples/mcp-calculator`](examples/mcp-calculator/README.md) contains a local Node stdio server, a lockfile, and smoke tests. The revision 4 builder reported 2/2 tests passing, but the final scoped Git inspection was blocked. The latest exported run log ends at revision 6 with the `smoke` builder bound; it records no result, independent QA, or PM acceptance for that revision. Check the board before starting any duplicate work.
- **The local and managed checkouts are distinct paths.** This checkout is `C:\Projects\artifact-relay`, and its calculator README now proposes a Desktop entry for this checkout only. The board’s original managed checkout was `C:\ClaudeHub\hq\repos\artifact-relay`. Local Git reports `main` with no commits. The board records a managed commit-policy mismatch (`main` versus required `master`); resolve it before any commit there. GitHub clone access was reported working; write access was not verified. No push was authorized.

## Local T001 verification — 2026-11-19

In `C:\Projects\artifact-relay`, Node v26.5.0 completed `npm.cmd --prefix examples/mcp-calculator ci --offline --ignore-scripts --no-audit --no-fund` (95 packages), then `node --test examples/mcp-calculator/smoke.test.mjs` passed **2/2**. The client discovered only `relay_smoke`; `{}` returned exactly `[{"type":"text","text":"artifact-relay:ok"}]`; `not_registered` failed, and the SDK child was gone after client closure. The raw stdio test observed exactly one valid initialize response on stdout, empty stderr, and exit 0 on stdin EOF with no child left.

The scoped Git inventory showed only the six expected fixture files, all untracked in this checkout; Git confirmed `node_modules` is ignored. No fixture source edits were needed. The Node executable resolves to `C:\Program Files\nodejs\node.exe`. This is fresh evidence for the local checkout only, not a managed-board acceptance or a Desktop discovery/rendering result. No Desktop configuration was applied and no restart was performed.

## Local T002 build — 2026-11-19

The calculator is implemented in the local checkout. The offline locked install succeeded; the bundle built and all three stdio tests passed, including app metadata and HTML resource discovery, typed arithmetic, and error handling. The [fixture README](examples/mcp-calculator/README.md) contains the exact proposed Desktop entry for this checkout, rollback, and manual acceptance steps. Desktop discovery, native rendering, Clear, the UI-to-server round trip, and user tryout are still pending. The user approved registration and restart. The exact entry was saved and verified in the local Desktop config without modifying existing settings. Desktop was not restarted from the active Code session; restart and Chat acceptance remain pending.

## Local T003 Relay adapter

Implemented a calculator-only adapter over the existing stdio server. An already-open view must opt in for one typed arithmetic action; it computes in the view and returns a matching receipt after updating its display. Four local tests pass, including routing to one of two armed views, rejection of unsupported operations and extra fields, and rejection of wrong-token or replayed receipts. The test uses a protocol client to simulate the app role, not Desktop. The [fixture README](examples/mcp-calculator/README.md) gives the actual Chat prompt and visual pass criteria. Desktop must still prove that Chat and the view reach the same stdio server and that the original view changes; no board acceptance is implied.

## Desktop findings — 2026-11-20

- The first config edit was lost: it was written while Desktop was running and Desktop overwrote the file on quit. A re-add with Desktop closed worked.
- **Code tab, text path (observed):** after the restart this Code session lists the four model-visible calculator tools. `relay_smoke` returned `artifact-relay:ok` and `relay_open_calculator` returned its text reply. The Code tab does not render the UI, so no UI, receipt, or Relay round trip was observed.
- **Correction (user-observed):** the Code tab does render the calculator widget inline, with the Arm Relay button. The earlier "Code does not render MCP Apps" claim was wrong. The real Relay test runs in this thread against the Desktop-spawned server, so the remote-route plan below is not needed for it.
- **Desktop Chat tab (observed blocker):** the user's Chat reported no `relay_smoke` and listed only cloud tools (bash, web search, image search, memory, file creation, connector and Docs tools). That Chat surface does not load local stdio servers from the Desktop config here, so native rendering and the Relay tryout are blocked locally. Per Claude's MCP Apps docs, app tools need a remote-backed connector.
- **Options:** (1) add a Streamable HTTP transport and expose it through a tunnel as a custom connector, which breaks the pilot's no-listener/no-tunnel scope and needs separate approval; (2) stop at this evidence. Not yet checked: whether Settings → Developer lists the server as running.

## T003 live result — 2026-11-20 (agent-side evidence)

In this Code thread, after a Desktop restart, the agent sent `8 × 9` to a freshly armed widget (code `3ff48c6769`) with `relay_drive_calculator`. The server's debug log, all one process (pid 5632), shows drive at 00:28:03.000, the view's poll seeing `queued` 92 ms later, and the view's acknowledgement 12 ms after that. `relay_calculator_receipt` then returned `rendered` with `displayed: {value: 72}`. A second command to the same code was refused. The agent's model-visible tool list did not include the app-only arm/poll/ack tools. **The user confirmed visually** that the same widget showed `8 × 9 = 72` and `Applied by Relay · view 3ff48c6769 · receipt 35d5ef2f-9a6a-439f-8fa0-4b3a0c8dd7b9`, matching the agent's receipt.

**Verdict: ADAPT, not drop-in.** Observed: an agent can drive an already-open local MCP App widget through typed, calculator-only tools, with the widget pulling the command and returning a receipt, in this Code thread. Reusable: the Relay idea of typed commands, a private per-view channel and receipts. Needs adapting: Relay's Artifact DB transport and `window.claude` capabilities were not exercised; here the widget polls through host-mediated app tool calls (about 1 s) and the agent's tool only queues. Limits: a human must click Arm and paste the code; one action per arm, 2-minute window; no server push to an open view was tested; real-host isolation between two simultaneous views was only tested with a protocol client; the Desktop Chat tab saw no local servers; the first failed attempt is unexplained.

An earlier attempt on the previous server run stayed `queued` for about 10 s and the user saw no change. That run had no debug log, so its cause is unknown; the widget on screen at the time was a different instance with no Relay status line.

## Automatic arm and target — built 2026-11-20, live check pending

The view now arms itself on connect, renews while idle (up to five idle windows) and re-arms after each action. `relay_drive_calculator` targets the single listening view without a code and refuses with none or several; the receipt can be fetched by request ID alone. Four local tests pass, including no-listener and two-listener refusal. Not yet observed in Desktop after a restart.

### Live check blocked by session caches (2026-11-20)

Stopping the server processes made Desktop respawn the server on the next tool call, with no Desktop restart, and the new process ran the new code. The session that built the change still held the old tool schemas (`viewCode` required, no `waitMs`), and the widget on screen showed the old UI, with the new bundle confirmed on disk. The server's tool-list-changed notice did not refresh either. A new session should load fresh definitions and widget HTML; a card proposes it, and the live check is still pending.

## Readback built — 2026-11-20 (live check pending)

Review finding: the original Relay reads page state and takes screenshots; the first adapter only sent commands, so the agent saw the widget only through the user. The verdict above should be read with that gap. Built: `relay_inspect_calculator` (the view's own state from its DOM) and `relay_snapshot_calculator` (a JPEG via html2canvas 1.4.1, returned as an image block). Both go through the same command queue and re-arming as drive. Five local tests pass, including wrong-kind, malformed and oversized answers, timeouts and the re-arm gap. Not yet observed in a host: whether html2canvas works inside the sandboxed widget, or how the image looks.

Cache finding: a second session saw fresh tool schemas but still the old widget, and a hand-changed URI rendered nothing in that session. The server now derives the widget URI from a hash of the bundle so every rebuild gets a fresh URI; hosts also cache a session's tool list, so test in a new conversation.

## Widget host behavior — inferred 2026-11-20 (not directly observed)

Every widget run so far fits one rule: **Desktop only renders widgets for `ui://` URIs the server advertised when Desktop started it, and serves their HTML from a cache keyed by that URI.** Evidence: after the Desktop restart at 07:27 the widget showed the then-current code. Later rebuilds on the same URI were shown as the old widget. Two sessions with a new URI (`calculator-v2`, then the bundle hash) rendered no widget at all. Tool schemas, in contrast, were fresh in new sessions, and the server respawns without a Desktop restart. Transcripts show no difference between rendering and non-rendering calls. Consequence: a rebuilt widget needs a Desktop restart to appear, and my earlier "no Desktop restart needed" held only for server tool logic. The hash URI makes a stale widget fail loudly (nothing renders) instead of silently showing old HTML, and it is correct once Desktop has started the server after the final build.

Next: quit and reopen Desktop, then retry the readback live check. Do not rebuild the bundle first, or the hash will change again and need another restart.

## Readback live result — 2026-11-20 (after Desktop restart; user confirmed it matches their screen)

**User confirmed visually** that the widget showed what the inspect state and the snapshot reported. Net T003 result: the agent can now both drive and see a local MCP App calculator widget in the real host through typed calculator-only tools, so the sight gap noted in the first verdict is closed for this widget. The verdict remains ADAPT: Relay's Artifact transport and `window.claude` capabilities were not exercised, the widget pulls commands by polling, and generic page control (arbitrary selectors) was deliberately not built.

In this Code thread, after a Desktop restart, with no click and no pasted code:
1. `relay_open_calculator`: the widget rendered, armed itself and polled (log: `arm`, then repeated `poll`, one process, pid 31104).
2. `relay_inspect_calculator` with no arguments returned the first look: empty operands, `add`, status `Relay listening · code fd15ceca0f`.
3. `relay_drive_calculator` 8 × 9, then `relay_calculator_receipt` with `waitMs` 10000: `rendered`, `displayed: {value: 72}`.
4. `relay_inspect_calculator` again: left `8`, operation `multiply`, right `9`, result `8 × 9 = 72`, and relayLast `Applied by Relay · view 5cef386db9 · receipt bb06d2cc-…`, matching the drive receipt. This is readback independent of the drive's own receipt.
5. `relay_snapshot_calculator` returned a 25 KB JPEG that the agent could look at: dark-theme "Relay Calculator" with 8, ×, 9, `8 × 9 = 72`, the Arm button, `Relay listening · code 3477a31c9a` and `Read by Relay · view e11499aaa0 · receipt 00a323c1-…`, consistent with the inspect state. html2canvas works inside the sandboxed widget.

Repeat with a different operator (agent-observed, not user-confirmed): drive 20 ÷ 4 returned receipt `rendered`, value 5; inspect then showed `20`, `divide`, `4`, `20 ÷ 4 = 5` with relayLast naming that receipt; the snapshot showed the same.

Caveats: the drive and receipt tool definitions in this session were cached with the old schema (code required), so the drive call used the viewCode read from `relay-debug.log`, not implicit targeting. Implicit targeting was observed only with inspect and snapshot. Every command makes the widget re-arm with a new code. Inspect state and image are produced by the widget's own code; the user's own look remains the reference. Not tested: two widgets open at once in the host, idle expiry, a rebuilt widget without a restart.

## Remote-route plan (superseded — not needed for this test)

0. **Gate (user):** claude.ai → Customize → Connectors must offer **Add custom connector**. Team/Enterprise needs an Owner to add it under Organization settings. Docs do not confirm custom connectors work in the Desktop Chat tab; claude.ai in a browser is the fallback surface.
1. **Local build (no exposure):** add a separate Streamable HTTP entry beside the stdio server. Bind 127.0.0.1, serve at an unguessable `/mcp/<random>` path, set `allowedHosts` for the tunnel hostname, and hoist the Relay view map to module scope so it survives per-request servers. Add HTTP-client tests. Stdio files stay unchanged.
2. **Tunnel (approval to install/run):** Cloudflare Tunnel or ngrok, for the test window only. Authless means anyone with the URL can call the tools. They only do arithmetic and keep in-memory view codes, with no files, network or secrets.
3. **Connect (user):** add the URL with **No sign-in**, enable it in a chat, then run the T002 and T003 checks. Relay polling goes through Claude's backend as app tool calls, so slow the poll to about 2 s.
4. **Teardown:** stop the tunnel, remove the connector, and record the reuse / adapt / stop recommendation.

## Resume in ticket order

| Ticket | Gate and evidence required |
| --- | --- |
| **MCP Apps T001 — smoke** | Let the existing builder review the fixture first; change only a demonstrated defect and keep writes in `examples/mcp-calculator/**`. Independent QA should verify scope, the locked install (`npm ci --ignore-scripts --no-audit --no-fund`), and `node --test smoke.test.mjs` from the fixture directory. Confirm one tool, `relay_smoke`, which returns exactly one text item with `artifact-relay:ok` on `{}`; an unknown tool returns an error, stdout carries protocol frames only, and the child exits cleanly. Record proof for PM acceptance. Do not replay the refused compound inspection or apply Desktop settings. |
| **MCP Apps T002 — calculator** | After T001 acceptance, build a real MCP App UI resource with typed basic arithmetic, no `eval`, and app-instance state. Before Desktop registration or restart, show the exact proposed `artifact-relay-calculator` entry and rollback for the intended checkout and obtain separate approval. Preserve every other setting; rollback removes only that entry and restarts Desktop. In Desktop Chat, first verify discovery and `relay_smoke`, then verify native UI rendering and let the user try `7 × 6 = 42`, clear, and division by zero. Record Code tool visibility separately if tested; this Code thread is not proof of MCP UI rendering, and Code registration needs separate approval. |
| **MCP Apps T003 — Relay fit** | After T002, try one typed, allowlisted calculator action over a supported MCP surface. Capture the result, instance or session scope, and rejection of an unsupported action, or record the precise host blocker. Compare with Relay’s existing Artifact runtime (`db` and `user` capabilities) and say what can be reused, what needs an adapter, and what the host does not support. Recommend reuse, adapt, or stop based on the evidence. |

## Pilot boundaries

Keep the fixture local and stdio-only, with project-local pinned dependencies. No listener, tunnel, runtime CDN, credentials, external data, global install, remote connector, arbitrary UI control, or publication. A passing local protocol test, a text tool call, and a rendered Desktop MCP App are three different pieces of evidence.

Board references: `project.md`, `onboarding/T001.md`, and `mcp-apps/{epic.md,T001.md,T002.md,T003.md,tree.json,tree-run.md}` under the source folder above.

## Relay Calculator: implicit-targeting run (2026-11-20, NOT PROVEN)

Result: no pass. The widget never armed, so no drive or receipt was possible.

- Tool schemas loaded fresh: `relay_drive_calculator` does not require `viewCode`; `relay_calculator_receipt` accepts `waitMs`.
- Server was not stale (started 07:41:13, after the last edit at 07:40:52).
- `relay_open_calculator` -> user saw the OLD widget (Arm button only). Log had no `arm`/`poll`; `relay_drive_calculator` failed with "No calculator is listening" (log: `drive implicit candidates=0`).
- Tried: changed the resource URI to `ui://artifact-relay/calculator-v2` (server.mjs, calculator.test.mjs; 4 tests still pass), stopped the node server (respawned as pid 28624), reopened. Result: no widget rendered, still no `arm` for pid 28624. Likely the host keeps this conversation's tools/list (old URI) cached, so the new URI is not resolved here.
- Unobserved: 8 x 9 = 72, receipt, visual confirmation, re-arm on a second command.
- Next: run again in a brand-new Claude Desktop conversation (v2 URI is in place); if that still shows an old widget, a Desktop restart is needed (not done here by constraint).

## Readback live check (2026-11-20): FAILED at step 2, no widget armed
- Tools loaded fine: inspect and snapshot exist; `relay_drive_calculator` has no required `viewCode`.
- Server process pid 10064 started 07:49:56, after the last edit (bundle 07:48:37), so it is current. Expected URI `ui://artifact-relay/calculator-d4fa2731`.
- `relay_open_calculator` returned "Relay Calculator is ready in an MCP Apps host." but `relay-debug.log` shows no `arm` or `poll` line from this session; `relay_inspect_calculator` was refused ("No calculator is listening", log: `inspect refused`).
- Inference, not verified: the Claude Code tab session that ran the tool does not render MCP Apps widgets, so nothing armed. Retry from a Claude Desktop Chat conversation (new one, so it picks up the new tool list), where the widget can render.

## Update: unchanged kit on MCP (final state)

**Verdict: Artifact Relay is implementable on MCP Apps with the bridge unchanged.** `bridge.js` (v2.2), `rc-wiring.js` and the panel run as-is inside the MCP widget; only the database is replaced (`kit/mcp-app/widget/mcp-db.js` over the `relay_db` app-only tool, in-memory store in `kit/mcp-app/server/`). Agent tools: `relay_send`, `relay_result`.

Live in Claude Desktop (Code tab, after restart): ping/read, fill, select, click, wait_for, text, screenshot (as image), named action `getState`, element screenshot, 7÷0 error path, panel lock, `release:true`; 8×9=72 matched on screen.

Finding: the host shows the agent `structuredContent` and may drop the text block, so `relay_send` returns step results in `structuredContent` (fixed, live-verified).

Packaged: `kit/mcp-app/` (README, server, widget, `starter/` with test), plugin skill `relay-mcp-app`, hook support for `mcp__*__relay_send` (stamp.mjs, `rc-plugin/0.2`), prompts, checklist, pitfalls, plugin 0.2.0. Plugin and marketplace ids unchanged; bridge and the 45 stress tests untouched. The starter was verified from a clean copy of `plugin/kit` (npm install, build, test).

Remaining limits/untested: two widgets at once in a real host, idle expiry, widget restart on change (hosts cache by URI; restart needed), claude.ai chat cannot reach a local server, nothing pushed to GitHub.
