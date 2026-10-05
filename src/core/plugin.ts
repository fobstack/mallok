/**
 * Plugin manifest (`plugin.json`) schema and helpers (docs/PLUGIN_API.md §4).
 *
 * Manifests are validated when the registry module loads, so a broken one
 * fails the build and the test suite, never a visitor request.
 */

import { z } from 'zod';
import { LOCALE_PATTERN } from './paths.js';

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
] as const;

/**
 * The plugin API version that introduced each hook. A hook absent from this
 * map has existed since version 1.
 */
const HOOK_SINCE: Readonly<
  Partial<Record<(typeof PLUGIN_HOOKS)[number], number>>
> = { renderData: 2 };

/** One declared hook name. */
export type PluginHookName = (typeof PLUGIN_HOOKS)[number];

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
    /** Use the site's Workers rate-limit binding, keyed by plugin id + IP. */
    rateLimit: z.boolean().default(false),
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
  })
  .strict();

const panelSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    label: z.string(),
    type: z.literal('table'),
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
      for (const action of panel.actions) {
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
