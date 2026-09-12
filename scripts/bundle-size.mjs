/**
 * Reports the Worker bundle's size against two different things.
 *
 * **Cloudflare's limit is 64 MiB uncompressed**, on Free and Paid alike, and
 * the platform documentation is explicit that there is no compressed size
 * limit — the gzip figure a deploy prints is for information. Checked against
 * developers.cloudflare.com/workers/platform/limits on 2026-09-12.
 *
 * Everything in this repository used to say "3 MB gzip, the Free plan's hard
 * limit", and reported a percentage of it as though it were a quota. It was
 * neither the right number nor the right unit, and calling an internal target
 * a platform limit is how a budget stops being questioned.
 *
 * **3 MiB gzip stays, as Mallok's own budget.** It is a deliberate ceiling on
 * what may enter the render path — the Markdown pipeline, the sanitiser, the
 * template engine and the official plugins, together — because a Worker that
 * has room for 64 MiB of dependencies is a Worker whose cold starts and CPU
 * time nobody is watching. It is ours, it is reviewable, and it is not a
 * Cloudflare rule.
 *
 * Run after `pnpm build`, which writes dist/worker/index.js.
 */
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

/** Cloudflare's actual limit: uncompressed, and the same on both plans. */
const PLATFORM_LIMIT = 64 * 1024 * 1024;

/** Mallok's own ceiling on what enters the render path. Not a platform rule. */
const MALLOK_BUDGET = 3 * 1024 * 1024;

const source = await readFile('dist/worker/index.js');
const gzipped = gzipSync(source, { level: 9 }).length;
const percent = (value, limit) => `${((value / limit) * 100).toFixed(1)}%`;
const kib = (value) => `${(value / 1024).toFixed(1)} KiB`;

console.log(`worker bundle: ${kib(source.length)} raw, ${kib(gzipped)} gzip`);
console.log(
  `  Cloudflare limit (64 MiB uncompressed, Free and Paid): ${percent(
    source.length,
    PLATFORM_LIMIT,
  )}`,
);
console.log(
  `  Mallok's own render-path budget (3 MiB gzip): ${percent(
    gzipped,
    MALLOK_BUDGET,
  )}`,
);

let failed = false;
if (source.length > PLATFORM_LIMIT) {
  console.error(
    `Uncompressed bundle is ${kib(source.length)}; Cloudflare refuses anything over 64 MiB.`,
  );
  failed = true;
}
if (gzipped > MALLOK_BUDGET) {
  console.error(
    `Gzipped bundle is ${kib(gzipped)}, over Mallok's own 3 MiB budget. ` +
      'This is not a platform limit — raising it is a decision to record in ' +
      'docs/ARCHITECTURE.md, not a number to edit here.',
  );
  failed = true;
}
if (failed) {
  process.exit(1);
}
