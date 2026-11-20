// Builds app.bundle.html, the single-file widget the server serves. Run it again after you change app.html,
// app-view.js or actions.js, then restart the server and the host (see ../README.md, "Changing the widget").
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { assembleWidget } from "../widget/assemble.mjs";

const here = (name) => fileURLToPath(new URL(name, import.meta.url));
await assembleWidget({
  build,
  nodePaths: [here("./node_modules")],                 // where esbuild finds @modelcontextprotocol/ext-apps
  html2canvasFile: here("./node_modules/html2canvas/dist/html2canvas.min.js"),
  appHtmlFile: here("./app.html"),
  actionsFile: here("./actions.js"),
  appScriptFiles: [here("./app-view.js")],
  outFile: here("./app.bundle.html"),
});
