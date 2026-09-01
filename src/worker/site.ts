/**
 * Typed views over the JSON columns of the `site` row.
 */

import { z } from 'zod';
import type { SiteRow } from '../db/queries.js';

const kindsSchema = z.record(
  z.string(),
  z.object({ base: z.string().default('') }),
);
const navSchema = z.record(
  z.string(),
  z.array(z.object({ label: z.string(), href: z.string() })),
);

/** Parsed site settings used by the render path. */
export interface SiteSettings {
  readonly name: string;
  readonly tagline: string;
  readonly defaultLocale: string;
  readonly locales: readonly string[];
  readonly kinds: Readonly<Record<string, { readonly base: string }>>;
  readonly nav: Readonly<
    Record<string, readonly { readonly label: string; readonly href: string }[]>
  >;
  readonly themeOptions: Readonly<Record<string, unknown>>;
  readonly domain: string | null;
  readonly mediaBaseUrl: string;
  readonly cacheTtl: number;
}

/** Parses the JSON columns of a site row, tolerating malformed values. */
export function parseSiteSettings(row: SiteRow): SiteSettings {
  return {
    name: row.name,
    tagline: row.tagline ?? '',
    defaultLocale: row.default_locale,
    locales: parseWith(z.array(z.string()), row.locales, [row.default_locale]),
    kinds: parseWith(kindsSchema, row.kinds, {}),
    nav: parseWith(navSchema, row.nav, {}),
    themeOptions: parseWith(
      z.record(z.string(), z.unknown()),
      row.theme_options,
      {},
    ),
    domain: row.domain,
    mediaBaseUrl: row.media_base_url ?? '',
    cacheTtl: row.cache_ttl,
  };
}

function parseWith<T>(schema: z.ZodType<T>, text: string, fallback: T): T {
  try {
    const result = schema.safeParse(JSON.parse(text));
    return result.success ? result.data : fallback;
  } catch {
    return fallback;
  }
}

/** Public origin of the site: the custom domain when bound, else the request. */
export function siteOrigin(settings: SiteSettings, request: Request): string {
  if (settings.domain !== null && settings.domain !== '') {
    return `https://${settings.domain}`;
  }
  return new URL(request.url).origin;
}
