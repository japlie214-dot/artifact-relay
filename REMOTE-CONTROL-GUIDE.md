# Artifact Relay reference (bridge v2.2)

How Claude can operate, read and screenshot a Claude app (an Artifact) while it is open, with no extra login and no separate server. This is the reference version. For a guided, interactive version with a playground, open `learn.html`.

## 1. The idea

```
 Claude (chat)                 your private channel in the app's db                 your open app
 -------------                 -------------------------------------                 -------------
 ArtifactData set  -------->   data/users/<you>/rc/cmd/c001 {pending, steps}  ---->  subscription fires
                                                                                     page validates, claims, runs steps
                               data/users/<you>/rc/res/c001 {status, results} <----  page writes the outcome
                               data/users/<you>/rc/snap/c001_1 {jpeg}         <----  page writes a screenshot
 ArtifactData get  <--------   (Claude reads results and the screenshot)
```

1. **Claude writes to the app's db.** The `ArtifactData` tool reads and writes the db as you. In a path, `me` means "the person Claude works for".
2. **The page listens.** A page with the `db` capability subscribes to a collection and is called when a document changes. The page is not reloaded, so its state is kept.
3. **The page is a real signed-in session.** Anything it does, including calling a connector through the `mcp` capability, runs with that person's credentials.

Commands are **data, not code**. The page interprets steps from a fixed action list. Nothing is passed to `eval`.

## 2. What changed from v1

v1 used shared `cmd`, `res` and `snap` collections and only ran commands in the owner's view. Testing found problems, and v2 fixes them:

| v1 problem | v2 behaviour |
|---|---|
| Results and screenshots readable by everyone the app is shared with | Per-user private channel under `data/users/<id>/rc`. Private even from the owner. |
| Only the owner could use it | Every Contributor gets their own channel. |
| `text` hid what a person had typed but not submitted | `read` returns every field's value. `text` warns, and on a field returns its value. |
| `inspect` listed only buttons and inputs | `read` also returns lists and tables. `inspect` gives selectors, labels, values, disabled, visible. |
| A wait that timed out let the command carry on | A missed `wait_for` fails the command. `optional:true` opts out. |
| Clicks on disabled or hidden elements reported success | They fail with a reason. `force:true` overrides for hidden ones. |
| A bad step halfway left the app half changed | The whole command is validated first. One bad step makes it `invalid` and nothing runs. |
| Two tabs could both run a command | A lease lets only one tab take each command. |
| A command could be stuck at `running` after a closed page | Marked `interrupted` on the next start. Never retried. |
| No timeouts or size caps | Per-step timeout. Result size cap with a clear message. |

## 3. Paths and documents

All paths are relative to `base = "data/users/<id>/rc"` (4 pieces, a document). Collections have an odd number of pieces, documents an even number.

| Path | Written by | Contents |
|---|---|---|
| `<base>/cmd/<id>` | Claude | `{status:"pending", steps:[...], expires?:epochMs}` |
| `<base>/res/<id>` | page | `{status, error, results:[...], t, holder}` |
| `<base>/snap/<id>` | page | `{jpeg:"data:image/...", t}` |
| `<base>/meta/hello` | page | `{openedAt, holder, version, visibility}` written when the page opens |

Command `status` goes `pending` → `running` → `done`, `error`, `invalid`, `expired` or `interrupted`. Use a new id for each command (`c001`, `c002`, ...). Writing to an existing id is refused unless you pin its version.

## 4. Actions

| action | fields | what it does |
|---|---|---|
| `ping` | none | Replies at once with the bridge version and page visibility. |
| `read` | `selector?` | Text, lists, tables and every control with its value (including typed-but-unsubmitted text). Scope defaults to `#app`. |
| `inspect` | `selector?` | Controls only: selector, label, value, checked, options, disabled, visible. |
| `fill` | `selector`, `value`, `index?`, `force?` | Types into a text field or text area using the browser's native setter, fires `input` and `change`, reads the value back (`accepted`). |
| `select` | `selector`, `value` or `label` | Chooses a dropdown option. Errors list the options. |
| `check` | `selector`, `checked?` | Ticks or unticks a checkbox. |
| `click` | `selector`, `index?`, `force?` | Clicks. Refuses disabled and hidden elements. |
| `press` | `key`, `selector?` | Sends a key event to the page's handlers. Does not submit forms. |
| `wait` | `ms` | Pauses up to 10 seconds. |
| `wait_for` | `selector`, `textIncludes?`, `gone?`, `timeoutMs?` | Waits (up to 120 s) for an element to be visible, or gone. Fails the command on timeout. |
| `text` | `selector`, `index?` | Visible text of one element. On a field, its value. |
| `call` | `name`, `args?` | Runs a function registered in `window.REMOTE_ACTIONS`. The result must be small JSON. |
| `screenshot` | `selector?` | Captures the page or one area as a small JPEG. |

Any step may add `"optional": true`. A command may have at most 40 steps.

## 5. Failure policy

| Kind | Behaviour |
|---|---|
| Hard error | The command stops. Status `error` with a message that names the step. |
| Invalid | Nothing runs. Status `invalid`. |
| Soft failure | The step reports `ok:false` with a `reason`, and the command continues (screenshots). |
| Warning | The step succeeds with a `warning` (several matches, a field changed the value). |

## 6. Adding the bridge to your own app

1. Wrap your app in an element with `id="app"` and give the controls ids.
2. Copy from `template.html`: the `#rc` panel and its CSS, the html2canvas `<script>` tag, the bridge block (`REMOTE CONTROL BRIDGE v2` to `END`), and the wiring script at the end.
3. Use `hidden` to hide things, not only CSS tricks. `wait_for` and `read` follow real visibility either way.
4. Register named actions in `window.REMOTE_ACTIONS` for anything awkward to click. Make them safe to run twice.
5. Publish with:

```json
{
  "db": { "rules": [
    { "path": "",                  "read": "view", "write": "admin" },
    { "path": "data/users/{self}", "write": "interact" }
  ] },
  "user": {}
}
```

   Add `"mcp": { "servers": [ { "server": "<connector display name>", "tools": ["<tool>"] } ] }` if the app calls a connector.
6. Open the app. The panel should say `on`.

## 7. Working with it from Claude's side

1. **Is the page there?** Write a `ping` command, wait a few seconds, read `res/<id>`. No answer means the page is not open. Open the app (the Artifact `open` action) and read again. Commands written while the page was closed run in order when it opens.
2. **Look first.** Send `read` to learn the real selectors and what is on screen.
3. **Act.** `fill`, `select`, `check`, `click`. Check the `accepted` and `warning` fields in the results.
4. **Wait for the right thing.** Use `wait_for` on something that appears only at the end (the results table), or `gone:true` on a spinner.
5. **Observe.** Use `read` or `text` for exact data. Use `screenshot` for layout.
6. **Read back.** `ArtifactData get` on `data/users/me/rc/res/<id>`. For a screenshot, get `snap/<id>` with `out_dir`, then `node decode-snap.mjs <file.json>` and open the JPEG.
7. **Tidy up.** Delete old `cmd` and `res` documents now and then. An app holds at most 25,000 documents in total.

## 8. Pitfalls and how they are handled

Each has a test in `tests/stress-tests.html` (also in `learn.html`, lesson 8).

| Pitfall | Handling | Test ids |
|---|---|---|
| `text` misses typed values | `read`; `text` warns | read-drafts, text-on-field |
| Existing lists invisible | `read` lists and tables | read-lists, inspect-hints |
| Hidden content | follows visibility | read-hidden |
| Waiting on the wrong thing | `wait_for` fails on timeout, `gone`, `optional` | wait-timeout, optional-step, wait-gone |
| Silent do-nothing clicks | refuse disabled, hidden, read-only | disabled-click, hidden-click, disabled-fill |
| Ambiguous selectors | `matches`, warning, `index`; malformed selectors become errors | many-matches, no-match, bad-selector |
| Field did not take the value | read-back `accepted`; exact text; true length | fill-readback, long-value, special-chars |
| Frameworks ignore `.value =` | native setter plus events (needs a framework page to test) | none |
| Half-run commands | validate everything first | unknown-atomic, bad-shapes |
| Same command twice | lease; retry after a db hiccup | two-tabs, db-hiccup |
| Closed mid-command | `interrupted`, never retried | interrupted |
| Late commands | `expires`; pending commands run on open | expired, pending-on-open |
| One stuck step | per-step timeout | step-timeout |
| Oversized results | caps and clear errors | result-too-big, call-errors |
| Screenshots fail or mislead | soft failure, pruning, selector for a smaller area | screenshots |
| Synthetic input limits | `press` does not submit forms; click the button | dropdown-check-press |
| Is the page there? | `ping`, `meta/hello` | ping, hello |
| View-only people | panel says `off` with a reason | view-only |
| Wrong path piece count | the practice db throws like the real one | path-rules |
| Pause and stop | commands wait; a stopped bridge ignores new ones | pause, stop |
| Data piles up, privacy, idempotent actions, timer writes | design guidance (see `learn.html`, lesson 7) | none |

## 9. Several people at once

Each person uses the app in their own Claude window, with their own connector login, and has their own private channel `data/users/<their id>/rc`. Claude writes to `me`, so it only reaches the person it works for. Results are private from other people and from the owner. Queries run under each person's own login, at the same time, without interfering. People need Contributor access (or higher) to have a channel; Viewers can use the app but the panel says `off`.

## 9a. Several agents on one app (busy status)

Two Claude sessions can drive the same app for the same person. Without a rule their clicks and typing interleave. Bridge 2.1 adds a lock, kept by the page in `data/users/<id>/rc/meta/lock`:

```
{ agent, cmd, state: "running" | "idle", since, lastActive, expiresAt, holder }
```

- Every command may carry `"agent": "name"` (up to 60 characters). The kit's wiring turns on `requireAgent`, so a command with no name is `invalid` and nothing runs. Agents should use their **session name** (the title of the Claude session). The bridge cannot see session IDs and cannot verify the name: it is a label the agent writes, so two agents could share a name. Ask each session to use a distinct one. With `requireAgent` off (`RC_OPTIONS = { limits: { requireAgent: false } }`), a missing name means `"unnamed"`.
- The first agent whose command runs owns the app. Another agent's command is **not run**: it ends with status `busy`, an `error` text naming the holder and when it frees, and a `lock` field with the details.
- The idle clock starts when the owner's command ends. After `lockIdleMs` (default 120000, two minutes) without activity the app is free. A long command keeps the lock while it runs.
- `"release": true` on a command frees the app when that command ends. `"takeover": true` takes it from another agent and is logged. Use takeover only when the person says so.
- A command whose steps are all `ping` never takes the lock. Its result carries `lock: {held, agent, state, idleMs, expiresInMs}`, so an agent can look before it acts. The lock document can also be read directly: it is free when `expiresAt` is in the past.
- The panel shows `Agent: free`, `busy: <name>`, or `held by <name> (idle Ns, frees in Ns)`.
- Limits to know: the page is the referee, so two open tabs of the same app could both decide in the same instant (rare). The lock is cooperative: an agent that ignores `agent` is treated as `unnamed`, which is one more agent.

## 9c. Session identity and the plugin (bridge 2.2)

A command's `agent` field is only a label the model writes. Identity comes from the **session id**, which a plugin hook adds to every command:

- Fields: `session` (the Claude session id), `subagent` (`{id, type}` inside a subagent), `sessionTitle` (when the hook knows it), `stampedBy`.
- The lock is keyed on the session (plus the subagent id). Two sessions with the same display name are different owners. One session that changes its name is the same owner. A subagent is a different caller from its parent session.
- The panel and the log show `title · short id`, for example `Sales report helper · a1b2c3d4`. Every log line starts with it. The panel labels are **Session**, **Control** (the pause switch) and **Logs**.
- `requireAgent` is satisfied by either a name or a session id.
- What the hook can know: the harness gives hooks the session id and, in subagents, the agent id. The title is given only at session start and on prompt submit, so the hook saves it. Rewriting a tool's input from a hook is documented (`updatedInput`).
- Limits, stated plainly: the bridge cannot verify the stamp. With the hook active the model cannot forge it, because the hook overwrites those fields after the model writes. A session without the plugin is unstamped, and a writer that is not a Claude session at all (a script with the user's credentials) can write anything. The stamp is honest identity, not authentication.
- The plugin is in `plugin/`: hook, two skills (`operate-remote-app`, `build-remote-app`), the kit and the docs. See `plugin/README.md` to install.

## 9b. The panel and its looks

The panel has a header with a status pill, an Agent line, a Pause switch, and an activity list that scrolls inside its own box (the newest 60 lines are kept). A button in the header collapses it. Open `kit/panel-styles.html` to see six looks playing a demo session: hairline (the default, follows your colour tokens), enterprise (light grey, data-table log), quiet-dark, ops-dashboard, control-room (plant-floor HMI) and minimal (one line, with an optional start-collapsed setting `RC_OPTIONS = { collapsed: true }`). Copy the CSS of one into your app's `rc-panel.css`. The markup and wiring stay the same. The hooks for your own style are `data-s` on `#rc`, `#rc-state` and `#rc-lock`, and `data-k` (`ok`, `run`, `warn`, `bad`, `info`) on each log line.

## 10. Security and limits

- **Private by design.** Nobody else can read or write your channel.
- **Fixed action list.** No `eval`. At most 40 steps.
- **It acts as you.** A Run click in a Snowflake page runs under your Snowflake login.
- **You stay in control.** The panel shows what ran. Pause holds commands. Closing the page stops everything.
- **Connector approvals** are yours. The first call from a new page shows a prompt that Claude cannot click.
- **Screenshots are redrawn** from the page, not photographed. In a real test a two-line note appeared on one line in the picture while `read` returned it exactly. Use `read` for exact values.
- **The page must be open** in the Claude app, and visible, because browsers slow hidden tabs. `ping` reports `visibility`.
- Documents hold at most 256 KB.

## 11. What was tested

- **45 automated tests** against a stand-in database (all passing), including negative tests and a 19-damage mutation check: each deliberate bug in the bridge was caught by at least one test. The first mutation check found a weak test (two tabs), which was strengthened.
- **The published template on the real database** (one person): ping, hello, read with typed-but-unsubmitted text (quotes, emoji, a two-line note), disabled click, malformed selector, unknown action (`invalid`, nothing ran), wait timeout, expired command, select and check, inspect, and a screenshot. All behaved as expected. A private `me` path resolved to the owner's id, and the lease worked on documents created by `ArtifactData`.
- **Opening another artifact** did not stop the template page: it kept running and reported `visibility: visible`.

- **The starter kit on the real database**: the multi-file starter was published with its `rc/` files and the kit's publish settings. It said hello, and `ping`, `read`, `fill` and a read-back all worked. The ambiguous selector `input` (the page's field and the panel's checkbox) produced a clear warning.
- **Reopening a closed page**: with the tab closed, a command waited as `pending`. Claude's first open request did nothing for about 100 seconds. After showing the artifact pane and opening again, the page loaded in about 25 seconds and ran the waiting command. It was a fresh page, so unsent typing was gone. It works, but is slow and not reliable on the first try. Be ready to open the app yourself.

Not yet tested: two different people at once; a framework-controlled input; a very large real app.

## 12. Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| Command stays `pending` | Page closed, paused, view-only, or off | `ping`; check `meta/hello`; open the app; untick Pause. |
| Panel says `off` | Capabilities missing, view-only, or no user id | Republish with `db` (2 rules) and `user`. Give Contributor access. |
| `invalid` | Mistake in the command | Read the error. Nothing ran. Fix and send under a new id. |
| `error: ... disabled / not visible` | Control not usable yet | `read` the page; wait for what enables it; `force:true` only for hidden elements. |
| `error: No element matches` | Wrong selector or not on screen yet | `read` or `inspect`; add `wait_for`. |
| `error: Timed out` | What you waited for never appeared | Screenshot and `read`; check the selector; raise `timeoutMs` only for slow work. |
| `interrupted` | Page closed mid-command | Read the page state before sending anything again. |
| Screenshot shows "Running..." | Waited on something shown at the start | Wait for the end signal. |
| Connector call never finishes | An Allow prompt is waiting | Click Allow in the Claude window. |
| `result too large` | Result over the size cap | Ask for less, for example `read` with a selector. |

## 13. Files

- `learn.html`: interactive guide (open this first)
- `template.html`: starter app with the bridge
- `best-practices.html`: one page of dos, don'ts, a checklist and 23 pitfalls (some can run their own tests)
- `kit/`: copy-and-use files: `starter.html` (one file), `multi-file/` (app plus `rc/` folder), `actions.example.js`, `publish/capabilities*.json`, `prompts.md`, `CHECKLIST.md`, `README.md`
- `tests/stress-tests.html`: the 45 tests as a stand-alone page
- `decode-snap.mjs`: turns an exported screenshot document into a JPEG
- `source/`: the sources and `build.mjs`. Edit `source/src/bridge.js` once and rebuild: every page uses the same bridge.

```bash
node source/build.mjs
```
