/**
 * `mallok build` — a whole static site from a local content directory
 * (no D1, no Worker, no network).
 *
 * It renders with the **same** `src/core` functions the Worker runs, so a
 * built page and a served page are the same bytes for the same input. That
 * is the reason `src/core` may not import Cloudflare types.
 *
 * What a build cannot do is anything that needs a server: the inquiry form
 * has nowhere to post, and there is no admin. Those are reported, not
 * silently dropped.
 */

import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  buildContentPageView,
  buildFeed,
  buildHomePageView,
  buildHomePath,
  buildImageViews,
  buildListPageView,
  buildRobots,
  buildSitemap,
  compileTheme,
  renderFragment,
  renderPage,
  type SitemapEntry,
  type SummaryInput,
  type ThemeFiles,
  type ThemeManifest,
  themeLanguageNames,
  themeStrings,
  type ViewContext,
} from '../core/index.js';
import { CliError, EXIT, type Reporter } from './output.js';
import { loadThemeFromDisk } from './preview.js';
import { scanDirectory } from './scan.js';
import {
  buildSiteModel,
  listOf,
  relationsFor,
  type SiteConfigFile,
  type SiteItem,
  type SiteModel,
  tagsOf,
  translationsOf,
} from './site-model.js';

/** Items per list page, matching the Worker's `LIST_PAGE_SIZE`. */
const PAGE_SIZE = 20;
const FEED_ITEMS = 20;

/** What a build produced. */
export interface BuildResult {
  readonly pages: number;
  readonly assets: number;
  readonly warnings: readonly string[];
}

/** Options `mallok build` takes. */
export interface BuildOptions {
  /** Directory holding `site.json` and `content/`. */
  readonly root: string;
  readonly themeDir: string;
  readonly outDir: string;
  /** Absolute origin used for canonical URLs, sitemap and feed. */
  readonly origin: string;
  readonly now: Date;
}

async function readConfig(root: string): Promise<SiteConfigFile> {
  let text: string;
  try {
    text = await readFile(join(root, 'site.json'), 'utf8');
  } catch {
    throw new CliError(
      EXIT.user,
      `No site.json in ${root}.`,
      'A build needs one. `mallok export` writes it, or copy the example from docs/CONTENT_FORMAT.md §5.',
    );
  }
  const parsed = JSON.parse(text) as SiteConfigFile;
  if (
    typeof parsed.name !== 'string' ||
    typeof parsed.defaultLocale !== 'string' ||
    !Array.isArray(parsed.locales) ||
    parsed.kinds === undefined
  ) {
    throw new CliError(
      EXIT.user,
      'site.json is missing name, defaultLocale, locales or kinds.',
    );
  }
  return parsed;
}

/** Where a public path is written inside the output directory. */
function outputPath(outDir: string, path: string): string {
  const clean = path.replace(/^\/+/, '').replace(/\/+$/, '');
  return clean === ''
    ? join(outDir, 'index.html')
    : join(outDir, ...clean.split('/'), 'index.html');
}

async function write(
  outDir: string,
  path: string,
  html: string,
): Promise<void> {
  const target = outputPath(outDir, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, html, 'utf8');
}

function contextFor(
  config: SiteConfigFile,
  manifest: ThemeManifest,
  files: ThemeFiles,
  origin: string,
  locale: string,
  path: string,
): ViewContext {
  return {
    settings: {
      name: config.name,
      tagline: config.tagline ?? '',
      defaultLocale: config.defaultLocale,
      locales: config.locales,
      kinds: config.kinds,
      nav: config.nav ?? {},
      themeOptions: config.themeOptions ?? {},
      // A build has no R2, so media is served from the site itself.
      mediaBaseUrl: '',
    },
    manifest,
    origin,
    locale,
    path,
    strings: themeStrings(manifest, files, locale),
    languageNames: themeLanguageNames(manifest, files),
  };
}

/** Maps a model item to the shape the view builders take. */
function toSummary(item: SiteItem): SummaryInput {
  return {
    id: item.id,
    kind: item.kind,
    locale: item.locale,
    slug: item.slug,
    path: item.path,
    title: item.title,
    description: item.description,
    publishedAt: item.publishedAt,
    frontmatter: item.frontmatter,
    cover: '',
  };
}

/** Copies a bundle's files into the built site, under the item's path. */
async function copyAssets(item: SiteItem, outDir: string): Promise<number> {
  let copied = 0;
  for (const [relativePath, absolute] of item.assets) {
    const target = join(
      outDir,
      ...item.path.replace(/^\/+/, '').split('/'),
      ...relativePath.split('/'),
    );
    await mkdir(dirname(target), { recursive: true });
    await copyFile(absolute, target);
    copied++;
  }
  return copied;
}

async function copyTree(from: string, to: string): Promise<number> {
  let copied = 0;
  let entries: string[] = [];
  try {
    entries = (await readdir(from, { recursive: true })) as string[];
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const source = join(from, entry);
    const target = join(to, entry);
    try {
      await mkdir(dirname(target), { recursive: true });
      await copyFile(source, target);
      copied++;
    } catch {
      // Directories surface here too; only files copy.
    }
  }
  return copied;
}

/** Builds the whole site. */
export async function buildStatic(
  options: BuildOptions,
  report: Reporter,
): Promise<BuildResult> {
  const config = await readConfig(options.root);
  const { manifest, files } = await loadThemeFromDisk(options.themeDir);
  const theme = compileTheme(manifest, files, 1);
  const warnings: string[] = [];

  report.step(`Reading content from ${options.root}…`);
  const scan = await scanDirectory(join(options.root, 'content'), {
    defaultLocale: config.defaultLocale,
    kinds: Object.keys(config.kinds),
    fields: Object.fromEntries(
      Object.entries(manifest.kinds).map(([kind, entry]) => [
        kind,
        entry.fields ?? {},
      ]),
    ),
  });
  const model = buildSiteModel(scan.bundles, config, options.now);
  report.step(
    `${model.published.length} published items in ${config.locales.length} language${config.locales.length === 1 ? '' : 's'}.`,
  );

  let pages = 0;
  let assets = 0;

  // --- content pages -------------------------------------------------
  for (const item of model.published) {
    const fragment = await renderFragment({
      body: item.body,
      frontmatter: item.frontmatter,
      // Paths stay relative to the page's own directory, and the files are
      // copied there, so the built site is self-contained.
      assets: {},
      mediaBaseUrl: '',
    });
    if (item.missing.length > 0) {
      warnings.push(
        `${item.path} references ${item.missing.length} file(s) that are not in its bundle: ${item.missing.join(', ')}`,
      );
    }

    const relations = relationsFor(model, item, manifest);
    for (const bad of relations.dangling) {
      warnings.push(
        `${item.path}: "${bad.field}: ${bad.value}" matches no published ${item.locale} content. A reference holds the target's slug, not its title (docs/CONTENT_FORMAT.md §3.2).`,
      );
    }
    const view = buildContentPageView(
      contextFor(
        config,
        manifest,
        files,
        options.origin,
        item.locale,
        item.path,
      ),
      {
        ...toSummary(item),
        updatedAt: item.updatedAt,
        images: buildImageViews({}, ''),
      },
      { html: fragment.html, meta: fragment.meta },
      translationsOf(model, item).map((entry) => ({
        locale: entry.locale,
        path: entry.path,
      })),
      {
        refs: Object.fromEntries(
          Object.entries(relations.refs).map(([field, target]) => [
            field,
            toSummary(target),
          ]),
        ),
        backrefs: Object.fromEntries(
          Object.entries(relations.backrefs).map(([kind, list]) => [
            kind,
            list.map(toSummary),
          ]),
        ),
        siblings: relations.siblings.map(toSummary),
      },
    );
    const layout =
      manifest.kinds[item.kind]?.layout ??
      manifest.kinds.page?.layout ??
      'layouts/page.liquid';
    let html = await renderPage(theme, layout, view);

    // A static site has no server, so the inquiry marker cannot become a
    // working form. Saying so beats shipping a form that silently fails.
    if (html.includes('<p>[[inquiry]]</p>')) {
      html = html.replaceAll('<p>[[inquiry]]</p>', '');
      warnings.push(
        `${item.path} contains an [[inquiry]] form, which a static build cannot serve — it needs a server to receive submissions. The marker was removed from this page.`,
      );
    }

    await write(options.outDir, item.path, html);
    pages++;
    assets += await copyAssets(item, options.outDir);
  }

  // --- home, lists and tag archives, per locale -----------------------
  for (const locale of config.locales) {
    const homePath = buildHomePath(locale, config.defaultLocale);
    const recent: Record<string, SummaryInput[]> = {};
    for (const kind of Object.keys(config.kinds)) {
      recent[kind] = listOf(model, kind, locale).slice(0, 12).map(toSummary);
    }
    await write(
      options.outDir,
      homePath,
      await renderPage(
        theme,
        manifest.home,
        buildHomePageView(
          contextFor(config, manifest, files, options.origin, locale, homePath),
          recent,
        ),
      ),
    );
    pages++;

    const prefix = locale === config.defaultLocale ? '' : `/${locale}`;

    for (const [kind, kindConfig] of Object.entries(config.kinds)) {
      const listLayout = manifest.kinds[kind]?.listLayout;
      if (listLayout === undefined || kindConfig.base === '') {
        continue;
      }
      const all = listOf(model, kind, locale);
      const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
      for (let page = 1; page <= totalPages; page++) {
        const slice = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
        if (slice.length === 0 && page > 1) {
          break;
        }
        const basePath = `${prefix}/${kindConfig.base}`;
        const path = page === 1 ? basePath : `${basePath}/page/${page}`;
        await write(
          options.outDir,
          path,
          await renderPage(
            theme,
            listLayout,
            buildListPageView(
              contextFor(config, manifest, files, options.origin, locale, path),
              {
                kind,
                items: slice.map(toSummary),
                hasNext: page < totalPages,
                page,
                basePath,
                kindBase: kindConfig.base,
              },
            ),
          ),
        );
        pages++;
      }
    }

    // Tag archives reuse whichever list layout the theme has.
    const anyListLayout = Object.values(manifest.kinds).find(
      (entry) => entry.listLayout !== undefined,
    )?.listLayout;
    if (anyListLayout !== undefined) {
      for (const [tag, tagged] of tagsOf(model, locale)) {
        const basePath = `${prefix}/tags/${encodeURIComponent(tag)}`;
        const totalPages = Math.max(1, Math.ceil(tagged.length / PAGE_SIZE));
        for (let page = 1; page <= totalPages; page++) {
          const slice = tagged.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
          const path = page === 1 ? basePath : `${basePath}/page/${page}`;
          await write(
            options.outDir,
            path,
            await renderPage(
              theme,
              anyListLayout,
              buildListPageView(
                contextFor(
                  config,
                  manifest,
                  files,
                  options.origin,
                  locale,
                  path,
                ),
                {
                  kind: 'tag',
                  items: slice.map(toSummary),
                  hasNext: page < totalPages,
                  page,
                  basePath,
                  kindBase: `tags/${encodeURIComponent(tag)}`,
                  tag,
                },
              ),
            ),
          );
          pages++;
        }
      }
    }

    // Per-locale feed.
    const articles = listOf(model, 'article', locale).slice(0, FEED_ITEMS);
    const feedPath =
      locale === config.defaultLocale ? '/feed.xml' : `${prefix}/feed.xml`;
    await mkdir(
      dirname(join(options.outDir, ...feedPath.replace(/^\//, '').split('/'))),
      { recursive: true },
    );
    await writeFile(
      join(options.outDir, ...feedPath.replace(/^\//, '').split('/')),
      buildFeed({
        siteName: config.name,
        siteUrl: `${options.origin}${homePath}`,
        feedUrl: `${options.origin}${feedPath}`,
        description: config.tagline ?? '',
        locale,
        items: articles.map((item) => ({
          title: item.title,
          url: `${options.origin}${item.path}`,
          description: item.description,
          publishedAt: item.publishedAt,
        })),
      }),
      'utf8',
    );
  }

  // --- sitemap and robots ---------------------------------------------
  const entries: SitemapEntry[] = model.published.map((item) => {
    const siblings = translationsOf(model, item);
    const fallback =
      siblings.find((entry) => entry.locale === config.defaultLocale) ?? item;
    return {
      url: `${options.origin}${item.path}`,
      lastModified: item.updatedAt,
      alternates: siblings.map((entry) => ({
        locale: entry.locale,
        url: `${options.origin}${entry.path}`,
      })),
      defaultUrl: `${options.origin}${fallback.path}`,
    };
  });
  await writeFile(
    join(options.outDir, 'sitemap.xml'),
    buildSitemap(entries),
    'utf8',
  );
  await writeFile(
    join(options.outDir, 'robots.txt'),
    buildRobots({
      indexable: true,
      sitemapUrl: `${options.origin}/sitemap.xml`,
    }),
    'utf8',
  );

  // --- theme assets and loose media ------------------------------------
  const assetTarget = join(
    options.outDir,
    'theme',
    manifest.id,
    manifest.version,
  );
  assets += await copyTree(join(options.themeDir, 'assets'), assetTarget);
  assets += await copyTree(
    join(options.root, 'media'),
    join(options.outDir, 'media'),
  );

  return { pages, assets, warnings };
}

/** A model built from a directory, for callers that only need the data. */
export type { SiteModel };
