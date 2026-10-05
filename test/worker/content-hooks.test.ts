import { env, SELF } from 'cloudflare:test';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { SiteClient } from '../../src/cli/client.js';
import type { Reporter } from '../../src/cli/output.js';
import { publishBundles } from '../../src/cli/publish.js';
import type { Bundle } from '../../src/cli/scan.js';
import { definePlugin } from '../../src/plugins/define.js';
import { inquiryPlugin } from '../../src/plugins/inquiry/index.js';
import type {
  ContentDeleteRef,
  ContentDraft,
} from '../../src/plugins/types.js';
import { resetBootForTests } from '../../src/worker/bootstrap.js';
import {
  activeTheme,
  compiledPlugins,
  configure,
} from '../../src/worker/composition.js';

/**
 * The content hooks (docs/PLUGIN_API.md §5.4, §5.7).
 *
 * `onContentSave` was documented and typed from the first plugin API, and
 * nothing ever called it. A plugin that kept data beside a product had no way
 * to learn the product had been saved, or deleted.
 */

const ORIGIN = 'https://content-hooks.example';
const EMAIL = 'hooks@example.com';
const PASSWORD = 'a sufficiently long password';
const STAMP = '\n\n<!-- stamped -->\n';

type SaveMode = 'watch' | 'stamp' | 'reject' | 'grow' | 'untitle' | 'throw';
let saveMode: SaveMode = 'watch';
let deleteFails = false;
const drafts: ContentDraft[] = [];
const secondSaw: string[] = [];
const deleted: ContentDeleteRef[] = [];
const alsoDeleted: string[] = [];

/** Written for plugin API 1: the save hook has been in the contract since. */
const audit = definePlugin({
  manifest: {
    id: 'audit',
    name: 'Audit',
    version: '1.0.0',
    pluginApi: 1,
    hooks: ['onContentSave'],
  },
  hooks: {
    onContentSave: async (draft) => {
      drafts.push(draft);
      if (saveMode === 'reject') {
        throw new Error('A product needs a SKU before it can be saved.');
      }
      if (saveMode === 'stamp') {
        // Idempotent: the same input always gives the same output.
        return draft.markdown.includes(STAMP)
          ? undefined
          : { markdown: `${draft.markdown}${STAMP}` };
      }
      if (saveMode === 'grow') {
        return { markdown: `${draft.markdown}\n${'word '.repeat(12_000)}` };
      }
      if (saveMode === 'untitle') {
        return { markdown: 'No front matter at all.' };
      }
      return undefined;
    },
  },
});

/** Runs after `audit`, and after a delete. */
const follower = definePlugin({
  manifest: {
    id: 'follower',
    name: 'Follower',
    version: '1.0.0',
    pluginApi: 2,
    hooks: ['onContentSave', 'onContentDelete'],
  },
  hooks: {
    onContentSave: async (draft) => {
      secondSaw.push(draft.markdown);
      return undefined;
    },
    onContentDelete: async (ref) => {
      deleted.push(ref);
      if (deleteFails) {
        throw new Error('could not drop the variants');
      }
    },
  },
});

const sweeper = definePlugin({
  manifest: {
    id: 'sweeper',
    name: 'Sweeper',
    version: '1.0.0',
    pluginApi: 2,
    hooks: ['onContentDelete'],
  },
  hooks: {
    onContentDelete: async (ref) => {
      alsoDeleted.push(ref.id);
    },
  },
});

let token = '';

async function api(
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/_mallok/api${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function save(
  slug: string,
  body: string,
  extra: Record<string, unknown> = {},
): Promise<Response> {
  return api('POST', '/content', {
    kind: 'article',
    slug,
    markdown: `---\ntitle: ${slug}\nsku: ${slug}-1\n---\n\n${body}\n`,
    ...extra,
  });
}

async function stored(slug: string): Promise<string | null> {
  const row = await env.DB.prepare(
    'SELECT markdown FROM content WHERE slug = ?',
  )
    .bind(slug)
    .first<{ markdown: string }>();
  return row?.markdown ?? null;
}

async function enable(id: string, enabled = true): Promise<void> {
  await api('POST', `/plugins/${id}/enabled`, { enabled });
}

describe('content hooks', () => {
  const original = { theme: activeTheme(), plugins: compiledPlugins() };

  beforeAll(async () => {
    configure({
      theme: original.theme,
      plugins: [inquiryPlugin, audit, follower, sweeper],
    });
    resetBootForTests();

    await SELF.fetch(`${ORIGIN}/`);
    await SELF.fetch(`${ORIGIN}/_mallok/api/auth/bootstrap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    const session = await SELF.fetch(`${ORIGIN}/_mallok/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    const cookie =
      (session.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const { csrf } = (await session.json()) as { csrf: string };
    const minted = await SELF.fetch(`${ORIGIN}/_mallok/api/tokens`, {
      method: 'POST',
      headers: {
        cookie,
        'x-mallok-csrf': csrf,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'hooks',
        scopes: ['content:write', 'settings:write'],
      }),
    });
    token = ((await minted.json()) as { token: string }).token;
    await api('PATCH', '/settings', { locales: ['en', 'de'] });
    for (const id of ['audit', 'follower', 'sweeper']) {
      await enable(id);
    }
  });

  afterEach(() => {
    saveMode = 'watch';
    deleteFails = false;
    drafts.length = 0;
    secondSaw.length = 0;
    deleted.length = 0;
    alsoDeleted.length = 0;
    vi.restoreAllMocks();
  });

  afterAll(() => {
    configure(original);
    resetBootForTests();
  });

  describe('onContentSave', () => {
    it('is called with the draft before anything is stored', async () => {
      const response = await save('first', 'Body.', { status: 'draft' });
      expect(response.status).toBe(201);
      expect(drafts).toHaveLength(1);
      expect(drafts[0]).toMatchObject({
        kind: 'article',
        locale: 'en',
        slug: 'first',
        title: 'first',
        status: 'draft',
      });
      expect(drafts[0]?.frontmatter.sku).toBe('first-1');
      expect(drafts[0]?.markdown).toContain('Body.');
    });

    it("stores and renders the hook's Markdown, and hands it to the next plugin", async () => {
      saveMode = 'stamp';
      const response = await save('stamped', 'Stamped body.');
      expect(response.status).toBe(201);
      const { path } = (await response.json()) as { path: string };

      expect(await stored('stamped')).toContain(STAMP);
      // The plugin after it sees what the first one returned.
      expect(secondSaw).toHaveLength(1);
      expect(secondSaw[0]).toContain(STAMP);
      // Stage one ran on the hook's result, not on what was submitted.
      const fragment = await env.DB.prepare(
        `SELECT render_cache.html FROM render_cache
           JOIN content ON content.id = render_cache.content_id
          WHERE content.slug = 'stamped'`,
      ).first<{ html: string }>();
      expect(fragment?.html).toContain('Stamped body.');
      expect((await SELF.fetch(`${ORIGIN}${path}`)).status).toBe(200);
    });

    it('reports the same file published again as unchanged', async () => {
      saveMode = 'stamp';
      const again = await save('stamped', 'Stamped body.');
      expect(again.status).toBe(200);
      expect(((await again.json()) as { unchanged?: boolean }).unchanged).toBe(
        true,
      );
      // The hook still ran: the comparison is on its answer.
      expect(drafts).toHaveLength(1);
      expect(drafts[0]?.markdown).not.toContain(STAMP);
    });

    it("compares the hook's answer, so a hook that now answers differently is a change", async () => {
      // Same file as before, but the plugin no longer stamps it. What would
      // be stored differs from what is stored, so this is an update — the
      // submitted bytes being the same as last time does not make it a no-op.
      const response = await save('stamped', 'Stamped body.');
      expect(response.status).toBe(200);
      expect(
        ((await response.json()) as { unchanged?: boolean }).unchanged,
      ).toBeUndefined();
      expect(await stored('stamped')).not.toContain(STAMP);
    });

    it('lets a plugin refuse the save, with its own words, and stores nothing', async () => {
      saveMode = 'reject';
      const response = await save('refused', 'Body.');
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({
        error: 'A product needs a SKU before it can be saved.',
        rejectedBy: 'audit',
      });
      expect(await stored('refused')).toBeNull();
      // Nothing after the refusal ran.
      expect(secondSaw).toHaveLength(0);

      // An existing item is left exactly as it was.
      const before = await stored('first');
      const update = await save('first', 'A different body.');
      expect(update.status).toBe(422);
      expect(await stored('first')).toBe(before);
    });

    it('applies the length safety net to what the hook returned', async () => {
      saveMode = 'grow';
      const response = await save('grown', 'Short.');
      expect(response.status).toBe(201);
      const result = (await response.json()) as {
        status: string;
        warning?: string;
      };
      // The submitted body was a few bytes; the plugin made it too long to
      // render safely, and that is what counts.
      expect(result.status).toBe('draft');
      expect(result.warning).toContain('Saved as a draft without rendering');
    });

    it('refuses a rewrite that can no longer be saved', async () => {
      saveMode = 'untitle';
      const response = await save('untitled', 'Body.');
      expect(response.status).toBe(422);
      expect(((await response.json()) as { error: string }).error).toContain(
        'A plugin rewrote this item into something that cannot be saved',
      );
      expect(await stored('untitled')).toBeNull();
    });

    it('does not call a plugin that is switched off', async () => {
      await enable('audit', false);
      saveMode = 'reject';
      const response = await save('unwatched', 'Body.');
      await enable('audit');
      expect(response.status).toBe(201);
      expect(drafts).toHaveLength(0);
      expect(secondSaw).toHaveLength(1);
    });

    it('runs for `mallok publish`, which takes the same path', async () => {
      const parsed = async <T>(response: Response): Promise<T> => {
        if (!response.ok) {
          throw new Error(`${response.status} ${await response.text()}`);
        }
        return (await response.json()) as T;
      };
      const client: SiteClient = {
        origin: ORIGIN,
        get: async <T>(path: string) => parsed<T>(await api('GET', path)),
        post: async <T>(path: string, body: unknown) =>
          parsed<T>(await api('POST', path, body)),
        patch: async <T>(path: string, body: unknown) =>
          parsed<T>(await api('PATCH', path, body)),
        put: () => Promise.reject(new Error('not used')),
        bytes: () => Promise.reject(new Error('not used')),
      };
      const silent: Reporter = {
        json: false,
        step: () => {},
        warn: () => {},
        done: () => {},
      };
      const bundle = (body: string): Bundle => ({
        name: 'from-cli',
        dir: '/content/article/from-cli',
        kind: 'article',
        documents: [
          {
            locale: 'en',
            fileName: 'index.md',
            markdown: `---\ntitle: From the CLI\n---\n\n${body}\n`,
            assets: new Map(),
            missing: [],
          },
        ],
        identity: null,
        unfilledSlots: [],
      });
      const run = (body: string) =>
        publishBundles(
          client,
          [bundle(body)],
          {
            mode: 'publish',
            draft: false,
            createOnly: false,
            dryRun: false,
            failOnMissing: false,
            widths: [],
            maxEdge: null,
            defaultLocale: 'en',
          },
          silent,
        );

      saveMode = 'stamp';
      const first = await run('Published body.');
      expect(first[0]?.status).not.toBe('failed');
      expect(await stored('from-cli')).toContain(STAMP);
      // The file on disk never had the stamp; publishing it again is still
      // a no-op, because the hook gives the same answer.
      expect(
        (await run('Published body.')).map((outcome) => outcome.status),
      ).toEqual(['unchanged']);

      saveMode = 'reject';
      const refused = await run('Edited.');
      expect(refused[0]?.status).toBe('failed');
      expect(refused[0]?.error).toContain('needs a SKU');
      expect(await stored('from-cli')).toContain('Published body.');
    });
  });

  describe('onContentDelete', () => {
    async function create(slug: string, locale: string, group?: string) {
      const response = await api('POST', '/content', {
        kind: 'article',
        slug,
        locale,
        markdown: `---\ntitle: ${slug} ${locale}\n---\n\nBody.\n`,
        ...(group === undefined ? {} : { translationGroup: group }),
      });
      return (await response.json()) as {
        id: string;
        translationGroup: string;
      };
    }

    it('tells plugins what was deleted, and when it was the last language', async () => {
      const english = await create('paired', 'en');
      const german = await create('paired', 'de', english.translationGroup);
      expect(german.translationGroup).toBe(english.translationGroup);

      const first = await api('DELETE', `/content/${german.id}`);
      expect(await first.json()).toEqual({ ok: true, id: german.id });
      const second = await api('DELETE', `/content/${english.id}`);
      expect(second.status).toBe(200);

      expect(deleted).toEqual([
        {
          id: german.id,
          kind: 'article',
          locale: 'de',
          translationGroup: english.translationGroup,
          lastInGroup: false,
        },
        {
          id: english.id,
          kind: 'article',
          locale: 'en',
          translationGroup: english.translationGroup,
          lastInGroup: true,
        },
      ]);
      // Called after the delete, not instead of it.
      expect(await stored('paired')).toBeNull();
      expect(alsoDeleted).toEqual([german.id, english.id]);
    });

    it('still deletes when a hook fails, runs the others, and says so', async () => {
      const item = await create('doomed', 'en');
      deleteFails = true;
      const warn = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      const response = await api('DELETE', `/content/${item.id}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        ok: true,
        id: item.id,
        hookFailed: ['follower'],
      });
      expect(await stored('doomed')).toBeNull();
      expect(alsoDeleted).toEqual([item.id]);
      expect(
        warn.mock.calls.map((call) => JSON.parse(String(call[0])) as object),
      ).toEqual([
        {
          event: 'content_delete_hook_failed',
          plugin: 'follower',
          content: item.id,
          reason: 'could not drop the variants',
        },
      ]);
    });

    it('calls nothing for an item that does not exist, or a plugin switched off', async () => {
      const missing = await api(
        'DELETE',
        '/content/00000000-0000-4000-8000-000000000000',
      );
      expect(missing.status).toBe(404);
      expect(deleted).toHaveLength(0);

      const item = await create('quiet', 'en');
      await enable('follower', false);
      await enable('sweeper', false);
      const response = await api('DELETE', `/content/${item.id}`);
      await enable('follower');
      await enable('sweeper');
      expect(await response.json()).toEqual({ ok: true, id: item.id });
      expect(deleted).toHaveLength(0);
      expect(alsoDeleted).toHaveLength(0);
    });
  });
});
