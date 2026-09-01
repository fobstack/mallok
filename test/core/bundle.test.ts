import { describe, expect, it } from 'vitest';
import {
  bundleFileName,
  collectAssetPaths,
  deriveFrontmatter,
  detectLayout,
  formatBundleIdentity,
  localeFromFileName,
  parseBundleIdentity,
  resolveStatus,
} from '../../src/core/index.js';

describe('deriveFrontmatter', () => {
  it('fills canonical fields from the aliases other tools use', () => {
    expect(
      deriveFrontmatter({
        pubDate: '2026-01-01',
        heroImage: 'images/a.jpg',
        summary: 'A summary.',
        lastmod: '2026-02-02',
      }),
    ).toMatchObject({
      date: '2026-01-01',
      cover: 'images/a.jpg',
      description: 'A summary.',
      updated: '2026-02-02',
    });
  });

  it('never overrides a canonical field the author wrote', () => {
    const derived = deriveFrontmatter({
      date: '2026-05-05',
      pubDate: '1999-01-01',
      description: 'Mine.',
      excerpt: 'Theirs.',
    });
    expect(derived.date).toBe('2026-05-05');
    expect(derived.description).toBe('Mine.');
  });

  it('merges categories into tags without duplicating', () => {
    expect(
      deriveFrontmatter({ tags: ['a', 'b'], categories: ['b', 'c'] }).tags,
    ).toEqual(['a', 'b', 'c']);
    expect(deriveFrontmatter({ categories: ['x'] }).tags).toEqual(['x']);
  });

  it('keeps the original keys, because the source text is never rewritten', () => {
    const derived = deriveFrontmatter({ pubDate: '2026-01-01' });
    expect(derived.pubDate).toBe('2026-01-01');
  });
});

describe('collectAssetPaths', () => {
  const fields = {
    gallery: { type: 'image[]' as const, required: false },
    datasheet: { type: 'file' as const, required: false },
    grade: { type: 'string' as const, required: false },
  };

  it('finds references in the body and the front matter', () => {
    const markdown = [
      '---',
      'title: A product',
      'cover: images/hero.jpg',
      'gallery:',
      '  - images/one.jpg',
      '  - ./images/two.jpg',
      'datasheet: files/sheet.pdf',
      'grade: images/not-a-path.jpg',
      '---',
      '',
      '![alt](images/body.png)',
      '',
      '[Manual](files/manual.pdf)',
      '',
      '<img src="images/inline.gif">',
    ].join('\n');
    const paths = collectAssetPaths(markdown, fields);
    expect(paths).toContain('images/hero.jpg');
    expect(paths).toContain('images/one.jpg');
    // `./images/two.jpg` normalises to the same key as `images/two.jpg`.
    expect(paths).toContain('images/two.jpg');
    expect(paths).toContain('files/sheet.pdf');
    expect(paths).toContain('images/body.png');
    expect(paths).toContain('files/manual.pdf');
    expect(paths).toContain('images/inline.gif');
    // A field the theme did not declare as media is not scanned.
    expect(paths).not.toContain('images/not-a-path.jpg');
  });

  it('rejects paths that escape the bundle or are not relative', () => {
    const markdown = [
      '---',
      'title: T',
      'cover: ../../etc/passwd',
      '---',
      '',
      '![a](/absolute.png)',
      '![b](https://example.com/remote.png)',
      '![c](images/../secret.png)',
      '![d](file:///etc/passwd)',
      '![e](other/dir.png)',
    ].join('\n');
    expect(collectAssetPaths(markdown)).toEqual([]);
  });

  it('de-duplicates and preserves first-seen order', () => {
    const markdown =
      '![a](images/b.png)\n![c](images/a.png)\n![d](images/b.png)';
    expect(collectAssetPaths(markdown)).toEqual([
      'images/b.png',
      'images/a.png',
    ]);
  });
});

describe('resolveStatus', () => {
  const now = new Date('2026-06-01T00:00:00Z');

  it('honours draft above everything', () => {
    expect(resolveStatus({ draft: true, date: '2020-01-01' }, now)).toBe(
      'draft',
    );
  });

  it('schedules a future date and publishes a past one', () => {
    expect(resolveStatus({ date: '2027-01-01' }, now)).toBe('scheduled');
    expect(resolveStatus({ date: '2020-01-01' }, now)).toBe('published');
  });

  it('publishes when there is no usable date', () => {
    expect(resolveStatus({}, now)).toBe('published');
    expect(resolveStatus({ date: 'not a date' }, now)).toBe('published');
  });
});

describe('bundle identity', () => {
  const identity = {
    translation_group: 'group-1',
    items: {
      zh: { id: 'b', created_at: '2026-01-02T00:00:00Z', path: '/zh/x' },
      en: { id: 'a', created_at: '2026-01-01T00:00:00Z', path: '/x' },
    },
  };

  it('round trips through its own serialiser', () => {
    expect(parseBundleIdentity(formatBundleIdentity(identity))).toEqual(
      identity,
    );
  });

  it('writes locales in a stable order so exports are comparable', () => {
    const text = formatBundleIdentity(identity);
    expect(text.indexOf('"en"')).toBeLessThan(text.indexOf('"zh"'));
  });

  it('returns null rather than half-trusting a broken file', () => {
    expect(parseBundleIdentity('not json')).toBeNull();
    expect(parseBundleIdentity('{}')).toBeNull();
    expect(parseBundleIdentity('[]')).toBeNull();
  });

  it('drops incomplete item entries instead of inventing fields', () => {
    const parsed = parseBundleIdentity(
      '{"translation_group":"g","items":{"en":{"id":"a"},"de":{"id":"d","created_at":"t","path":"/p"}}}',
    );
    expect(Object.keys(parsed?.items ?? {})).toEqual(['de']);
  });
});

describe('bundle file names', () => {
  it('names the default locale plainly and the rest by locale', () => {
    expect(bundleFileName('en', 'en')).toBe('index.md');
    expect(bundleFileName('zh', 'en')).toBe('index.zh.md');
    expect(localeFromFileName('index.md', 'en')).toBe('en');
    expect(localeFromFileName('index.zh-Hans.md', 'en')).toBe('zh-Hans');
    expect(localeFromFileName('notes.md', 'en')).toBeNull();
  });
});

describe('detectLayout', () => {
  it('recognises an export by site.json plus content/', () => {
    expect(detectLayout(['site.json', 'content/article/a/index.md'])).toBe(
      'export',
    );
  });

  it('recognises a set of bundles by a nested index file', () => {
    expect(detectLayout(['a/index.md', 'a/images/x.jpg', 'b/index.md'])).toBe(
      'bundles',
    );
  });

  it('recognises loose Markdown files', () => {
    expect(detectLayout(['one.md', 'two.md'])).toBe('flat');
  });

  it('returns null when there is nothing to import', () => {
    expect(detectLayout(['readme.txt', 'images/x.jpg'])).toBeNull();
    expect(detectLayout([])).toBeNull();
  });
});
