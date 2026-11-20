// Builds the one-file widget HTML for an MCP App from YOUR app markup and the kit's unchanged remote-control files.
// An MCP App resource must be a single HTML document, so everything is inlined:
//   html2canvas (screenshots) -> bridge.js -> your actions -> the MCP shim (+ MCP Apps client) -> your app scripts -> rc-wiring.js
// Your app HTML needs two markers:
//   <!-- RELAY_PANEL -->     where the status panel goes (rc-panel.html)
//   <!-- RELAY_SCRIPTS -->   at the end of <body>, where all the scripts go
// Give your app a wrapper with id="app" and an id on every control, as in the other kit starters.
//
//   import { build } from "esbuild";
//   await assembleWidget({ build, nodePaths: [new URL("./node_modules", import.meta.url).pathname], ... });
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(f, "utf8");
// Script text goes inside <script> tags, so a closing tag in it must be escaped. This is only valid inside JS strings,
// which is where minified libraries have them. The kit's own files are checked instead of changed.
const escapeClose = (s) => s.replace(/<\/(script)/gi, "<\\/$1");
const mustNotClose = (name, s) => { if (/<\/script/i.test(s)) throw new Error(name + " contains </script and cannot be inlined"); return s; };

export async function assembleWidget({
  build,                                   // esbuild's build function
  html2canvasFile,                         // path to html2canvas.min.js (node_modules/html2canvas/dist/html2canvas.min.js)
  appHtmlFile,                             // your app markup with the two markers
  outFile,                                 // where to write the widget HTML
  actionsFile,                             // optional: a script that defines window.REMOTE_ACTIONS
  appScriptFiles = [],                     // optional: your own classic scripts (they may use window.RELAY_MCP)
  nodePaths = [],                          // where esbuild finds @modelcontextprotocol/ext-apps
  rcDir = join(here, "..", "..", "multi-file", "rc"),
}) {
  const { outputFiles: [shim] } = await build({
    entryPoints: [join(here, "mcp-shim.js")], bundle: true, platform: "browser", format: "iife",
    minify: true, legalComments: "none", charset: "utf8", write: false, nodePaths,
  });
  const scripts = [
    escapeClose(read(html2canvasFile)),
    mustNotClose("bridge.js", read(join(rcDir, "bridge.js"))),
    ...(actionsFile ? [mustNotClose(actionsFile, read(actionsFile))] : []),
    escapeClose(shim.text),
    ...appScriptFiles.map((f) => mustNotClose(f, read(f))),
    mustNotClose("rc-wiring.js", read(join(rcDir, "rc-wiring.js"))),
  ].map((s) => "<script>\n" + s.trimEnd() + "\n</script>").join("\n");

  let html = read(appHtmlFile);
  for (const marker of ["<!-- RELAY_PANEL -->", "<!-- RELAY_SCRIPTS -->"]) {
    if (!html.includes(marker)) throw new Error(appHtmlFile + " needs the marker " + marker);
  }
  if (!/<\/head>/i.test(html)) throw new Error(appHtmlFile + " needs a </head>");
  html = html.replace(/<\/head>/i, () => "<style>\n" + read(join(rcDir, "rc-panel.css")).trimEnd() + "\n</style>\n</head>")
    .replace("<!-- RELAY_PANEL -->", () => read(join(rcDir, "rc-panel.html")).trimEnd())
    .replace("<!-- RELAY_SCRIPTS -->", () => scripts);
  writeFileSync(outFile, html);
  return html;
}
