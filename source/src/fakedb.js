/* A tiny in-memory stand-in for the Claude app database, used by the playground and the stress tests.
   It follows the same rules the real db enforces where they matter for the bridge:
     - document paths have an even number of segments, collection paths an odd number
     - update() needs an existing document
     - documents are capped at 256 KiB
     - acquire() is a lease: set-if-not-busy, renewable only by the same holder
   It is NOT the real db. The published template is also tested against the real db. */
function createFakeDb(opts) {
  opts = opts || {};
  const store = new Map();   // path -> { data, version }
  const leases = new Map();  // path -> { holder, expires }
  const subs = new Set();
  const listeners = new Set();
  const delay = opts.delayMs || 0;
  const now = opts.now || (() => Date.now());
  const faults = { writeError: null };
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const err = (code, message) => Object.assign(new Error(message), { code });
  const idOf = (p) => p.slice(p.lastIndexOf("/") + 1);
  const parentOf = (p) => p.slice(0, p.lastIndexOf("/"));
  const depth = (p) => p.split("/").length;
  const autoId = () => "a" + Math.random().toString(36).slice(2, 10);
  const wait = () => (delay ? new Promise((r) => setTimeout(r, delay)) : Promise.resolve());
  function check(p, isDoc) {
    if (typeof p !== "string" || !p || p[0] === "/" || p[p.length - 1] === "/") throw new TypeError("Bad path: " + p);
    const even = depth(p) % 2 === 0;
    if (isDoc !== even) throw new TypeError((isDoc ? "A document" : "A collection") + " path needs an " + (isDoc ? "even" : "odd") + " number of segments: " + p);
  }
  function merge(a, b) {
    const out = Object.assign({}, a);
    for (const k of Object.keys(b)) {
      const x = out[k], y = b[k];
      if (y && typeof y === "object" && !Array.isArray(y) && x && typeof x === "object" && !Array.isArray(x)) out[k] = merge(x, y);
      else out[k] = clone(y);
    }
    return out;
  }
  function changed() { listeners.forEach((h) => { try { h(); } catch (_) {} }); subs.forEach((s) => s.fire()); }
  function write(path, fn) {
    if (faults.writeError) throw faults.writeError;
    const old = store.get(path), data = fn(old && old.data);
    if (JSON.stringify(data).length > 262144) throw err("invalid_argument", "A document is limited to 256 KiB");
    store.set(path, { data, version: (old ? old.version : 0) + 1 });
    changed();
  }
  function docSnap(path) {
    const e = store.get(path);
    return { id: idOf(path), exists: !!e, data: () => (e ? clone(e.data) : undefined), metadata: { fromCache: false, hasPendingWrites: false } };
  }
  function matches(data, f) {
    const x = data[f[0]], v = f[2];
    switch (f[1]) {
      case "==": case "=": return x === v;
      case "!=": return x !== v;
      case "<": return x < v; case "<=": return x <= v; case ">": return x > v; case ">=": return x >= v;
      case "in": return Array.isArray(v) && v.indexOf(x) >= 0;
      case "not-in": return Array.isArray(v) && v.indexOf(x) < 0;
      case "array-contains": return Array.isArray(x) && x.indexOf(v) >= 0;
      default: throw err("invalid_argument", "Unknown operator " + f[1]);
    }
  }
  function runQuery(path, filters, order, lim) {
    let rows = [...store.entries()].filter(([p]) => parentOf(p) === path && depth(p) === depth(path) + 1 && filters.every((f) => matches(store.get(p).data, f)));
    if (order) rows.sort((a, b) => { const x = a[1].data[order.f], y = b[1].data[order.f]; return (x > y ? 1 : x < y ? -1 : 0) * (order.d === "desc" ? -1 : 1); });
    else rows.sort((a, b) => (a[0] < b[0] ? -1 : 1));
    if (lim) rows = rows.slice(0, lim);
    return rows.map((r) => r[0]);
  }
  function buildSnap(paths, prev) {
    const cur = new Map(paths.map((p) => [p, JSON.stringify(store.get(p).data)]));
    const changes = [];
    paths.forEach((p, i) => { if (!prev || !prev.has(p)) changes.push({ type: "added", doc: docSnap(p), oldIndex: -1, newIndex: i }); else if (prev.get(p) !== cur.get(p)) changes.push({ type: "modified", doc: docSnap(p), oldIndex: i, newIndex: i }); });
    if (prev) prev.forEach((_, p) => { if (!cur.has(p)) changes.push({ type: "removed", doc: Object.assign(docSnap(p), { exists: true }), oldIndex: 0, newIndex: -1 }); });
    return { cur, snap: { docs: paths.map(docSnap), size: paths.length, empty: !paths.length, metadata: { fromCache: false, hasPendingWrites: false }, docChanges: () => changes } };
  }
  function docRef(path) {
    check(path, true);
    return {
      id: idOf(path), path,
      async get() { await wait(); return docSnap(path); },
      async set(data) { await wait(); write(path, () => clone(data)); },
      async update(data) { await wait(); if (!store.has(path)) throw err("invalid_argument", "update needs an existing document: " + path); write(path, (old) => merge(old, data)); },
      async delete() { await wait(); if (faults.writeError) throw faults.writeError; store.delete(path); changed(); },
      async acquire(o) {
        await wait();
        if (faults.writeError) throw faults.writeError;
        o = o || {};
        const ttl = Math.min(Math.max(o.ttlMs || 30000, 1000), 600000), l = leases.get(path), t = now();
        if (l && l.expires > t && l.holder !== o.holder) return { acquired: false, expiresAt: new Date(l.expires).toISOString() };
        leases.set(path, { holder: o.holder, expires: t + ttl });
        if (o.data) write(path, (old) => merge(old || {}, o.data));
        const e = store.get(path);
        return { acquired: true, version: e ? e.version : undefined, expiresAt: new Date(t + ttl).toISOString(), holder: o.holder };
      },
      collection(sub) { return colRef(path + "/" + sub); },
      onSnapshot(next, error) {
        let last = null, dead = false;
        const sub = { fire() { if (dead) return; const s = JSON.stringify(store.has(path) ? store.get(path).data : null); if (s === last) return; last = s; setTimeout(() => { if (!dead) next(docSnap(path)); }, delay); } };
        subs.add(sub); setTimeout(() => sub.fire(), 0);
        return () => { dead = true; subs.delete(sub); };
      },
    };
  }
  function colRef(path) {
    check(path, false);
    const q = (filters, order, lim) => ({
      path,
      where(f, op, v) { return q(filters.concat([[f, op, v]]), order, lim); },
      orderBy(f, d) { return q(filters, { f, d: d || "asc" }, lim); },
      limit(n) { return q(filters, order, n); },
      async get() { await wait(); return buildSnap(runQuery(path, filters, order, lim), null).snap; },
      onSnapshot(next, error) {
        let prev = null, dead = false;
        const sub = { fire() {
          if (dead) return;
          const b = buildSnap(runQuery(path, filters, order, lim), prev);
          if (prev && !b.snap.docChanges().length) return;
          prev = b.cur;
          setTimeout(() => { if (!dead) next(b.snap); }, delay);
        } };
        subs.add(sub); setTimeout(() => sub.fire(), 0);
        return () => { dead = true; subs.delete(sub); };
      },
      doc(id) { return docRef(path + "/" + (id || autoId())); },
      async add(data) { const r = docRef(path + "/" + autoId()); await r.set(data); return r; },
    });
    return q([], null, null);
  }
  return {
    doc: docRef, collection: colRef, faults,
    onChange(h) { listeners.add(h); return () => listeners.delete(h); },
    dump() { const o = {}; store.forEach((e, p) => { o[p] = clone(e.data); }); return o; },
  };
}
