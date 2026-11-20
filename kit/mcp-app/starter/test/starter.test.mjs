import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const serverFile = fileURLToPath(new URL("../server.mjs", import.meta.url));

test("starter server: tools, widget resource, app tool, and relay refusal without a widget", async () => {
  const client = new Client({ name: "starter-test", version: "0.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverFile] }));
  try {
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    for (const n of ["app_greet", "app_open", "relay_db", "relay_result", "relay_send"]) assert.ok(names.includes(n), `missing ${n}`);

    const open = (await client.listTools()).tools.find((t) => t.name === "app_open");
    const uri = open._meta.ui.resourceUri;
    const res = await client.readResource({ uri });
    const html = res.contents[0].text;
    for (const marker of ['id="app"', "createBridge", "REMOTE_ACTIONS", "RELAY_MCP"]) assert.ok(html.includes(marker), `widget lacks ${marker}`);

    const greet = await client.callTool({ name: "app_greet", arguments: { name: "Ada" } });
    assert.equal(greet.structuredContent.greeting, "Hello, Ada!");

    const send = await client.callTool({ name: "relay_send", arguments: { agent: "test", steps: [{ action: "ping" }] } });
    assert.equal(send.isError, true, "relay_send must refuse while no widget is connected");
  } finally {
    await client.close();
  }
});
