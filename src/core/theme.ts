/**
 * Theme manifest (`theme.json`) schema and helpers.
 *
 * A theme is declarative data: Liquid templates, locale strings, a stylesheet
 * and this manifest. It contains no executable code. See
 * docs/ARCHITECTURE.md §10.
 */

import { z } from 'zod';
import { LOCALE_PATTERN } from './paths.js';

const LAYOUT_PATH = /^layouts\/[a-z0-9-]+\.liquid$/;

/**
 * Version of the theme contract this build understands
 * (docs/THEME_FORMAT.md §13). A theme declaring a higher number is refused
 * rather than loaded with fields the engine would silently ignore.
 */
export const THEME_API_VERSION = 1;

/** Field types a theme may declare for a content kind. */
export const THEME_FIELD_TYPES = [
  'string',
  'text',
  'number',
  'boolean',
  'date',
  'select',
  'string[]',
  'color',
  'image',
  'image[]',
  'file',
  'keyvalue',
  'reference',
  'reference[]',
] as const;

/** One declared field type. */
export type ThemeFieldType = (typeof THEME_FIELD_TYPES)[number];

/**
 * Schema for one frontmatter field of a content kind. The admin generates a
 * form control from this and the CLI validates imports against it, so theme
 * and plugin authors never write UI code (docs/ADMIN.md §7).
 */
export const themeFieldSchema = z
  .object({
    type: z.enum(THEME_FIELD_TYPES),
    label: z.string().optional(),
    required: z.boolean().default(false),
    help: z.string().optional(),
    group: z.string().optional(),
    default: z.unknown().optional(),
    /** `select` only. */
    choices: z.array(z.string()).optional(),
    /** `reference` and `reference[]` only: the kind being pointed at. */
    kind: z.string().optional(),
    /** Upper bound for numbers, string length, or list length. */
    max: z.number().optional(),
    min: z.number().optional(),
    /** `file` only: accepted extensions. */
    accept: z.array(z.string()).optional(),
  })
  .refine(
    (field) => field.type !== 'select' || (field.choices?.length ?? 0) > 0,
    { message: 'A "select" field must list its choices.' },
  )
  .refine(
    (field) =>
      (field.type !== 'reference' && field.type !== 'reference[]') ||
      field.kind !== undefined,
    { message: 'A "reference" field must name the kind it points at.' },
  );

/** A validated field declaration. */
export type ThemeField = z.infer<typeof themeFieldSchema>;

/** Schema for one content kind declared by a theme. */
export const themeKindSchema = z.object({
  /** Template used to render a single item of this kind. */
  layout: z.string().regex(LAYOUT_PATH),
  /** Template used to render the paginated list of this kind, if any. */
  listLayout: z.string().regex(LAYOUT_PATH).optional(),
  /** Human-readable label shown in the admin. */
  label: z.string().optional(),
  /**
   * Default base path segment for public URLs, e.g. `news` yields
   * `/news/<slug>`. Sites may override it in their settings.
   */
  base: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  /**
   * Frontmatter fields specific to this kind. Fields the theme does not
   * declare are kept as-is rather than dropped, so switching themes never
   * loses data (docs/THEME_FORMAT.md §5.2).
   */
  fields: z
    .record(z.string().regex(/^[a-z][a-z0-9_]*$/), themeFieldSchema)
    .optional(),
});

/** Schema for a theme option exposed in the admin. */
export const themeOptionSchema = z.object({
  type: z.enum(['string', 'text', 'number', 'boolean', 'color', 'select']),
  label: z.string(),
  default: z.union([z.string(), z.number(), z.boolean()]),
  choices: z.array(z.string()).optional(),
});

/** Schema for `theme.json`. */
export const themeManifestSchema = z.object({
  /** Stable identifier, also the install id. */
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  /** Contract version; absent means 1. */
  themeApi: z.number().int().positive().default(THEME_API_VERSION),
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().optional(),
  /** Template for the home page. */
  home: z.string().regex(LAYOUT_PATH),
  /** Content kinds this theme can render, keyed by kind name. */
  kinds: z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), themeKindSchema),
  options: z.record(z.string(), themeOptionSchema).default({}),
  /** Locales for which `locales/<locale>.json` exists. */
  locales: z.array(z.string().regex(LOCALE_PATTERN)).min(1),
  defaultLocale: z.string().regex(LOCALE_PATTERN),
  /** WebP variant widths this theme wants, ascending. */
  imageWidths: z
    .array(z.number().int().positive())
    .default([480, 960, 1440, 1920]),
  /**
   * Client-side scripts the theme ships. Official themes ship none; anything
   * listed here is shown to the site owner as a cost.
   */
  clientScripts: z
    .array(
      z.union([
        z.string(),
        z.object({
          path: z.string(),
          purpose: z.string(),
          bytes: z.number().int().nonnegative().optional(),
        }),
      ]),
    )
    .default([]),
});

/** A validated theme manifest. */
export type ThemeManifest = z.infer<typeof themeManifestSchema>;

/** Text files of an installed theme keyed by their path inside the theme. */
export type ThemeFiles = Readonly<Record<string, string>>;

/** Parses and validates a `theme.json` document. */
export function parseThemeManifest(json: unknown): ThemeManifest {
  return themeManifestSchema.parse(json);
}

/**
 * Returns the locale strings of a theme for `locale`, falling back to the
 * theme's default locale. Missing or malformed files yield an empty map.
 */
export function themeStrings(
  manifest: ThemeManifest,
  files: ThemeFiles,
  locale: string,
): Readonly<Record<string, string>> {
  const fallback = readStrings(files[`locales/${manifest.defaultLocale}.json`]);
  const requested = readStrings(files[`locales/${locale}.json`]);
  return { ...fallback, ...requested };
}

function readStrings(text: string | undefined): Record<string, string> {
  if (text === undefined) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object') {
      return {};
    }
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') {
        out[key] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * What each locale calls itself, read from every locale pack the theme
 * ships (`language_name`). A pack without one falls back to its code.
 *
 * This reads *all* the packs rather than the active one, because a language
 * switcher has to name the languages the reader is not currently in.
 */
export function themeLanguageNames(
  manifest: ThemeManifest,
  files: ThemeFiles,
): Readonly<Record<string, string>> {
  const names: Record<string, string> = {};
  for (const locale of manifest.locales) {
    const strings = readStrings(files[`locales/${locale}.json`]);
    names[locale] = strings.language_name ?? locale;
  }
  return names;
}
