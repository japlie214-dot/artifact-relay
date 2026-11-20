// Builds every deliverable from the shared sources in ./src, so every page and every kit file uses the SAME bridge.
//   template.html                the demo app with the remote control (published as an artifact)
//   learn.html                   the interactive guide
//   best-practices.html          the dos, don'ts, checklist and pitfalls page
//   tests/stress-tests.html      the test battery as a stand-alone page
//   kit/...                      starter files, the separate remote-control files, publish settings, prompts, checklist
// Usage: node source/build.mjs [outDir]      (default outDir is the folder above this script)
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.argv[2] || join(here, ".."));
const src = (n) => readFileSync(join(here, "src", n), "utf8");

const LS = new RegExp(String.fromCharCode(0x2028), "g"), PS = new RegExp(String.fromCharCode(0x2029), "g");
const asJson = (s) => JSON.stringify(s).replace(/<\/(script)/gi, "<\\/$1").replace(LS, "\\u2028").replace(PS, "\\u2029");
const noClose = (name, s) => { if (/<\/script/i.test(s)) throw new Error(name + " contains </script and cannot be inlined"); return s; };
const indent = (s, n) => s.trimEnd().split("\n").map((l) => (l ? " ".repeat(n) + l : l)).join("\n");

const parts = {
  "/*__BRIDGE__*/": noClose("bridge.js", src("bridge.js")),
  "/*__FAKEDB__*/": noClose("fakedb.js", src("fakedb.js")),
  "/*__DEMO_JS__*/": noClose("demo-app.js", src("demo-app.js")),
  "/*__TESTS__*/": noClose("tests.js", src("tests.js")),
  "/*__PITFALLS__*/": noClose("pitfalls.js", src("pitfalls.js")),
  "/*__RC_WIRING__*/": noClose("rc-wiring.js", src("rc-wiring.js")),
  "/*__RC_CSS__*/": src("rc-panel.css").trimEnd(),
  "<!--__RC_PANEL__-->": indent(src("rc-panel.html"), 2),
  "/*__DEMO_HTML_JSON__*/\"\"": asJson(src("demo-app.html")),
  "<!--__DEMO_APP_HTML__-->": indent(src("demo-app.html"), 4),
  "/*__BRIDGE_JSON__*/\"\"": asJson(src("bridge.js")),
  "/*__TEMPLATE_JSON__*/\"\"": null,   // filled after the template is built
  "/*__KIT_JSON__*/{}": null,          // filled after the kit is built
};
function fill(html) {
  for (const [k, v] of Object.entries(parts)) if (v !== null) html = html.split(k).join(v);   // split/join avoids "$" replacement patterns
  return html;
}
const written = [];
function write(rel, content) { const p = join(out, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, content); written.push(rel); return content; }

// 1. template and tests
const template = write("template.html", fill(src("template.src.html")));
write("tests/stress-tests.html", fill(src("tests.src.html")));

// 2. kit
const kit = {};
const put = (rel, content) => { kit[rel] = write("kit/" + rel, content); };
put("starter.html", fill(src("starter.src.html")));
put("multi-file/index.html", fill(src("starter-multi.src.html")));
put("multi-file/rc/bridge.js", src("bridge.js"));
put("multi-file/rc/rc-wiring.js", src("rc-wiring.js"));
put("multi-file/rc/rc-panel.css", src("rc-panel.css"));
put("multi-file/rc/rc-panel.html", src("rc-panel.html"));
for (const f of ["actions.example.js", "prompts.md", "CHECKLIST.md", "README.md", "capabilities.json", "capabilities.with-connector.json"]) {
  const rel = f.startsWith("capabilities") ? "publish/" + f : f;
  put(rel, readFileSync(join(here, "src", "kit", f), "utf8"));
}

// 3. pages that embed the template and the kit
// style gallery + the style files
const styleDir = join(here, "src", "kit", "styles");
if (existsSync(styleDir)) {
  const styles = {};
  for (const f of readdirSync(styleDir).filter((n) => n.endsWith(".css")).sort()) { const css = readFileSync(join(styleDir, f), "utf8"); styles[f.replace(/\.css$/, "")] = css; put("styles/" + f, css); }
  parts["/*__STYLES_JSON__*/{}"] = asJson(styles);
  parts["/*__PANEL_JSON__*/\"\""] = asJson(src("rc-panel.html"));
  put("panel-styles.html", fill(src("panel-styles.src.html")));
}
parts["/*__TEMPLATE_JSON__*/\"\""] = asJson(template);
parts["/*__KIT_JSON__*/{}"] = asJson(kit);
if (existsSync(join(here, "src", "best-practices.src.html"))) write("best-practices.html", fill(src("best-practices.src.html")));
if (existsSync(join(here, "src", "learn.src.html"))) write("learn.html", fill(src("learn.src.html")));

// 4. the plugin: its own files, plus a copy of the kit and the docs so the plugin is self-contained
const pluginSrc = join(here, "src", "plugin");
if (existsSync(pluginSrc)) {
  const copyDir = (from, rel) => { for (const e of readdirSync(from, { withFileTypes: true })) { const f = join(from, e.name), r = rel + "/" + e.name; if (e.isDirectory()) copyDir(f, r); else write(r, readFileSync(f, "utf8")); } };
  copyDir(pluginSrc, "plugin");
  write(".claude-plugin/marketplace.json", readFileSync(join(here, "src", "plugin-market", "marketplace.json"), "utf8"));
  for (const rel of Object.keys(kit)) write("plugin/kit/" + rel, kit[rel]);
  for (const f of ["best-practices.html", "learn.html"]) write("plugin/docs/" + f, readFileSync(join(out, f), "utf8"));
  write("plugin/kit/decode-snap.mjs", readFileSync(join(here, "src", "decode-snap.mjs"), "utf8"));
}
console.log("Built " + written.length + " files in " + out + ":\n  " + written.join("\n  "));
