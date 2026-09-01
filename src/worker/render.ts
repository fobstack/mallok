/**
 * Builds theme views from database rows and renders pages. This is the glue
 * between `src/db` and `src/core`; it owns the "ensure fragment" step that
 * regenerates a stale stage-one fragment when necessary.
 */

import {
  type AssetMap,
  buildContentPageView,
  buildFileUrls,
  buildHomePageView,
  buildImageViews,
  buildListPageView,
  type CompiledTheme,
  computeFragmentCacheKey,
  type FragmentMeta,
  mediaUrl,
  PIPELINE_VERSION,
  type RelationsInput,
  renderFragment,
  renderPage,
  type SummaryInput,
  splitFrontmatter,
  type ThemeManifest,
  themeLanguageNames,
  themeStrings,
  type ViewContext,
  variantUrl,
} from '../core/index.js';
import {
  type ContentRow,
  type ContentSummaryRow,
  listByReference,
  listSiblings,
  loadMediaBySha,
  type PluginStateRow,
  putFragment,
  type RenderCacheRow,
  summaryBySlug,
  type TranslationRow,
} from '../db/queries.js';
import { beforeRenderHooks, fragmentPluginHash } from './plugin-runtime.js';
import type { SiteSettings } from './site.js';

/** A fragment ready for stage two. */
export interface Fragment {
  readonly html: string;
  readonly meta: FragmentMeta;
  readonly cacheKey: string;
  /** True when this call had to regenerate the fragment. */
  readonly regenerated: boolean;
  /** Media this content references, already resolved. Reused by the page
   * render so front-matter images cost no extra query. */
  readonly assets: AssetMap;
}

/** Resolves the `assets` column of a content row against the media table. */
export async function resolveAssets(
  db: D1Database,
  assetsJson: string,
): Promise<AssetMap> {
  let mapping: Record<string, string>;
  try {
    mapping = JSON.parse(assetsJson) as Record<string, string>;
  } catch {
    return {};
  }
  const hashes = Object.values(mapping);
  if (hashes.length === 0) {
    return {};
  }
  const rows = await loadMediaBySha(db, hashes);
  const bySha = new Map(rows.map((row) => [row.sha256, row]));
  const assets: Record<string, AssetMap[string]> = {};
  for (const [path, sha] of Object.entries(mapping)) {
    const row = bySha.get(sha);
    if (row === undefined) {
      continue;
    }
    let variants: number[] = [];
    try {
      variants = (JSON.parse(row.variants) as number[]).sort((a, b) => a - b);
    } catch {
      variants = [];
    }
    assets[path] = {
      sha256: row.sha256,
      kind: row.kind,
      ext: row.ext,
      variants,
      ...(row.width === null ? {} : { width: row.width }),
      ...(row.height === null ? {} : { height: row.height }),
      ...(row.alt === null ? {} : { alt: row.alt }),
    };
  }
  return assets;
}

/**
 * Returns the stage-one fragment for `content`, using the cached row when its
 * key still matches and regenerating (and storing) it otherwise.
 */
export async function ensureFragment(
  db: D1Database,
  content: ContentRow,
  settings: SiteSettings,
  plugins: readonly PluginStateRow[],
  cached: RenderCacheRow | null,
  now: string,
): Promise<Fragment> {
  const { body, data } = splitFrontmatter(content.markdown);
  const assets = await resolveAssets(db, content.assets);
  const hash = await fragmentPluginHash(plugins);
  const input = {
    body,
    frontmatter: data,
    assets,
    mediaBaseUrl: settings.mediaBaseUrl,
    pluginHash: hash,
  };
  const expectedKey = await computeFragmentCacheKey(input);
  if (cached !== null && cached.cache_key === expectedKey) {
    return {
      html: cached.html,
      meta: JSON.parse(cached.meta) as FragmentMeta,
      cacheKey: cached.cache_key,
      regenerated: false,
      assets,
    };
  }
  const rendered = await renderFragment({
    ...input,
    hooks: beforeRenderHooks(plugins),
  });
  await putFragment(
    db,
    content.id,
    {
      cacheKey: rendered.cacheKey,
      html: rendered.html,
      meta: JSON.stringify(rendered.meta),
      pipelineVersion: PIPELINE_VERSION,
    },
    now,
  );
  return { ...rendered, regenerated: true, assets };
}

/** Context shared by every page render. */
export interface RenderContext {
  readonly settings: SiteSettings;
  readonly theme: CompiledTheme;
  readonly origin: string;
  readonly locale: string;
  readonly path: string;
}

/**
 * Turns the Worker's context into the plain one core takes.
 *
 * This function is the whole adapter: every decision about what a theme sees
 * lives in `src/core/view.ts`, so the Worker, the CLI and the admin preview
 * cannot drift apart.
 */
function viewContext(ctx: RenderContext): ViewContext {
  return {
    settings: ctx.settings,
    manifest: ctx.theme.manifest,
    origin: ctx.origin,
    locale: ctx.locale,
    path: ctx.path,
    strings: themeStrings(ctx.theme.manifest, ctx.theme.files, ctx.locale),
    languageNames: themeLanguageNames(ctx.theme.manifest, ctx.theme.files),
  };
}

/**
 * Maps a summary row to the shape core takes. `covers` maps a media hash to
 * its URL; without it the cover is simply empty, which is a normal state.
 */
function toSummary(
  row: ContentSummaryRow,
  covers: ReadonlyMap<string, string> = new Map(),
): SummaryInput {
  return {
    id: row.id,
    kind: row.kind,
    locale: row.locale,
    slug: row.slug,
    path: row.path,
    title: row.title,
    description: row.description ?? '',
    publishedAt: row.published_at ?? '',
    frontmatter: parseJson(row.frontmatter),
    cover:
      row.cover_sha256 === null ? '' : (covers.get(row.cover_sha256) ?? ''),
  };
}

/**
 * Resolves the cover images of a batch of summary rows in one query, so a
 * list page costs a constant number of queries however many items it shows
 * (docs/DATA_MODEL.md §3).
 */
export async function resolveCovers(
  db: D1Database,
  rows: readonly ContentSummaryRow[],
  mediaBaseUrl: string,
): Promise<Map<string, string>> {
  const hashes = [
    ...new Set(
      rows
        .map((row) => row.cover_sha256)
        .filter((sha): sha is string => sha !== null),
    ),
  ];
  const covers = new Map<string, string>();
  if (hashes.length === 0) {
    return covers;
  }
  for (const media of await loadMediaBySha(db, hashes)) {
    let variants: number[] = [];
    try {
      variants = (JSON.parse(media.variants) as number[]).sort((a, b) => a - b);
    } catch {
      variants = [];
    }
    const asset = {
      sha256: media.sha256,
      kind: media.kind,
      ext: media.ext,
      variants,
    };
    const largest = variants[variants.length - 1];
    covers.set(
      media.sha256,
      largest === undefined
        ? mediaUrl(mediaBaseUrl, asset)
        : variantUrl(mediaBaseUrl, asset, largest),
    );
  }
  return covers;
}

/** Renders a single content item. */
export async function renderContentPage(
  ctx: RenderContext,
  content: ContentRow,
  fragment: Fragment,
  translations: readonly TranslationRow[],
  relations: RelationsInput = {},
): Promise<string> {
  // The fragment already resolved this item's media, so the cover and the
  // front-matter images cost nothing extra here.
  const images = buildImageViews(fragment.assets, ctx.settings.mediaBaseUrl);
  const files = buildFileUrls(fragment.assets, ctx.settings.mediaBaseUrl);
  const coverPath = Object.keys(fragment.assets).find(
    (path) => fragment.assets[path]?.sha256 === content.cover_sha256,
  );
  const covers = new Map<string, string>(
    content.cover_sha256 === null || coverPath === undefined
      ? []
      : [[content.cover_sha256, images[coverPath]?.url ?? '']],
  );
  const view = buildContentPageView(
    viewContext(ctx),
    {
      ...toSummary(content, covers),
      updatedAt: content.updated_at,
      images,
      files,
    },
    { html: fragment.html, meta: fragment.meta },
    translations.map((row) => ({ locale: row.locale, path: row.path })),
    relations,
  );
  const kinds = ctx.theme.manifest.kinds;
  const layout =
    kinds[content.kind]?.layout ?? kinds.page?.layout ?? 'layouts/page.liquid';
  return renderPage(ctx.theme, layout, view);
}

/** Renders the home page of a locale. */
export async function renderHomePage(
  ctx: RenderContext,
  recent: Readonly<Record<string, readonly ContentSummaryRow[]>>,
  covers: ReadonlyMap<string, string> = new Map(),
): Promise<string> {
  const mapped: Record<string, SummaryInput[]> = {};
  for (const [kind, rows] of Object.entries(recent)) {
    mapped[kind] = rows.map((row) => toSummary(row, covers));
  }
  const view = buildHomePageView(viewContext(ctx), mapped);
  return renderPage(ctx.theme, ctx.theme.manifest.home, view);
}

/** Renders one page of a kind's list. */
export async function renderListPage(
  ctx: RenderContext,
  kind: string,
  list: { items: readonly ContentSummaryRow[]; hasNext: boolean },
  pageNumber: number,
  basePath: string,
  kindBase: string,
  covers: ReadonlyMap<string, string> = new Map(),
  tag = '',
): Promise<string> {
  // A tag archive reuses whichever list layout the theme has, because it is
  // the same shape of page: a paginated set of summaries. Themes that want
  // to name the tag read `list.tag`.
  const layout =
    kind === 'tag'
      ? (Object.values(ctx.theme.manifest.kinds).find(
          (config) => config.listLayout !== undefined,
        )?.listLayout ?? undefined)
      : ctx.theme.manifest.kinds[kind]?.listLayout;
  if (layout === undefined) {
    throw new Error(`Theme has no list layout for kind "${kind}".`);
  }
  const view = buildListPageView(viewContext(ctx), {
    kind,
    items: list.items.map((row) => toSummary(row, covers)),
    hasNext: list.hasNext,
    page: pageNumber,
    basePath,
    kindBase,
    ...(tag === '' ? {} : { tag }),
  });
  return renderPage(ctx.theme, layout, view);
}

function parseJson(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * How many related items each group may hold. Both bounds come from the
 * cold-render read budget in docs/DATA_MODEL.md §3.
 */
const BACKREF_LIMIT = 24;
const SIBLING_LIMIT = 6;
/** Upper bound on relation statements, so the batch stays constant-sized. */
const RELATION_STATEMENTS_MAX = 8;

/** One relation statement and where its result belongs. */
interface RelationSlot {
  readonly group: 'ref' | 'backref';
  readonly key: string;
  readonly statement: D1PreparedStatement;
}

/**
 * Resolves the related content a theme declared it wants, in one D1 batch.
 *
 * The rules are read off the manifest, never hardcoded: a `reference` field
 * on this kind resolves forward to its target (`content.refs.<field>`), a
 * `reference` field on another kind that points at this kind resolves
 * backward to the items pointing here (`content.backrefs.<kind>`), and a kind
 * with its own list gets recent siblings. That is why the core knows nothing
 * about "category" or "product" (docs/ARCHITECTURE.md §11).
 */
export async function loadRelations(
  db: D1Database,
  manifest: ThemeManifest,
  content: ContentRow,
  mediaBaseUrl: string,
  now: string,
): Promise<RelationsInput> {
  const kind = manifest.kinds[content.kind];
  if (kind === undefined) {
    return {};
  }
  const frontmatter = parseJson(content.frontmatter);
  const slots: RelationSlot[] = [];

  // Forward: this kind's `reference` fields.
  for (const [field, decl] of Object.entries(kind.fields ?? {})) {
    if (decl.type !== 'reference' || decl.kind === undefined) {
      continue;
    }
    const slug = frontmatter[field];
    if (typeof slug !== 'string' || slug === '') {
      continue;
    }
    slots.push({
      group: 'ref',
      key: field,
      statement: summaryBySlug(db, decl.kind, content.locale, slug, now),
    });
  }

  // Backward: other kinds whose `reference` field points at this kind.
  for (const [otherKind, decl] of Object.entries(manifest.kinds)) {
    if (otherKind === content.kind) {
      continue;
    }
    for (const [field, fieldDecl] of Object.entries(decl.fields ?? {})) {
      if (fieldDecl.type !== 'reference' || fieldDecl.kind !== content.kind) {
        continue;
      }
      slots.push({
        group: 'backref',
        key: otherKind,
        statement: listByReference(
          db,
          otherKind,
          content.locale,
          field,
          content.slug,
          BACKREF_LIMIT,
          now,
        ),
      });
    }
  }

  const wantsSiblings = kind.listLayout !== undefined;
  const bounded = slots.slice(0, RELATION_STATEMENTS_MAX);
  if (slots.length > bounded.length) {
    // A theme declaring more relations than the budget allows is a theme bug;
    // say which ones were dropped rather than rendering a quietly short page.
    console.warn(
      JSON.stringify({
        event: 'relations_truncated',
        kind: content.kind,
        kept: bounded.length,
        dropped: slots.slice(bounded.length).map((slot) => slot.key),
      }),
    );
  }
  if (bounded.length === 0 && !wantsSiblings) {
    return {};
  }

  const statements = bounded.map((slot) => slot.statement);
  if (wantsSiblings) {
    statements.push(
      listSiblings(
        db,
        content.kind,
        content.locale,
        content.id,
        SIBLING_LIMIT,
        now,
      ),
    );
  }
  const results = await db.batch<ContentSummaryRow>(statements);
  const allRows = results.flatMap((result) => result.results ?? []);
  const covers = await resolveCovers(db, allRows, mediaBaseUrl);

  const refs: Record<string, SummaryInput> = {};
  const backrefs: Record<string, SummaryInput[]> = {};
  bounded.forEach((slot, index) => {
    const rows = results[index]?.results ?? [];
    if (slot.group === 'ref') {
      const first = rows[0];
      if (first !== undefined) {
        refs[slot.key] = toSummary(first, covers);
      }
      return;
    }
    const existing = backrefs[slot.key] ?? [];
    existing.push(...rows.map((row) => toSummary(row, covers)));
    backrefs[slot.key] = existing;
  });
  const siblings = wantsSiblings
    ? (results[bounded.length]?.results ?? []).map((row) =>
        toSummary(row, covers),
      )
    : [];

  return { refs, backrefs, siblings };
}
