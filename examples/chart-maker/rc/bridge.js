/* ===================== REMOTE CONTROL BRIDGE v2 (keep) =====================
   A per-user, private command channel stored in the app's shared db.
   Paths (relative to `base`, for example "data/users/<your id>/rc"):
     <base>/cmd/<id>      Claude writes  {status:"pending", steps:[...], expires?:epochMs}
     <base>/res/<id>      page writes    {status, error, results:[...], t}
     <base>/snap/<id>     page writes    {jpeg:"data:image/...", t}
     <base>/meta/hello    page writes    {openedAt, holder, version, visibility}
     <base>/meta/lock     page writes    {agent, state, since, lastActive, expiresAt}  (who is using the app; frees itself after lockIdleMs of inactivity)
   A command may carry  agent:"name"  (who you are), release:true (free the app when done), takeover:true (take it from another agent).
   If another agent holds the app, the command is not run and ends with status "busy". ping-only commands never take the lock.
   Steps are plain data from a fixed action list. Nothing is eval'd.
   Failure policy:
     hard error  -> the command stops, status "error"      (missing element, disabled, timeout...)
     soft failure -> the step reports ok:false and continues (screenshot unavailable)
     warning     -> ok:true plus a "warning" field         (selector matched several elements)      */
const BRIDGE_VERSION = "2.1";
const BRIDGE_ACTIONS = ["ping", "inspect", "read", "fill", "click", "check", "select", "press", "wait", "wait_for", "text", "call", "screenshot"];

function createBridge(opts) {
  const o = Object.assign({
    root: document, actions: {}, snapshot: null, stepDelayMs: 0,
    onState() {}, onLog() {}, onLock() {}, highlight() {}, now: () => Date.now(),
    holder: "tab-" + Math.random().toString(36).slice(2, 8),
  }, opts);
  const L = Object.assign({
    maxSteps: 40, maxChars: 20000, maxResultBytes: 200000, maxSnapChars: 190000, maxSnaps: 10,
    stepTimeoutMs: 150000, leaseMs: 60000, rescanMs: 5000, maxFieldChars: 2000, maxElements: 150, maxRows: 100, lockIdleMs: 120000, maxAgentChars: 40,
  }, opts.limits || {});
  const { db, base, root } = o;
  const P = { cmd: base + "/cmd", res: base + "/res", snap: base + "/snap", hello: base + "/meta/hello", lock: base + "/meta/lock" };
  const S = { paused: false, stopped: false, snapIds: [], unsub: null, chain: Promise.resolve(), seen: new Set(), running: new Set() };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const msg = (e) => String((e && e.message) || (e && e.code) || e);
  const trunc = (s, n) => { s = String(s == null ? "" : s); return s.length > n ? { text: s.slice(0, n), truncated: true, length: s.length } : { text: s, truncated: false, length: s.length }; };
  const doc = () => root.ownerDocument || root;
  const win = () => doc().defaultView || window;
  const visState = () => doc().visibilityState;
  const withTimeout = (p, ms, label) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(label + " timed out after " + ms + "ms")), ms);
    p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
  });

  /* ---------- who is using the app ---------- */
  const agentOf = (d) => (typeof d.agent === "string" && d.agent.trim() ? d.agent.trim() : "unnamed");
  async function readLock() { try { const s = await db.doc(P.lock).get(); return s.exists ? s.data() : null; } catch (_) { return null; } }
  const lockLive = (l) => !!(l && l.agent && Number(l.expiresAt) > o.now());
  function lockInfo(l) {
    if (!lockLive(l)) return { held: false };
    return { held: true, agent: l.agent, state: l.state, since: l.since, idleMs: Math.max(0, o.now() - l.lastActive), expiresInMs: Math.max(0, l.expiresAt - o.now()) };
  }
  async function writeLock(l) { try { await db.doc(P.lock).set(l); } catch (e) { o.onLog("could not write the lock: " + msg(e)); } o.onLock(l); }
  const touchedLock = (prev, agent, cmd, state) => ({ agent, cmd, state, holder: o.holder, since: prev && prev.agent === agent && lockLive(prev) ? prev.since : o.now(), lastActive: o.now(), expiresAt: o.now() + L.lockIdleMs });

  /* ---------- looking at the page ---------- */
  function visible(el) {
    if (!el || el.hidden || (el.closest && el.closest("[hidden]"))) return false;
    if (el.getClientRects && el.getClientRects().length === 0) return false;
    const cs = win().getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none";
  }
  const isDisabled = (el) => !!(el.disabled || el.getAttribute("aria-disabled") === "true");
  function labelOf(el) {
    const aria = el.getAttribute("aria-label"); if (aria) return aria.trim().slice(0, 80);
    if (el.labels && el.labels.length) return el.labels[0].innerText.trim().slice(0, 80);
    if (el.placeholder) return el.placeholder.slice(0, 80);
    if (el.tagName === "INPUT" && /^(button|submit|reset)$/.test(el.type)) return String(el.value).slice(0, 80);
    return (el.innerText || el.title || "").trim().replace(/\s+/g, " ").slice(0, 80);
  }
  function bestSelector(el) {
    const esc = (s) => (win().CSS && win().CSS.escape ? win().CSS.escape(s) : String(s).replace(/[^\w-]/g, "\\$&"));
    if (el.id) return "#" + esc(el.id);
    const rc = el.getAttribute("data-rc"); if (rc) return '[data-rc="' + rc.replace(/"/g, '\\"') + '"]';
    const nm = el.getAttribute("name"); if (nm) return el.tagName.toLowerCase() + '[name="' + nm.replace(/"/g, '\\"') + '"]';
    const parts = []; let n = el;
    while (n && n.nodeType === 1 && n !== root && parts.length < 4) {
      if (n.id) { parts.unshift("#" + esc(n.id)); break; }
      let part = n.tagName.toLowerCase();
      const sib = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : [];
      if (sib.length > 1) part += ":nth-of-type(" + (sib.indexOf(n) + 1) + ")";
      parts.unshift(part); n = n.parentElement;
    }
    return parts.join(" > ");
  }
  function describe(el) {
    const tag = el.tagName.toLowerCase(), type = tag === "input" ? (el.type || "text").toLowerCase() : undefined;
    const d = { selector: bestSelector(el), tag };
    if (type) d.type = type;
    if (el.id) d.id = el.id;
    const nm = el.getAttribute("name"); if (nm) d.name = nm;
    d.label = labelOf(el);
    if (tag === "input" || tag === "textarea" || tag === "select") {
      if (type === "password") d.value = el.value ? "(hidden: password)" : "";
      else if (type === "checkbox" || type === "radio") d.checked = !!el.checked;
      else if (tag === "select") { d.value = el.value; d.selectedText = el.selectedOptions[0] ? el.selectedOptions[0].text : ""; d.options = [...el.options].slice(0, 50).map((op) => op.text); }
      else { const t = trunc(el.value, L.maxFieldChars); d.value = t.text; if (t.truncated) d.valueLength = t.length; }
    } else if (el.isContentEditable) { const t = trunc(el.innerText, L.maxFieldChars); d.value = t.text; }
    if (tag === "a") d.href = el.getAttribute("href");
    d.disabled = isDisabled(el);
    d.visible = visible(el);
    return d;
  }
  const CONTROLS = 'button,input,textarea,select,a[href],[role="button"],[contenteditable=""],[contenteditable="true"],[data-rc]';
  function controlsOf(scope) {
    const all = [...scope.querySelectorAll(CONTROLS)];
    return { controls: all.slice(0, L.maxElements).map(describe), controlsTotal: all.length, controlsTruncated: all.length > L.maxElements };
  }
  const defaultScope = () => root.querySelector("#app") || root.body || root;
  function readScope(scope) {
    const t = trunc(scope.innerText != null ? scope.innerText : scope.textContent, L.maxChars);
    const lists = [...scope.querySelectorAll("ul,ol")].filter(visible).slice(0, 20).map((ul) => ({
      selector: bestSelector(ul),
      items: [...ul.children].filter((li) => li.tagName === "LI" && visible(li)).slice(0, L.maxRows).map((li) => trunc(li.innerText.trim().replace(/\s+/g, " "), 300).text),
    }));
    const tables = [...scope.querySelectorAll("table")].filter(visible).slice(0, 10).map((tb) => ({
      selector: bestSelector(tb),
      rows: [...tb.rows].slice(0, L.maxRows).map((r) => [...r.cells].slice(0, 30).map((c) => trunc(c.innerText.trim(), 200).text)),
    }));
    return Object.assign({ title: doc().title || "", text: t.text, textTruncated: t.truncated, lists, tables }, controlsOf(scope));
  }

  /* ---------- finding and acting ---------- */
  function one(step, o2) {
    if (typeof step.selector !== "string" || !step.selector) throw new Error('"selector" is required for ' + step.action);
    let list; try { list = [...root.querySelectorAll(step.selector)]; } catch (_) { throw new Error("Invalid selector: " + step.selector); }
    if (!list.length) throw new Error("No element matches " + step.selector);
    let i = 0;
    if (step.index !== undefined) { i = Number(step.index); if (!Number.isInteger(i) || i < 0 || i >= list.length) throw new Error("index " + step.index + " is out of range (" + list.length + " matches)"); }
    const el = list[i];
    if (o2 && o2.needVisible && !step.force && !visible(el)) throw new Error("Element is not visible: " + step.selector + " (add force:true to act anyway)");
    o.highlight(el);
    const out = { el, matches: list.length };
    if (list.length > 1 && step.index === undefined) out.warning = "Selector matched " + list.length + " elements; used the first. Add index or a more specific selector.";
    return out;
  }
  function setNative(el, v) {
    const W = win();
    const proto = el.tagName === "TEXTAREA" ? W.HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? W.HTMLSelectElement.prototype : W.HTMLInputElement.prototype;
    const d = Object.getOwnPropertyDescriptor(proto, "value");
    if (d && d.set) d.set.call(el, v); else el.value = v;      // the native setter makes React-style controlled inputs notice
  }
  function fire(el, type, init) {
    const W = win(), E = type === "input" && W.InputEvent ? W.InputEvent : W.Event;
    el.dispatchEvent(new E(type, Object.assign({ bubbles: true }, init)));
  }
  const withWarn = (r, w) => (w ? Object.assign(r, { warning: w }) : r);

  async function runStep(step, ctx) {
    switch (step.action) {
      case "ping":
        return { ok: true, pong: true, t: o.now(), visibility: visState(), version: BRIDGE_VERSION, holder: o.holder, lock: lockInfo(await readLock()) };

      case "inspect": {
        const f = step.selector ? one(step) : { el: defaultScope() };
        return Object.assign({ ok: true }, controlsOf(f.el));
      }
      case "read": {
        const f = step.selector ? one(step) : { el: defaultScope() };
        return Object.assign({ ok: true }, readScope(f.el));
      }
      case "fill": {
        const f = one(step, { needVisible: true }), el = f.el;
        if (step.value === undefined) throw new Error('"value" is required for fill');
        const v = String(step.value), type = (el.type || "").toLowerCase();
        if (isDisabled(el)) throw new Error("Element is disabled: " + step.selector);
        if (el.readOnly) throw new Error("Element is read-only: " + step.selector);
        if (el.tagName === "SELECT") throw new Error('Use "select" for a dropdown');
        if (el.tagName === "INPUT" && /^(checkbox|radio|button|submit|reset|file|image)$/.test(type)) throw new Error('fill cannot set an input of type "' + type + '". Use check or click.');
        if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") { el.focus(); setNative(el, v); }
        else if (el.isContentEditable) { el.focus(); el.textContent = v; }
        else throw new Error("Element is not a text field: " + step.selector);
        fire(el, "input", { data: v, inputType: "insertText" }); fire(el, "change");
        const actual = el.isContentEditable && el.tagName !== "INPUT" && el.tagName !== "TEXTAREA" ? el.innerText : el.value;
        const accepted = actual === v, t = trunc(actual, 200);
        return withWarn({ ok: true, matches: f.matches, accepted, value: t.text, valueLength: actual.length },
          f.warning || (accepted ? null : "The field changed the value (length, type or pattern rules). Check value."));
      }
      case "click": {
        const f = one(step, { needVisible: true });
        if (isDisabled(f.el)) throw new Error("Element is disabled: " + step.selector);
        f.el.click(); await sleep(30);
        return withWarn({ ok: true, matches: f.matches }, f.warning);
      }
      case "check": {
        const f = one(step, { needVisible: true }), el = f.el;
        if (!(el.tagName === "INPUT" && /^(checkbox|radio)$/.test(el.type))) throw new Error("check needs a checkbox or radio button");
        if (isDisabled(el)) throw new Error("Element is disabled: " + step.selector);
        const want = step.checked === undefined ? true : !!step.checked;
        if (el.checked !== want) { el.click(); await sleep(30); }
        if (el.checked !== want) throw new Error("Could not set checked=" + want + " on " + step.selector);
        return withWarn({ ok: true, checked: el.checked }, f.warning);
      }
      case "select": {
        const f = one(step, { needVisible: true }), el = f.el;
        if (el.tagName !== "SELECT") throw new Error("select needs a <select> element");
        if (isDisabled(el)) throw new Error("Element is disabled: " + step.selector);
        const by = step.value !== undefined ? (op) => op.value === String(step.value) : step.label !== undefined ? (op) => op.text.trim() === String(step.label).trim() : null;
        if (!by) throw new Error('select needs "value" or "label"');
        const op = [...el.options].find(by);
        if (!op || op.disabled) throw new Error("No selectable option matches. Options: " + [...el.options].map((x) => JSON.stringify(x.text)).join(", "));
        setNative(el, op.value); fire(el, "input"); fire(el, "change");
        return withWarn({ ok: true, value: el.value, selectedText: el.selectedOptions[0].text }, f.warning);
      }
      case "press": {
        if (typeof step.key !== "string" || !step.key) throw new Error('"key" is required for press');
        let target;
        if (step.selector) { target = one(step, { needVisible: true }).el; target.focus(); } else target = doc().activeElement || doc().body;
        const init = { key: step.key, code: step.key.length === 1 ? "Key" + step.key.toUpperCase() : step.key, bubbles: true, cancelable: true };
        target.dispatchEvent(new (win().KeyboardEvent)("keydown", init));
        target.dispatchEvent(new (win().KeyboardEvent)("keyup", init));
        await sleep(30);
        return { ok: true, synthetic: true, note: "Synthetic key events run the page's handlers but not browser defaults such as submitting a form. Click the submit button instead." };
      }
      case "wait": {
        const ms = Number(step.ms);
        if (!Number.isFinite(ms) || ms < 0) throw new Error('"ms" must be a number');
        await sleep(Math.min(ms, 10000)); return { ok: true, waitedMs: Math.min(ms, 10000) };
      }
      case "wait_for": {
        if (typeof step.selector !== "string" || !step.selector) throw new Error('"selector" is required for wait_for');
        const limit = Math.min(Number(step.timeoutMs) || 15000, 120000), t0 = o.now();
        for (;;) {
          let list; try { list = [...root.querySelectorAll(step.selector)]; } catch (_) { throw new Error("Invalid selector: " + step.selector); }
          const vis = list.filter(visible);
          const textOk = !step.textIncludes || vis.some((e) => String(e.innerText || "").includes(step.textIncludes) || String(e.value || "").includes(step.textIncludes));
          if (step.gone ? vis.length === 0 : (vis.length > 0 && textOk)) return { ok: true, waitedMs: o.now() - t0 };
          if (o.now() - t0 >= limit) throw new Error("Timed out after " + limit + "ms waiting for " + step.selector + (step.gone ? " to disappear" : " to appear") + (step.textIncludes ? ' with text "' + step.textIncludes + '"' : ""));
          await sleep(100);
        }
      }
      case "text": {
        const f = one(step), el = f.el, isField = /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
        const t = trunc(isField ? el.value : (el.innerText != null ? el.innerText : el.textContent), L.maxChars);
        const r = { ok: true, matches: f.matches, text: t.text, truncated: t.truncated, length: t.length, visible: visible(el) };
        if (isField) r.source = "value";
        else {
          const typed = [...el.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=password]),textarea')].filter((x) => x.value).length;
          if (typed) r.note = typed + " field(s) inside have typed values that text does not include. Use read to see them.";
          if (!r.visible) r.note = (r.note ? r.note + " " : "") + "The element is hidden, so its text may be empty.";
        }
        return withWarn(r, f.warning);
      }
      case "call": {
        const fn = o.actions && o.actions[step.name];
        if (typeof fn !== "function") throw new Error("No registered action: " + step.name + ". Registered: " + Object.keys(o.actions || {}).join(", "));
        if (step.args !== undefined && (typeof step.args !== "object" || step.args === null || Array.isArray(step.args))) throw new Error('"args" must be an object');
        const result = await fn(step.args || {}, { cmdId: ctx.cmdId });
        let s; try { s = JSON.stringify(result === undefined ? null : result); } catch (e) { throw new Error("Action result is not JSON-serializable: " + msg(e)); }
        if (s.length > L.maxChars) throw new Error("Action result is too large (" + s.length + " characters; the limit is " + L.maxChars + ")");
        return { ok: true, name: step.name, result: JSON.parse(s) };
      }
      case "screenshot": {
        if (typeof o.snapshot !== "function") return { ok: false, reason: "screenshots are not available in this page" };
        const target = step.selector ? one(step).el : null;
        let url; try { url = await o.snapshot(target); } catch (e) { return { ok: false, reason: "capture failed: " + msg(e) }; }
        if (typeof url !== "string" || url.indexOf("data:") !== 0) return { ok: false, reason: "capture produced no image" };
        if (url.length > L.maxSnapChars) return { ok: false, reason: "image too large (" + url.length + " characters; limit " + L.maxSnapChars + "). Try a selector for a smaller area." };
        const id = ctx.cmdId + "_" + (ctx.n++);
        await db.doc(P.snap + "/" + id).set({ jpeg: url, t: o.now() });
        S.snapIds.push(id);
        while (S.snapIds.length > L.maxSnaps) { try { await db.doc(P.snap + "/" + S.snapIds.shift()).delete(); } catch (_) {} }
        return { ok: true, snap: id, bytes: url.length };
      }
      default: throw new Error('Unknown action "' + step.action + '"');
    }
  }

  /* ---------- commands ---------- */
  function validate(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) return "The command is not an object";
    if (!Array.isArray(data.steps)) return '"steps" must be a list';
    if (!data.steps.length) return '"steps" is empty';
    if (data.steps.length > L.maxSteps) return "Too many steps (" + data.steps.length + "). The limit is " + L.maxSteps;
    for (let i = 0; i < data.steps.length; i++) {
      const s = data.steps[i];
      if (!s || typeof s !== "object" || Array.isArray(s)) return "Step " + (i + 1) + " is not an object";
      if (typeof s.action !== "string") return "Step " + (i + 1) + ' has no "action"';
      if (BRIDGE_ACTIONS.indexOf(s.action) < 0) return "Step " + (i + 1) + ': unknown action "' + s.action + '". Known actions: ' + BRIDGE_ACTIONS.join(", ");
    }
    if (data.expires !== undefined && !Number.isFinite(Number(data.expires))) return '"expires" must be a number (epoch milliseconds)';
    if (data.agent !== undefined && (typeof data.agent !== "string" || data.agent.length > L.maxAgentChars)) return '"agent" must be a short text (at most ' + L.maxAgentChars + " characters)";
    for (const k of ["release", "takeover"]) if (data[k] !== undefined && typeof data[k] !== "boolean") return '"' + k + '" must be true or false';
    return null;
  }

  async function finish(id, ref, status, error, results, extra) {
    const res = Object.assign({ status, error: error || null, results: results || [], t: o.now(), holder: o.holder }, extra || {});
    const size = JSON.stringify(res).length;
    if (size > L.maxResultBytes) {
      res.results = res.results.map((r) => ({ step: r.step, action: r.action, ok: r.ok, error: r.error }));
      res.error = (res.error ? res.error + " | " : "") + "The full results were too large (" + size + " bytes) and were dropped. Ask for less, for example read with a selector.";
      if (res.status === "done") res.status = "error";
    }
    try { await db.doc(P.res + "/" + id).set(res); }
    catch (e) { try { await db.doc(P.res + "/" + id).set({ status: "error", error: "Could not save the result: " + msg(e), results: [], t: o.now() }); } catch (_) {} }
    try { await ref.update({ status: res.status }); } catch (_) {}
    o.onLog(id + " " + res.status + (res.error ? ": " + res.error : ""));
  }

  async function execute(snap) {
    const id = snap.id;
    if (S.seen.has(id)) return;
    S.seen.add(id);
    const ref = db.doc(P.cmd + "/" + id);
    let data, agent = null, held = false;
    try {
      const lease = await ref.acquire({ holder: o.holder, ttlMs: L.leaseMs });            // one tab at a time
      if (!lease.acquired) { o.onLog(id + ": another tab is handling it"); return; }
      const fresh = await ref.get();
      if (!fresh.exists || (fresh.data() || {}).status !== "pending") return;
      data = fresh.data();
    } catch (e) {
      o.onLog(id + ": could not claim it (" + msg(e) + "). Will look again soon.");
      S.seen.delete(id); setTimeout(rescan, L.rescanMs); return;
    }
    S.running.add(id);
    const renew = setInterval(() => { ref.acquire({ holder: o.holder, ttlMs: L.leaseMs }).catch(() => {}); }, Math.max(500, L.leaseMs / 2));
    const renewLock = setInterval(() => { if (held) readLock().then((l) => { if (l && l.agent === agent) writeLock(touchedLock(l, agent, id, "running")); }); }, Math.max(100, L.lockIdleMs / 3));
    try {
      const bad = validate(data);
      if (bad) return await finish(id, ref, "invalid", bad, []);
      if (data.expires !== undefined && o.now() > Number(data.expires)) return await finish(id, ref, "expired", "It expired before it ran", []);
      while (S.paused && !S.stopped) await sleep(200);
      if (S.stopped) return;
      agent = agentOf(data);
      if (!data.steps.every((s) => s.action === "ping")) {                 // ping-only commands just look; they never take the app
        const prev = await readLock();
        if (lockLive(prev) && prev.agent !== agent && !data.takeover) {
          const li = lockInfo(prev);
          return await finish(id, ref, "busy", 'The app is in use by agent "' + prev.agent + '" (' + (prev.state === "running" ? "working now" : "idle for " + Math.round(li.idleMs / 1000) + "s") + "). It frees itself in " + Math.round(li.expiresInMs / 1000) + 's, or when that agent sends release:true. Wait and send again, or use takeover:true only if the person says so. Nothing was run.', [], { lock: li });
        }
        if (lockLive(prev) && prev.agent !== agent) o.onLog(id + ": " + agent + " took the app over from " + prev.agent);
        await writeLock(touchedLock(prev, agent, id, "running")); held = true;
      }
      await ref.update({ status: "running", startedAt: o.now(), holder: o.holder });
      o.onState("running", id); o.onLog(id + " started (" + data.steps.length + " steps)");
      const results = [], ctx = { cmdId: id, n: 1 };
      let status = "done", error = null;
      for (let i = 0; i < data.steps.length; i++) {
        while (S.paused && !S.stopped) await sleep(200);
        if (S.stopped) { status = "interrupted"; error = "The bridge was stopped"; break; }
        const s = data.steps[i];
        if (o.stepDelayMs) await sleep(o.stepDelayMs);
        const t0 = o.now();
        try {
          const r = await withTimeout(runStep(s, ctx), L.stepTimeoutMs, "Step " + (i + 1));
          results.push(Object.assign({ step: i, action: s.action, ms: o.now() - t0 }, r));
        } catch (e) {
          results.push({ step: i, action: s.action, ok: false, error: msg(e), ms: o.now() - t0 });
          if (s.optional) continue;
          status = "error"; error = "Step " + (i + 1) + " (" + s.action + "): " + msg(e); break;
        }
      }
      await finish(id, ref, status, error, results);
    } catch (e) {
      o.onLog(id + ": unexpected error " + msg(e));
      await finish(id, ref, "error", "Unexpected error: " + msg(e), []);
    } finally {
      clearInterval(renew); clearInterval(renewLock); S.running.delete(id);
      if (held) {                                               // the idle clock starts when the command ends
        try {
          if (data && data.release) { await db.doc(P.lock).delete(); o.onLock(null); o.onLog(agent + " released the app"); }
          else await writeLock(touchedLock(await readLock(), agent, id, "idle"));
        } catch (_) {}
      }
      o.onState(S.paused ? "paused" : "on", "waiting for commands");
    }
  }

  /* ---------- lifecycle ---------- */
  function enqueue(d) { S.chain = S.chain.then(() => execute(d)).catch((e) => o.onLog("bridge error: " + msg(e))); }
  async function rescan() {
    if (S.stopped) return;
    try { const snap = await db.collection(P.cmd).where("status", "==", "pending").get(); snap.docs.forEach((d) => { if (!S.seen.has(d.id)) enqueue(d); }); }
    catch (e) { o.onLog("rescan failed: " + msg(e)); }
  }
  async function recover() {                                  // commands left "running" by a page that closed
    if (S.stopped) return;
    try {
      const snap = await db.collection(P.cmd).where("status", "==", "running").get();
      for (const d of snap.docs) {
        if (S.running.has(d.id)) continue;
        const ref = db.doc(P.cmd + "/" + d.id);
        const lease = await ref.acquire({ holder: o.holder, ttlMs: 1000 }).catch(() => ({ acquired: false }));
        if (!lease.acquired) continue;                         // somebody is still working on it
        const has = await db.doc(P.res + "/" + d.id).get();
        if (!has.exists) await db.doc(P.res + "/" + d.id).set({ status: "interrupted", error: "The page was closed or reloaded while this command was running. It was not retried because it may have partly run.", results: [], t: o.now(), holder: o.holder });
        await ref.update({ status: "interrupted" });
        o.onLog(d.id + " marked interrupted");
      }
    } catch (e) { o.onLog("recover failed: " + msg(e)); }
  }
  async function start() {
    try { await db.doc(P.hello).set({ openedAt: o.now(), holder: o.holder, version: BRIDGE_VERSION, visibility: visState() }); }
    catch (e) { o.onState("off", "cannot write to your private channel (" + msg(e) + "). You may have view-only access."); return false; }
    o.onState("on", "waiting for commands");
    S.unsub = db.collection(P.cmd).where("status", "==", "pending").onSnapshot(
      (snap) => snap.docChanges().filter((c) => c.type === "added").forEach((c) => enqueue(c.doc)),
      (err) => o.onState("error", "subscription ended: " + msg(err)));
    recover(); setTimeout(recover, L.leaseMs + 2000);
    return true;
  }
  function pause(b) { S.paused = !!b; o.onState(S.paused ? "paused" : "on", S.paused ? "commands wait until you resume" : "waiting for commands"); }
  function stop() { S.stopped = true; if (S.unsub) { try { S.unsub(); } catch (_) {} } }

  return { start, stop, pause, validate, runStep: (s) => runStep(s, { cmdId: "manual", n: 1 }), paths: P, readLock, lockInfo: async () => lockInfo(await readLock()), holder: o.holder, version: BRIDGE_VERSION, limits: L };
}

/* Optional helper: turn the page (or one element) into a small JPEG data URL with html2canvas. */
function makeHtml2canvasSnapshot(defaultTarget, o2) {
  const cfg = Object.assign({ maxWidth: 900, maxChars: 180000 }, o2);
  return async function (target) {
    if (typeof html2canvas !== "function") return null;
    let c = await html2canvas(target || defaultTarget || document.body, { backgroundColor: getComputedStyle(document.body).backgroundColor, scale: 1, logging: false });
    if (c.width > cfg.maxWidth) {
      const out = document.createElement("canvas"); out.width = cfg.maxWidth; out.height = Math.round(c.height * cfg.maxWidth / c.width);
      out.getContext("2d").drawImage(c, 0, 0, out.width, out.height); c = out;
    }
    for (const q of [0.75, 0.55, 0.4, 0.3]) { const u = c.toDataURL("image/jpeg", q); if (u.length < cfg.maxChars) return u; }
    return null;
  };
}
/* ===================== END REMOTE CONTROL BRIDGE ===================== */
