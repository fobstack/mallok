import { describe, expect, it } from 'vitest';
import {
  boolFlag,
  parseArgs,
  resolveOrigin,
  resolveToken,
  stringFlag,
} from '../../src/cli/args.js';
import { type CliError, EXIT, table } from '../../src/cli/output.js';

describe('parseArgs', () => {
  it('separates the command, positionals and flags', () => {
    const args = parseArgs(['publish', './articles', '--kind', 'product']);
    expect(args.command).toBe('publish');
    expect(args.positional).toEqual(['./articles']);
    expect(stringFlag(args, 'kind')).toBe('product');
  });

  it('accepts --name=value as well as --name value', () => {
    expect(stringFlag(parseArgs(['x', '--url=https://a.example']), 'url')).toBe(
      'https://a.example',
    );
  });

  it('treats declared boolean flags as switches', () => {
    const args = parseArgs(['publish', './d', '--dry-run', '--json', '-v']);
    expect(boolFlag(args, 'dry-run')).toBe(true);
    expect(boolFlag(args, 'json')).toBe(true);
    expect(boolFlag(args, 'verbose')).toBe(true);
    expect(args.positional).toEqual(['./d']);
  });

  it('refuses a value-taking flag with no value', () => {
    expect(() => parseArgs(['publish', '--kind'])).toThrow(/needs a value/);
    expect(() => parseArgs(['publish', '--kind', '--json'])).toThrow(
      /needs a value/,
    );
  });

  it('refuses an unknown short option rather than ignoring it', () => {
    expect(() => parseArgs(['publish', '-x'])).toThrow(/Unknown option/);
  });

  it('passes everything after -- through as positional', () => {
    expect(parseArgs(['publish', '--', '--not-a-flag']).positional).toEqual([
      '--not-a-flag',
    ]);
  });
});

describe('resolveOrigin', () => {
  const registry = {
    alpha: { origin: 'https://alpha.example' },
    beta: { origin: 'https://beta.example' },
  };

  it('prefers an explicit --url', () => {
    expect(
      resolveOrigin(
        parseArgs(['x', '--url', 'https://direct.example']),
        registry,
      ),
    ).toBe('https://direct.example');
  });

  it('looks a named site up in the registry', () => {
    expect(resolveOrigin(parseArgs(['x', '--site', 'beta']), registry)).toBe(
      'https://beta.example',
    );
  });

  it('uses the only registered site when there is exactly one', () => {
    expect(
      resolveOrigin(parseArgs(['x']), {
        solo: { origin: 'https://solo.example' },
      }),
    ).toBe('https://solo.example');
  });

  it('refuses to guess between several sites', () => {
    // Publishing to the wrong site is worse than an error message.
    expect(() => resolveOrigin(parseArgs(['x']), registry)).toThrow(
      /--site is required/,
    );
  });

  it('names the known sites when one is not found', () => {
    try {
      resolveOrigin(parseArgs(['x', '--site', 'gamma']), registry);
      expect.unreachable();
    } catch (error) {
      expect((error as CliError).hint).toContain('alpha');
    }
  });

  it('explains what to do when nothing is registered', () => {
    expect(() => resolveOrigin(parseArgs(['x']), {})).toThrow(
      /No site specified/,
    );
  });
});

describe('resolveToken', () => {
  it('prefers --token, then the environment', () => {
    expect(resolveToken(parseArgs(['x', '--token', 'a']), {})).toBe('a');
    expect(resolveToken(parseArgs(['x']), { MALLOK_TOKEN: 'b' })).toBe('b');
  });

  it('fails with the auth exit code and says where to get one', () => {
    try {
      resolveToken(parseArgs(['x']), {});
      expect.unreachable();
    } catch (error) {
      expect((error as CliError).code).toBe(EXIT.auth);
      expect((error as CliError).hint).toContain('MALLOK_TOKEN');
    }
  });
});

describe('table', () => {
  it('aligns columns and trims trailing space', () => {
    const rendered = table(
      ['a', 'bbbb'],
      [
        ['1', '2'],
        ['long', 'x'],
      ],
    );
    expect(rendered.split('\n')).toEqual(['a     bbbb', '1     2', 'long  x']);
  });

  it('renders nothing for no rows', () => {
    expect(table(['a'], [])).toBe('');
  });
});
