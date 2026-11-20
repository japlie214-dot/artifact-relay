# Artifact Relay plugin

What it gives a Claude session:

- **Skills**: `operate-remote-app` (how to drive an app that has the remote-control panel) and `build-remote-app` (how to build or publish one, from the files in `kit/`).
- **A hook** (`scripts/stamp.mjs`) that adds the real session id to every remote-control command, so the app can tell sessions apart without trusting what the model writes.
- **The kit** (`kit/`: starter app, panel styles, publish settings, prompts, checklist) and **docs** (`docs/`).

## Install

Add the folder that contains `.claude-plugin/marketplace.json` as a marketplace, then install:

```
/plugin marketplace add "C:\path\to\claudeAppRemoteControl"
/plugin install claude-app-remote-control@remote-control-kit
```

Or try it for one session without installing: `claude --plugin-dir "C:\path\to\claudeAppRemoteControl\plugin"`.
Run `/reload-plugins` after changes. For a team, put the folder in a git repository and add it with `/plugin marketplace add <owner>/<repo>`.

## What the hook does and does not do

- It acts only on `ArtifactData` calls that write to a collection ending in `/rc/cmd` with a `steps` list. Everything else passes through untouched.
- It replaces `session`, `subagent` and `sessionTitle` in the command with values from the harness, so the model cannot forge them while the hook is active.
- The title is only known to hooks at session start and on prompt submit; the hook remembers it. A session with no title shows its short id.
- It makes no permission decision by default, so normal prompts apply. Set `RC_STAMP_DECISION=allow` (or `ask`) in your environment to choose otherwise. Set `RC_STAMP_ARTIFACTS=<url>,<url>` to stamp only commands for specific apps.
- Sessions without the plugin are not stamped. Make the app refuse them by keeping `requireAgent` on, which asks them to name themselves.
- It does not authenticate anything: it is an honest identity from the harness, not a cryptographic proof.

## Check it works

Send any remote-control command, then read the command document back from `data/users/me/rc/cmd/<id>`. It should contain `session`, `stampedBy: "rc-plugin/0.1"` and, inside a subagent, `subagent`. The app's panel then shows the session id next to the activity.
