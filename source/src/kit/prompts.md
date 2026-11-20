# Sentences to say to Claude

Copy, fill in the angle brackets, and send. They are written so Claude has everything it needs.

## Publish

**One file**

```
Publish the file at <FULL PATH TO starter.html> as a Claude artifact.
Capabilities: use the contents of <FULL PATH TO publish/capabilities.json>.
Open it for me when it is published.
```

**Multi-file**

```
Publish <FULL PATH TO multi-file/index.html> as a Claude artifact, with these supporting files
published at the same paths: rc/bridge.js, rc/rc-wiring.js, rc/rc-panel.css (from the multi-file folder).
Capabilities: use the contents of <FULL PATH TO publish/capabilities.json>.
Open it for me when it is published.
```

**With a connector**: use `publish/capabilities.with-connector.json` instead, and change the connector name and tools to yours.

## First run

```
The app is open. Write commands to my private channel (data/users/me/rc/cmd), one at a time with new ids:
1) ping, then tell me the bridge version and whether the page is visible.
2) read, then list the controls you found with their selectors.
3) take a screenshot and describe what you see.
```

## Do a task

```
In the open app, do this: <WHAT YOU WANT>.
Use read first to find the controls. After each action check the accepted and warning fields.
When you finish, read the page again and tell me what changed. Do not click anything that I did not ask for.
```

## Check what I have typed but not submitted

```
Use read on the app and tell me what is in each field right now, including text I have not submitted.
```

## Verify a fix

```
Run these checks on the open app and report each result in one line:
1) a click on <A DISABLED BUTTON> should fail with a clear message,
2) a wait_for on <SOMETHING THAT NEVER APPEARS> with a 500 ms timeout should fail the command,
3) a command with an unknown action should come back invalid and run nothing.
```

## If the page might be closed

```
Send a ping to my private channel. If there is no answer after about 10 seconds, show the artifact pane,
open the app, wait up to 30 seconds, and try once more. If it is still silent, tell me and I will open it myself.
```

## Clean up

```
Delete the documents in data/users/me/rc/cmd, data/users/me/rc/res and data/users/me/rc/snap that are older than today.
Do not touch data/users/me/rc/meta.
```

## Time-limited command

```
Send this command with expires set to 5 minutes from now so that it is skipped if the page is not open by then: <STEPS>.
```

## Several agents on one app

Give each agent a name. Say this to every Claude session that will use the app:

```
Use your session name (the title of this Claude session) as the "agent" field in every command you write. Without a name, commands are rejected.
Before you start, send a ping-only command and read result.results[0].lock. If another agent holds the app,
wait and try again; do not use takeover unless I say so. When you finish, send your last command with "release": true.
```

To see who holds the app at any time, read the document `data/users/me/rc/meta/lock`. If its `expiresAt` is in the past, the app is free.

## MCP App widgets

For an MCP App built on `mcp-app/` (tools `relay_send` / `relay_result`). Use these instead of the Artifact prompts above.

**First run**

```
Open the widget with <OPEN TOOL NAME>. Then use relay_send, with "agent" set to your session name:
1) ping, then tell me the bridge version and who holds the app.
2) read, then list the controls you found with their selectors.
3) take a screenshot and describe what you see.
```

**Do a task**

```
In the open widget, do this: <WHAT YOU WANT>. Use the widget's controls through relay_send, not the server's own tools
and not your own arithmetic. Read first to find the controls, then check each step's ok. When you finish, read the page
again and tell me what the widget shows. Send "release": true on your last call.
```

**Prove the bridge works on this widget**

```
Drive the widget through relay_send only: fill a field, click its button, wait_for the result, read it back, take a
screenshot, then send release. Report each step's result in one line and tell me whether the screenshot matches what I see.
```

**After I rebuilt the widget**

```
I restarted <Claude Desktop / Claude Code>. Open the widget again and run ping and read to confirm you see the new version.
```
