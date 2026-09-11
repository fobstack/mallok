import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Checks on this project's own configuration and content.
 *
 * Mallok's own behaviour is tested in the `mallok` package; what is left for
 * a site to check is the part a site can get wrong: a binding removed from
 * `wrangler.jsonc`, a settings file that stopped being valid JSON, a content
 * bundle with no title. `npm run smoke` adds the other half — a real request
 * to a real Worker.
 */

/** `wrangler.jsonc` is JSONC; comments and trailing commas are allowed. */
async function readJsonc(path: string): Promise<Record<string, unknown>> {
  const text = await readFile(path, 'utf8');
  const stripped = text
    .replace(/^\s*\/\*[\s\S]*?\*\//, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(stripped) as Record<string, unknown>;
}

describe('wrangler.jsonc', () => {
  it('declares every binding the Worker reads', async () => {
    const config = await readJsonc('wrangler.jsonc');

    expect((config.d1_databases as { binding: string }[])[0]?.binding).toBe(
      'DB',
    );
    expect((config.r2_buckets as { binding: string }[])[0]?.binding).toBe(
      'MEDIA',
    );
    expect((config.assets as { binding: string }).binding).toBe('ASSETS');
    // Optional to the Worker, but its absence silently disables the rate
    // limit on plugin routes such as inquiry submission.
    const limits = config.ratelimits as
      | { name: string; namespace_id: string }[]
      | undefined;
    expect(limits?.[0]?.name).toBe('RATE_LIMITER');
    expect(limits?.[0]?.namespace_id).toMatch(/^\d+$/);
  });

  it('keeps the cron trigger a site needs for scheduling and cleanup', async () => {
    const config = await readJsonc('wrangler.jsonc');
    const crons = (config.triggers as { crons: string[] }).crons;

    expect(crons).toHaveLength(1);
  });
});

describe('site.json', () => {
  it('is valid and names a default locale', async () => {
    const site = JSON.parse(await readFile('site.json', 'utf8')) as {
      defaultLocale?: string;
      locales?: string[];
    };

    expect(typeof site.defaultLocale).toBe('string');
    expect(site.locales).toContain(site.defaultLocale);
  });
});

describe('content/', () => {
  it('gives every bundle a title', async () => {
    const roots = await readdir('content', { withFileTypes: true });
    let checked = 0;

    for (const kind of roots.filter((entry) => entry.isDirectory())) {
      const bundles = await readdir(join('content', kind.name), {
        withFileTypes: true,
      });
      for (const bundle of bundles.filter((entry) => entry.isDirectory())) {
        const dir = join('content', kind.name, bundle.name);
        for (const file of await readdir(dir)) {
          if (!file.endsWith('.md')) {
            continue;
          }
          const text = await readFile(join(dir, file), 'utf8');
          expect(text.startsWith('---\n'), `${dir}/${file}`).toBe(true);
          const end = text.indexOf('\n---', 4);
          expect(text.slice(4, end), `${dir}/${file}`).toMatch(/(^|\n)title:/);
          checked++;
        }
      }
    }

    expect(checked).toBeGreaterThan(0);
  });
});
