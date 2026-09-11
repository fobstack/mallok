import { describe, expect, it } from 'vitest';
import { parseArgs } from '../../src/cli/args.js';
import { CliError } from '../../src/cli/output.js';
import {
  configFingerprint,
  normaliseDomain,
  rateLimitNamespace,
  resourceNames,
  validateDomain,
} from '../../src/cli/site-config.js';

/**
 * Two ways an argument can be wrong without anything saying so.
 *
 * A stray positional was silently ignored, so `mallok destroy acme --confirm
 * acme extra-word` deleted a site while its user believed they had typed a
 * command that would be refused. And a domain was written into the
 * configuration exactly as typed, so `Example.COM` and `example.com` produced
 * two different fingerprints for one site — a resumed run then refused to
 * continue because it thought the configuration had changed.
 */

function refusal(argv: readonly string[]): CliError {
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

describe('how many positional arguments a command takes', () => {
  it('refuses a second directory for create', () => {
    const error = refusal(['create', 'my-site', 'and-another']);

    expect(error.message).toContain('one directory');
    expect(error.message).toContain('and-another');
  });

  it('refuses a second slug for destroy', () => {
    // The dangerous one: this command deletes a database.
    expect(refusal(['destroy', 'acme', 'also-this']).message).toContain(
      'one site slug',
    );
  });

  it('refuses any positional for upgrade and prepare', () => {
    expect(refusal(['upgrade', '0.1.0']).message).toMatch(/takes no/);
    expect(refusal(['prepare', 'something']).message).toMatch(/takes no/);
  });

  it('still accepts the documented shapes', () => {
    expect(parseArgs(['create', 'my-site']).positional).toEqual(['my-site']);
    expect(parseArgs(['destroy', 'acme']).positional).toEqual(['acme']);
    expect(parseArgs(['upgrade', '--to', '1.0.0']).positional).toEqual([]);
    expect(parseArgs(['media', 'push', './media']).positional).toEqual([
      'push',
      './media',
    ]);
  });
});

describe('normalising a domain', () => {
  it('lower-cases it, because DNS does not care and a fingerprint does', () => {
    expect(normaliseDomain('Example.COM')).toBe('example.com');
    expect(normaliseDomain('  shop.Example.com  ')).toBe('shop.example.com');
  });

  it('converts a non-ASCII name to its IDNA form', () => {
    // What a certificate, a DNS record and Wrangler will all use.
    expect(normaliseDomain('münchen.example')).toBe('xn--mnchen-3ya.example');
    expect(normaliseDomain('例子.example')).toBe('xn--fsqu00a.example');
  });

  it('drops a trailing dot, which is the same name', () => {
    expect(normaliseDomain('example.com.')).toBe('example.com');
  });

  it('refuses what is not a hostname at all', () => {
    for (const input of [
      'https://example.com',
      'http://example.com',
      'example.com:8787',
      'example.com/path',
      'user@example.com',
      '*.example.com',
      'localhost',
      'exam ple.com',
      '',
    ]) {
      expect(validateDomain(input), input).not.toBeNull();
    }
  });

  it('gives one site one fingerprint however its domain was typed', () => {
    const of = (domain: string) =>
      configFingerprint({
        slug: 'acme',
        names: resourceNames('acme'),
        databaseId: 'x',
        domain: normaliseDomain(domain),
        rateLimitNamespace: rateLimitNamespace('acme'),
      });

    expect(of('Example.com')).toBe(of('example.com'));
    expect(of('example.com.')).toBe(of('example.com'));
  });
});

describe('the rate-limit namespace', () => {
  it('does not collide for the slugs that used to collide', () => {
    // Found by enumeration: `s01z` and `s0cg` both produced 44314 under the
    // previous derivation, so two sites on one account shared a limiter and
    // one throttled the other.
    expect(rateLimitNamespace('s01z')).not.toBe(rateLimitNamespace('s0cg'));
  });

  it('is unique across a large sample of realistic slugs', () => {
    const slugs: string[] = [];
    for (const first of 'abcdefghijklmnopqrstuvwxyz') {
      for (const second of 'abcdefghijklmnopqrstuvwxyz0123456789') {
        slugs.push(`site-${first}${second}`, `${first}${second}-trading`);
      }
    }
    const namespaces = slugs.map(rateLimitNamespace);

    expect(new Set(namespaces).size).toBe(slugs.length);
  });

  it('is stable for one slug', () => {
    expect(rateLimitNamespace('acme')).toBe(rateLimitNamespace('acme'));
  });
});
