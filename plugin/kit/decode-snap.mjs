// Turns a screenshot document exported from the app's db into a JPEG you (or Claude) can open.
// Usage: node decode-snap.mjs <path-to-exported-snap.json> [output.jpg]
// The export comes from ArtifactData `get` with `out_dir` (the JSON holds {jpeg: "data:image/jpeg;base64,..."}).
import { readFileSync, writeFileSync } from "node:fs";

const [input, output] = process.argv.slice(2);
if (!input) { console.error("Usage: node decode-snap.mjs <snap.json> [out.jpg]"); process.exit(1); }

const doc = JSON.parse(readFileSync(input, "utf8"));
const dataUrl = doc.jpeg ?? doc.data?.jpeg;
if (!dataUrl || !dataUrl.startsWith("data:image/")) { console.error("No jpeg data URL found in that file."); process.exit(1); }

const out = output ?? input.replace(/\.json$/i, "") + ".jpg";
writeFileSync(out, Buffer.from(dataUrl.split(",")[1], "base64"));
console.log("Wrote " + out);
