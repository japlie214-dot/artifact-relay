Artifact Relay (bridge v2.2)
===========================

Start here: open learn.html in any browser. It is an interactive guide with a playground that runs the
real bridge code, a step-by-step build, pitfalls, a stress-test lab and a quiz. It works offline.

Files
-----
learn.html                  Interactive guide. Open this first.
best-practices.html         Dos, don'ts, checklist and pitfalls on one page.
examples/chart-maker/       A finished app built from the kit by a Haiku agent: SQL to Snowflake, chart, Export PNG.
plugin/                     A Claude Code plugin: a hook that stamps commands with the real session id, plus
                            skills to operate and build apps, the kit and the docs. See plugin/README.md.
kit/panel-styles.html       Six looks for the panel with live demos. Copy the CSS of the one you like.
kit/                        Copy-and-use files. Start with kit/README.md. starter.html is a ready skeleton;
                            multi-file/ keeps the remote control in its own rc/ folder; publish/ holds the
                            publish settings; prompts.md has sentences to say to Claude.
template.html               The starter Claude app (a task list plus the remote-control bridge).
tests/stress-tests.html     The 45 stress and negative tests as a stand-alone page. Open it and press Run.
REMOTE-CONTROL-GUIDE.md     The same material as a plain reference document.
decode-snap.mjs             (folder root, next to this file) Turns a stored screenshot document into a JPEG (needs Node.js).
source/                     Sources and the build script.
  build.mjs                 Rebuilds every page and the whole kit.
  src/bridge.js             The bridge. One source, used by every page.
  src/fakedb.js             A small in-memory stand-in for the app database (for the playground and tests).
  src/demo-app.html, .js    The practice app.
  src/tests.js              The stress tests. Add your own here.
  src/*.src.html            Page templates.

Rebuild after editing anything in source/src
--------------------------------------------
node source/build.mjs

Use the template
----------------
1. Ask Claude to publish template.html as a Claude artifact with these capabilities:
   db with a root rule read "view" and write "admin", a rule for "data/users/{self}" with write "interact",
   and user. (kit/publish/capabilities.json has them ready; learn.html has the wording.)
2. Open the artifact in the Claude app. The panel at the bottom should say "on".
3. Ask Claude to send commands to it. Each person has a private channel at data/users/<their id>/rc.

Notes
-----
- Results and screenshots are private to each person, even from the app's owner.
- The first time a page calls a connector, Claude asks you to allow it. Claude cannot click that for you.
- Reopening a closed page works but is slow (about a minute, second try needed). Be ready to open the app yourself.
- Not yet tested: two different people at once.
