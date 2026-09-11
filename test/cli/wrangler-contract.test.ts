import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { FAKE_SUBCOMMANDS } from './helpers/fake-wrangler.js';

const run = promisify(execFile);

/**
 * Every Wrangler subcommand this project uses must exist in the Wrangler this
 * project locks.
 *
 * The fake in `helpers/fake-wrangler.ts` answered `wrangler r2 object list`,
 * which Wrangler 4.124.0 does not have. A `destroy --empty-bucket` was built
 * on top of it, tested against the fake, and would have failed on the first
 * real account it met. A fake that invents commands does not test a feature;
 * it invents one.
 *
 * This asks the locked binary what it supports, and compares.
 */

/** The real `--help` for a command path, or null when it does not exist. */
async function help(path: readonly string[]): Promise<string | null> {
  try {
    const { stdout } = await run(
      'node_modules/.bin/wrangler',
      [...path, '--help'],
      { cwd: process.cwd(), maxBuffer: 1 << 22 },
    );
    return stdout;
  } catch {
    return null;
  }
}

describe('the locked Wrangler supports everything we call', () => {
  it('reports its version, so this contract is pinned to one', async () => {
    const { stdout } = await run('node_modules/.bin/wrangler', ['--version'], {
      cwd: process.cwd(),
    });

    // Not asserted exactly: the point is that the checks below ran against
    // whatever this repository actually locks.
    expect(stdout.trim()).toMatch(/\d+\.\d+\.\d+/);
  });

  it.each(FAKE_SUBCOMMANDS)('has `wrangler %s`', async (subcommand) => {
    const path = subcommand.split(' ');
    const parent = path.slice(0, -1);
    const leaf = path.at(-1) ?? '';

    const output = await help(parent.length === 0 ? [leaf] : parent);
    expect(output, `wrangler ${parent.join(' ')} --help failed`).not.toBeNull();

    if (parent.length === 0) {
      // A top-level command: its own help is proof enough that it exists.
      expect(await help([leaf])).not.toBeNull();
      return;
    }
    // A subcommand is listed in its parent's COMMANDS section.
    expect(output, `wrangler ${subcommand}`).toMatch(
      new RegExp(`wrangler ${parent.join(' ')} ${leaf}\\b`),
    );
  });

  it('does not have the command a fake once invented', async () => {
    // `r2 object` offers get, put and delete — and no list. This assertion is
    // here so that the day Wrangler adds one, somebody revisits the destroy
    // flow deliberately rather than discovering it by accident.
    const output = await help(['r2', 'object']);

    expect(output).not.toBeNull();
    expect(output).not.toMatch(/wrangler r2 object list\b/);
  });
});
