/**
 * The `renderData` hook: plugin data read while a page is rendered
 * (docs/PLUGIN_API.md §5.6).
 *
 * It is the one hook on the render path that may touch the database, so
 * everything here exists to keep that from costing the page its guarantees:
 *
 * - **The round-trip budget.** A cold render may make four D1 round trips
 *   (`AC-INV-05`) and the core uses two. Each hook gets one call, and at most
 *   {@link RENDER_DATA_PLUGINS_MAX} plugins run per page.
 * - **Determinism.** The hook gets a database that only reads, and nothing
 *   about the request beyond the page it is for.
 * - **Availability.** A hook that fails takes its own data with it and
 *   nothing else: the page renders, the failure is logged, and that page is
 *   not stored in the edge cache.
 */

import type { PluginsView } from '../core/index.js';
import type { PluginStateRow } from '../db/queries.js';
import type { PluginRenderDataContext } from '../plugins/types.js';
import { compiledPlugins } from './composition.js';
import { activePlugins } from './plugin-runtime.js';

/**
 * How many plugins may run `renderData` on one page: the two round trips the
 * core leaves free out of four. The first in the order the site compiles its
 * plugins run; a later one is skipped and logged.
 */
export const RENDER_DATA_PLUGINS_MAX = 2;

/** How much of a failure's message reaches the log. */
const REASON_MAX = 200;

const ONE_CALL =
  'renderData may make one database call per render: one query or one batch.';
const READ_ONLY =
  'renderData may only read: a statement must be a single SELECT (or WITH … SELECT).';

/** What one guarded database has been asked to do. */
interface GuardState {
  calls: number;
  /** The first rule the hook broke, kept even when the hook caught the error. */
  violation: string | null;
}

/**
 * Says why `sql` is not a single read, or `null` when it is.
 *
 * The check is by keyword, not by parsing: the statement must start with
 * `SELECT`, or with `WITH` and contain no `INSERT`, `UPDATE` or `DELETE`, and
 * must not carry a second statement. It exists to catch a mistake early, not
 * to contain hostile code — a plugin is trusted source — and it can refuse a
 * legitimate query that spells one of those words in a literal; bind the
 * value instead.
 */
export function readOnlyProblem(sql: string): string | null {
  const body = sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .trim()
    .replace(/;\s*$/, '');
  if (body.includes(';')) {
    return READ_ONLY;
  }
  const first = /^[a-z]+/i.exec(body)?.[0].toUpperCase();
  if (first === 'SELECT') {
    return null;
  }
  if (first === 'WITH' && !/\b(?:INSERT|UPDATE|DELETE)\b/i.test(body)) {
    return null;
  }
  return READ_ONLY;
}

/**
 * Wraps the D1 binding for one hook call: reads only, and one round trip.
 *
 * A broken rule throws at the call that broke it and is also recorded, so a
 * hook that catches the error and carries on is still treated as failed.
 */
export function guardRenderDataDb(real: D1Database): {
  db: D1Database;
  state: GuardState;
} {
  const state: GuardState = { calls: 0, violation: null };
  const originals = new WeakMap<object, D1PreparedStatement>();

  const refuse = (message: string): never => {
    state.violation ??= message;
    throw new Error(message);
  };
  const claim = (): void => {
    state.calls += 1;
    if (state.calls > 1) {
      refuse(ONE_CALL);
    }
  };

  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
    const run =
      (method: 'first' | 'all' | 'run' | 'raw') =>
      (...args: unknown[]): unknown => {
        claim();
        return (statement[method] as (...a: unknown[]) => unknown)(...args);
      };
    const wrapped = {
      bind: (...values: unknown[]) => wrap(statement.bind(...values)),
      first: run('first'),
      all: run('all'),
      run: run('run'),
      raw: run('raw'),
    } as unknown as D1PreparedStatement;
    originals.set(wrapped, statement);
    return wrapped;
  };

  const db = {
    prepare: (sql: string) => {
      const problem = readOnlyProblem(sql);
      if (problem !== null) {
        refuse(problem);
      }
      return wrap(real.prepare(sql));
    },
    batch: (statements: D1PreparedStatement[]) => {
      const unwrapped = statements.map(
        (statement) =>
          originals.get(statement) ??
          refuse('renderData may only run statements it prepared on ctx.db.'),
      );
      claim();
      return real.batch(unwrapped);
    },
    exec: () => refuse(READ_ONLY),
    dump: () => refuse(READ_ONLY),
    withSession: () =>
      refuse('renderData may not open a database session of its own.'),
  } as unknown as D1Database;

  return { db, state };
}

/** The page a set of `renderData` hooks is run for. */
export type RenderDataPage = Omit<PluginRenderDataContext, 'db' | 'settings'>;

/** What the hooks returned, and whether any of them failed. */
export interface RenderDataResult {
  readonly plugins: PluginsView;
  /**
   * True when a hook failed. The page is still rendered, without that
   * plugin's data, and must not be stored in the edge cache: the next request
   * should try again rather than be served the lesser page for a whole TTL.
   */
  readonly degraded: boolean;
}

const NOTHING: RenderDataResult = { plugins: {}, degraded: false };

/**
 * Runs the enabled plugins' `renderData` hooks for one page, concurrently.
 *
 * Never rejects. The keys of the result follow the order the site compiles
 * its plugins in, not the order the hooks finished in, so the same database
 * state always produces the same view.
 */
export async function runRenderData(
  db: D1Database,
  rows: readonly PluginStateRow[],
  page: RenderDataPage,
): Promise<RenderDataResult> {
  const order = new Map(
    compiledPlugins().map((plugin, index) => [plugin.manifest.id, index]),
  );
  const candidates = activePlugins(rows)
    .filter(({ plugin }) => plugin.hooks?.renderData !== undefined)
    .sort(
      (left, right) =>
        (order.get(left.state.plugin_id) ?? 0) -
        (order.get(right.state.plugin_id) ?? 0),
    );
  if (candidates.length === 0) {
    return NOTHING;
  }

  for (const skipped of candidates.slice(RENDER_DATA_PLUGINS_MAX)) {
    // A standing property of the site's composition, not a failure of this
    // request: the page is cacheable, it just has no data from this plugin.
    console.warn(
      JSON.stringify({
        event: 'render_data_skipped',
        plugin: skipped.state.plugin_id,
        path: page.path,
        reason: `At most ${RENDER_DATA_PLUGINS_MAX} plugins may use renderData on a page.`,
      }),
    );
  }

  const outcomes = await Promise.all(
    candidates.slice(0, RENDER_DATA_PLUGINS_MAX).map(async (active) => {
      const id = active.state.plugin_id;
      const { db: guarded, state } = guardRenderDataDb(db);
      try {
        const returned: unknown = await active.plugin.hooks?.renderData?.({
          ...page,
          db: guarded,
          settings: active.settings,
        });
        if (state.violation !== null) {
          throw new Error(state.violation);
        }
        return { id, data: plainObject(returned), failed: false };
      } catch (error) {
        console.warn(
          JSON.stringify({
            event: 'render_data_failed',
            plugin: id,
            path: page.path,
            reason: (error instanceof Error
              ? error.message
              : String(error)
            ).slice(0, REASON_MAX),
          }),
        );
        return { id, data: undefined, failed: true };
      }
    }),
  );

  const plugins: Record<string, Readonly<Record<string, unknown>>> = {};
  for (const outcome of outcomes) {
    if (outcome.data !== undefined) {
      plugins[viewKey(outcome.id)] = outcome.data;
    }
  }
  return { plugins, degraded: outcomes.some((outcome) => outcome.failed) };
}

/**
 * The key a plugin's data has in the view: its id with hyphens as
 * underscores, the same spelling its table prefix uses, so a template can
 * write `plugins.my_shop` rather than a bracketed lookup.
 */
function viewKey(pluginId: string): string {
  return pluginId.replace(/-/g, '_');
}

/**
 * Reduces what a hook returned to plain JSON data.
 *
 * The round trip is the enforcement of "JSON-serialisable": whatever cannot
 * be serialised either disappears (a function) or throws (a cycle, a
 * BigInt), and what remains is plain objects the template engine can read.
 * `undefined` means the plugin has nothing for this page.
 */
function plainObject(
  value: unknown,
): Readonly<Record<string, unknown>> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('renderData must return an object or undefined.');
  }
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}
