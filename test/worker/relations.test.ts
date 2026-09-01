import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
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

function relationsFor(id: string) {
  return env.DB.prepare('SELECT * FROM content WHERE id = ?')
    .bind(id)
    .first()
    .then((content) =>
      loadRelations(
        env.DB,
        atelierManifest,
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
    expect(relations.refs?.category?.title).toBe('Aerospace alloys');
    expect(relations.refs?.category?.path).toBe('/categorys/aerospace');
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
