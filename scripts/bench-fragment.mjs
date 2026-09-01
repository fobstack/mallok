/**
 * Stage-one CPU cost in Node as a function of Markdown size.
 *
 * Node's V8 is the same engine workerd uses, so this is a good proxy for the
 * shape of the curve; the absolute numbers on Cloudflare come from Workers
 * Logs during the Task 01 spike. Two numbers matter:
 *  - "cold": the very first render in a fresh process, which includes JIT
 *    warm-up. A cold isolate on Cloudflare pays a similar cost.
 *  - "warm": the steady state once the pipeline is compiled.
 * Run with `pnpm bench:fragment`.
 */
import { renderFragment } from '../dist/core/index.mjs';
import { medianCpuMs, syntheticMarkdown } from './synthetic.mjs';

const SIZES_KB = [2, 8, 32, 128, 512, 1024];
const WARMUP_ROUNDS = 30;
const ROUNDS = 15;

async function render(body) {
  return renderFragment({
    body,
    frontmatter: {},
    assets: {},
    mediaBaseUrl: '',
  });
}

const coldStart = process.cpuUsage();
await render(syntheticMarkdown(2));
const coldUsage = process.cpuUsage(coldStart);
console.log(
  `cold first render of 2 KB (includes JIT warm-up): ${((coldUsage.user + coldUsage.system) / 1000).toFixed(1)} ms CPU\n`,
);

for (let i = 0; i < WARMUP_ROUNDS; i++) {
  await render(syntheticMarkdown(8));
}

console.log('Markdown KB | HTML KB | warm median CPU ms (Node)');
console.log('-----------|---------|--------------------------');
for (const kb of SIZES_KB) {
  const body = syntheticMarkdown(kb);
  let htmlBytes = 0;
  const ms = await medianCpuMs(async () => {
    const result = await render(body);
    htmlBytes = result.html.length;
  }, ROUNDS);
  console.log(
    `${String(kb).padStart(10)} | ${(htmlBytes / 1024).toFixed(0).padStart(7)} | ${ms.toFixed(2)}`,
  );
}
