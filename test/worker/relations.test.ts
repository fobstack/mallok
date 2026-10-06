import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SummaryInput } from '../../src/core/index.js';
import { atelierManifest } from '../../src/themes/atelier/index.js';
import { loadRelations, resolveCovers } from '../../src/worker/render.js';

const NOW = '2026-08-29T00:00:00.000Z';
const PAST = '2026-08-01T00:00:00.000Z';
const FUTURE = '2027-01-01T00:00:00.000Z';

/**
 * Relations are exercised against the atelier manifest rather than the
 * active theme: the point is that the rules come off whatever manifest is
 * passed in, not off a hardcoded list of kinds.
 */
async function seed(row: {
  id: string;
  kind: string;
  slug: string;
  title: string;
  frontmatter?: Record<string, unknown>;
  locale?: string;
  status?: string;
  publishedAt?: string | null;
  coverSha?: string | null;
}): Promise<void> {
  const locale = row.locale ?? 'en';
  await env.DB.prepare(
    `INSERT INTO content
       (id, kind, locale, translation_group, slug, path, title, description,
        frontmatter, markdown, markdown_sha256, assets, cover_sha256, status,
        published_at, created_at, updated_at, rev)
     VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, '', ?, '{}', ?, ?, ?, ?, ?, 1)`,
  )
    .bind(
      row.id,
      row.kind,
      locale,
      `tg-${row.id}`,
      row.slug,
      `/${row.kind}s/${row.slug}${locale === 'en' ? '' : `-${locale}`}`,
      row.title,
      JSON.stringify(row.frontmatter ?? {}),
      row.id.padEnd(64, '0'),
      row.coverSha ?? null,
      row.status ?? 'published',
      row.publishedAt === undefined ? PAST : row.publishedAt,
      PAST,
      PAST,
    )
    .run();
}

/** A `reference` field's target: one summary, never a list. */
function one(
  target: SummaryInput | readonly SummaryInput[] | undefined,
): SummaryInput | undefined {
  if (Array.isArray(target)) {
    throw new Error('expected one summary, got a list');
  }
  return target as SummaryInput | undefined;
}

/** A `reference[]` field's targets: a list, never one summary. */
function many(
  target: SummaryInput | readonly SummaryInput[] | undefined,
): readonly SummaryInput[] | undefined {
  if (target !== undefined && !Array.isArray(target)) {
    throw new Error('expected a list, got one summary');
  }
  return target as readonly SummaryInput[] | undefined;
}

function relationsFor(
  id: string,
  manifest: typeof atelierManifest = atelierManifest,
  db: D1Database = env.DB,
) {
  return env.DB.prepare('SELECT * FROM content WHERE id = ?')
    .bind(id)
    .first()
    .then((content) =>
      loadRelations(
        db,
        manifest,
        // biome-ignore lint/suspicious/noExplicitAny: row shape comes from D1.
        content as any,
        'https://media.example.com',
        NOW,
      ),
    );
}

describe('manifest-driven relations', () => {
  beforeAll(async () => {
    await SELF.fetch('https://relations-test.example/');
    await seed({
      id: 'cat-aero',
      kind: 'category',
      slug: 'aerospace',
      title: 'Aerospace alloys',
    });
    await seed({
      id: 'cat-marine',
      kind: 'category',
      slug: 'marine',
      title: 'Marine alloys',
    });
    await seed({
      id: 'prod-bar',
      kind: 'product',
      slug: 'bar',
      title: 'Grade 5 bar',
      frontmatter: { category: 'aerospace', grade: 'Ti-6Al-4V' },
    });
    await seed({
      id: 'prod-plate',
      kind: 'product',
      slug: 'plate',
      title: 'Grade 2 plate',
      frontmatter: { category: 'aerospace' },
    });
    await seed({
      id: 'prod-tube',
      kind: 'product',
      slug: 'tube',
      title: 'Grade 9 tube',
      frontmatter: { category: 'marine' },
    });
    await seed({
      id: 'prod-draft',
      kind: 'product',
      slug: 'draft',
      title: 'Not visible',
      frontmatter: { category: 'aerospace' },
      status: 'draft',
      publishedAt: null,
    });
    await seed({
      id: 'prod-later',
      kind: 'product',
      slug: 'later',
      title: 'Not yet',
      frontmatter: { category: 'aerospace' },
      status: 'published',
      publishedAt: FUTURE,
    });
    await seed({
      id: 'prod-de',
      kind: 'product',
      slug: 'bar',
      title: 'Stab Güte 5',
      locale: 'de',
      frontmatter: { category: 'aerospace' },
    });
  });

  it('resolves a reference field forward to its target', async () => {
    const relations = await relationsFor('prod-bar');
    expect(one(relations.refs?.category)?.title).toBe('Aerospace alloys');
    expect(one(relations.refs?.category)?.path).toBe('/categorys/aerospace');
  });

  it('resolves the reverse direction from the same declaration', async () => {
    const relations = await relationsFor('cat-aero');
    const titles = (relations.backrefs?.product ?? []).map(
      (item) => item.title,
    );
    expect(titles).toContain('Grade 5 bar');
    expect(titles).toContain('Grade 2 plate');
    expect(titles).not.toContain('Grade 9 tube');
  });

  it('never surfaces drafts, scheduled items or other locales', async () => {
    const relations = await relationsFor('cat-aero');
    const titles = (relations.backrefs?.product ?? []).map(
      (item) => item.title,
    );
    expect(titles).not.toContain('Not visible');
    expect(titles).not.toContain('Not yet');
    expect(titles).not.toContain('Stab Güte 5');
  });

  it('lists same-kind siblings and excludes the item itself', async () => {
    const relations = await relationsFor('prod-bar');
    const ids = (relations.siblings ?? []).map((item) => item.id);
    expect(ids).not.toContain('prod-bar');
    expect(ids).toContain('prod-plate');
    expect(ids).not.toContain('prod-draft');
  });

  it('returns empty groups for a kind that declares no references', async () => {
    await seed({ id: 'page-1', kind: 'page', slug: 'about', title: 'About' });
    const relations = await relationsFor('page-1');
    // `page` has no reference fields and no list layout, so nothing is loaded.
    expect(relations.refs ?? {}).toEqual({});
    expect(relations.siblings ?? []).toEqual([]);
  });

  it('refuses an unsafe field name at the query boundary', async () => {
    const { listByReference } = await import('../../src/db/queries.js');
    expect(() =>
      listByReference(
        env.DB,
        'product',
        'en',
        "x'; DROP TABLE content--",
        'a',
        1,
        NOW,
      ),
    ).toThrow(/unsafe field name/);
  });

  it('leaves a dangling reference absent rather than guessing', async () => {
    await seed({
      id: 'prod-orphan',
      kind: 'product',
      slug: 'orphan',
      title: 'Orphan',
      frontmatter: { category: 'no-such-family' },
    });
    const relations = await relationsFor('prod-orphan');
    expect(relations.refs?.category).toBeUndefined();
  });
});

/**
 * Atelier, with two lists of references on a product: the families it is
 * also sold under, and the products that go with it.
 */
const product = atelierManifest.kinds.product;
if (product === undefined) {
  throw new Error('atelier declares a product kind');
}
const withLists: typeof atelierManifest = {
  ...atelierManifest,
  kinds: {
    ...atelierManifest.kinds,
    product: {
      ...product,
      fields: {
        ...product.fields,
        also_in: { type: 'reference[]', kind: 'category', required: false },
        goes_with: { type: 'reference[]', kind: 'product', required: false },
      },
    },
  },
};

describe('lists of references', () => {
  beforeAll(async () => {
    await SELF.fetch('https://relations-test.example/');
    for (const slug of ['alpha', 'beta', 'gamma']) {
      await seed({
        id: `fam-${slug}`,
        kind: 'category',
        slug,
        title: `Family ${slug}`,
      });
    }
    await seed({
      id: 'fam-hidden',
      kind: 'category',
      slug: 'hidden',
      title: 'Hidden family',
      status: 'draft',
      publishedAt: null,
    });
    await seed({
      id: 'fam-alpha-de',
      kind: 'category',
      slug: 'alpha',
      title: 'Familie alpha',
      locale: 'de',
    });
    await seed({
      id: 'multi-1',
      kind: 'product',
      slug: 'multi-one',
      title: 'In two families',
      // Written gamma first: that is the order a template gets.
      frontmatter: {
        also_in: ['gamma', 'no-such', 'alpha', 'hidden', 'gamma', '', 7],
        goes_with: ['multi-two'],
      },
    });
    await seed({
      id: 'multi-2',
      kind: 'product',
      slug: 'multi-two',
      title: 'In alpha only',
      frontmatter: { also_in: ['alpha'] },
    });
    await seed({
      id: 'multi-3',
      kind: 'product',
      slug: 'multi-three',
      title: 'Named twice over',
      // Its family by the single field and by the list: one item, once.
      frontmatter: { category: 'alpha', also_in: ['alpha', 'beta'] },
    });
    await seed({
      id: 'multi-near',
      kind: 'product',
      slug: 'multi-near',
      title: 'A near miss',
      // Contains the text "alpha" without naming that family.
      frontmatter: { also_in: ['alpha-2', 'not-alpha'] },
    });
    await seed({
      id: 'multi-scalar',
      kind: 'product',
      slug: 'multi-scalar',
      title: 'Not a list',
      frontmatter: { also_in: 'alpha' },
    });
    await seed({
      id: 'multi-draft',
      kind: 'product',
      slug: 'multi-draft',
      title: 'Unpublished',
      frontmatter: { also_in: ['alpha'] },
      status: 'draft',
      publishedAt: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves a list forward, in the order written, to what is published', async () => {
    const relations = await relationsFor('multi-1', withLists);
    expect(many(relations.refs?.also_in)?.map((item) => item.title)).toEqual([
      'Family gamma',
      'Family alpha',
    ]);
    // A list pointing at the item's own kind resolves forward like any other.
    expect(many(relations.refs?.goes_with)?.map((item) => item.id)).toEqual([
      'multi-2',
    ]);
  });

  it('gives a list that resolves to nothing as an empty list, and no list as absent', async () => {
    await seed({
      id: 'multi-nowhere',
      kind: 'product',
      slug: 'multi-nowhere',
      title: 'Nowhere',
      frontmatter: { also_in: ['no-such'] },
    });
    expect(
      (await relationsFor('multi-nowhere', withLists)).refs?.also_in,
    ).toEqual([]);
    expect(
      (await relationsFor('multi-scalar', withLists)).refs?.also_in,
    ).toBeUndefined();
    expect(
      (await relationsFor('prod-bar', withLists)).refs?.also_in,
    ).toBeUndefined();
  });

  it('lists an item on every target its list names', async () => {
    const titles = async (id: string): Promise<string[]> =>
      ((await relationsFor(id, withLists)).backrefs?.product ?? []).map(
        (item) => item.title,
      );
    const alpha = await titles('fam-alpha');
    expect(alpha).toContain('In two families');
    expect(alpha).toContain('In alpha only');
    expect(alpha).not.toContain('A near miss');
    expect(alpha).not.toContain('Not a list');
    expect(alpha).not.toContain('Unpublished');
    expect(await titles('fam-gamma')).toEqual(['In two families']);
    expect(await titles('fam-beta')).toEqual(['Named twice over']);
    // Under the manifest without the list, the same items are not related.
    expect(
      ((await relationsFor('fam-gamma')).backrefs?.product ?? []).map(
        (item) => item.title,
      ),
    ).toEqual([]);
  });

  it('lists an item once when two of its fields point at the same target', async () => {
    const ids = (
      (await relationsFor('fam-alpha', withLists)).backrefs?.product ?? []
    ).map((item) => item.id);
    expect(ids.filter((id) => id === 'multi-3')).toEqual(['multi-3']);
  });

  it('does it all in the one batch a single reference uses', async () => {
    const batches: number[] = [];
    const counting = new Proxy(env.DB, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (property === 'batch') {
          return (statements: D1PreparedStatement[]) => {
            batches.push(statements.length);
            return target.batch(statements);
          };
        }
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await relationsFor('multi-3', withLists, counting);
    // Its family, the list, the cases pointing at it, and its siblings: the
    // list is one statement however many it names, and `goes_with`, which
    // is empty, costs nothing.
    expect(batches).toEqual([4]);
    await relationsFor('prod-bar', withLists, counting);
    // Without the list: the same batch, one statement shorter.
    expect(batches).toEqual([4, 3]);
  });

  it('resolves at most 24 targets of one list, and says so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const slugs: string[] = [];
    for (let n = 0; n < 26; n++) {
      const slug = `bulk-${String(n).padStart(2, '0')}`;
      slugs.push(slug);
      await seed({
        id: `fam-${slug}`,
        kind: 'category',
        slug,
        title: `Bulk ${n}`,
      });
    }
    await seed({
      id: 'multi-many',
      kind: 'product',
      slug: 'multi-many',
      title: 'Everywhere',
      frontmatter: { also_in: slugs },
    });
    const relations = await relationsFor('multi-many', withLists);
    expect(many(relations.refs?.also_in)?.map((item) => item.slug)).toEqual(
      slugs.slice(0, 24),
    );
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toEqual({
      event: 'reference_list_truncated',
      kind: 'product',
      field: 'also_in',
      kept: 24,
      listed: 26,
    });
  });

  it('reads through an index in both directions, never the whole table', async () => {
    const { listByReferenceList, summariesBySlugs } = await import(
      '../../src/db/queries.js'
    );
    // The statements as the page runs them, asked how they would be run.
    const plan = async (sql: string, ...values: unknown[]): Promise<string> =>
      (
        await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`)
          .bind(...values)
          .all<{ detail: string }>()
      ).results
        .map((row) => row.detail)
        .join(' | ');
    const captured: { sql: string; values: unknown[] }[] = [];
    const recording = {
      prepare: (sql: string) => ({
        bind: (...values: unknown[]) => {
          captured.push({ sql, values });
          return {};
        },
      }),
    } as unknown as D1Database;
    summariesBySlugs(recording, 'category', 'en', ['alpha', 'gamma'], NOW);
    listByReferenceList(
      recording,
      'product',
      'en',
      'also_in',
      'alpha',
      24,
      NOW,
    );
    const [forward, backward] = captured;
    if (forward === undefined || backward === undefined) {
      throw new Error('both statements were prepared');
    }

    const forwardPlan = await plan(forward.sql, ...forward.values);
    // Each slug is a lookup on the unique (kind, locale, slug) index.
    expect(forwardPlan).toMatch(
      /SEARCH content USING INDEX \S+ \(kind=\? AND locale=\? AND slug=\?\)/,
    );
    const backwardPlan = await plan(backward.sql, ...backward.values);
    // The published items of that kind and language, not the table: the
    // bound the single-reference query has (docs/DATA_MODEL.md §3).
    expect(backwardPlan).toMatch(
      /SEARCH content USING INDEX content_list \(kind=\? AND locale=\? AND status=\? AND published_at/,
    );
    expect(backwardPlan).not.toMatch(/SCAN content/);
  });

  it('refuses an unsafe field name at the query boundary', async () => {
    const { listByReferenceList } = await import('../../src/db/queries.js');
    expect(() =>
      listByReferenceList(env.DB, 'product', 'en', "x') OR 1=1--", 'a', 1, NOW),
    ).toThrow(/unsafe field name/);
  });
});

describe('resolveCovers', () => {
  it('resolves cover hashes to the largest variant in one query', async () => {
    const sha = 'd'.repeat(64);
    await env.DB.prepare(
      `INSERT INTO media
         (sha256, kind, mime, ext, bytes, width, height, variants,
          original_name, ref_count, created_at)
       VALUES (?, 'image', 'image/jpeg', 'jpg', 1000, 1600, 900, '[480,960]', 'a.jpg', 1, ?)`,
    )
      .bind(sha, PAST)
      .run();
    await seed({
      id: 'prod-cover',
      kind: 'product',
      slug: 'cover',
      title: 'With cover',
      coverSha: sha,
    });
    const rows = await env.DB.prepare('SELECT * FROM content WHERE id = ?')
      .bind('prod-cover')
      .all();
    const covers = await resolveCovers(
      env.DB,
      // biome-ignore lint/suspicious/noExplicitAny: row shape comes from D1.
      rows.results as any,
      'https://media.example.com',
    );
    expect(covers.get(sha)).toBe(
      `https://media.example.com/media/${sha}_960.webp`,
    );
  });

  it('does nothing when no row has a cover', async () => {
    expect((await resolveCovers(env.DB, [], 'https://x')).size).toBe(0);
  });
});
