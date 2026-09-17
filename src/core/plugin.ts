/**
 * Plugin manifest (`plugin.json`) schema and helpers (docs/PLUGIN_API.md §4).
 *
 * Manifests are validated when the registry module loads, so a broken one
 * fails the build and the test suite, never a visitor request.
 */

import { z } from 'zod';

/** Version of the plugin contract this build understands. */
export const PLUGIN_API_VERSION = 1;

/** Hook points a plugin may declare (docs/PLUGIN_API.md §5). */
export const PLUGIN_HOOKS = [
  'onRequest',
  'beforeRender',
  'afterRender',
  'onContentSave',
  'scheduled',
] as const;

/** One declared hook name. */
export type PluginHookName = (typeof PLUGIN_HOOKS)[number];

const routeSchema = z
  .object({
    /** Path under `/_mallok/p/<plugin>/`. */
    path: z.string().regex(/^[a-z][a-z0-9-]*$/),
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
    for (const route of manifest.routes) {
      if (routePaths.has(route.path)) {
        issue.addIssue({
          code: 'custom',
          message: `Route "${route.path}" is declared more than once.`,
        });
      }
      routePaths.add(route.path);
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
