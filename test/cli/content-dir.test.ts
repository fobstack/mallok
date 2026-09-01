/**
 * The repository's own `content/` directory is the single content source: the
 * setup wizard imports it into D1, and `mallok build` compiles it into a
 * static site. These tests hold the two readings to the same files, because a
 * drift between them is invisible until someone's site is already wrong.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import siteConfig from '../../site.json';
import { splitFrontmatter } from '../../src/core/index.js';
import { tradeB2bStarter } from '../../src/starters/trade-b2b/index.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const CONTENT = path.join(ROOT, 'content');

async function bundleDirs(): Promise<{ kind: string; slug: string }[]> {
  const kinds = await readdir(CONTENT, { withFileTypes: true });
  const out: { kind: string; slug: string }[] = [];
  for (const kind of kinds.filter((entry) => entry.isDirectory())) {
    const slugs = await readdir(path.join(CONTENT, kind.name), {
      withFileTypes: true,
    });
    for (const slug of slugs.filter((entry) => entry.isDirectory())) {
      out.push({ kind: kind.name, slug: slug.name });
    }
  }
  return out;
}

describe('content/ as the single source', () => {
  it('every directory under content/ is a kind the site declares', async () => {
    const kinds = await readdir(CONTENT, { withFileTypes: true });
    for (const entry of kinds.filter((dir) => dir.isDirectory())) {
      expect(Object.keys(siteConfig.kinds)).toContain(entry.name);
    }
  });

  it('the starter ships exactly the bundles on disk', async () => {
    const onDisk = (await bundleDirs())
      .map(({ kind, slug }) => `${kind}/${slug}`)
      .sort();
    const inStarter = tradeB2bStarter.documents
      .map((doc) => `${doc.kind}/${doc.slug}`)
      .sort();
    expect(inStarter).toEqual(onDisk);
  });

  it('a translation slug in front matter matches the one the wizard uses', async () => {
    for (const doc of tradeB2bStarter.documents) {
      for (const [locale, translation] of Object.entries(
        doc.translations ?? {},
      )) {
        const file = path.join(
          CONTENT,
          doc.kind,
          doc.slug,
          `index.${locale}.md`,
        );
        const { data } = splitFrontmatter(await readFile(file, 'utf8'));
        // The static builder reads `slug`; the wizard reads the starter entry.
        // If these disagree the same page gets two URLs on the two paths.
        expect(data.slug).toBe(translation.slug);
      }
    }
  });

  it('every bundle on disk carries the default locale', async () => {
    for (const { kind, slug } of await bundleDirs()) {
      const files = await readdir(path.join(CONTENT, kind, slug));
      expect(files).toContain('index.md');
    }
  });
});
