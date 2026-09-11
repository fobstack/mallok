import { describe, expect, it } from 'vitest';
import { boolFlag, parseArgs } from '../../src/cli/args.js';
import { CliError } from '../../src/cli/output.js';

/**
 * Two ways an argument parser can deploy something nobody asked it to.
 *
 * Both of these were real: a misspelled `--no-deploy` was accepted and
 * ignored, and `--dry-run=true` parsed as the string `"true"`, which every
 * `=== true` check downstream read as false. The most explicit way a person
 * can ask for a dry run was the one way that provisioned.
 */

function failure(argv: readonly string[]): CliError {
  try {
    parseArgs(argv);
  } catch (error) {
    if (error instanceof CliError) {
      return error;
    }
    throw error;
  }
  throw new Error(`expected ${argv.join(' ')} to be refused`);
}

describe('the flag whitelist', () => {
  it('refuses a misspelled switch instead of ignoring it', () => {
    const error = failure(['create', 'my-site', '--no-deply']);

    expect(error.message).toContain('no option "--no-deply"');
    // And it says what was probably meant, because that is the whole cost of
    // the mistake.
    expect(error.hint).toContain('--no-deploy');
  });

  it('refuses a flag that belongs to another command', () => {
    expect(failure(['publish', './content', '--slug', 'x']).message).toContain(
      'mallok publish has no option "--slug"',
    );
    expect(failure(['create', 'site', '--draft']).message).toContain(
      'mallok create has no option "--draft"',
    );
  });

  it('accepts the flags each command declares', () => {
    expect(
      parseArgs(['create', 'my-site', '--slug', 'acme', '--no-deploy']).flags,
    ).toEqual({ slug: 'acme', 'no-deploy': true });
    expect(
      parseArgs(['destroy', 'acme', '--confirm', 'acme', '--dry-run']).flags,
    ).toEqual({ confirm: 'acme', 'dry-run': true });
    expect(parseArgs(['upgrade', '--to', '0.1.0-rc.3']).flags).toEqual({
      to: '0.1.0-rc.3',
    });
  });

  it('accepts the global switches on any command', () => {
    for (const command of ['create', 'publish', 'destroy', 'upgrade']) {
      expect(parseArgs([command, '--json', '--verbose']).flags).toEqual({
        json: true,
        verbose: true,
      });
    }
  });
});

describe('boolean flags', () => {
  it('reads --flag=true as true, not as the string "true"', () => {
    for (const argv of [
      ['create', 'site', '--dry-run'],
      ['create', 'site', '--dry-run=true'],
    ]) {
      const args = parseArgs(argv);
      expect(args.flags['dry-run'], argv.join(' ')).toBe(true);
      expect(boolFlag(args, 'dry-run'), argv.join(' ')).toBe(true);
    }

    const off = parseArgs(['create', 'site', '--dry-run=false']);
    expect(off.flags['dry-run']).toBe(false);
    expect(boolFlag(off, 'dry-run')).toBe(false);
  });

  it('reads --no-deploy=true as true', () => {
    const args = parseArgs(['create', 'site', '--no-deploy=true']);

    expect(args.flags['no-deploy']).toBe(true);
    expect(boolFlag(args, 'no-deploy')).toBe(true);
  });

  it('refuses a value that is neither true nor false', () => {
    for (const value of ['yes', '1', 'on', '']) {
      const error = failure(['create', 'site', `--dry-run=${value}`]);
      expect(error.message, value).toContain('is not true or false');
    }
  });

  it('never leaves a switch holding a string', () => {
    // The invariant the two tests above are protecting: after parsing, a
    // declared switch is a boolean or absent — never a string a `=== true`
    // check will silently read as false.
    for (const argv of [
      ['create', 'site', '--dry-run=true'],
      ['create', 'site', '--no-deploy=false'],
      ['destroy', 'acme', '--dry-run=true'],
      ['upgrade', '--to', '1.0.0', '--dry-run=true'],
    ]) {
      for (const [name, value] of Object.entries(parseArgs(argv).flags)) {
        if (['dry-run', 'no-deploy'].includes(name)) {
          expect(typeof value, `${argv.join(' ')} → ${name}`).toBe('boolean');
        }
      }
    }
  });
});

describe('values', () => {
  it('keeps an = inside a value', () => {
    expect(parseArgs(['create', 'site', '--domain=a=b.example']).flags).toEqual(
      { domain: 'a=b.example' },
    );
  });

  it('refuses a value flag with nothing after it', () => {
    expect(failure(['create', 'site', '--slug']).message).toContain(
      '--slug needs a value',
    );
  });
});
