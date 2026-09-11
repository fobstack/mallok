import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * Checks on this project's own configuration and content.
 *
 * Mallok's own behaviour is tested in the `mallok` package; what is left for a
 * site to check is what a site can get wrong — a binding removed from
 * `wrangler.jsonc`, a settings file that stopped being valid JSON, a content
 * bundle with no title. `npm run smoke` adds the other half: a real request to
 * a real Worker.
 *
 * Node's own test runner, deliberately. A site should not need a test
 * framework, a config file and a version to keep in step with its framework's
 * — `node --test` is already installed on any machine that can run the
 * project at all.
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

    assert.equal(
      (config.d1_databases as { binding: string }[])[0]?.binding,
      'DB',
    );
    assert.equal(
      (config.r2_buckets as { binding: string }[])[0]?.binding,
      'MEDIA',
    );
    assert.equal((config.assets as { binding: string }).binding, 'ASSETS');

    // Optional to the Worker, but its absence silently disables the rate
    // limit on plugin routes such as inquiry submission.
    const limits = config.ratelimits as
      | { name: string; namespace_id: string }[]
      | undefined;
    assert.equal(limits?.[0]?.name, 'RATE_LIMITER');
    assert.match(limits?.[0]?.namespace_id ?? '', /^\d+$/);
  });

  it('keeps the cron trigger scheduling and cleanup need', async () => {
    const config = await readJsonc('wrangler.jsonc');
    const crons = (config.triggers as { crons: string[] }).crons;

    assert.equal(crons.length, 1);
  });
});

describe('site.json', () => {
  it('is valid and names a default locale', async () => {
    const site = JSON.parse(await readFile('site.json', 'utf8')) as {
      defaultLocale?: string;
      locales?: string[];
    };

    assert.equal(typeof site.defaultLocale, 'string');
    assert.ok(site.locales?.includes(site.defaultLocale ?? ''));
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
          assert.ok(
            text.startsWith('---\n'),
            `${dir}/${file} has no front matter`,
          );
          const end = text.indexOf('\n---', 4);
          assert.match(text.slice(4, end), /(^|\n)title:/, `${dir}/${file}`);
          checked++;
        }
      }
    }

    assert.ok(checked > 0, 'no content bundles were checked');
  });
});
