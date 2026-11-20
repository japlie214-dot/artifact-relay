// Browser entry for an MCP App widget. Bundled with the MCP Apps client (see assemble.mjs).
// It connects to the host and then offers `window.claude.use("db")` and `window.claude.use("user")`,
// which is all the unchanged rc-wiring.js and bridge.js ask for. Load it BEFORE rc-wiring.js.
// Your own app code can use  window.RELAY_MCP.callTool(name, args)  to call its server's tools.
import { App } from "@modelcontextprotocol/ext-apps";
import { createMcpDb } from "./mcp-db.js";

const options = window.RELAY_MCP_OPTIONS || {};
const app = new App({ name: options.name || "Relay widget", version: options.version || "1.0.0" });
const connected = app.connect();
connected.catch(() => {});                          // the db calls below report a failed connection themselves

async function callTool(name, args = {}) {
  await connected;
  return app.callServerTool({ name, arguments: args }, { timeout: options.timeoutMs || 10_000 });
}
async function callRelay(args) {
  const r = await callTool("relay_db", args);
  const d = r.structuredContent;
  if (r.isError || !d) {
    const text = r.content && r.content.find((c) => c.type === "text");
    throw Object.assign(new Error((d && d.message) || (text && text.text) || "The Relay call failed"), { code: d && d.code });
  }
  return d;
}

const db = createMcpDb(callRelay, { pollMs: options.pollMs || 1000 });
window.RELAY_MCP = { app, connected, callTool };
window.claude = {
  use: async (name) => {
    if (name === "db") return db;
    if (name === "user") return { id: async () => "local" };
    throw new Error('The "' + name + '" capability is not available in an MCP widget');
  },
};
