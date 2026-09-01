/**
 * Reports the compressed size of the Worker bundle against the plan limits.
 * Run after `pnpm build` (which writes dist/worker/index.js).
 */
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const FREE_LIMIT = 3 * 1024 * 1024;
const PAID_LIMIT = 10 * 1024 * 1024;

const source = await readFile('dist/worker/index.js');
const gzipped = gzipSync(source, { level: 9 }).length;
const pct = (n, limit) => `${((n / limit) * 100).toFixed(1)}%`;

console.log(
  `worker bundle: ${(source.length / 1024).toFixed(1)} KiB raw, ${(gzipped / 1024).toFixed(1)} KiB gzip`,
);
console.log(`  of Free limit (3 MB):  ${pct(gzipped, FREE_LIMIT)}`);
console.log(`  of Paid limit (10 MB): ${pct(gzipped, PAID_LIMIT)}`);
if (gzipped > FREE_LIMIT) {
  console.error('Bundle exceeds the Free plan limit.');
  process.exit(1);
}
