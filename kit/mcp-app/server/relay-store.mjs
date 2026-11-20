// A small in-memory document store for the Relay channel of an MCP App.
// It offers what bridge.js needs from the Claude app database and nothing more:
//   documents (get, set, update, delete), leases (acquire), and listing one collection filtered by a field.
// It lives only in the MCP server process. Nothing is written to disk and nothing listens on the network.
// Rules it keeps, because the bridge relies on them:
//   - update() needs an existing document and merges objects deeply
//   - a document is limited to 256 KiB of JSON
//   - acquire() is a lease: it succeeds if free, expired, or already held by the same holder
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function merge(a, b) {
  const out = { ...a };
  for (const [k, y] of Object.entries(b)) out[k] = isObject(y) && isObject(out[k]) ? merge(out[k], y) : clone(y);
  return out;
}

export class StoreError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export function createStore({ now = Date.now, maxDocs = 200, maxDocChars = 262_144 } = {}) {
  const docs = new Map();     // path -> { data, seq }
  const leases = new Map();   // path -> { holder, expires }
  let seq = 0;
  const idOf = (path) => path.slice(path.lastIndexOf("/") + 1);
  const parentOf = (path) => path.slice(0, path.lastIndexOf("/"));

  function put(path, data) {
    if (JSON.stringify(data).length > maxDocChars) throw new StoreError("invalid_argument", "A document is limited to 256 KiB");
    const old = docs.get(path);
    docs.set(path, { data: clone(data), seq: old ? old.seq : ++seq });
    if (docs.size > maxDocs) {                       // keep memory bounded: drop the oldest, never the one just written
      for (const [p] of [...docs].sort((a, b) => a[1].seq - b[1].seq)) {
        if (docs.size <= maxDocs) break;
        if (p !== path && !p.includes("/meta/")) docs.delete(p);
      }
    }
  }

  return {
    get(path) {
      const e = docs.get(path);
      return { exists: !!e, data: e ? clone(e.data) : undefined };
    },
    set(path, data) { put(path, data); },
    update(path, patch) {
      const e = docs.get(path);
      if (!e) throw new StoreError("not_found", "No document at " + path);
      put(path, merge(e.data, patch));
    },
    delete(path) { docs.delete(path); leases.delete(path); },
    acquire(path, holder, ttlMs) {
      const l = leases.get(path);
      if (l && l.expires > now() && l.holder !== holder) return { acquired: false };
      leases.set(path, { holder, expires: now() + ttlMs });
      return { acquired: true };
    },
    // Direct children of `collection` whose `field` equals `value`, oldest first.
    query(collection, field, value) {
      return [...docs]
        .filter(([p, e]) => parentOf(p) === collection && e.data[field] === value)
        .sort((a, b) => a[1].seq - b[1].seq)
        .map(([p, e]) => ({ id: idOf(p), data: clone(e.data) }));
    },
    size: () => docs.size,
  };
}
