/* Stress and negative tests for the remote-control bridge.
   Each test builds a fresh demo app + fake db + bridge, sends real command documents, and checks what came back.
   Needs globals: createBridge, createFakeDb, mountDemoApp, DEMO_APP_HTML. */
const TEST_BASE = "data/users/u1/rc";

function makeEnv(opts) {
  opts = opts || {};
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:-9999px;top:0;width:520px";
  host.innerHTML = '<div id="app">' + DEMO_APP_HTML + "</div>";
  document.body.appendChild(host);
  const root = host.querySelector("#app");
  const app = mountDemoApp(root, { syncMs: 300 });
  const db = createFakeDb({ delayMs: opts.delayMs || 0 });   // a small delay makes tabs genuinely overlap
  const logs = [], states = [];
  const actions = Object.assign({}, app.actions, opts.actions);
  const make = (holder) => createBridge({
    db, base: TEST_BASE, root, actions, snapshot: opts.snapshot, limits: opts.limits, holder,
    onLog: (l) => logs.push(l), onState: (s, d) => states.push([s, d]),
  });
  const bridges = [make(opts.holder || "tab-A")];
  let seq = 0;
  const env = {
    root, app, db, logs, states, bridge: bridges[0], tasks: app.tasks,
    q: (s) => root.querySelector(s),
    addBridge(holder) { const b = make(holder); bridges.push(b); return b; },
    async send(steps, extra) { const id = "c" + String(++seq).padStart(3, "0"); await db.doc(TEST_BASE + "/cmd/" + id).set(Object.assign({ status: "pending", steps }, extra)); return id; },
    async sendRaw(data) { const id = "c" + String(++seq).padStart(3, "0"); await db.doc(TEST_BASE + "/cmd/" + id).set(data); return id; },
    async result(id, ms) {
      const t0 = Date.now();
      while (Date.now() - t0 < (ms || 4000)) { const s = await db.doc(TEST_BASE + "/res/" + id).get(); if (s.exists) return s.data(); await new Promise((r) => setTimeout(r, 15)); }
      throw new Error("No result for " + id + " within " + (ms || 4000) + "ms");
    },
    async run(steps, extra, ms) { const id = await env.send(steps, extra); const res = await env.result(id, ms); const cmd = (await db.doc(TEST_BASE + "/cmd/" + id).get()).data(); return { id, res, cmd }; },
    async cmdStatus(id) { return (await db.doc(TEST_BASE + "/cmd/" + id).get()).data().status; },
    dispose() { bridges.forEach((b) => b.stop()); host.remove(); },
  };
  return env;
}

const tsleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ctlOf = (res, id) => res.results.find((r) => r.action === "read" || r.action === "inspect").controls.find((c) => c.id === id);

const TESTS = [
  { id: "ping", name: "The page answers a ping", why: "Before real work, Claude can check the page is alive and whether it is visible. A hidden tab runs slowly.",
    fn: async (t) => {
      const e = await t.env(); const r = await e.run([{ action: "ping" }]);
      t.eq(r.res.status, "done"); t.ok(r.res.results[0].pong, "pong"); t.ok(typeof r.res.results[0].visibility === "string", "visibility reported");
    } },
  { id: "hello", name: "The page announces itself when it opens", why: "A hello document tells Claude the page opened, which bridge version it runs, and who holds the channel.",
    fn: async (t) => {
      const e = await t.env(); const hello = e.db.dump()[TEST_BASE + "/meta/hello"];
      t.ok(hello && hello.version === "2.2", "hello document written"); t.ok(e.states.some((s) => s[0] === "on"), "state is on");
    } },
  { id: "read-drafts", name: "read sees text that was typed but not submitted", why: "PITFALL: innerText ignores what is typed inside fields. read returns every field's value, so drafts are not invisible.",
    fn: async (t) => {
      const e = await t.env();
      const r = await e.run([{ action: "fill", selector: "#item", value: "draft task" }, { action: "fill", selector: "#note", value: "line one\nline two" }, { action: "read" }, { action: "text", selector: "#form" }]);
      t.eq(r.res.status, "done");
      t.eq(ctlOf(r.res, "item").value, "draft task"); t.eq(ctlOf(r.res, "note").value, "line one\nline two");
      const txt = r.res.results[3];
      t.ok(txt.text.indexOf("draft task") < 0, "text does not contain the typed value (that is the pitfall)");
      t.ok(/typed values/.test(txt.note || ""), "text warns that typed values were left out");
    } },
  { id: "read-lists", name: "read lists the items already on the page", why: "The first version of inspect only listed buttons. read also returns lists and tables, so existing content is visible.",
    fn: async (t) => {
      const e = await t.env();
      const r = await e.run([{ action: "call", name: "addTask", args: { text: "Alpha", note: "first" } }, { action: "call", name: "addTask", args: { text: "Beta", urgent: true } }, { action: "read" }]);
      const lists = r.res.results[2].lists; t.eq(lists.length, 1); t.eq(lists[0].items.length, 2);
      t.ok(lists[0].items[0].indexOf("Alpha") === 0 && lists[0].items[1].indexOf("urgent") > 0, "items carry their details");
    } },
  { id: "read-hidden", name: "read leaves out hidden content", why: "Hidden text is not what the user sees. read and text follow visibility, and say so.",
    fn: async (t) => {
      const e = await t.env();
      const r = await e.run([{ action: "read" }, { action: "text", selector: "#details" }, { action: "click", selector: "#toggle" }, { action: "text", selector: "#details" }]);
      t.ok(r.res.results[0].text.indexOf("kept in memory") < 0, "hidden panel not in read");
      t.eq(r.res.results[1].visible, false); t.ok(/hidden/.test(r.res.results[1].note || ""), "hidden note");
      t.ok(r.res.results[3].text.indexOf("kept in memory") >= 0, "visible after toggle");
    } },
  { id: "inspect-hints", name: "inspect gives usable selectors and states", why: "Claude should not guess selectors. inspect returns a selector, label, value, disabled and visible for every control.",
    fn: async (t) => {
      const e = await t.env(); const r = await e.run([{ action: "inspect" }]); const c = r.res.results[0].controls;
      const clear = c.find((x) => x.id === "clear"); t.ok(clear && clear.disabled === true && clear.selector === "#clear", "disabled button reported");
      t.eq(c.find((x) => x.id === "category").options.length, 3);
      t.eq(c.find((x) => x.id === "urgent").checked, false);
    } },
  { id: "special-chars", name: "Quotes, HTML and emoji survive and are not run as HTML", why: "Typed text must arrive exactly and must never be interpreted as markup.",
    fn: async (t) => {
      const e = await t.env(); const nasty = 'He said "hi" & <b>bold</b> <img src=x onerror=alert(1)> 😀 \'q\'';
      const r = await e.run([{ action: "fill", selector: "#item", value: nasty }, { action: "click", selector: "#add" }, { action: "read" }]);
      t.eq(r.res.status, "done"); t.eq(r.res.results[0].accepted, true);
      t.ok(r.res.results[2].lists[0].items[0].indexOf(nasty) === 0, "text is intact");
      t.eq(e.root.querySelectorAll("#list b, #list img").length, 0);
    } },
  { id: "long-value", name: "A very long value is accepted but reported shortened", why: "Results have size caps. The value is read back with its true length so nothing is silently lost.",
    fn: async (t) => {
      const e = await t.env(); const r = await e.run([{ action: "fill", selector: "#note", value: "x".repeat(5000) }, { action: "read" }]);
      t.eq(r.res.results[0].accepted, true); t.eq(r.res.results[0].valueLength, 5000);
      const c = ctlOf(r.res, "note"); t.eq(c.value.length, 2000); t.eq(c.valueLength, 5000);
    } },
  { id: "disabled-click", name: "Clicking a disabled button fails loudly", why: "PITFALL: a click on a disabled button does nothing. The bridge refuses and says why, instead of reporting success.",
    fn: async (t) => {
      const e = await t.env(); const r = await e.run([{ action: "click", selector: "#clear" }]);
      t.eq(r.res.status, "error"); t.ok(/disabled/.test(r.res.error), "error mentions disabled");
    } },
  { id: "hidden-click", name: "Clicking a hidden element is refused unless forced", why: "A person cannot click what they cannot see. force:true is the explicit override.",
    fn: async (t) => {
      const e = await t.env();
      const a = await e.run([{ action: "click", selector: "#synced" }]); t.eq(a.res.status, "error"); t.ok(/not visible/.test(a.res.error));
      const b = await e.run([{ action: "click", selector: "#synced", force: true }]); t.eq(b.res.status, "done");
    } },
  { id: "no-match", name: "A selector that matches nothing is an error", why: "The message names the selector so the fix is obvious.",
    fn: async (t) => { const e = await t.env(); const r = await e.run([{ action: "click", selector: "#nope" }]); t.eq(r.res.status, "error"); t.ok(/No element matches #nope/.test(r.res.error)); } },
  { id: "bad-selector", name: "A malformed selector does not crash the bridge", why: "querySelector throws on bad syntax. That must become a normal error, and the next command must still work.",
    fn: async (t) => {
      const e = await t.env(); const a = await e.run([{ action: "click", selector: "##" }]); t.eq(a.res.status, "error"); t.ok(/Invalid selector/.test(a.res.error));
      const b = await e.run([{ action: "ping" }]); t.eq(b.res.status, "done");
    } },
  { id: "many-matches", name: "Several matches: warn, and let the command choose with index", why: "PITFALL: '.remove' matches every Remove button. The bridge reports the count and takes the first, or the one you ask for.",
    fn: async (t) => {
      const e = await t.env();
      const a = await e.run([{ action: "call", name: "addTask", args: { text: "A" } }, { action: "call", name: "addTask", args: { text: "B" } }, { action: "click", selector: ".remove" }]);
      t.eq(a.res.results[2].matches, 2); t.ok(/matched 2/.test(a.res.results[2].warning), "warning"); t.eq(e.tasks.length, 1); t.eq(e.tasks[0].text, "B");
      const b = await e.run([{ action: "click", selector: ".remove", index: 3 }]); t.eq(b.res.status, "error"); t.ok(/out of range/.test(b.res.error));
      const c = await e.run([{ action: "call", name: "addTask", args: { text: "C" } }, { action: "click", selector: ".remove", index: 1 }]); t.eq(c.res.status, "done"); t.eq(e.tasks.map((x) => x.text).join(","), "B");
    } },
  { id: "wait-timeout", name: "wait_for that times out fails the command", why: "PITFALL: carrying on after a missed wait runs the next steps on the wrong screen. The command stops with a clear message.",
    fn: async (t) => { const e = await t.env(); const r = await e.run([{ action: "wait_for", selector: "#synced", timeoutMs: 250 }, { action: "call", name: "addTask", args: { text: "should not run" } }]); t.eq(r.res.status, "error"); t.ok(/Timed out/.test(r.res.error)); t.eq(e.tasks.length, 0); } },
  { id: "optional-step", name: "An optional step may fail without stopping the command", why: "For exploratory steps. The failure is still recorded in the results.",
    fn: async (t) => { const e = await t.env(); const r = await e.run([{ action: "wait_for", selector: "#synced", timeoutMs: 200, optional: true }, { action: "call", name: "addTask", args: { text: "ran" } }]); t.eq(r.res.status, "done"); t.eq(r.res.results[0].ok, false); t.eq(e.tasks.length, 1); } },
  { id: "wait-gone", name: "wait_for can wait for something to disappear", why: "Spinners and 'Loading...' labels are best handled by waiting until they are gone.",
    fn: async (t) => {
      const e = await t.env();
      const r = await e.run([{ action: "click", selector: "#sync" }, { action: "wait_for", selector: "#syncing" }, { action: "wait_for", selector: "#syncing", gone: true, timeoutMs: 3000 }, { action: "wait_for", selector: "#synced", textIncludes: "Synced" }]);
      t.eq(r.res.status, "done");
    } },
  { id: "unknown-atomic", name: "A command with an unknown action runs nothing at all", why: "Validate the whole command first. Otherwise the first steps run and the rest are rejected, leaving the app half changed.",
    fn: async (t) => {
      const e = await t.env(); const r = await e.run([{ action: "fill", selector: "#item", value: "x" }, { action: "explode" }]);
      t.eq(r.res.status, "invalid"); t.ok(/unknown action "explode"/.test(r.res.error)); t.eq(e.q("#item").value, "");
    } },
  { id: "bad-shapes", name: "Malformed commands are rejected, never hang", why: "Anything can end up in the db: wrong types, empty lists, too many steps. Each gets a clear 'invalid' result.",
    fn: async (t) => {
      const e = await t.env();
      const cases = [{ steps: "nope" }, { steps: [] }, { steps: Array.from({ length: 41 }, () => ({ action: "ping" })) }, { steps: [1] }, { steps: [{}] }, { steps: [{ action: "ping" }], expires: "soon" }, { hello: "no steps" }];
      for (const c of cases) { const id = await e.sendRaw(Object.assign({ status: "pending" }, c)); const r = await e.result(id); t.eq(r.status, "invalid", JSON.stringify(c).slice(0, 40)); t.ok(r.error, "has a message"); }
    } },
  { id: "expired", name: "A stale command is skipped; a fresh one runs", why: "A pending command waits until the page opens. expires stops old instructions running at a surprising moment.",
    fn: async (t) => {
      const e = await t.env();
      const a = await e.run([{ action: "call", name: "addTask", args: { text: "late" } }], { expires: Date.now() - 1000 }); t.eq(a.res.status, "expired"); t.eq(e.tasks.length, 0);
      const b = await e.run([{ action: "call", name: "addTask", args: { text: "on time" } }], { expires: Date.now() + 60000 }); t.eq(b.res.status, "done"); t.eq(e.tasks.length, 1);
    } },
  { id: "dropdown-check-press", name: "select, check and press work, and misuse is explained", why: "Dropdowns, checkboxes and key presses have their own steps. Using fill on a dropdown gets a helpful error.",
    fn: async (t) => {
      const e = await t.env();
      const a = await e.run([{ action: "select", selector: "#category", label: "Work" }, { action: "check", selector: "#urgent" }, { action: "fill", selector: "#item", value: "boss task" }, { action: "press", selector: "#item", key: "Enter" }]);
      t.eq(a.res.status, "done"); t.eq(e.tasks[0].category, "Work"); t.eq(e.tasks[0].urgent, true);
      const b = await e.run([{ action: "select", selector: "#category", label: "Nope" }]); t.ok(/Options: "Home", "Work", "Errands"/.test(b.res.error), "lists the options");
      const c = await e.run([{ action: "check", selector: "#item" }]); t.eq(c.res.status, "error");
      const d = await e.run([{ action: "fill", selector: "#category", value: "Work" }]); t.ok(/Use "select"/.test(d.res.error));
    } },
  { id: "disabled-fill", name: "fill refuses disabled and read-only fields", why: "Typing into a locked field changes nothing a person could do. The bridge says so.",
    fn: async (t) => {
      const e = await t.env(); e.q("#item").disabled = true;
      const a = await e.run([{ action: "fill", selector: "#item", value: "x" }]); t.ok(/disabled/.test(a.res.error));
      e.q("#item").disabled = false; e.q("#item").readOnly = true;
      const b = await e.run([{ action: "fill", selector: "#item", value: "x" }]); t.ok(/read-only/.test(b.res.error));
    } },
  { id: "fill-readback", name: "fill reads the value back and flags changes", why: "PITFALL: a number field rejects letters; maxlength truncates. accepted:false tells Claude the app did not take the value as typed.",
    fn: async (t) => {
      const e = await t.env(); const n = document.createElement("input"); n.id = "qty"; n.type = "number"; e.root.querySelector("#form").appendChild(n);
      const r = await e.run([{ action: "fill", selector: "#qty", value: "abc" }]);
      t.eq(r.res.status, "done"); t.eq(r.res.results[0].accepted, false); t.ok(/changed the value/.test(r.res.results[0].warning || ""));
    } },
  { id: "text-on-field", name: "text on an input returns its value", why: "Asking for the 'text' of a field is a natural mistake. It answers with the value and says that is what it did.",
    fn: async (t) => { const e = await t.env(); const r = await e.run([{ action: "fill", selector: "#item", value: "abc" }, { action: "text", selector: "#item" }]); t.eq(r.res.results[1].text, "abc"); t.eq(r.res.results[1].source, "value"); } },
  { id: "call-errors", name: "Named actions: unknown, throwing, huge and circular results", why: "Your own functions can fail in ways the bridge cannot predict. Each failure becomes a clear error, not a crash.",
    opts: { actions: { boom: async () => { throw new Error("kaput"); }, big: async () => "x".repeat(30000), circ: async () => { const a = {}; a.self = a; return a; } } },
    fn: async (t) => {
      const e = await t.env(t.opts);
      let r = await e.run([{ action: "call", name: "nope" }]); t.ok(/No registered action: nope. Registered: addTask, getState, boom/.test(r.res.error), "lists registered");
      r = await e.run([{ action: "call", name: "boom" }]); t.ok(/kaput/.test(r.res.error));
      r = await e.run([{ action: "call", name: "big" }]); t.ok(/too large/.test(r.res.error));
      r = await e.run([{ action: "call", name: "circ" }]); t.ok(/not JSON-serializable/.test(r.res.error));
      r = await e.run([{ action: "call", name: "getState", args: [1] }]); t.ok(/"args" must be an object/.test(r.res.error));
    } },
  { id: "screenshots", name: "Screenshots: success, soft failures and pruning", why: "A missing picture should not sink the command. Failures are reported and the command continues. Old pictures are deleted.",
    fn: async (t) => {
      const ok = "data:image/jpeg;base64,AAAA";
      let e = await t.env({ snapshot: async () => ok, limits: { maxSnaps: 3 } });
      let r = await e.run([{ action: "screenshot" }, { action: "screenshot" }, { action: "screenshot" }, { action: "screenshot" }, { action: "screenshot" }]);
      t.eq(r.res.status, "done"); t.eq(Object.keys(e.db.dump()).filter((p) => p.indexOf(TEST_BASE + "/snap/") === 0).length, 3, "only 3 kept");
      for (const [name, snap] of [["null", async () => null], ["throws", async () => { throw new Error("canvas tainted"); }], ["huge", async () => "data:image/jpeg;base64," + "A".repeat(200000)]]) {
        e = await t.env({ snapshot: snap }); r = await e.run([{ action: "screenshot" }, { action: "call", name: "addTask", args: { text: "after" } }]);
        t.eq(r.res.status, "done", name); t.eq(r.res.results[0].ok, false, name); t.ok(r.res.results[0].reason, name + " reason"); t.eq(e.tasks.length, 1, name + " continued");
      }
      e = await t.env(); r = await e.run([{ action: "screenshot" }]); t.eq(r.res.results[0].ok, false); t.ok(/not available/.test(r.res.results[0].reason));
    } },
  { id: "rapid-fire", name: "Twelve commands sent at once all run, in order", why: "Claude may queue several commands. They must all finish and keep their order.",
    fn: async (t) => {
      const e = await t.env(); const ids = [];
      for (let i = 1; i <= 12; i++) ids.push(await e.send([{ action: "call", name: "addTask", args: { text: "T" + i } }]));
      for (const id of ids) t.eq((await e.result(id, 6000)).status, "done", id);
      t.eq(e.tasks.map((x) => x.text).join(","), Array.from({ length: 12 }, (_, i) => "T" + (i + 1)).join(","));
    } },
  { id: "two-tabs", name: "Two tabs on the same channel never run a command twice", why: "PITFALL: the same page open twice (or after a reconnect) would run every command twice. A lease lets only one tab take each command.",
    fn: async (t) => {
      const e = await t.env({ delayMs: 4 }); const b2 = e.addBridge("tab-B"); await b2.start();
      const ids = []; for (let i = 0; i < 6; i++) ids.push(await e.send([{ action: "call", name: "addTask", args: { text: "N" + i } }]));
      for (const id of ids) await e.result(id, 6000);
      await tsleep(150); t.eq(e.tasks.length, 6, "each command ran exactly once");
    } },
  { id: "interrupted", name: "A command left 'running' by a closed page is marked interrupted, not re-run", why: "PITFALL: if the page closes mid-command we cannot know which steps happened. It is flagged, never retried. A command that another tab is really running is left alone.",
    fn: async (t) => {
      const e = await t.env({ limits: { leaseMs: 1000 } });
      await e.db.doc(TEST_BASE + "/cmd/c900").set({ status: "running", steps: [{ action: "call", name: "addTask", args: { text: "ghost" } }] });
      await e.db.doc(TEST_BASE + "/cmd/c901").set({ status: "running", steps: [{ action: "ping" }] });
      await e.db.doc(TEST_BASE + "/cmd/c901").acquire({ holder: "other-tab", ttlMs: 60000 });
      await e.bridge.start();
      const r = await e.result("c900", 3000); t.eq(r.status, "interrupted"); t.eq(await e.cmdStatus("c900"), "interrupted"); t.eq(e.tasks.length, 0, "ghost command was not re-run");
      await tsleep(200); t.eq(await e.cmdStatus("c901"), "running", "live command left alone");
    }, noStart: true },
  { id: "pending-on-open", name: "Commands written while the page was closed run, in order, when it opens", why: "Claude can leave commands for a page that is not open yet. They wait in the db and run, oldest first, as soon as the page starts.",
    fn: async (t) => {
      const e = await t.env({ noStart: true });
      for (const n of ["first", "second", "third"]) await e.send([{ action: "call", name: "addTask", args: { text: n } }]);
      t.eq(e.tasks.length, 0, "nothing runs while the page is closed");
      await e.bridge.start();
      for (const id of ["c001", "c002", "c003"]) t.eq((await e.result(id, 3000)).status, "done", id);
      t.eq(e.tasks.map((x) => x.text).join(","), "first,second,third");
    }, noStart: true },
  { id: "pause", name: "Pause holds commands until resumed", why: "The person stays in control. Nothing runs while the Pause box is ticked.",
    fn: async (t) => {
      const e = await t.env(); e.bridge.pause(true);
      const id = await e.send([{ action: "call", name: "addTask", args: { text: "held" } }]); await tsleep(400);
      t.eq(e.tasks.length, 0, "nothing ran while paused"); t.eq(await e.cmdStatus(id), "pending");
      e.bridge.pause(false); t.eq((await e.result(id, 3000)).status, "done"); t.eq(e.tasks.length, 1);
    } },
  { id: "stop", name: "A stopped bridge ignores new commands", why: "Stopping must be clean: no late surprises after the page decides it is done.",
    fn: async (t) => { const e = await t.env(); e.bridge.stop(); const id = await e.send([{ action: "ping" }]); await tsleep(400); t.eq(await e.cmdStatus(id), "pending"); } },
  { id: "result-too-big", name: "An oversized result is dropped with an explanation", why: "A document is limited to 256 KiB. The command still ends cleanly and tells Claude to ask for less.",
    fn: async (t) => {
      const e = await t.env({ limits: { maxResultBytes: 3000 } });
      const steps = []; for (let i = 0; i < 6; i++) steps.push({ action: "call", name: "addTask", args: { text: "x".repeat(400) } }); steps.push({ action: "read" });
      const r = await e.run(steps); t.eq(r.res.status, "error"); t.ok(/too large/.test(r.res.error)); t.ok(!("lists" in r.res.results[6]), "big fields dropped");
    } },
  { id: "step-timeout", name: "A step that never finishes times out", why: "One stuck action must not freeze every later command.",
    opts: { actions: { hang: () => new Promise(() => {}) }, limits: { stepTimeoutMs: 300 } },
    fn: async (t) => {
      const e = await t.env(t.opts); const a = await e.run([{ action: "call", name: "hang" }]); t.eq(a.res.status, "error"); t.ok(/timed out/.test(a.res.error));
      const b = await e.run([{ action: "ping" }]); t.eq(b.res.status, "done", "later commands still run");
    } },
  { id: "db-hiccup", name: "A db failure while claiming a command is retried later", why: "PITFALL: if the first attempt fails and the page forgets the command, it sits pending forever. A re-scan picks it up when the db recovers.",
    fn: async (t) => {
      const e = await t.env({ limits: { rescanMs: 300 } });
      const id = await e.send([{ action: "call", name: "addTask", args: { text: "retried" } }]);
      e.db.faults.writeError = Object.assign(new Error("quota"), { code: "quota_exceeded" });
      await tsleep(120); e.db.faults.writeError = null;
      t.eq((await e.result(id, 4000)).status, "done"); t.eq(e.tasks.length, 1);
    } },
  { id: "view-only", name: "A view-only user is told the channel is off", why: "Viewers cannot write to their own subtree. The page says so instead of failing silently.",
    fn: async (t) => {
      const e = await t.env({ noStart: true }); e.db.faults.writeError = Object.assign(new Error("denied"), { code: "invalid_argument" });
      const ok = await e.bridge.start(); t.eq(ok, false); t.ok(e.states.some((s) => s[0] === "off" && /view-only/.test(s[1])), "state is off with a reason");
    }, noStart: true },
  { id: "path-rules", name: "The fake db enforces path parity like the real one", why: "The most common db mistake: wrong number of path segments. Documents need an even count, collections an odd count.",
    fn: async (t) => {
      const db = createFakeDb(); let threw = 0;
      try { db.doc("a/b/c"); } catch (_) { threw++; } try { db.collection("a/b"); } catch (_) { threw++; }
      t.eq(threw, 2); t.ok(db.doc("data/users/u1/rc"), "rc is a document (4 segments)"); t.ok(db.collection("data/users/u1/rc/cmd"), "cmd is a collection (5 segments)");
    } },
  { id: "busy-other-agent", name: "A second agent is told the app is busy and nothing runs", why: "PITFALL: two agents driving one app at once interleave clicks and typing. The first agent to run owns the app. Others get status busy, with who holds it and when it frees, and none of their steps run.",
    fn: async (t) => {
      const e = await t.env();
      const a = await e.run([{ action: "fill", selector: "#item", value: "from A" }], { agent: "agent-A" }); t.eq(a.res.status, "done");
      const b = await e.run([{ action: "fill", selector: "#item", value: "from B" }, { action: "click", selector: "#add" }], { agent: "agent-B" });
      t.eq(b.res.status, "busy"); t.ok(/agent-A/.test(b.res.error), "names who holds it"); t.ok(b.res.lock && b.res.lock.held && b.res.lock.agent === "agent-A", "result carries the lock info");
      t.eq(e.q("#item").value, "from A", "agent B changed nothing"); t.eq(e.tasks.length, 0, "agent B added nothing");
      const a2 = await e.run([{ action: "read" }], { agent: "agent-A" }); t.eq(a2.res.status, "done", "the holder carries on");
    } },
  { id: "busy-ping-and-info", name: "ping never takes the app and reports who holds it", why: "Agents need a safe way to look before they act. A ping-only command always runs, never takes the lock, and says who is using the app.",
    fn: async (t) => {
      const e = await t.env();
      const p0 = await e.run([{ action: "ping" }], { agent: "agent-B" }); t.eq(p0.res.results[0].lock.held, false, "free at first");
      await e.run([{ action: "read" }], { agent: "agent-A" });
      const p1 = await e.run([{ action: "ping" }], { agent: "agent-B" });
      t.eq(p1.res.status, "done"); t.eq(p1.res.results[0].lock.agent, "agent-A"); t.eq(p1.res.results[0].lock.state, "idle");
      const again = await e.run([{ action: "read" }], { agent: "agent-A" }); t.eq(again.res.status, "done", "ping did not steal the app");
    } },
  { id: "busy-idle-release", name: "The app frees itself after inactivity", why: "A crashed or forgetful agent must not block the app forever. The lock expires after lockIdleMs without activity, and then anyone may use the app.",
    fn: async (t) => {
      const e = await t.env({ limits: { lockIdleMs: 350 } });
      await e.run([{ action: "read" }], { agent: "agent-A" });
      const early = await e.run([{ action: "read" }], { agent: "agent-B" }); t.eq(early.res.status, "busy", "busy while A is recent");
      await tsleep(450);
      const late = await e.run([{ action: "read" }], { agent: "agent-B" }); t.eq(late.res.status, "done", "free after the idle time");
      const pa = await e.run([{ action: "read" }], { agent: "agent-A" }); t.eq(pa.res.status, "busy", "now B holds it");
    } },
  { id: "busy-release-takeover", name: "release frees the app at once, takeover forces it", why: "A polite agent sends release:true when done. takeover:true exists for when the person says to cut in, and is logged.",
    fn: async (t) => {
      const e = await t.env();
      await e.run([{ action: "read" }], { agent: "agent-A", release: true });
      const b = await e.run([{ action: "read" }], { agent: "agent-B" }); t.eq(b.res.status, "done", "free right after release");
      const a = await e.run([{ action: "read" }], { agent: "agent-A" }); t.eq(a.res.status, "busy");
      const a2 = await e.run([{ action: "read" }], { agent: "agent-A", takeover: true }); t.eq(a2.res.status, "done", "takeover works");
      t.ok(e.logs.some((l) => /took the app over/.test(l)), "takeover is logged");
      const bad = await e.sendRaw({ status: "pending", steps: [{ action: "read" }], agent: 5, takeover: "yes" }); t.eq((await e.result(bad)).status, "invalid", "bad lock fields are rejected");
    } },
  { id: "busy-long-command", name: "A long command keeps its lock while it runs", why: "The idle clock starts when a command ENDS. A command that runs longer than lockIdleMs must not lose the app halfway.",
    fn: async (t) => {
      const e = await t.env({ limits: { lockIdleMs: 300, leaseMs: 600 } });
      const long = await e.send([{ action: "wait", ms: 900 }, { action: "fill", selector: "#item", value: "long" }], { agent: "agent-A" });
      await tsleep(500);
      const b = await e.run([{ action: "fill", selector: "#item", value: "intruder" }], { agent: "agent-B" }); t.eq(b.res.status, "busy", "still held mid-command");
      t.eq((await e.result(long)).status, "done"); t.eq(e.q("#item").value, "long");
    } },
  { id: "agent-required", name: "An app can require every command to name its agent", why: "With requireAgent on, a command with no agent name is invalid and nothing runs, so the busy message can always say who holds the app.",
    fn: async (t) => {
      const e = await t.env({ limits: { requireAgent: true } });
      const no = await e.run([{ action: "fill", selector: "#item", value: "x" }]); t.eq(no.res.status, "invalid"); t.ok(/session name/.test(no.res.error), "tells the agent what to do"); t.eq(e.q("#item").value, "", "nothing ran");
      const blank = await e.run([{ action: "read" }], { agent: "   " }); t.eq(blank.res.status, "invalid", "a blank name does not count");
      const yes = await e.run([{ action: "read" }], { agent: "Sales report helper" }); t.eq(yes.res.status, "done");
    } },
  { id: "session-identity", name: "The session id is the identity; a name can be shared or changed", why: "The plugin hook stamps each command with the real session id. Two sessions that use the same display name are still different owners, and one session that changes its name is still the same owner.",
    fn: async (t) => {
      const e = await t.env();
      const a = await e.run([{ action: "read" }], { agent: "helper", session: "aaaa1111-0000" }); t.eq(a.res.status, "done");
      const b = await e.run([{ action: "fill", selector: "#item", value: "x" }], { agent: "helper", session: "bbbb2222-0000" });
      t.eq(b.res.status, "busy", "same name, different session: busy"); t.eq(e.q("#item").value, "", "nothing ran");
      const a2 = await e.run([{ action: "read" }], { agent: "renamed", session: "aaaa1111-0000" }); t.eq(a2.res.status, "done", "same session, new name: still the owner");
      const sub = await e.run([{ action: "read" }], { session: "aaaa1111-0000", subagent: { id: "sub-1", type: "Explore" } }); t.eq(sub.res.status, "busy", "a subagent of the same session is a different caller");
      const lock = JSON.parse(JSON.stringify(e.db.dump()[TEST_BASE + "/meta/lock"])); t.ok(/aaaa1111/.test(lock.agent) && lock.verified === true, "the lock label carries the short session id");
    } },
  { id: "session-logs", name: "Log lines carry the session", why: "The activity log should say who did what. Every log line for a command starts with the session label.",
    fn: async (t) => {
      const e = await t.env();
      await e.run([{ action: "read" }], { agent: "Sales helper", session: "cccc3333-0000" });
      t.ok(e.logs.some((l) => /Sales helper · cccc3333.*started/.test(l)), "started line has the label");
      t.ok(e.logs.some((l) => /Sales helper · cccc3333.*done/.test(l)), "done line has the label");
    } },
  { id: "session-satisfies-require", name: "A session id satisfies requireAgent", why: "With the plugin installed the agent need not write a name at all: the stamped session id is enough.",
    fn: async (t) => {
      const e = await t.env({ limits: { requireAgent: true } });
      const r = await e.run([{ action: "read" }], { session: "dddd4444-0000" }); t.eq(r.res.status, "done");
      const bad = await e.sendRaw({ status: "pending", steps: [{ action: "read" }], session: 7 }); t.eq((await e.result(bad)).status, "invalid", "a non-text session is rejected");
    } },
];

async function runStressTests(onResult, only) {
  const summary = { passed: 0, failed: 0, results: [] };
  for (const test of TESTS) {
    if (only && only.indexOf(test.id) < 0) continue;
    const envs = [], t0 = Date.now();
    const t = {
      opts: test.opts,
      async env(o) { const e = makeEnv(o || {}); envs.push(e); if (!(o && o.noStart) && !test.noStart) await e.bridge.start(); return e; },
      eq(a, b, m) { if (a !== b) throw new Error((m ? m + ": " : "") + "expected " + JSON.stringify(b) + " but got " + JSON.stringify(a)); },
      ok(v, m) { if (!v) throw new Error("check failed" + (m ? ": " + m : "")); },
    };
    let error = null;
    try { await test.fn(t); } catch (e) { error = String((e && e.message) || e); }
    envs.forEach((e) => e.dispose());
    const r = { id: test.id, name: test.name, why: test.why, passed: !error, error, ms: Date.now() - t0 };
    summary.results.push(r); r.passed ? summary.passed++ : summary.failed++;
    if (onResult) onResult(r);
  }
  return summary;
}
