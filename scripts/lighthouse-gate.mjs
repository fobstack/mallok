/**
 * Reads the three Lighthouse reports and decides whether the gate passed.
 *
 * `docs/SEO_PERFORMANCE.md §7` asks for two different things at once: **no
 * single run below 0.90**, and a **median at or above 0.95**. Lighthouse CI
 * asserts one threshold against the median, so it can express either one but
 * not both, and `lighthouserc.json` was set to the floor alone. The gate then
 * read as "performance ≥ 0.90", which is the weaker of the two requirements,
 * and the stronger one quietly stopped being checked.
 *
 * There is no either/or here. Both hold, and this reads the reports and says
 * so with numbers.
 *
 * Usage: `node scripts/lighthouse-gate.mjs [.tmp/lighthouse]`
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * What each category has to reach.
 *
 * `min` applies to **every** run; `median` to the median of the three. SEO is
 * 1.00 in both columns because it is a checklist, not a measurement: a score
 * below 1 means a tag is missing, and that is the same on every run.
 */
const THRESHOLDS = [
  { id: 'performance', min: 0.9, median: 0.95 },
  { id: 'accessibility', min: 0.95, median: 0.95 },
  { id: 'best-practices', min: 0.95, median: 0.95 },
  { id: 'seo', min: 1, median: 1 },
];

/** The expected number of runs per URL. Fewer is a failed collection. */
const RUNS = 3;

const directory = process.argv[2] ?? '.tmp/lighthouse';

/** The median of a list of numbers, for an odd count. */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[(sorted.length - 1) >> 1];
}

const files = (await readdir(directory)).filter(
  (name) => name.startsWith('lhr-') && name.endsWith('.json'),
);
if (files.length === 0) {
  console.error(
    `No Lighthouse reports in ${directory}. The collection did not run, ` +
      'which is a failure and not a pass with nothing to check.',
  );
  process.exit(1);
}

/** url → category id → the score from each run. */
const byUrl = new Map();
for (const file of files) {
  const report = JSON.parse(await readFile(join(directory, file), 'utf8'));
  const url =
    report.finalDisplayedUrl ?? report.finalUrl ?? report.requestedUrl;
  const categories = byUrl.get(url) ?? new Map();
  for (const { id } of THRESHOLDS) {
    const score = report.categories?.[id]?.score;
    if (typeof score !== 'number') {
      console.error(`${url}: no ${id} score in ${file}.`);
      process.exit(1);
    }
    categories.set(id, [...(categories.get(id) ?? []), score]);
  }
  byUrl.set(url, categories);
  // The form factor is part of the claim: a desktop run passing these
  // thresholds is not the same evidence as a mobile one.
  const formFactor = report.configSettings?.formFactor;
  if (formFactor !== 'mobile') {
    console.error(
      `${file} was collected as "${formFactor}", not mobile. ` +
        'lighthouserc.json sets the mobile preset; something overrode it.',
    );
    process.exit(1);
  }
}

let failed = false;
for (const [url, categories] of byUrl) {
  console.log(`\n${url}`);
  if ([...categories.values()][0]?.length !== RUNS) {
    console.error(
      `  expected ${RUNS} runs, found ${[...categories.values()][0]?.length}`,
    );
    failed = true;
  }
  for (const threshold of THRESHOLDS) {
    const scores = categories.get(threshold.id) ?? [];
    const lowest = Math.min(...scores);
    const middle = median(scores);
    const ok = lowest >= threshold.min && middle >= threshold.median;
    console.log(
      `  ${threshold.id.padEnd(15)} runs ${scores
        .map((score) => score.toFixed(2))
        .join(' ')}  min ${lowest.toFixed(2)} (≥ ${threshold.min})` +
        `  median ${middle.toFixed(2)} (≥ ${threshold.median})  ${ok ? 'ok' : 'FAIL'}`,
    );
    if (!ok) {
      failed = true;
    }
  }
}

if (failed) {
  console.error(
    '\nThe Lighthouse gate failed. Both conditions have to hold: every run ' +
      'above the minimum, and the median above the higher bar.',
  );
  process.exit(1);
}
console.log('\nLighthouse gate: ok');
