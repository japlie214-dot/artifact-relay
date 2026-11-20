/* ===================== REMOTE CONTROL WIRING (keep) =====================
   Connects the bridge to this page and to the #rc panel.
   Needs, loaded before it: the bridge (createBridge, makeHtml2canvasSnapshot), the #rc panel markup,
   and optionally window.REMOTE_ACTIONS (named actions Claude can call) and the html2canvas script.
   Optional settings, set BEFORE this script runs:
     window.RC_OPTIONS = { root: someElement, limits: { maxSteps: 20 } }                                  */
const RC = { bridge: null, paused: false, lines: [], lock: null };
const rcEl = (id) => document.getElementById(id);
const rcEsc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function rcState(s, detail) { const el = rcEl("rc-state"); el.dataset.s = s; el.textContent = s; rcEl("rc-detail").textContent = detail ? " · " + detail : ""; }
function rcLog(line) { RC.lines.unshift(new Date().toLocaleTimeString() + "  " + line); RC.lines.length = Math.min(RC.lines.length, 6); rcEl("rc-log").innerHTML = RC.lines.map((l) => "<li>" + rcEsc(l) + "</li>").join(""); }
function rcLock(l) { RC.lock = l; rcShowLock(); }
function rcShowLock() {
  const el = rcEl("rc-lock"), l = RC.lock, now = Date.now();
  if (!l || !(Number(l.expiresAt) > now)) { el.dataset.s = "free"; el.textContent = "free"; return; }
  el.dataset.s = l.state === "running" ? "busy" : "held";
  el.textContent = (l.state === "running" ? "busy: " : "held by ") + l.agent + (l.state === "running" ? "" : " (idle " + Math.round((now - l.lastActive) / 1000) + "s, frees in " + Math.round((l.expiresAt - now) / 1000) + "s)");
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
  const opts = window.RC_OPTIONS || {};
  RC.bridge = createBridge({
    db, base: "data/users/" + uid + "/rc", root: opts.root || document, limits: opts.limits,
    actions: window.REMOTE_ACTIONS || {}, snapshot: makeHtml2canvasSnapshot(document.body),
    onState: rcState, onLog: rcLog, onLock: rcLock,
  });
  if (RC.paused) RC.bridge.pause(true);
  await RC.bridge.start();
})();
/* ===================== END REMOTE CONTROL WIRING ===================== */
