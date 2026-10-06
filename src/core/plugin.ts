/**
 * Plugin manifest (`plugin.json`) schema and helpers (docs/PLUGIN_API.md §4).
 *
 * Manifests are validated when the registry module loads, so a broken one
 * fails the build and the test suite, never a visitor request.
 */

import { z } from 'zod';
import { LOCALE_PATTERN } from './paths.js';
import { recordFieldsSchema, scalarFieldsSchema } from './records.js';

/** Version of the plugin contract this build understands. */
export const PLUGIN_API_VERSION = 2;

/** Hook points a plugin may declare (docs/PLUGIN_API.md §5). */
export const PLUGIN_HOOKS = [
  'onRequest',
  'beforeRender',
  'afterRender',
  'onContentSave',
  'scheduled',
  'renderData',
  'onContentDelete',
] as const;

/**
 * The plugin API version that introduced each hook. A hook absent from this
 * map has existed since version 1.
 */
const HOOK_SINCE: Readonly<
  Partial<Record<(typeof PLUGIN_HOOKS)[number], number>>
> = { renderData: 2, onContentDelete: 2 };

/** One declared hook name. */
export type PluginHookName = (typeof PLUGIN_HOOKS)[number];

/** The largest raw body a route may accept unless it declares its own cap. */
export const RAW_BODY_BYTES_DEFAULT = 256 * 1024;
/** The largest cap a route may declare. */
export const RAW_BODY_BYTES_LIMIT = 1024 * 1024;

/**
 * The rate-limit tiers a route may ask for (docs/PLUGIN_API.md §7.2). Each
 * is one binding in the site's `wrangler.jsonc`; the numbers live there.
 */
export const RATE_LIMIT_TIERS = ['strict', 'relaxed'] as const;

/** One rate-limit tier. */
export type RateLimitTier = (typeof RATE_LIMIT_TIERS)[number];

/**
 * The name a plugin route gives the layout it wants, and a theme gives the
 * layout it provides: `shop/cart`. Plugin and theme agree on it and on what
 * the view under it contains; the core only matches the two.
 */
export const PLUGIN_LAYOUT_NAME = /^[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)*$/;

/** A fixed route segment, and the whole of a version 1 route path. */
const ROUTE_LITERAL = /^[a-z][a-z0-9-]*$/;
/** A route segment that captures one path segment as a named parameter. */
const ROUTE_PARAMETER = /^:[A-Za-z][A-Za-z0-9]*$/;
/** How many segments a route path may have. */
const ROUTE_SEGMENTS_MAX = 6;

/**
 * A route path: fixed segments and `:parameters`, starting with a fixed one
 * (docs/PLUGIN_API.md §7.2). What a given plugin API version may use of this
 * is checked on the whole manifest, below.
 */
function isRoutePath(path: string): boolean {
  const segments = path.split('/');
  return (
    segments.length <= ROUTE_SEGMENTS_MAX &&
    ROUTE_LITERAL.test(segments[0] ?? '') &&
    segments.every(
      (segment) => ROUTE_LITERAL.test(segment) || ROUTE_PARAMETER.test(segment),
    )
  );
}

/** A path with its parameter names removed: what a request is matched on. */
function routeShape(path: string): string {
  return path
    .split('/')
    .map((segment) => (segment.startsWith(':') ? ':' : segment))
    .join('/');
}

const routeSchema = z
  .object({
    /** Path under `/_mallok/p/<plugin>/`. */
    path: z.string().refine(isRoutePath, {
      message:
        'A route path is lowercase segments separated by "/", each a name such as "orders" or a parameter such as ":orderNo", starting with a name.',
    }),
    method: z.enum(['GET', 'POST']),
    /** Verify a Turnstile token server-side before the handler runs. */
    turnstile: z.boolean().default(false),
    /**
     * Which of the site's rate-limit bindings guards the route, keyed by
     * plugin id, route and IP. `true` is the version 1 spelling of
     * `"strict"`; the named tiers need plugin API 2.
     */
    rateLimit: z.union([z.boolean(), z.enum(RATE_LIMIT_TIERS)]).default(false),
    /**
     * `"page"`: the handler returns a view and the theme's layout named by
     * `layout` renders it as a page of the site. Plugin API 2.
     */
    render: z.enum(['response', 'page']).default('response'),
    /** The plugin layout a `"page"` route is rendered with. */
    layout: z.string().regex(PLUGIN_LAYOUT_NAME).optional(),
    /**
     * `"raw"`: the core does not parse the body; the handler reads the bytes
     * exactly as they were sent from `ctx.request`. For a webhook whose
     * signature is computed over those bytes. Plugin API 2.
     */
    body: z.enum(['parsed', 'raw']).default('parsed'),
    /** `"raw"` only: the largest body accepted, in bytes. */
    maxBytes: z.number().int().positive().max(RAW_BODY_BYTES_LIMIT).optional(),
  })
  .strict();

/**
 * Plugin settings use only controls that need no access to site content or
 * media. Keeping this schema here also means unknown fields are rejected;
 * reusing the theme schema used to silently strip plugin-only typos.
 */
const pluginSettingSchema = z
  .object({
    type: z.enum([
      'string',
      'text',
      'number',
      'boolean',
      'date',
      'select',
      'string[]',
      'color',
      'keyvalue',
    ]),
    label: z.string().optional(),
    required: z.boolean().default(false),
    help: z.string().optional(),
    group: z.string().optional(),
    default: z.unknown().optional(),
    choices: z.array(z.string()).optional(),
    max: z.number().optional(),
    min: z.number().optional(),
  })
  .strict()
  .refine(
    (field) => field.type !== 'select' || (field.choices?.length ?? 0) > 0,
    { message: 'A "select" field must list its choices.' },
  );

const panelColumnSchema = z
  .object({
    field: z.string().regex(/^[a-z_][a-z0-9_]*$/),
    label: z.string(),
    type: z.enum(['text', 'email', 'datetime', 'badge']).default('text'),
    /** The list may be ordered by this column. Plugin API 2. */
    sortable: z.boolean().default(false),
  })
  .strict();

const panelSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    label: z.string(),
    /**
     * `table` lists rows and runs actions on them. `records` also creates
     * and edits them, through handlers the plugin provides. Plugin API 2.
     */
    type: z.enum(['table', 'records']),
    /** `records` only: the fields of the create and edit form. */
    fields: recordFieldsSchema.optional(),
    /**
     * `records` only: the panel belongs to content of one kind and is shown
     * in that kind's editor, for the item that is open. Its records are
     * keyed by the item's translation group — one set for every language —
     * held in `column` of the panel's table. Plugin API 2.
     */
    attachTo: z
      .object({
        kind: z.string().regex(/^[a-z][a-z0-9_]*$/),
        column: z
          .string()
          .regex(/^[a-z_][a-z0-9_]*$/)
          .default('translation_group'),
      })
      .strict()
      .optional(),
    /** Columns a text search looks in, by substring. Plugin API 2. */
    search: z.array(z.string().regex(/^[a-z_][a-z0-9_]*$/)).default([]),
    /** Must carry the plugin's `p_<id>_` prefix; checked below. */
    table: z.string().regex(/^[a-z_][a-z0-9_]*$/),
    columns: z.array(panelColumnSchema).min(1),
    /** Fields a viewer may filter by, equality only in 0.1. */
    filters: z.array(z.string().regex(/^[a-z_][a-z0-9_]*$/)).default([]),
    /** Extra fields shown in the row detail view. */
    detail: z.array(z.string().regex(/^[a-z_][a-z0-9_]*$/)).default([]),
    /** Column ordering the panel lists by, newest first. */
    orderBy: z
      .string()
      .regex(/^[a-z_][a-z0-9_]*$/)
      .default('created_at'),
    actions: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z_][a-z0-9_]*$/),
            label: z.string(),
            type: z.enum(['update', 'download']).default('update'),
            /**
             * Values the admin asks for before running the action — a
             * tracking number, a refund amount. Plugin API 2.
             */
            params: scalarFieldsSchema.optional(),
          })
          .strict(),
      )
      .default([]),
    /**
     * Child tables shown read-only with one row of the panel: the lines of
     * an order. Plugin API 2.
     */
    related: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z][a-z0-9-]*$/),
            label: z.string(),
            /** Must carry the plugin's `p_<id>_` prefix; checked below. */
            table: z.string().regex(/^[a-z_][a-z0-9_]*$/),
            /** The child table's column holding the parent row's id. */
            foreignKey: z.string().regex(/^[a-z_][a-z0-9_]*$/),
            columns: z.array(panelColumnSchema).min(1),
            orderBy: z
              .string()
              .regex(/^[a-z_][a-z0-9_]*$/)
              .optional(),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();

/** Schema for `plugin.json`. */
export const pluginManifestSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    name: z.string().min(1),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    description: z.string().optional(),
    pluginApi: z.number().int().positive().default(PLUGIN_API_VERSION),
    hooks: z.array(z.enum(PLUGIN_HOOKS)).default([]),
    routes: z.array(routeSchema).default([]),
    settings: z
      .record(z.string().regex(/^[a-z_][a-z0-9_]*$/), pluginSettingSchema)
      .default({}),
    secrets: z
      .record(
        z.string().regex(/^[a-z_][a-z0-9_]*$/),
        z
          .object({
            label: z.string(),
            required: z.boolean().default(false),
          })
          .strict(),
      )
      .default({}),
    panels: z.array(panelSchema).default([]),
    affectsFragmentCache: z.boolean().default(false),
    clientScripts: z
      .array(
        z
          .object({
            src: z.string(),
            purpose: z.string(),
            bytes: z.number().int().nonnegative().optional(),
          })
          .strict(),
      )
      .default([]),
  })
  .strict()
  .superRefine((manifest, issue) => {
    if (
      manifest.hooks.includes('beforeRender') &&
      !manifest.affectsFragmentCache
    ) {
      issue.addIssue({
        code: 'custom',
        message:
          'A plugin with a beforeRender hook must set affectsFragmentCache: true.',
      });
    }
    for (const hook of manifest.hooks) {
      const since = HOOK_SINCE[hook];
      if (since !== undefined && manifest.pluginApi < since) {
        issue.addIssue({
          code: 'custom',
          message: `The ${hook} hook needs plugin API ${since}; this plugin declares ${manifest.pluginApi}.`,
        });
      }
    }
    const panelIds = new Set<string>();
    const actionIds = new Set<string>();
    for (const panel of manifest.panels) {
      if (panelIds.has(panel.id)) {
        issue.addIssue({
          code: 'custom',
          message: `Panel "${panel.id}" is declared more than once.`,
        });
      }
      panelIds.add(panel.id);
      if (!panel.table.startsWith(`p_${manifest.id.replace(/-/g, '_')}_`)) {
        issue.addIssue({
          code: 'custom',
          message: `Panel table "${panel.table}" must start with "p_${manifest.id.replace(/-/g, '_')}_".`,
        });
      }
      if (panel.type === 'records') {
        if (manifest.pluginApi < 2) {
          issue.addIssue({
            code: 'custom',
            message: `Panel "${panel.id}" is a records panel, which needs plugin API 2; this plugin declares ${manifest.pluginApi}.`,
          });
        }
        if (Object.keys(panel.fields ?? {}).length === 0) {
          issue.addIssue({
            code: 'custom',
            message: `Records panel "${panel.id}" declares no fields to edit.`,
          });
        }
      } else if (panel.fields !== undefined) {
        issue.addIssue({
          code: 'custom',
          message: `Panel "${panel.id}" declares fields but is not a records panel.`,
        });
      }
      if (panel.attachTo !== undefined && panel.type !== 'records') {
        issue.addIssue({
          code: 'custom',
          message: `Panel "${panel.id}" is attached to content but is not a records panel.`,
        });
      }
      if (
        manifest.pluginApi < 2 &&
        (panel.search.length > 0 ||
          panel.columns.some((column) => column.sortable))
      ) {
        issue.addIssue({
          code: 'custom',
          message: `Panel "${panel.id}" declares sorting or search, which needs plugin API 2; this plugin declares ${manifest.pluginApi}.`,
        });
      }
      const prefix = `p_${manifest.id.replace(/-/g, '_')}_`;
      const relatedIds = new Set<string>();
      for (const related of panel.related) {
        if (!related.table.startsWith(prefix)) {
          issue.addIssue({
            code: 'custom',
            message: `Related table "${related.table}" must start with "${prefix}".`,
          });
        }
        if (relatedIds.has(related.id)) {
          issue.addIssue({
            code: 'custom',
            message: `Panel "${panel.id}" declares the related table "${related.id}" more than once.`,
          });
        }
        relatedIds.add(related.id);
      }
      if (
        manifest.pluginApi < 2 &&
        (panel.related.length > 0 ||
          panel.actions.some((action) => action.params !== undefined))
      ) {
        issue.addIssue({
          code: 'custom',
          message: `Panel "${panel.id}" declares action parameters or related rows, which need plugin API 2; this plugin declares ${manifest.pluginApi}.`,
        });
      }
      for (const action of panel.actions) {
        if (action.type === 'download' && action.params !== undefined) {
          issue.addIssue({
            code: 'custom',
            message: `Action "${action.id}" is a download and cannot take parameters.`,
          });
        }
        if (actionIds.has(action.id)) {
          issue.addIssue({
            code: 'custom',
            message: `Panel action "${action.id}" is declared more than once in this plugin.`,
          });
        }
        actionIds.add(action.id);
      }
    }
    const routePaths = new Set<string>();
    const routeShapes = new Map<string, string>();
    for (const route of manifest.routes) {
      if (routePaths.has(route.path)) {
        issue.addIssue({
          code: 'custom',
          message: `Route "${route.path}" is declared more than once.`,
        });
      }
      routePaths.add(route.path);

      const segments = route.path.split('/');
      if (route.render === 'page') {
        if (manifest.pluginApi < 2) {
          issue.addIssue({
            code: 'custom',
            message: `Route "${route.path}" is a page route (render: page), which needs plugin API 2; this plugin declares ${manifest.pluginApi}.`,
          });
        }
        if (route.layout === undefined) {
          issue.addIssue({
            code: 'custom',
            message: `Route "${route.path}" is a page route (render: page) with no layout to render it with.`,
          });
        }
      } else if (route.layout !== undefined) {
        issue.addIssue({
          code: 'custom',
          message: `Route "${route.path}" names a layout but is not a page route (render: page).`,
        });
      }
      if (route.body === 'raw') {
        if (manifest.pluginApi < 2) {
          issue.addIssue({
            code: 'custom',
            message: `Route "${route.path}" takes a raw body, which needs plugin API 2; this plugin declares ${manifest.pluginApi}.`,
          });
        }
        // Turnstile reads a token out of the parsed fields, and a page is a
        // visitor's form: neither goes with a body nobody parsed.
        if (route.turnstile) {
          issue.addIssue({
            code: 'custom',
            message: `Route "${route.path}" takes a raw body and so cannot use Turnstile.`,
          });
        }
        if (route.render === 'page') {
          issue.addIssue({
            code: 'custom',
            message: `Route "${route.path}" takes a raw body and so cannot be a page route.`,
          });
        }
      } else if (route.maxBytes !== undefined) {
        issue.addIssue({
          code: 'custom',
          message: `Route "${route.path}" declares maxBytes but does not take a raw body.`,
        });
      }
      if (manifest.pluginApi < 2 && typeof route.rateLimit === 'string') {
        issue.addIssue({
          code: 'custom',
          message: `Route "${route.path}" asks for the "${route.rateLimit}" rate-limit tier, which needs plugin API 2; this plugin declares ${manifest.pluginApi}. Version 1 has "rateLimit": true.`,
        });
      }
      if (manifest.pluginApi < 2) {
        // Version 1 routes are one fixed segment and are matched exactly as
        // they always were, locale-shaped names included.
        if (segments.length > 1) {
          issue.addIssue({
            code: 'custom',
            message: `Route "${route.path}" has several segments or a parameter, which needs plugin API 2; this plugin declares ${manifest.pluginApi}.`,
          });
        }
        continue;
      }
      // A site's locales are settings, changeable after the build, and a
      // request's first segment is read as a locale when it is one. A route
      // that could be mistaken for a locale is refused here instead.
      if (LOCALE_PATTERN.test(segments[0] ?? '')) {
        issue.addIssue({
          code: 'custom',
          message: `Route "${route.path}" starts with "${segments[0]}", which has the shape of a locale code (two letters, optionally "-" and two to four more). A request's first segment is read as a locale, so this route could become unreachable; rename it.`,
        });
      }
      const names = segments.filter((segment) => segment.startsWith(':'));
      if (new Set(names).size !== names.length) {
        issue.addIssue({
          code: 'custom',
          message: `Route "${route.path}" names the same parameter twice.`,
        });
      }
      const shape = routeShape(route.path);
      const same = routeShapes.get(shape);
      if (same !== undefined && same !== route.path) {
        issue.addIssue({
          code: 'custom',
          message: `Routes "${same}" and "${route.path}" match the same requests.`,
        });
      }
      routeShapes.set(shape, route.path);
    }
    if (manifest.pluginApi > PLUGIN_API_VERSION) {
      issue.addIssue({
        code: 'custom',
        message: `This plugin needs plugin API ${manifest.pluginApi}; this build supports ${PLUGIN_API_VERSION}.`,
      });
    }
  });

/** A validated plugin manifest. */
export type PluginManifest = z.infer<typeof pluginManifestSchema>;

/** Parses and validates a `plugin.json` document. */
export function parsePluginManifest(json: unknown): PluginManifest {
  return pluginManifestSchema.parse(json);
}

/**
 * Builds the zod validator for a plugin's settings object from its declared
 * fields, so the admin cannot store values the plugin will choke on.
 */
export function settingsValidator(manifest: {
  readonly settings: Readonly<
    Record<
      string,
      {
        readonly type: PluginManifest['settings'][string]['type'];
        readonly required: boolean;
        readonly choices?: readonly string[] | undefined;
      }
    >
  >;
}): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodType<unknown>> = {};
  for (const [key, field] of Object.entries(manifest.settings)) {
    let type: z.ZodType<unknown>;
    switch (field.type) {
      case 'number':
        type = z.number();
        break;
      case 'boolean':
        type = z.boolean();
        break;
      case 'string[]':
        type = z.array(z.string());
        break;
      case 'select':
        type = z.enum([...(field.choices ?? [''])] as [string, ...string[]]);
        break;
      default:
        type = z.string();
    }
    shape[key] = field.required === true ? type : type.optional();
  }
  return z.object(shape).strict() as z.ZodType<Record<string, unknown>>;
}

/** A declared route a request matched, with the parameters it captured. */
export interface PluginRouteMatch<Route extends { readonly path: string }> {
  readonly route: Route;
  readonly params: Readonly<Record<string, string>>;
}

/**
 * Finds the declared route for a request's path segments.
 *
 * A fixed segment beats a parameter in the same position, so `orders/new`
 * is not swallowed by `orders/:orderNo`; among routes equally specific the
 * first declared wins. Parameter values are the segments as given — the
 * caller decodes them.
 */
export function matchPluginRoute<Route extends { readonly path: string }>(
  routes: readonly Route[],
  segments: readonly string[],
): PluginRouteMatch<Route> | null {
  let best: { match: PluginRouteMatch<Route>; fixed: number } | null = null;
  for (const route of routes) {
    const pattern = route.path.split('/');
    if (pattern.length !== segments.length) {
      continue;
    }
    const params: Record<string, string> = {};
    let fixed = 0;
    let matched = true;
    for (const [index, part] of pattern.entries()) {
      const segment = segments[index] ?? '';
      if (part.startsWith(':')) {
        params[part.slice(1)] = segment;
      } else if (part === segment) {
        fixed += 1;
      } else {
        matched = false;
        break;
      }
    }
    if (matched && (best === null || fixed > best.fixed)) {
      best = { match: { route, params }, fixed };
    }
  }
  return best?.match ?? null;
}
