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
import { loadSiteRenderData } from '../../src/db/queries.js';
import { definePlugin } from '../../src/plugins/define.js';
import { inquiryPlugin } from '../../src/plugins/inquiry/index.js';
import type { PluginContext } from '../../src/plugins/types.js';
import { resetBootForTests } from '../../src/worker/bootstrap.js';
import {
  activeTheme,
  compiledPlugins,
  configure,
} from '../../src/worker/composition.js';
import {
  activePlugins,
  buildPluginContext,
} from '../../src/worker/plugin-runtime.js';
import { handleScheduled } from '../../src/worker/scheduled.js';
import { parseSiteSettings } from '../../src/worker/site.js';

/**
 * Scheduled hooks that cannot take each other down, and the job API
 * (docs/PLUGIN_API.md §5.5, §7.4).
 */

const ORIGIN = 'https://plugin-jobs.example';
const EMAIL = 'jobs@example.com';
const PASSWORD = 'a sufficiently long password';

let alphaThrows = false;
let workFails = false;
const scheduledRan: string[] = [];
const worked: unknown[] = [];

const alpha = definePlugin({
  manifest: {
    id: 'alpha',
    name: 'Alpha',
    version: '1.0.0',
    pluginApi: 2,
    hooks: ['scheduled'],
  },
  migrations: [
    {
      id: 'plugin:alpha:0001',
      sql: 'CREATE TABLE p_alpha_order (id TEXT PRIMARY KEY, status TEXT NOT NULL);',
    },
  ],
  hooks: {
    scheduled: async () => {
      scheduledRan.push('alpha');
      if (alphaThrows) {
        throw new Error('the exchange rate service is down');
      }
    },
  },
  jobs: {
    work: async (payload) => {
      if (workFails) {
        throw new Error('could not reach the warehouse');
      }
      worked.push(payload);
    },
  },
});

const beta = definePlugin({
  manifest: {
    id: 'beta',
    name: 'Beta',
    version: '1.0.0',
    pluginApi: 2,
    hooks: ['scheduled'],
  },
  hooks: {
    scheduled: async () => {
      scheduledRan.push('beta');
    },
  },
  jobs: {
    note: async (payload) => {
      worked.push({ beta: payload });
    },
  },
});

const tickCtx = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
  props: {},
} as unknown as ExecutionContext;

async function tick(): Promise<void> {
  await handleScheduled(env, tickCtx);
}

async function contextOf(pluginId: string): Promise<PluginContext> {
  const data = await loadSiteRenderData(env.DB);
  if (data.site === null) {
    throw new Error('no site');
  }
  const active = activePlugins(data.plugins).find(
    (candidate) => candidate.state.plugin_id === pluginId,
  );
  if (active === undefined) {
    throw new Error(`${pluginId} is not enabled`);
  }
  return buildPluginContext(env, tickCtx, parseSiteSettings(data.site), active);
}

interface Job {
  type: string;
  status: string;
  attempts: number;
  last_error: string | null;
  run_at: string;
  updated_at: string;
  payload: string;
}

async function job(id: string): Promise<Job> {
  const row = await env.DB.prepare('SELECT * FROM job WHERE id = ?')
    .bind(id)
    .first<Job>();
  if (row === null) {
    throw new Error('no such job');
  }
  return row;
}

/** Makes a job that is waiting out its backoff due now. */
async function makeDue(id: string): Promise<void> {
  await env.DB.prepare('UPDATE job SET run_at = ? WHERE id = ?')
    .bind(new Date(Date.now() - 1000).toISOString(), id)
    .run();
}

function events(
  spy: { readonly mock: { readonly calls: readonly (readonly unknown[])[] } },
  event: string,
): Record<string, unknown>[] {
  return spy.mock.calls
    .map((call): Record<string, unknown> => {
      try {
        return JSON.parse(String(call[0])) as Record<string, unknown>;
      } catch {
        return {};
      }
    })
    .filter((entry) => entry.event === event);
}

describe('scheduled hooks and plugin jobs', () => {
  const original = { theme: activeTheme(), plugins: compiledPlugins() };
  let admin: (
    method: string,
    path: string,
    body?: unknown,
  ) => Promise<Response>;

  beforeAll(async () => {
    configure({
      theme: original.theme,
      plugins: [inquiryPlugin, alpha, beta],
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
    admin = (method, path, body) =>
      SELF.fetch(`${ORIGIN}${path}`, {
        method,
        headers: {
          cookie,
          'x-mallok-csrf': csrf,
          'content-type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    for (const id of ['alpha', 'beta']) {
      await admin('POST', `/_mallok/api/plugins/${id}/enabled`, {
        enabled: true,
      });
    }
  });

  afterEach(async () => {
    alphaThrows = false;
    workFails = false;
    scheduledRan.length = 0;
    worked.length = 0;
    vi.restoreAllMocks();
    await env.DB.prepare("DELETE FROM job WHERE type LIKE 'plugin:%'").run();
  });

  afterAll(() => {
    configure(original);
    resetBootForTests();
  });

  it("runs every plugin's scheduled hook even when one throws, and names it", async () => {
    alphaThrows = true;
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    await tick();
    // Alpha is listed first and threw; Beta ran all the same.
    expect(scheduledRan).toEqual(['alpha', 'beta']);
    expect(events(error, 'plugin_scheduled_error')).toEqual([
      {
        event: 'plugin_scheduled_error',
        plugin: 'alpha',
        message: 'the exchange rate service is down',
      },
    ]);
  });

  describe('jobs', () => {
    it('queues a job and runs it in a later tick, once', async () => {
      const ctx = await contextOf('alpha');
      const id = await ctx.enqueue('work', { orderId: 'A-1', n: 3 });
      expect(await job(id)).toMatchObject({
        type: 'plugin:alpha:work',
        status: 'pending',
        attempts: 0,
        payload: '{"orderId":"A-1","n":3}',
      });
      expect(worked).toEqual([]);

      await tick();
      expect(worked).toEqual([{ orderId: 'A-1', n: 3 }]);
      expect((await job(id)).status).toBe('done');

      await tick();
      expect(worked).toHaveLength(1);
    });

    it('waits for runAt', async () => {
      const ctx = await contextOf('alpha');
      const id = await ctx.enqueue('work', 'later', {
        runAt: new Date(Date.now() + 60 * 60 * 1000),
      });
      await tick();
      expect(worked).toEqual([]);
      await makeDue(id);
      await tick();
      expect(worked).toEqual(['later']);
    });

    it('retries a failing job at 2, 4, 8 and 16 minutes, then marks it failed', async () => {
      const warn = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      const ctx = await contextOf('alpha');
      const id = await ctx.enqueue('work', 'doomed');
      workFails = true;

      const waits: number[] = [];
      for (let attempt = 1; attempt <= 5; attempt++) {
        await tick();
        const row = await job(id);
        expect(row.attempts).toBe(attempt);
        expect(row.last_error).toBe('could not reach the warehouse');
        if (attempt < 5) {
          expect(row.status).toBe('pending');
          waits.push(
            Math.round(
              (Date.parse(row.run_at) - Date.parse(row.updated_at)) / 60_000,
            ),
          );
          // Not due yet: another tick now does nothing.
          await tick();
          expect((await job(id)).attempts).toBe(attempt);
          await makeDue(id);
        } else {
          expect(row.status).toBe('failed');
        }
      }
      expect(waits).toEqual([2, 4, 8, 16]);
      const logged = events(warn, 'plugin_job_failed');
      expect(logged).toHaveLength(5);
      expect(logged.map((entry) => entry.final)).toEqual([
        false,
        false,
        false,
        false,
        true,
      ]);
      expect(logged[0]).toMatchObject({ plugin: 'alpha', job: 'work' });

      // Given up for good: fixing the cause does not bring it back by itself.
      workFails = false;
      await makeDue(id);
      await tick();
      expect(worked).toEqual([]);

      // And the admin can see it.
      const diagnostics = (await (
        await admin('GET', '/_mallok/api/diagnostics')
      ).json()) as {
        failedJobs: { type: string; lastError: string; updatedAt: string }[];
      };
      expect(diagnostics.failedJobs).toMatchObject([
        {
          type: 'plugin:alpha:work',
          lastError: 'could not reach the warehouse',
        },
      ]);
    });

    it('succeeds on a later attempt when the cause goes away', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const ctx = await contextOf('alpha');
      const id = await ctx.enqueue('work', 'flaky');
      workFails = true;
      await tick();
      workFails = false;
      await makeDue(id);
      await tick();
      expect(worked).toEqual(['flaky']);
      expect(await job(id)).toMatchObject({ status: 'done', attempts: 1 });
    });

    it('runs a bounded number per tick, oldest first, across plugins', async () => {
      const first = await contextOf('alpha');
      const second = await contextOf('beta');
      for (let n = 1; n <= 4; n++) {
        await first.enqueue('work', n, {
          runAt: new Date(Date.now() - (10 - n) * 1000),
        });
      }
      for (let n = 5; n <= 7; n++) {
        await second.enqueue('note', n, {
          runAt: new Date(Date.now() - (10 - n) * 1000),
        });
      }
      await tick();
      expect(worked).toEqual([1, 2, 3, 4, { beta: 5 }]);
      await tick();
      expect(worked).toEqual([
        1,
        2,
        3,
        4,
        { beta: 5 },
        { beta: 6 },
        { beta: 7 },
      ]);
    });

    it('counts a Worker that stopped mid-job as a failed attempt, and runs the job again', async () => {
      const warn = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      const ctx = await contextOf('alpha');
      const id = await ctx.enqueue('work', 'twice');
      const abandon = async (): Promise<void> => {
        // Claimed eleven minutes ago by a Worker that never came back.
        await env.DB.prepare(
          "UPDATE job SET status = 'running', updated_at = ? WHERE id = ?",
        )
          .bind(new Date(Date.now() - 11 * 60 * 1000).toISOString(), id)
          .run();
      };
      await abandon();
      await tick();
      expect(await job(id)).toMatchObject({
        status: 'pending',
        attempts: 1,
        last_error: 'The Worker stopped while this job was running.',
      });
      // It waits out the same backoff as any failure.
      expect(worked).toEqual([]);
      expect(events(warn, 'plugin_job_failed')).toMatchObject([
        { plugin: 'alpha', job: 'work', attempt: 1, final: false },
      ]);

      await makeDue(id);
      await tick();
      // At least once: a handler has to be safe to repeat.
      expect(worked).toEqual(['twice']);
      expect((await job(id)).status).toBe('done');
    });

    it('gives up on a job whose Worker stops every time', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const ctx = await contextOf('alpha');
      const id = await ctx.enqueue('work', 'poison');
      for (let attempt = 1; attempt <= 5; attempt++) {
        await env.DB.prepare(
          "UPDATE job SET status = 'running', updated_at = ? WHERE id = ?",
        )
          .bind(new Date(Date.now() - 11 * 60 * 1000).toISOString(), id)
          .run();
        await tick();
        expect((await job(id)).attempts).toBe(attempt);
      }
      expect((await job(id)).status).toBe('failed');
      expect(worked).toEqual([]);
    });

    it('leaves a claim that is still fresh alone', async () => {
      const ctx = await contextOf('alpha');
      const id = await ctx.enqueue('work', 'busy');
      await env.DB.prepare(
        "UPDATE job SET status = 'running', updated_at = ? WHERE id = ?",
      )
        .bind(new Date(Date.now() - 60 * 1000).toISOString(), id)
        .run();
      await tick();
      expect(await job(id)).toMatchObject({ status: 'running', attempts: 0 });
      expect(worked).toEqual([]);
    });

    it('leaves the jobs of a plugin that is switched off waiting', async () => {
      const ctx = await contextOf('beta');
      await ctx.enqueue('note', 'patient');
      await admin('POST', '/_mallok/api/plugins/beta/enabled', {
        enabled: false,
      });
      await tick();
      expect(worked).toEqual([]);
      await admin('POST', '/_mallok/api/plugins/beta/enabled', {
        enabled: true,
      });
      await tick();
      expect(worked).toEqual([{ beta: 'patient' }]);
    });

    it('refuses a job it could never run, where the author sees it', async () => {
      const ctx = await contextOf('alpha');
      await expect(ctx.enqueue('nothing', {})).rejects.toThrow(
        /no job named "nothing"/,
      );
      // Another plugin's job is not this plugin's to queue.
      await expect(ctx.enqueue('note', {})).rejects.toThrow(/no job named/);
      await expect(ctx.enqueue('work', 'x'.repeat(16 * 1024))).rejects.toThrow(
        /at most 16384 bytes/,
      );
      const loop: Record<string, unknown> = {};
      loop.self = loop;
      await expect(ctx.enqueue('work', loop)).rejects.toThrow();
      expect(() => ctx.enqueueStatement('nothing', {})).toThrow(/no job named/);
      const count = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM job WHERE type LIKE 'plugin:%'",
      ).first<{ n: number }>();
      expect(count?.n).toBe(0);
    });
  });

  describe("a job queued inside the plugin's own batch", () => {
    async function counts(): Promise<{ orders: number; jobs: number }> {
      const [orders, jobs] = await env.DB.batch<{ n: number }>([
        env.DB.prepare('SELECT COUNT(*) AS n FROM p_alpha_order'),
        env.DB.prepare(
          "SELECT COUNT(*) AS n FROM job WHERE type = 'plugin:alpha:work'",
        ),
      ]);
      return {
        orders: orders?.results[0]?.n ?? 0,
        jobs: jobs?.results[0]?.n ?? 0,
      };
    }

    it('commits with the change it follows', async () => {
      const ctx = await contextOf('alpha');
      await ctx.db.batch([
        ctx.db.prepare(
          "INSERT INTO p_alpha_order (id, status) VALUES ('o-1', 'paid')",
        ),
        ctx.enqueueStatement('work', { orderId: 'o-1' }),
      ]);
      expect(await counts()).toEqual({ orders: 1, jobs: 1 });
      await tick();
      expect(worked).toEqual([{ orderId: 'o-1' }]);
    });

    it('is not queued when the batch fails: no order, no job', async () => {
      const ctx = await contextOf('alpha');
      const before = await counts();
      await expect(
        ctx.db.batch([
          ctx.enqueueStatement('work', { orderId: 'o-2' }),
          ctx.db.prepare(
            "INSERT INTO p_alpha_order (id, status) VALUES ('o-2', 'paid')",
          ),
          // The same order again: the batch is rolled back as a whole.
          ctx.db.prepare(
            "INSERT INTO p_alpha_order (id, status) VALUES ('o-2', 'paid')",
          ),
        ]),
      ).rejects.toThrow();
      expect(await counts()).toEqual(before);
      await tick();
      expect(worked).toEqual([]);
    });
  });
});

describe('definePlugin and jobs', () => {
  const manifest = { id: 'acme', name: 'Acme', version: '1.0.0' };
  const said = (build: () => unknown): string => {
    try {
      build();
    } catch (error) {
      return (error as Error).message;
    }
    throw new Error('expected a refusal');
  };

  it('takes jobs under plugin API 2 only, with usable names', () => {
    const work = async () => undefined;
    expect(
      Object.keys(
        definePlugin({
          manifest: { ...manifest, pluginApi: 2 },
          jobs: { work },
        }).jobs ?? {},
      ),
    ).toEqual(['work']);
    expect(
      said(() =>
        definePlugin({
          manifest: { ...manifest, pluginApi: 1 },
          jobs: { work },
        }),
      ),
    ).toMatch(/defines jobs, which need plugin API 2/);
    expect(
      said(() =>
        definePlugin({
          manifest: { ...manifest, pluginApi: 2 },
          jobs: { 'Bad-Name': work },
        }),
      ),
    ).toMatch(/job name "Bad-Name" is not valid/);
    expect(
      said(() =>
        definePlugin({
          manifest: { ...manifest, pluginApi: 2 },
          jobs: { work: 'soon' as never },
        }),
      ),
    ).toMatch(/job "work" is not a function/);
  });
});
