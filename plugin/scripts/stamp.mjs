// Remote-control hook. One script for three events (read from stdin, as Claude Code sends it):
//   SessionStart / UserPromptSubmit : remember the session title (only these events carry it) in a small state file.
//   PreToolUse on ArtifactData      : add the real session id (and the subagent id) to every remote-control command
//                                     the model writes, replacing anything the model put in those fields.
// A command is recognised by its shape, not by trust: action set/update/batch, a collection path ending in
// "/rc/cmd", and a body with a "steps" list. Everything else passes through untouched.
// Optional environment: RC_STAMP_DECISION=allow|ask   (default: make no permission decision, normal prompts apply)
//                       RC_STAMP_ARTIFACTS=<url>,<url> (only stamp commands for these artifact urls)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const stateDir = join(process.env.CLAUDE_PLUGIN_DATA || join(tmpdir(), "rc-plugin"), "state");
const safe = (s) => String(s || "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
const out = (obj) => { process.stdout.write(JSON.stringify(obj)); process.exit(0); };

let input;
try { input = JSON.parse(readFileSync(0, "utf8")); } catch { process.exit(0); }   // never break the session on odd input
const event = input.hook_event_name;

if (event === "SessionStart" || event === "UserPromptSubmit") {
  if (input.session_id && input.session_title) {
    try { mkdirSync(stateDir, { recursive: true }); writeFileSync(join(stateDir, "title-" + safe(input.session_id) + ".txt"), String(input.session_title).slice(0, 80)); } catch {}
  }
  process.exit(0);
}
const isMcpRelay = /^mcp__.+__relay_send$/.test(input.tool_name || "");   // an MCP App server built on the kit (mcp-app/)
if (event !== "PreToolUse" || !input.tool_name || !(isMcpRelay || /ArtifactData$/.test(input.tool_name))) process.exit(0);

const ti = input.tool_input || {};
if (isMcpRelay) {                              // relay_send takes the command as its own arguments: stamp them directly
  if (!Array.isArray(ti.steps) || !input.session_id) process.exit(0);
  let t = "";
  try { const f = join(stateDir, "title-" + safe(input.session_id) + ".txt"); if (existsSync(f)) t = readFileSync(f, "utf8").trim(); } catch {}
  const r = { ...ti, session: String(input.session_id), stampedBy: "rc-plugin/0.2" };
  if (input.agent_id) r.subagent = { id: String(input.agent_id), type: String(input.agent_type || "") }; else delete r.subagent;
  if (t) r.sessionTitle = t.slice(0, 80); else delete r.sessionTitle;
  const o = { hookEventName: "PreToolUse", updatedInput: r, additionalContext: "relay_send stamped with session " + String(input.session_id).slice(0, 8) + (input.agent_id ? " (subagent " + String(input.agent_id).slice(0, 8) + ")" : "") + "." };
  const d = process.env.RC_STAMP_DECISION; if (d === "allow" || d === "ask") o.permissionDecision = d;
  out({ hookSpecificOutput: o });
}
const wanted = (process.env.RC_STAMP_ARTIFACTS || "").split(",").map((s) => s.trim()).filter(Boolean);
if (wanted.length && !wanted.some((u) => String(ti.url || "").includes(u))) process.exit(0);

let title = "";
try { const f = join(stateDir, "title-" + safe(input.session_id) + ".txt"); if (existsSync(f)) title = readFileSync(f, "utf8").trim(); } catch {}

const isCmdPath = (c) => typeof c === "string" && /(^|\/)rc\/cmd$/.test(c);
function stamp(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || !Array.isArray(body.steps)) return null;
  const b = { ...body };
  b.session = String(input.session_id || "");
  if (input.agent_id) b.subagent = { id: String(input.agent_id), type: String(input.agent_type || "") }; else delete b.subagent;
  if (title) b.sessionTitle = title; else delete b.sessionTitle;
  b.stampedBy = "rc-plugin/0.1";
  if (!b.session) return null;
  return b;
}
function stampFile(path) {                     // the model gave a file instead of inline data: stamp a copy and point at it
  try {
    const body = JSON.parse(readFileSync(path, "utf8")); const s = stamp(body); if (!s) return null;
    mkdirSync(join(stateDir, "stamped"), { recursive: true });
    const np = join(stateDir, "stamped", randomUUID() + ".json"); writeFileSync(np, JSON.stringify(s)); return np;
  } catch { return null; }
}
function stampEntry(e) {                       // one {collection, data|file_path} entry; returns a changed copy or null
  if (!e || !isCmdPath(e.collection) || e.op === "delete") return null;
  if (e.data !== undefined) { const s = stamp(e.data); return s ? { ...e, data: s } : null; }
  if (e.file_path) { const np = stampFile(e.file_path); return np ? { ...e, file_path: np } : null; }
  return null;
}

let updated = null;
if (ti.action === "set" || ti.action === "update") {
  updated = stampEntry({ collection: ti.collection, data: ti.data, file_path: ti.file_path, op: ti.action });
  if (updated) { const r = { ...ti }; if (updated.data !== undefined) r.data = updated.data; if (updated.file_path) r.file_path = updated.file_path; updated = r; }
} else if (ti.action === "batch" && Array.isArray(ti.writes)) {
  let changed = false;
  const writes = ti.writes.map((w) => { const s = stampEntry(w); if (s) { changed = true; return s; } return w; });
  if (changed) updated = { ...ti, writes };
}
if (!updated) process.exit(0);

const o = { hookEventName: "PreToolUse", updatedInput: updated, additionalContext: "Remote-control command stamped with session " + String(input.session_id).slice(0, 8) + (input.agent_id ? " (subagent " + String(input.agent_id).slice(0, 8) + ")" : "") + (title ? ", title \"" + title + "\"" : "") + "." };
const d = process.env.RC_STAMP_DECISION; if (d === "allow" || d === "ask") o.permissionDecision = d;
out({ hookSpecificOutput: o });
