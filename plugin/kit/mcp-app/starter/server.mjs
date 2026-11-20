// A minimal MCP App with Artifact Relay. Replace the greeter with your own tools and widget.
//   app_open   (agent)  shows the widget in the host
//   app_greet  (widget) what the Greet button calls; hidden from the agent
//   relay_*             added by registerRelay: relay_send / relay_result for the agent, relay_db for the widget
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { registerRelay } from "../server/relay-mcp.mjs";

const server = new McpServer({ name: "relay-starter", version: "0.1.0" });

// The widget URI carries a hash of its bundle. Hosts cache widget HTML by URI and only render URIs the server
// advertised when the host started it, so a rebuilt widget gets a new URI and needs a host restart (see the README).
const bundle = await readFile(new URL("./app.bundle.html", import.meta.url), "utf8");
const uri = `ui://relay-starter/app-${createHash("sha256").update(bundle).digest("hex").slice(0, 8)}`;

registerAppTool(server, "app_open", {
  title: "Open the app",
  description: "Open the Relay starter widget. Open it before using relay_send, which operates the open widget.",
  inputSchema: {},
  _meta: { ui: { resourceUri: uri, visibility: ["model"] } },
}, async () => ({ content: [{ type: "text", text: "The widget is open." }] }));

registerAppTool(server, "app_greet", {
  title: "Greet",
  description: "Greet someone by name.",
  inputSchema: z.strictObject({ name: z.string().trim().min(1).max(60) }),
  _meta: { ui: { resourceUri: uri, visibility: ["app"] } },
}, async ({ name }) => ({
  content: [{ type: "text", text: `Hello, ${name}!` }],
  structuredContent: { greeting: `Hello, ${name}!` },
}));

registerAppResource(server, "Relay starter", uri, {}, async () => ({
  contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: bundle }],
}));

registerRelay(server, { z, registerAppTool, uri });

await server.connect(new StdioServerTransport());
