// Artifact Relay for MCP Apps: the server half.
// The widget runs the unchanged bridge.js. This module gives it the database it expects and gives the agent two tools:
//   relay_db      (app only)   the widget's database calls: get / set / update / delete / acquire / query
//   relay_send    (agent)      send a list of steps to the open widget and wait for the result, including screenshots
//   relay_result  (agent)      wait for or fetch the result of an earlier command
// `z` (zod) and `registerAppTool` are passed in so this file has no imports to resolve from your project.
//
//   import { registerRelay } from "./kit/mcp-app/server/relay-mcp.mjs";
//   registerRelay(server, { z, registerAppTool, uri });
import { randomUUID } from "node:crypto";
import { createStore, StoreError } from "./relay-store.mjs";

// The widget's user id is "local": an MCP App has one local user, so bridge.js and rc-wiring.js run unchanged.
export const RELAY_BASE = "data/users/local/rc";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function registerRelay(server, {
  z, registerAppTool, uri, now = Date.now, store = createStore({ now }), basePath = RELAY_BASE,
  defaultWaitMs = 20_000, maxWaitMs = 30_000, connectedWithinMs = 5_000,
  trace = () => {},                                // optional: trace(event, detail) for diagnostics. Never given document contents.
}) {
  const esc = basePath.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const allowedPath = new RegExp("^" + esc + "/(?:(?:cmd|res|snap)/[A-Za-z0-9_-]{1,64}|meta/(?:hello|lock))$");
  const cmdCollection = basePath + "/cmd";
  let watchedAt = -Infinity;                       // the last time a widget asked for pending commands
  const connected = () => now() - watchedAt < connectedWithinMs;
  async function until(test, ms) {
    const end = Date.now() + ms;
    while (!test()) { if (Date.now() >= end) return false; await pause(150); }
    return true;
  }
  const fail = (message, data) => ({ isError: true, content: [{ type: "text", text: message }], ...(data && { structuredContent: data }) });
  const need = (a, ...keys) => { for (const k of keys) if (a[k] === undefined) throw new StoreError("invalid_argument", `"${k}" is required for ${a.op}`); };

  // ---- the widget's database (hidden from the agent) ----
  registerAppTool(server, "relay_db", {
    description: "Relay database access for the widget. Not for the agent.",
    inputSchema: z.strictObject({
      op: z.enum(["get", "set", "update", "delete", "acquire", "query"]),
      path: z.string().refine((p) => allowedPath.test(p), "Not a Relay path").optional(),
      data: z.record(z.string(), z.unknown()).optional(),
      holder: z.string().min(1).max(80).optional(),
      ttlMs: z.number().int().min(100).max(300_000).optional(),
      collection: z.literal(cmdCollection).optional(),
      field: z.literal("status").optional(),
      value: z.string().max(40).optional(),
    }),
    _meta: { ui: { resourceUri: uri, visibility: ["app"] } },
  }, async (a) => {
    trace("db", a.op + " " + (a.path ?? a.collection ?? ""));
    try {
      let out;
      switch (a.op) {
        case "get": need(a, "path"); out = store.get(a.path); break;
        case "set": need(a, "path", "data"); store.set(a.path, a.data); out = {}; break;
        case "update": need(a, "path", "data"); store.update(a.path, a.data); out = {}; break;
        case "delete": need(a, "path"); store.delete(a.path); out = {}; break;
        case "acquire": need(a, "path", "holder", "ttlMs"); out = store.acquire(a.path, a.holder, a.ttlMs); break;
        case "query": need(a, "collection", "field", "value"); watchedAt = now(); out = { rows: store.query(a.collection, a.field, a.value) }; break;
      }
      return { content: [{ type: "text", text: "ok" }], structuredContent: out };
    } catch (e) {
      return fail(String(e.message ?? e), { code: e.code ?? "error", message: String(e.message ?? e) });
    }
  });

  // ---- results for the agent: text, plus any screenshots as images it can look at ----
  async function collect(id, waitMs) {
    const resPath = `${basePath}/res/${id}`;
    await until(() => store.get(resPath).exists, waitMs);
    const res = store.get(resPath);
    trace("collect", `id=${id} ${res.exists ? "status=" + res.data.status : "not finished"}`);
    if (!res.exists) {
      const status = store.get(`${basePath}/cmd/${id}`).data?.status ?? "unknown";
      return { content: [{ type: "text", text: `Command ${id} is ${status}; it has not finished yet. Call relay_result with this id to wait longer.` }], structuredContent: { id, status, finished: false } };
    }
    const r = res.data;
    const results = Array.isArray(r.results) ? r.results : [];
    // Hosts show the agent structuredContent when a tool returns it, and may drop the text block: so the results go in both.
    // Over the limit, step details are dropped (each step keeps ok / error) rather than cutting JSON in half.
    let shown = results;
    let json = JSON.stringify({ id, status: r.status, error: r.error ?? null, results: shown });
    if (json.length > 100_000) {
      shown = results.map((s) => ({ step: s.step, action: s.action, ok: s.ok, error: s.error, snap: s.snap }));
      json = JSON.stringify({ id, status: r.status, error: r.error ?? null, results: shown, note: "Step details were dropped because the result was too large. Ask for less, for example read with a selector." });
    }
    const content = [{ type: "text", text: json }];
    for (const step of results) {
      if (typeof step.snap !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(step.snap)) continue;
      const url = store.get(`${basePath}/snap/${step.snap}`).data?.jpeg;
      const m = typeof url === "string" && /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
      if (m) content.push({ type: "image", data: m[1], mimeType: "image/jpeg" });
    }
    return { content, structuredContent: { id, status: r.status, finished: true, error: r.error ?? null, results: shown }, ...(r.status !== "done" && { isError: true }) };
  }

  const wait = z.number().int().min(0).max(maxWaitMs).optional();
  server.registerTool("relay_send", {
    description: "Send steps to the open Relay widget and wait for the result. Steps are plain objects from a fixed list: "
      + "ping, inspect, read, fill, click, check, select, press, wait, wait_for, text, call, screenshot. For example "
      + '[{"action":"ping"},{"action":"fill","selector":"#x","value":"1"},{"action":"click","selector":"#go"},{"action":"screenshot"}]. '
      + "`agent` is a short label for who you are. Screenshots come back as images. Waits up to waitMs (default 20000); "
      + "if it has not finished, call relay_result with the returned id. A widget must be open: use the app's open tool first.",
    inputSchema: z.strictObject({
      steps: z.array(z.record(z.string(), z.unknown())).min(1).max(40),
      agent: z.string().min(1).max(60),
      release: z.boolean().optional(),
      takeover: z.boolean().optional(),
      expires: z.number().int().optional(),
      session: z.string().max(120).optional(),
      sessionTitle: z.string().max(120).optional(),
      subagent: z.strictObject({ id: z.string().max(120).optional(), type: z.string().max(120).optional() }).optional(),
      stampedBy: z.string().max(60).optional(),
      waitMs: wait,
    }),
  }, async ({ waitMs, ...command }) => {
    if (!(await until(connected, 3_000))) { trace("send", "refused: no widget connected"); return fail("No Relay widget is connected. Open the app's widget first, wait a moment, and try again."); }
    const id = randomUUID().replace(/-/g, "").slice(0, 20);
    store.set(`${basePath}/cmd/${id}`, { ...command, status: "pending", createdAt: now() });
    trace("send", `id=${id} steps=${command.steps.length} agent=${command.agent}`);
    return collect(id, waitMs ?? defaultWaitMs);
  });

  server.registerTool("relay_result", {
    description: "Wait for, or fetch, the result of a command sent with relay_send. Waits up to waitMs (default 20000).",
    inputSchema: z.strictObject({ id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), waitMs: wait }),
  }, async ({ id, waitMs }) => {
    if (!store.get(`${basePath}/cmd/${id}`).exists && !store.get(`${basePath}/res/${id}`).exists) return fail(`No command with id ${id}.`);
    return collect(id, waitMs ?? defaultWaitMs);
  });

  return { store, basePath, connected };
}
