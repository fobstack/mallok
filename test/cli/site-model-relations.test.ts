import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  relationsFor,
  type SiteItem,
  type SiteModel,
} from '../../src/cli/site-model.js';
import { themeManifestSchema } from '../../src/core/theme.js';

/**
 * A static build resolves lists of references the way the Worker does
 * (docs/THEME_FORMAT.md §7.5): `test/worker/relations.test.ts` is the same
 * cases against D1.
 */

// Read from disk: the theme's own module imports its templates, which only
// the Worker's bundler understands.
const atelierManifest = themeManifestSchema.parse(
  JSON.parse(readFileSync('src/themes/atelier/theme.json', 'utf8')),
);
const product = atelierManifest.kinds.product;
if (product === undefined) {
  throw new Error('atelier declares a product kind');
}
const manifest: typeof atelierManifest = {
  ...atelierManifest,
  kinds: {
    ...atelierManifest.kinds,
    product: {
      ...product,
      fields: {
        ...product.fields,
        also_in: { type: 'reference[]', kind: 'category', required: false },
      },
    },
  },
};

let day = 0;
function item(
  kind: string,
  slug: string,
  frontmatter: Record<string, unknown> = {},
  locale = 'en',
): SiteItem {
  day += 1;
  return {
    id: `${kind}:${slug}:${locale}`,
    kind,
    locale,
    slug,
    path: `/${kind}/${slug}`,
    title: slug,
    description: '',
    publishedAt: `2026-01-${String(day).padStart(2, '0')}T00:00:00.000Z`,
    updatedAt: '2026-01-01T00:00:00.000Z',
    frontmatter,
    markdown: '',
    body: '',
    tags: [],
    translationGroup: `${kind}:${slug}`,
    assets: {},
    missing: [],
  } as unknown as SiteItem;
}

const alpha = item('category', 'alpha');
const beta = item('category', 'beta');
const gamma = item('category', 'gamma');
const alphaDe = item('category', 'alpha', {}, 'de');
const two = item('product', 'two', {
  also_in: ['gamma', 'no-such', 'alpha', 'gamma', '', 7],
});
const both = item('product', 'both', {
  category: 'alpha',
  also_in: ['alpha', 'beta'],
});
const near = item('product', 'near', { also_in: ['alpha-2'] });
const scalar = item('product', 'scalar', { also_in: 'alpha' });
const published = [alpha, beta, gamma, alphaDe, two, both, near, scalar];
const model: SiteModel = {
  items: published,
  published,
  locales: ['en', 'de'],
  defaultLocale: 'en',
};

const slugs = (list: readonly SiteItem[] | undefined): string[] =>
  (list ?? []).map((entry) => entry.slug);

describe('relationsFor, lists of references', () => {
  it('resolves a list forward in the order written, and reports what names nothing', () => {
    const relations = relationsFor(model, two, manifest);
    expect(relations.refs.also_in).toEqual([gamma, alpha]);
    expect(relations.dangling).toEqual([
      { field: 'also_in', value: 'no-such' },
    ]);
  });

  it('keeps a single reference single beside it', () => {
    const relations = relationsFor(model, both, manifest);
    expect(relations.refs.category).toBe(alpha);
    expect(relations.refs.also_in).toEqual([alpha, beta]);
  });

  it('ignores a value that is not a list', () => {
    expect(relationsFor(model, scalar, manifest).refs.also_in).toBeUndefined();
  });

  it('lists an item on every target its list names, once, newest first', () => {
    expect(
      slugs(relationsFor(model, alpha, manifest).backrefs.product),
    ).toEqual(['both', 'two']);
    expect(
      slugs(relationsFor(model, gamma, manifest).backrefs.product),
    ).toEqual(['two']);
    expect(slugs(relationsFor(model, beta, manifest).backrefs.product)).toEqual(
      ['both'],
    );
    // Another language's family is another item.
    expect(
      slugs(relationsFor(model, alphaDe, manifest).backrefs.product),
    ).toEqual([]);
    // Without the list declared, only the single field relates them.
    expect(
      slugs(relationsFor(model, alpha, atelierManifest).backrefs.product),
    ).toEqual(['both']);
  });
});
