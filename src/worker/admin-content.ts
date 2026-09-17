/**
 * Content endpoints of the management API: list, read, save and delete.
 *
 * Saving runs stage one of the rendering pipeline and stores the fragment in
 * the same batch as the row, so a visitor request never has to parse Markdown
 * (docs/ARCHITECTURE.md §5).
 */

import { z } from 'zod';
import {
  buildPublicPath,
  deriveFrontmatter,
  exportPathKey,
  LOCALE_PATTERN,
  normalizeRelativePath,
  PIPELINE_VERSION,
  type RenderedFragment,
  renderFragment,
  sha256Hex,
  slugify,
  splitFrontmatter,
} from '../core/index.js';
import {
  type ContentRow,
  deleteContent,
  findContentById,
  findContentByKey,
  listContent,
  listTranslationsOf,
  loadSite,
  loadSiteRenderData,
  upsertContent,
} from '../db/queries.js';
import { purgeTags, tagsForContent } from './cache.js';
import type { Env } from './env.js';
import { json, problem, readJson } from './http.js';
import { beforeRenderHooks, fragmentPluginHash } from './plugin-runtime.js';
import { resolveAssets } from './render.js';
import { parseSiteSettings } from './site.js';

const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
/**
 * Body length past which rendering is skipped rather than attempted.
 *
 * Real-account measurement (docs/tasks/TASK-01.md §5, 2026-09-03) put
 * stage-one rendering at 60–726 ms across 2–128 KB of body text — already
 * past the Free plan's documented 10 ms budget at every size tested, so no
 * length threshold can guarantee a render fits. This is a coarse safety net,
 * not a precise predictor: past this length, skip the expensive render
 * entirely rather than risk the platform killing the request mid-write
 * (`AC-CONTENT-10`, docs/ACCEPTANCE.md §14.2 item 7). 50 KB is comfortably
 * past any article this product's themes render as a single page.
 */
const MAX_SAFE_RENDER_BYTES = 50 * 1024;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

const contentInputSchema = z.object({
  id: z.string().uuid().optional(),
  kind: z.string().regex(/^[a-z][a-z0-9_]*$/),
  locale: z.string().regex(LOCALE_PATTERN).optional(),
  slug: z.string().min(1).max(80).optional(),
  translationGroup: z.string().uuid().optional(),
  /** Full `index.md` text including the front matter block. */
  markdown: z.string().max(MAX_MARKDOWN_BYTES),
  /** Relative path → sha256 of an object in the media table. */
  assets: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)).default({}),
  status: z.enum(['draft', 'published']).optional(),
  /**
   * Refuse instead of updating when the content already exists
   * (docs/CONTENT_FORMAT.md §7.2). Used by `mallok publish --create-only`.
   */
  createOnly: z.boolean().default(false),
});

/** Lists content for the admin, including drafts and scheduled items. */
export async function getContentList(env: Env, url: URL): Promise<Response> {
  const limit = clamp(
    Number(url.searchParams.get('limit') ?? DEFAULT_PAGE_SIZE),
    1,
    MAX_PAGE_SIZE,
  );
  const offset = clamp(Number(url.searchParams.get('offset') ?? 0), 0, 1e6);
  const status = url.searchParams.get('status');
  if (status !== null && !isStatus(status)) {
    return problem(400, 'Unknown status filter.');
  }
  const result = await listContent(env.DB, {
    ...optional('kind', url.searchParams.get('kind')),
    ...optional('locale', url.searchParams.get('locale')),
    ...(status === null ? {} : { status }),
    limit,
    offset,
  });
  return json({
    items: result.items.map(summary),
    hasNext: result.hasNext,
    limit,
    offset,
  });
}

/**
 * Returns one content item including its Markdown source and its siblings in
 * other locales.
 *
 * The translations travel with the item because the editor's language
 * switcher needs to know which locales already exist and which would be new
 * (docs/ADMIN.md §6.6).
 */
export async function getContentItem(env: Env, id: string): Promise<Response> {
  const row = await findContentById(env.DB, id);
  if (row === null) {
    return problem(404, 'Not found.');
  }
  const [siblings, siteRow] = await Promise.all([
    listTranslationsOf(env.DB, row.translation_group),
    loadSite(env.DB),
  ]);
  const enabled =
    siteRow === null ? [row.locale] : parseSiteSettings(siteRow).locales;
  const present = new Map(siblings.map((item) => [item.locale, item] as const));
  return json({
    ...summary(row),
    markdown: row.markdown,
    assets: parseJsonObject(row.assets),
    translations: enabled.map((locale) => {
      const sibling = present.get(locale);
      return sibling === undefined
        ? { locale, exists: false }
        : {
            locale,
            exists: true,
            id: sibling.id,
            path: sibling.path,
            title: sibling.title,
            status: sibling.status,
          };
    }),
  });
}

/** Creates or updates content and its stage-one fragment. */
export async function saveContent(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const parsedBody = contentInputSchema.safeParse(await readJson(request));
  if (!parsedBody.success) {
    return json(
      { error: 'Invalid request body.', issues: parsedBody.error.issues },
      { status: 400 },
    );
  }
  const input = parsedBody.data;

  const siteRow = await loadSite(env.DB);
  if (siteRow === null) {
    return problem(503, 'Site is not initialized.');
  }
  const settings = parseSiteSettings(siteRow);
  const kindConfig = settings.kinds[input.kind];
  if (kindConfig === undefined) {
    return problem(400, `Kind "${input.kind}" is not enabled on this site.`);
  }
  const locale = input.locale ?? settings.defaultLocale;
  if (!settings.locales.includes(locale)) {
    return problem(400, `Locale "${locale}" is not enabled on this site.`);
  }

  let document: ReturnType<typeof splitFrontmatter>;
  try {
    document = splitFrontmatter(input.markdown);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid input.';
    return problem(400, message);
  }
  // Past this length, rendering itself is the risk — skip it rather than
  // attempt it (see MAX_SAFE_RENDER_BYTES). The content is still saved, as a
  // draft, so nothing is lost; it renders normally once shortened.
  const tooLongToRenderSafely = document.body.length > MAX_SAFE_RENDER_BYTES;

  // Aliases from Astro, Hugo and common CMS exports are derived into the
  // stored view; the Markdown itself is never rewritten
  // (docs/CONTENT_FORMAT.md §3.3).
  const fm = deriveFrontmatter(document.data);
  const title = typeof fm.title === 'string' ? fm.title.trim() : '';
  if (title === '') {
    return problem(400, 'Front matter must include a non-empty "title".');
  }
  const slug =
    input.slug ?? (typeof fm.slug === 'string' ? fm.slug : slugify(title));
  if (slug === '') {
    return problem(400, 'Could not derive a slug; provide one explicitly.');
  }
  if (slugify(slug) !== slug) {
    return problem(
      400,
      'The slug must use lowercase ASCII letters, digits and single dashes.',
    );
  }

  const assets: Record<string, string> = {};
  const assetKeys = new Set<string>();
  for (const [rawPath, sha] of Object.entries(input.assets)) {
    const normalized = normalizeRelativePath(rawPath);
    if (normalized === null) {
      return problem(400, `Invalid asset path "${rawPath}".`);
    }
    const portableKey = exportPathKey(normalized);
    if (assetKeys.has(portableKey)) {
      return problem(
        400,
        `Asset path "${rawPath}" conflicts with another path on a case-insensitive filesystem.`,
      );
    }
    assetKeys.add(portableKey);
    assets[normalized] = sha;
  }

  const existing =
    input.id !== undefined
      ? await findContentById(env.DB, input.id)
      : await findContentByKey(env.DB, input.kind, locale, slug);

  if (input.createOnly && existing !== null) {
    // A pipeline that means to create must not silently overwrite a page
    // someone edited by hand (docs/CONTENT_FORMAT.md §7.2).
    return problem(
      409,
      `"${slug}" already exists in ${locale}. Remove --create-only to update it.`,
    );
  }

  const now = new Date().toISOString();
  const markdownSha = await sha256Hex(input.markdown);
  // Too long to render safely overrides whatever was requested: saving must
  // never publish content stage one hasn't actually rendered.
  const status = tooLongToRenderSafely
    ? 'draft'
    : resolveStatus(input.status, fm, now);
  const publishedAt = resolvePublishedAt(fm, existing, now);
  const assetsJson = JSON.stringify(assets);

  if (
    existing !== null &&
    existing.markdown_sha256 === markdownSha &&
    existing.assets === assetsJson &&
    existing.status === status &&
    existing.published_at === publishedAt
  ) {
    return json({ id: existing.id, path: existing.path, unchanged: true });
  }

  const path = buildPublicPath({
    kind: input.kind,
    locale,
    defaultLocale: settings.defaultLocale,
    slug,
    base: kindConfig.base,
  });

  const fragment: RenderedFragment = tooLongToRenderSafely
    ? {
        html: '',
        meta: {
          headings: [],
          excerpt: '',
          readingTimeMinutes: 0,
          refs: [],
          missing: [],
        },
        cacheKey: `too-long:${markdownSha}`,
      }
    : await (async () => {
        const siteData = await loadSiteRenderData(env.DB);
        const resolved = await resolveAssets(env.DB, assetsJson);
        return renderFragment({
          body: document.body,
          frontmatter: fm,
          assets: resolved,
          mediaBaseUrl: settings.mediaBaseUrl,
          pluginHash: await fragmentPluginHash(siteData.plugins),
          hooks: beforeRenderHooks(siteData.plugins),
        });
      })();

  const description =
    typeof fm.description === 'string' ? fm.description : fragment.meta.excerpt;
  const cover = typeof fm.cover === 'string' ? fm.cover : null;
  const row: ContentRow = {
    id: existing?.id ?? input.id ?? crypto.randomUUID(),
    kind: input.kind,
    locale,
    translation_group:
      existing?.translation_group ??
      input.translationGroup ??
      crypto.randomUUID(),
    slug,
    path,
    title,
    description,
    frontmatter: JSON.stringify(fm),
    markdown: input.markdown,
    markdown_sha256: markdownSha,
    assets: assetsJson,
    cover_sha256:
      cover === null
        ? null
        : (assets[normalizeRelativePath(cover) ?? ''] ?? null),
    status,
    published_at: publishedAt,
    created_at: existing?.created_at ?? now,
    updated_at: now,
    rev: existing?.rev ?? 1,
  };

  await upsertContent(env.DB, {
    row,
    fragment: {
      cacheKey: fragment.cacheKey,
      html: fragment.html,
      meta: JSON.stringify(fragment.meta),
      pipelineVersion: PIPELINE_VERSION,
    },
    ...(existing === null
      ? {}
      : { previousPath: existing.path, previousAssets: existing.assets }),
  });

  const tags = tagsForContent(row.id, row.kind, row.locale);
  ctx.waitUntil(purgeTags(env, tags));

  return json(
    {
      id: row.id,
      path: row.path,
      status: row.status,
      publishedAt: row.published_at,
      missingAssets: fragment.meta.missing,
      purgeQueued: env.CF_API_TOKEN !== undefined,
      ...(tooLongToRenderSafely
        ? {
            warning:
              `Saved as a draft without rendering: this item's body is ` +
              `over ${MAX_SAFE_RENDER_BYTES / 1024} KB, long enough that ` +
              `rendering it risks exceeding the Free plan's CPU limit. ` +
              `Nothing was lost — shorten it and save again to publish.`,
          }
        : {}),
    },
    { status: existing === null ? 201 : 200 },
  );
}

/** Deletes content and purges the pages that showed it. */
export async function removeContent(
  env: Env,
  ctx: ExecutionContext,
  id: string,
): Promise<Response> {
  const existing = await findContentById(env.DB, id);
  if (existing === null) {
    return problem(404, 'Not found.');
  }
  await deleteContent(env.DB, existing, new Date().toISOString());
  ctx.waitUntil(
    purgeTags(env, tagsForContent(existing.id, existing.kind, existing.locale)),
  );
  return json({ ok: true, id });
}

function summary(row: {
  readonly id: string;
  readonly kind: string;
  readonly locale: string;
  readonly translation_group: string;
  readonly slug: string;
  readonly path: string;
  readonly title: string;
  readonly description: string | null;
  readonly frontmatter: string;
  readonly cover_sha256: string | null;
  readonly status: string;
  readonly published_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly rev: number;
}) {
  return {
    id: row.id,
    kind: row.kind,
    locale: row.locale,
    translationGroup: row.translation_group,
    slug: row.slug,
    path: row.path,
    title: row.title,
    description: row.description ?? '',
    frontmatter: parseJsonObject(row.frontmatter),
    coverSha256: row.cover_sha256,
    status: row.status,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    rev: row.rev,
  };
}

function resolveStatus(
  requested: 'draft' | 'published' | undefined,
  fm: Readonly<Record<string, unknown>>,
  now: string,
): ContentRow['status'] {
  if (requested === 'draft' || fm.draft === true) {
    return 'draft';
  }
  const date = typeof fm.date === 'string' ? toIso(fm.date) : null;
  if (date !== null && date > now) {
    return 'scheduled';
  }
  return 'published';
}

function resolvePublishedAt(
  fm: Readonly<Record<string, unknown>>,
  existing: ContentRow | null,
  now: string,
): string {
  const date = typeof fm.date === 'string' ? toIso(fm.date) : null;
  if (date !== null) {
    return date;
  }
  return existing?.published_at ?? now;
}

function toIso(value: string): string | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function isStatus(value: string): value is ContentRow['status'] {
  return value === 'draft' || value === 'scheduled' || value === 'published';
}

function optional(key: string, value: string | null): Record<string, string> {
  return value === null || value === '' ? {} : { [key]: value };
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
