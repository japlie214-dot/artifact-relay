/* ===================== REMOTE CONTROL WIRING (keep) =====================
   Connects the bridge to this page and to the #rc panel.
   Needs, loaded before it: the bridge (createBridge, makeHtml2canvasSnapshot), the #rc panel markup,
   and optionally window.REMOTE_ACTIONS (named actions Claude can call) and the html2canvas script.
   Optional settings, set BEFORE this script runs:
     window.RC_OPTIONS = { root: someElement, collapsed: true, limits: { maxSteps: 20 } }                                  */
const RC = { bridge: null, paused: false, lines: [], lock: null };
const rcEl = (id) => document.getElementById(id);
const rcEsc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function rcState(s, detail) { const el = rcEl("rc-state"); el.dataset.s = s; el.textContent = s; rcEl("rc").dataset.s = s; rcEl("rc-detail").textContent = detail || ""; }
function rcKind(t) { return /error|invalid|failed|interrupted|could not/i.test(t) ? "bad" : /busy|took the app|expired/i.test(t) ? "warn" : /released|done/i.test(t) ? "ok" : /started/i.test(t) ? "run" : "info"; }
function rcLog(line) {                       // newest first, the list scrolls inside its own box
  RC.lines.unshift({ t: new Date().toLocaleTimeString(), text: line, k: rcKind(line) });
  RC.lines.length = Math.min(RC.lines.length, 60);
  rcEl("rc-log").innerHTML = RC.lines.map((l) => '<li data-k="' + l.k + '"><time>' + rcEsc(l.t) + "</time><span>" + rcEsc(l.text) + "</span></li>").join("");
}
if ((window.RC_OPTIONS || {}).collapsed) { rcEl("rc").dataset.collapsed = "true"; rcEl("rc-toggle").setAttribute("aria-expanded", "false"); }
rcEl("rc-toggle").addEventListener("click", () => { const c = rcEl("rc").dataset.collapsed !== "true"; rcEl("rc").dataset.collapsed = String(c); rcEl("rc-toggle").setAttribute("aria-expanded", String(!c)); });
function rcLock(l) { RC.lock = l; rcShowLock(); }
function rcShowLock() {
  const el = rcEl("rc-lock"), l = RC.lock, now = Date.now();
  const mini = rcEl("rc-mini");
  if (!l || !(Number(l.expiresAt) > now)) { el.dataset.s = "free"; el.textContent = "free"; if (mini) mini.textContent = "free"; return; }
  el.dataset.s = l.state === "running" ? "busy" : "held";
  el.textContent = (l.state === "running" ? "busy: " : "held by ") + l.agent + (l.state === "running" ? "" : " (idle " + Math.round((now - l.lastActive) / 1000) + "s, frees in " + Math.round((l.expiresAt - now) / 1000) + "s)");
  if (mini) mini.textContent = l.state === "running" ? l.agent + " · working" : l.agent + " · idle " + Math.round((now - l.lastActive) / 1000) + "s";
}
setInterval(rcShowLock, 1000);
rcEl("rc-pause").addEventListener("change", (e) => { RC.paused = e.target.checked; if (RC.bridge) RC.bridge.pause(RC.paused); else rcState(RC.paused ? "paused" : "off"); });

(async () => {
  let db = null, user = null;
  try { db = await window.claude.use("db"); user = await window.claude.use("user"); } catch (_) {}
  if (!db || !user) { rcState("off", "the db or user capability is not available in this view"); return; }
  let uid = null;
  try { uid = await user.id(); } catch (_) {}
  if (!uid) { rcState("off", "no user id, so there is no private channel"); return; }
  const opts = window.RC_OPTIONS || {};   // limits: { requireAgent: false } lets commands run without an agent name
  RC.bridge = createBridge({
    db, base: "data/users/" + uid + "/rc", root: opts.root || document, limits: Object.assign({ requireAgent: true }, opts.limits),
    actions: window.REMOTE_ACTIONS || {}, snapshot: makeHtml2canvasSnapshot(document.body),
    onState: rcState, onLog: rcLog, onLock: rcLock,
  });
  if (RC.paused) RC.bridge.pause(true);
  await RC.bridge.start();
})();
/* ===================== END REMOTE CONTROL WIRING ===================== */
