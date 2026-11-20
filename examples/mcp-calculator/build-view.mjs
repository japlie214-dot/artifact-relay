import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const { outputFiles: [bundle] } = await build({
  entryPoints: [fileURLToPath(new URL('./calculator-view.mjs', import.meta.url))],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  minify: true,
  legalComments: 'inline',
  charset: 'utf8',
  write: false,
});
const template = await readFile(new URL('./calculator.html', import.meta.url), 'utf8');
const html = template.replace('<!-- CALCULATOR_SCRIPT -->', () =>
  `<script>${bundle.text.replace(/<\/script/gi, '<\\/script')}</script>`);
await writeFile(new URL('./calculator.bundle.html', import.meta.url), html);
