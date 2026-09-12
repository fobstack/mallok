import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

/**
 * The half of the Lighthouse gate that Lighthouse CI cannot assert.
 *
 * `docs/SEO_PERFORMANCE.md §7` asks for a median performance score ≥ 0.95
 * *and* no single run below 0.90. `lhci` compares one threshold against the
 * median, so the release gate asserted the floor alone and the median
 * requirement silently stopped being checked. These cases are the two
 * failures that were being missed.
 */

const SCRIPT = join(process.cwd(), 'scripts/lighthouse-gate.mjs');

let directory = '';

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mallok-lhr-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

/** A report as `lhci` writes it, with only the fields the gate reads. */
async function report(
  index: number,
  scores: {
    performance: number;
    accessibility?: number;
    'best-practices'?: number;
    seo?: number;
  },
  formFactor = 'mobile',
): Promise<void> {
  await writeFile(
    join(directory, `lhr-${index}.json`),
    JSON.stringify({
      finalDisplayedUrl: 'https://gate.example.com/',
      configSettings: { formFactor },
      categories: {
        performance: { score: scores.performance },
        accessibility: { score: scores.accessibility ?? 1 },
        'best-practices': { score: scores['best-practices'] ?? 1 },
        seo: { score: scores.seo ?? 1 },
      },
    }),
    'utf8',
  );
}

async function gate(): Promise<{ code: number; out: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('node', [SCRIPT, directory]);
    return { code: 0, out: stdout + stderr };
  } catch (error) {
    const failure = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: failure.code ?? 1,
      out: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
    };
  }
}

describe('both thresholds, not either', () => {
  it('passes three good runs and shows the numbers', async () => {
    await report(1, { performance: 0.96 });
    await report(2, { performance: 0.97 });
    await report(3, { performance: 0.95 });

    const result = await gate();

    expect(result.code, result.out).toBe(0);
    // The evidence is the printed distribution, not the exit code alone.
    expect(result.out).toContain('min 0.95');
    expect(result.out).toContain('median 0.96');
  });

  it('fails a median of 0.93 even though every run clears 0.90', async () => {
    // Exactly the case `lhci` alone would pass: nothing is below the floor,
    // and the median is below the bar §7 actually asks for.
    await report(1, { performance: 0.92 });
    await report(2, { performance: 0.93 });
    await report(3, { performance: 0.94 });

    const result = await gate();

    expect(result.code).toBe(1);
    expect(result.out).toContain('FAIL');
    expect(result.out).toContain('median 0.93');
  });

  it('fails one run below 0.90 even though the median is 0.96', async () => {
    // And the mirror case: `lhci` compares the median, so a single bad run
    // disappears into it.
    await report(1, { performance: 0.85 });
    await report(2, { performance: 0.96 });
    await report(3, { performance: 0.99 });

    const result = await gate();

    expect(result.code).toBe(1);
    expect(result.out).toContain('min 0.85');
  });

  it('wants SEO at exactly 1.00', async () => {
    await report(1, { performance: 0.99, seo: 0.99 });
    await report(2, { performance: 0.99, seo: 1 });
    await report(3, { performance: 0.99, seo: 1 });

    expect((await gate()).code).toBe(1);
  });
});

describe('what the reports have to be', () => {
  it('refuses a desktop collection', async () => {
    // A desktop run is the easier test, and scoring it as though it were the
    // mobile one would overstate what was measured.
    await report(1, { performance: 0.99 }, 'desktop');
    await report(2, { performance: 0.99 }, 'desktop');
    await report(3, { performance: 0.99 }, 'desktop');

    const result = await gate();

    expect(result.code).toBe(1);
    expect(result.out).toContain('not mobile');
  });

  it('refuses fewer than three runs', async () => {
    await report(1, { performance: 0.99 });
    await report(2, { performance: 0.99 });

    const result = await gate();

    expect(result.code).toBe(1);
    expect(result.out).toContain('expected 3 runs');
  });

  it('fails when the collection produced nothing', async () => {
    // "No reports" must never read the same as "all reports passed".
    const result = await gate();

    expect(result.code).toBe(1);
    expect(result.out).toContain('did not run');
  });
});
