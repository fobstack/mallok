import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SiteClient } from '../../src/cli/client.js';
import { CliError, EXIT, type Reporter } from '../../src/cli/output.js';
import {
  type PublishOptions,
  type PublishOutcome,
  publishBundles,
  reportMissing,
  reportWarnings,
} from '../../src/cli/publish.js';
import type { Bundle } from '../../src/cli/scan.js';

/**
 * `mallok publish` / `mallok import` (docs/CLI.md §6).
 *
 * The publish loop decides three things a live run would show only after it
 * had already written to a site: which status a document is saved with, which
 * media actually gets uploaded, and which failures abort the run instead of
 * being collected. Those are what is asserted here, through a stub site.
 */

interface Save {
  readonly path: string;
  readonly body: Record<string, unknown>;
}

interface StubOptions {
  /** Hashes the site claims to hold already. */
  readonly existing?: readonly string[];
  /** Thrown instead of saving, keyed by slug. */
  readonly failFor?: Record<string, CliError>;
  /** Extra fields merged into a successful save response. */
  readonly saveResponse?: Record<string, unknown>;
  /** Items the site already has, for dry-run comparison. */
  readonly items?: readonly {
    readonly id: string;
    readonly slug: string;
    readonly markdown: string;
    readonly assets: Record<string, string>;
    readonly path: string;
  }[];
}

function stubSite(options: StubOptions = {}): SiteClient & {
  saves: Save[];
  uploads: string[];
} {
  const saves: Save[] = [];
  const uploads: string[] = [];
  const items = options.items ?? [];
  return {
    origin: 'https://example.com',
    saves,
    uploads,
    async get<T>(path: string): Promise<T> {
      if (path.startsWith('/content?')) {
        return { items: items.map((item) => ({ id: item.id })) } as T;
      }
      const id = path.replace('/content/', '');
      const found = items.find((item) => item.id === id);
      if (found === undefined) {
        throw new CliError(EXIT.remote, 'not found');
      }
      return found as T;
    },
    async post<T>(path: string, body: unknown): Promise<T> {
      if (path === '/media/check') {
        return {
          existing: (body as { hashes: string[] }).hashes.filter((hash) =>
            (options.existing ?? []).includes(hash),
          ),
        } as T;
      }
      const record = body as Record<string, unknown>;
      const failure = options.failFor?.[String(record.slug)];
      if (failure !== undefined) {
        throw failure;
      }
      saves.push({ path, body: record });
      return {
        id: `id-${saves.length}`,
        path: `/${record.slug}`,
        ...options.saveResponse,
      } as T;
    },
    async patch<T>(): Promise<T> {
      throw new Error('not used');
    },
    async put(path) {
      uploads.push(path);
      return new Response('', { status: 200 });
    },
    async bytes(): Promise<Uint8Array> {
      return new Uint8Array();
    },
  };
}

/** A reporter that keeps its output instead of writing it. */
function recordingReporter(): Reporter & { lines: string[] } {
  const lines: string[] = [];
  return {
    json: false,
    lines,
    step: (message) => lines.push(message),
    warn: (message) => lines.push(`! ${message}`),
    done: () => undefined,
  };
}

const baseOptions: PublishOptions = {
  mode: 'publish',
  draft: false,
  createOnly: false,
  dryRun: false,
  failOnMissing: false,
  widths: [320],
  maxEdge: null,
  defaultLocale: 'en',
};

let dir = '';

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mallok-publish-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function bundle(
  name: string,
  documents: readonly { locale: string; markdown: string }[],
  extra: Partial<Bundle> = {},
): Bundle {
  return {
    name,
    dir: name,
    kind: 'article',
    documents: documents.map((document) => ({
      locale: document.locale,
      fileName:
        document.locale === 'en' ? 'index.md' : `index.${document.locale}.md`,
      markdown: document.markdown,
      assets: new Map(),
      missing: [],
    })),
    identity: null,
    unfilledSlots: [],
    ...extra,
  };
}

const article = (title: string, extra = ''): string =>
  ['---', `title: ${title}`, extra, '---', '', 'Body.']
    .filter((line) => line !== '')
    .join('\n');

describe('publishing bundles', () => {
  it('publishes one document per locale, carrying the slug from front matter', async () => {
    const client = stubSite();

    const outcomes = await publishBundles(
      client,
      [
        bundle('first-post', [
          { locale: 'en', markdown: article('First', 'slug: chosen-slug') },
          { locale: 'de', markdown: article('Erster') },
        ]),
      ],
      baseOptions,
      recordingReporter(),
    );

    expect(outcomes.map((row) => row.locale)).toEqual(['en', 'de']);
    expect(client.saves[0]?.body.slug).toBe('chosen-slug');
    // No slug in the front matter: the directory name is the slug.
    expect(client.saves[1]?.body.slug).toBe('first-post');
    expect(client.saves.every((save) => save.body.status === 'published')).toBe(
      true,
    );
  });

  it('honours --draft, and lets import keep the front matter status', async () => {
    const held = article('Held back', 'draft: true');

    const drafting = stubSite();
    await publishBundles(
      drafting,
      [bundle('a', [{ locale: 'en', markdown: article('A') }])],
      { ...baseOptions, draft: true },
      recordingReporter(),
    );
    expect(drafting.saves[0]?.body.status).toBe('draft');

    // `import` resolves the status from the document, so a draft stays a
    // draft; `publish` overrides it. This is the one difference between the
    // two commands (docs/CONTENT_FORMAT.md §7.4).
    const importing = stubSite();
    await publishBundles(
      importing,
      [bundle('b', [{ locale: 'en', markdown: held }])],
      { ...baseOptions, mode: 'import' },
      recordingReporter(),
    );
    expect(importing.saves[0]?.body.status).toBe('draft');

    const publishing = stubSite();
    await publishBundles(
      publishing,
      [bundle('b', [{ locale: 'en', markdown: held }])],
      baseOptions,
      recordingReporter(),
    );
    expect(publishing.saves[0]?.body.status).toBe('published');
  });

  it('passes the identity of a bundle that has been published before', async () => {
    const client = stubSite();

    await publishBundles(
      client,
      [
        bundle('known', [{ locale: 'en', markdown: article('Known') }], {
          identity: {
            translation_group: 'group-1',
            items: {
              en: {
                id: 'item-1',
                created_at: '2026-01-01T00:00:00Z',
                path: '/articles/known',
              },
            },
          },
        }),
      ],
      baseOptions,
      recordingReporter(),
    );

    expect(client.saves[0]?.body.id).toBe('item-1');
    expect(client.saves[0]?.body.translationGroup).toBe('group-1');
  });

  it('uploads only the media the site does not already hold', async () => {
    const { default: sharp } = await import('sharp');
    const photo = join(dir, 'photo.png');
    await writeFile(
      photo,
      await sharp({
        create: {
          width: 20,
          height: 10,
          channels: 3,
          background: { r: 1, g: 2, b: 3 },
        },
      })
        .png()
        .toBuffer(),
    );

    const target = bundle('with-media', [
      { locale: 'en', markdown: article('Has media') },
    ]);
    const documents = [
      {
        ...target.documents[0],
        assets: new Map([['images/photo.png', photo]]),
      },
    ] as Bundle['documents'];

    const fresh = stubSite();
    await publishBundles(
      fresh,
      [{ ...target, documents }],
      baseOptions,
      recordingReporter(),
    );
    expect(fresh.uploads.length).toBeGreaterThan(0);
    const assets = fresh.saves[0]?.body.assets as Record<string, string>;
    const hash = String(assets['images/photo.png']);

    const known = stubSite({ existing: [hash] });
    await publishBundles(
      known,
      [{ ...target, documents }],
      baseOptions,
      recordingReporter(),
    );
    expect(known.uploads).toEqual([]);
  });

  it('collects a save failure but stops the run on an auth failure', async () => {
    const collected = stubSite({
      failFor: { bad: new CliError(EXIT.remote, 'The site returned 500.') },
    });

    const outcomes = await publishBundles(
      collected,
      [
        bundle('bad', [{ locale: 'en', markdown: article('Bad') }]),
        bundle('good', [{ locale: 'en', markdown: article('Good') }]),
      ],
      baseOptions,
      recordingReporter(),
    );

    expect(outcomes.map((row) => row.status)).toEqual(['failed', 'updated']);
    expect(outcomes[0]?.error).toBe('The site returned 500.');

    // An invalid token will not become valid on the next bundle, so the run
    // ends rather than reporting the same failure once per document.
    const refused = stubSite({
      failFor: { bad: new CliError(EXIT.auth, 'Invalid token.') },
    });
    await expect(
      publishBundles(
        refused,
        [
          bundle('bad', [{ locale: 'en', markdown: article('Bad') }]),
          bundle('good', [{ locale: 'en', markdown: article('Good') }]),
        ],
        baseOptions,
        recordingReporter(),
      ),
    ).rejects.toThrow('Invalid token.');
    expect(refused.saves).toEqual([]);
  });

  it('surfaces the server-side unchanged flag and save warning', async () => {
    const client = stubSite({
      saveResponse: {
        unchanged: true,
        warning: 'Saved as a draft: too long to render safely.',
        missingAssets: ['images/absent.png'],
      },
    });

    const outcomes = await publishBundles(
      client,
      [bundle('a', [{ locale: 'en', markdown: article('A') }])],
      baseOptions,
      recordingReporter(),
    );

    expect(outcomes[0]?.status).toBe('unchanged');
    expect(outcomes[0]?.warning).toContain('too long to render');
    expect(outcomes[0]?.missing).toEqual(['images/absent.png']);
  });

  it('passes createOnly through when asked', async () => {
    const client = stubSite();

    await publishBundles(
      client,
      [bundle('a', [{ locale: 'en', markdown: article('A') }])],
      { ...baseOptions, createOnly: true },
      recordingReporter(),
    );

    expect(client.saves[0]?.body.createOnly).toBe(true);
  });
});

describe('a publish dry run', () => {
  const target = bundle('a', [
    { locale: 'en', markdown: article('A', 'slug: a') },
  ]);
  const options = { ...baseOptions, dryRun: true };

  it('writes nothing and reports what a real run would do', async () => {
    const client = stubSite();

    const outcomes = await publishBundles(
      client,
      [target],
      options,
      recordingReporter(),
    );

    expect(client.saves).toEqual([]);
    expect(client.uploads).toEqual([]);
    expect(outcomes[0]?.status).toBe('created');
  });

  it('calls an item unchanged only when text and assets both match', async () => {
    const markdown = article('A', 'slug: a');
    const same = stubSite({
      items: [
        { id: '1', slug: 'a', markdown, assets: {}, path: '/articles/a' },
      ],
    });
    const changed = stubSite({
      items: [
        {
          id: '1',
          slug: 'a',
          markdown: `${markdown}\n\nEdited.`,
          assets: {},
          path: '/articles/a',
        },
      ],
    });

    const [unchanged] = await publishBundles(
      same,
      [target],
      options,
      recordingReporter(),
    );
    const [updated] = await publishBundles(
      changed,
      [target],
      options,
      recordingReporter(),
    );

    expect(unchanged?.status).toBe('unchanged');
    expect(unchanged?.path).toBe('/articles/a');
    expect(updated?.status).toBe('updated');
  });

  it('still reports when the lookup itself fails', async () => {
    const broken = {
      ...stubSite(),
      get: async (): Promise<never> => {
        throw new CliError(EXIT.remote, 'The site returned 500.');
      },
    };

    const outcomes = await publishBundles(
      broken,
      [target],
      options,
      recordingReporter(),
    );

    expect(outcomes[0]?.status).toBe('created');
  });
});

describe('the missing-file report', () => {
  const outcome = (missing: string[]): PublishOutcome => ({
    bundle: 'a',
    locale: 'en',
    kind: 'article',
    status: 'updated',
    missing,
  });

  it('says nothing when nothing is missing', () => {
    const report = recordingReporter();

    reportMissing([outcome([])], [], report, false);

    expect(report.lines).toEqual([]);
  });

  it('counts items and files, and names the unfilled image slots', () => {
    const report = recordingReporter();

    reportMissing(
      [outcome(['images/one.png', 'images/two.png'])],
      [
        bundle('a', [{ locale: 'en', markdown: article('A') }], {
          unfilledSlots: ['hero'],
        }),
      ],
      report,
      false,
    );

    expect(report.lines[0]).toBe(
      '! 1 item references 2 files that are not present:',
    );
    expect(report.lines.join('\n')).toContain('image slots not yet filled');
  });

  it('fails the run only when --fail-on-missing was set', () => {
    expect(() =>
      reportMissing([outcome(['x.png'])], [], recordingReporter(), false),
    ).not.toThrow();

    expect(() =>
      reportMissing([outcome(['x.png'])], [], recordingReporter(), true),
    ).toThrow('--fail-on-missing');

    // An unfilled slot is enough on its own.
    expect(() =>
      reportMissing(
        [outcome([])],
        [
          bundle('a', [{ locale: 'en', markdown: article('A') }], {
            unfilledSlots: ['hero'],
          }),
        ],
        recordingReporter(),
        true,
      ),
    ).toThrow('--fail-on-missing');
  });

  it('reports each server-side warning once', () => {
    const report = recordingReporter();

    reportWarnings(
      [{ ...outcome([]), warning: 'Saved as a draft.' }, outcome([])],
      report,
    );

    expect(report.lines).toEqual(['!     a (en): Saved as a draft.']);
  });
});
