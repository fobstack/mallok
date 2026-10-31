/**
 * Asserts the admin's first-load budget (docs/ADMIN.md §13).
 *
 * Only what `index.html` references is counted: that is what a browser must
 * download before the admin is usable. Everything the editor pulls in — the
 * rendering pipeline and CodeMirror — is behind a dynamic import and is
 * reported separately so a regression is visible without failing the build.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const APP_DIR = 'dist/assets/_mallok/app';
/** First-load budget in bytes, gzipped. */
const BUDGET = 150 * 1024;

const html = await readFile(join(APP_DIR, 'index.html'), 'utf8');
// Every script and stylesheet the page asks for before it runs: the entry,
// its CSS, and the shared chunks Vite splits out and lists as
// `<link rel="modulepreload">`. Those are downloaded with the first load as
// surely as the entry is; counting only `<script src>` would let a split move
// bytes out of the number without moving them out of the download.
const referenced = [
  ...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g),
].map((match) => (match[1] ?? '').replace('/_mallok/app/', ''));

let firstLoad = 0;
const rows = [];
for (const file of referenced) {
  const bytes = gzipSync(await readFile(join(APP_DIR, file))).length;
  firstLoad += bytes;
  rows.push([file, bytes]);
}

let lazy = 0;
for (const file of await readdir(join(APP_DIR, 'assets'))) {
  const relative = `assets/${file}`;
  if (referenced.includes(relative)) {
    continue;
  }
  lazy += gzipSync(await readFile(join(APP_DIR, relative))).length;
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;
for (const [file, bytes] of rows) {
  console.log(`  ${file}  ${kb(bytes)} gzip`);
}
console.log(`admin first load: ${kb(firstLoad)} gzip (budget ${kb(BUDGET)})`);
console.log(`  loaded on demand: ${kb(lazy)} gzip`);

if (firstLoad > BUDGET) {
  console.error(
    `\nThe admin's first load is over budget by ${kb(firstLoad - BUDGET)}. ` +
      'Move the new code behind a dynamic import, or raise the budget in ' +
      'docs/ADMIN.md §13 with a reason.',
  );
  process.exit(1);
}
