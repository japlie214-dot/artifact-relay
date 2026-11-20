// Builds app.bundle.html, the single-file widget the server serves, from app.html plus the kit.
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { assembleWidget } from '../../kit/mcp-app/widget/assemble.mjs';

const here = (name) => fileURLToPath(new URL(name, import.meta.url));
await assembleWidget({
  build,
  nodePaths: [here('./node_modules')],                 // where esbuild finds @modelcontextprotocol/ext-apps
  html2canvasFile: here('./node_modules/html2canvas/dist/html2canvas.min.js'),
  appHtmlFile: here('./app.html'),
  actionsFile: here('./actions.js'),
  appScriptFiles: [here('./app-view.js')],
  outFile: here('./app.bundle.html'),
});
