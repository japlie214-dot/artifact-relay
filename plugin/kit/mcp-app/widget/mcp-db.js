// The database API that bridge.js expects, backed by MCP tool calls to the server's `relay_db` tool.
// Pure and DOM-free: give it a function that performs one relay_db call and returns the structured result.
//   doc(path)         .get() .set(data) .update(data) .delete() .acquire({ holder, ttlMs })
//   collection(path)  .where("status", "==", value)  .get()  .onSnapshot(next, error)
// There is no push channel from an MCP server to its widget, so onSnapshot polls.
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const idOf = (path) => path.slice(path.lastIndexOf("/") + 1);
const snapshotOf = (id, exists, data) => ({ id, exists, data: () => (exists ? clone(data) : undefined) });

export function createMcpDb(callRelay, { pollMs = 1000, maxPollErrors = 5 } = {}) {
  function doc(path) {
    const id = idOf(path);
    return {
      id, path,
      async get() { const r = await callRelay({ op: "get", path }); return snapshotOf(id, !!r.exists, r.data); },
      async set(data) { await callRelay({ op: "set", path, data }); },
      async update(data) { await callRelay({ op: "update", path, data }); },
      async delete() { await callRelay({ op: "delete", path }); },
      async acquire({ holder, ttlMs }) { return { acquired: !!(await callRelay({ op: "acquire", path, holder, ttlMs })).acquired }; },
    };
  }

  function collection(path) {
    const build = (filter) => {
      const list = async () => {
        if (!filter) throw new Error("This database only lists a collection filtered with where(\"status\", \"==\", value)");
        return (await callRelay({ op: "query", collection: path, field: filter.field, value: filter.value })).rows || [];
      };
      return {
        where(field, op, value) {
          if (op !== "==" && op !== "=") throw new Error("This database only supports ==");
          return build({ field, value });
        },
        async get() {
          const rows = await list();
          return { docs: rows.map((r) => snapshotOf(r.id, true, r.data)), size: rows.length, empty: rows.length === 0 };
        },
        onSnapshot(next, onError) {
          let previous = null, stopped = false, timer = null, errors = 0;
          const tick = async () => {
            if (stopped) return;
            try {
              const rows = await list();
              errors = 0;
              const current = new Map(rows.map((r) => [r.id, JSON.stringify(r.data)]));
              const changes = [];
              rows.forEach((r, i) => {
                if (!previous || !previous.has(r.id)) changes.push({ type: "added", doc: snapshotOf(r.id, true, r.data), oldIndex: -1, newIndex: i });
                else if (previous.get(r.id) !== current.get(r.id)) changes.push({ type: "modified", doc: snapshotOf(r.id, true, r.data), oldIndex: i, newIndex: i });
              });
              if (previous) previous.forEach((_, id) => { if (!current.has(id)) changes.push({ type: "removed", doc: snapshotOf(id, true, {}), oldIndex: 0, newIndex: -1 }); });
              const first = previous === null;
              previous = current;
              if (first || changes.length) {
                next({ docs: rows.map((r) => snapshotOf(r.id, true, r.data)), size: rows.length, empty: !rows.length, docChanges: () => changes });
              }
            } catch (e) {
              if (++errors >= maxPollErrors) { stopped = true; if (onError) onError(e); return; }   // a few failed calls in a row are tolerated
            }
            if (!stopped) timer = setTimeout(tick, pollMs);
          };
          tick();
          return () => { stopped = true; clearTimeout(timer); };
        },
      };
    };
    return build(null);
  }

  return { doc, collection };
}
