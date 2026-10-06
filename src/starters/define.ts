/**
 * Checks a starter a site provides (docs/ARCHITECTURE.md §11).
 *
 * A starter is data a site's repository carries: example content, the
 * settings it assumes and, where its plugins keep data of their own, sample
 * records for them. It is checked when the Worker module loads, so a mistake
 * fails the build or the deployment and never the first-run wizard.
 */

import { z } from 'zod';
import { LOCALE_PATTERN } from '../core/index.js';
import type { MallokPlugin } from '../plugins/types.js';
import type { Starter } from './types.js';

/** Thrown for a starter that cannot be offered. The message says why. */
export class StarterDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StarterDefinitionError';
  }
}

const idSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,39}$/, 'lower-case letters, digits and hyphens');
const kindSchema = z.string().regex(/^[a-z][a-z0-9_]*$/);
const slugSchema = z.string().min(1).max(200);
const linkSchema = z.object({ label: z.string(), href: z.string() });

const starterSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(80),
  description: z.string().max(400),
  theme: z.string().min(1),
  plugins: z.array(z.string().min(1)).default([]),
  settings: z.object({
    locales: z.array(z.string().regex(LOCALE_PATTERN)).optional(),
    kinds: z.record(z.string(), z.object({ base: z.string() })),
    nav: z.record(z.string(), z.array(linkSchema)).default({}),
    themeOptions: z.record(z.string(), z.unknown()).default({}),
    tagline: z
      .union([
        z.string(),
        z.record(z.string().regex(LOCALE_PATTERN), z.string()),
      ])
      .default(''),
  }),
  documents: z
    .array(
      z.object({
        kind: kindSchema,
        slug: slugSchema,
        markdown: z.string().min(1),
        translations: z
          .record(
            z.string().regex(LOCALE_PATTERN),
            z.object({ slug: slugSchema, markdown: z.string().min(1) }),
          )
          .optional(),
      }),
    )
    .default([]),
  records: z
    .array(
      z.object({
        plugin: z.string().min(1),
        panel: z.string().min(1),
        values: z.record(z.string(), z.unknown()),
        attachedTo: z.object({ kind: kindSchema, slug: slugSchema }).optional(),
      }),
    )
    .default([]),
});

/**
 * Validates one starter and returns it.
 *
 * Checks what can be known from the starter alone: its shape, that no two
 * documents share a kind and slug, that every record's plugin is one the
 * starter switches on, and that a record attached to content names one of
 * the starter's own documents. What depends on the rest of the site — that
 * the plugin and its panel exist — is checked by `createMallok`.
 */
export function defineStarter(input: Starter): Starter {
  const parsed = starterSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.join('.') ?? '';
    const id =
      typeof (input as { id?: unknown } | null)?.id === 'string'
        ? ` "${(input as { id: string }).id}"`
        : '';
    throw new StarterDefinitionError(
      `Starter${id} is not valid${where === '' ? '' : ` at ${where}`}: ${issue?.message ?? 'unknown problem'}.`,
    );
  }
  const starter = parsed.data;
  const fail = (message: string): never => {
    throw new StarterDefinitionError(`Starter "${starter.id}": ${message}`);
  };

  const documents = new Set<string>();
  for (const document of starter.documents) {
    const key = `${document.kind}/${document.slug}`;
    if (documents.has(key)) {
      fail(`two documents are ${key}.`);
    }
    documents.add(key);
  }
  starter.records.forEach((record, index) => {
    if (!starter.plugins.includes(record.plugin)) {
      fail(
        `records[${index}] is for the plugin ${record.plugin}, which the starter does not list in plugins.`,
      );
    }
    const owner = record.attachedTo;
    if (owner !== undefined && !documents.has(`${owner.kind}/${owner.slug}`)) {
      fail(
        `records[${index}] is attached to ${owner.kind}/${owner.slug}, which is not one of its documents.`,
      );
    }
  });
  return starter as Starter;
}

/**
 * Validates the starters a site passes to `createMallok` against the rest of
 * its composition.
 */
export function normalizeStarters(
  inputs: readonly Starter[],
  plugins: readonly MallokPlugin[],
  reserved: readonly string[],
): readonly Starter[] {
  const starters = inputs.map(defineStarter);
  const seen = new Set<string>(reserved);
  for (const starter of starters) {
    const fail = (message: string): never => {
      throw new StarterDefinitionError(`Starter "${starter.id}": ${message}`);
    };
    if (seen.has(starter.id)) {
      fail(
        reserved.includes(starter.id)
          ? 'that id belongs to a starter Mallok ships. Choose another.'
          : 'every starter id in createMallok({ starters }) must be unique.',
      );
    }
    seen.add(starter.id);
    for (const pluginId of starter.plugins) {
      if (!plugins.some((plugin) => plugin.manifest.id === pluginId)) {
        fail(
          `it switches on the plugin ${pluginId}, which is not in createMallok({ plugins }).`,
        );
      }
    }
    (starter.records ?? []).forEach((record, index) => {
      const plugin = plugins.find(
        (candidate) => candidate.manifest.id === record.plugin,
      );
      const panel = plugin?.manifest.panels.find(
        (candidate) => candidate.id === record.panel,
      );
      if (
        panel === undefined ||
        panel.type !== 'records' ||
        plugin?.records?.[record.panel] === undefined
      ) {
        fail(
          `records[${index}] is for ${record.plugin}/${record.panel}, which is not a records panel of that plugin.`,
        );
        return;
      }
      if (panel.attachTo === undefined && record.attachedTo !== undefined) {
        fail(
          `records[${index}] has attachedTo, but the panel ${record.panel} is not attached to content.`,
        );
      }
      if (panel.attachTo !== undefined) {
        if (record.attachedTo === undefined) {
          fail(
            `records[${index}] needs attachedTo: the panel ${record.panel} belongs to a ${panel.attachTo.kind}.`,
          );
        } else if (record.attachedTo.kind !== panel.attachTo.kind) {
          fail(
            `records[${index}] is attached to a ${record.attachedTo.kind}, but the panel ${record.panel} belongs to a ${panel.attachTo.kind}.`,
          );
        }
      }
    });
  }
  return starters;
}
