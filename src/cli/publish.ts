/**
 * `mallok publish` and `mallok import` (docs/CLI.md §6).
 *
 * They are the same operation with one difference: `publish` defaults to
 * publishing, `import` keeps whatever status the front matter asks for
 * (docs/CONTENT_FORMAT.md §7.4).
 */

import { resolveStatus, splitFrontmatter } from '../core/index.js';
import type { SiteClient } from './client.js';
import { existingHashes, prepareMedia, uploadMedia } from './media.js';
import { CliError, EXIT, type Reporter } from './output.js';
import type { Bundle } from './scan.js';

/** What happened to one document. */
export interface PublishOutcome {
  readonly bundle: string;
  readonly locale: string;
  readonly kind: string;
  readonly status: 'created' | 'updated' | 'unchanged' | 'failed';
  readonly path?: string;
  readonly error?: string;
  readonly missing: readonly string[];
}

/** Options a publish run takes. */
export interface PublishOptions {
  readonly mode: 'publish' | 'import';
  readonly draft: boolean;
  readonly createOnly: boolean;
  readonly dryRun: boolean;
  readonly failOnMissing: boolean;
  /** Variant widths the site's theme asks for. */
  readonly widths: readonly number[];
  readonly maxEdge: number | null;
  readonly defaultLocale: string;
}

/** The API's response to a content save. */
interface SaveResponse {
  readonly id: string;
  readonly path: string;
  readonly unchanged?: boolean;
  readonly missingAssets?: readonly string[];
}

/**
 * Publishes every bundle.
 *
 * Media is handled first and per bundle rather than all at once, so a large
 * directory does not build one enormous request (docs/CLI.md §6.5).
 */
export async function publishBundles(
  client: SiteClient,
  bundles: readonly Bundle[],
  options: PublishOptions,
  report: Reporter,
): Promise<PublishOutcome[]> {
  const outcomes: PublishOutcome[] = [];
  const now = new Date();

  for (const bundle of bundles) {
    // One hash per referenced file, then a single question about all of them.
    const prepared = new Map<
      string,
      Awaited<ReturnType<typeof prepareMedia>>
    >();
    for (const document of bundle.documents) {
      for (const [relative, absolute] of document.assets) {
        if (prepared.has(relative)) {
          continue;
        }
        prepared.set(
          relative,
          await prepareMedia(absolute, relative, options.maxEdge),
        );
      }
    }

    const assets: Record<string, string> = {};
    for (const [relative, media] of prepared) {
      assets[relative] = media.sha256;
    }

    if (!options.dryRun && prepared.size > 0) {
      const known = await existingHashes(
        client,
        [...prepared.values()].map((media) => media.sha256),
      );
      for (const media of prepared.values()) {
        if (known.has(media.sha256)) {
          continue;
        }
        report.step(`  uploading ${media.path}`);
        await uploadMedia(client, media, options.widths);
      }
    }

    for (const document of bundle.documents) {
      const { data } = splitFrontmatter(document.markdown);
      const status = options.draft
        ? 'draft'
        : options.mode === 'publish'
          ? 'published'
          : resolveStatus(data, now);

      if (options.dryRun) {
        // Predict rather than assume: the server decides "unchanged" by
        // comparing the Markdown hash and the assets map, and the same
        // comparison can be made here from the item the site already has.
        const slug = typeof data.slug === 'string' ? data.slug : bundle.name;
        const existing = await findExisting(
          client,
          bundle.kind,
          document.locale,
          slug,
        );
        const unchanged =
          existing !== null &&
          existing.markdown === document.markdown &&
          sameAssets(existing.assets, assets);
        outcomes.push({
          bundle: bundle.name,
          locale: document.locale,
          kind: bundle.kind,
          status: unchanged
            ? 'unchanged'
            : existing === null
              ? 'created'
              : 'updated',
          ...(existing === null ? {} : { path: existing.path }),
          missing: document.missing,
        });
        continue;
      }

      const identityItem = bundle.identity?.items[document.locale];
      const body = {
        ...(identityItem === undefined ? {} : { id: identityItem.id }),
        ...(bundle.identity === null
          ? {}
          : { translationGroup: bundle.identity.translation_group }),
        kind: bundle.kind,
        locale: document.locale,
        slug: typeof data.slug === 'string' ? data.slug : bundle.name,
        markdown: document.markdown,
        assets,
        ...(options.createOnly ? { createOnly: true } : {}),
        // The API accepts draft or published; a future date becomes
        // scheduled on the server from the front matter.
        status: status === 'draft' ? 'draft' : 'published',
      };

      try {
        const result = await client.post<SaveResponse>('/content', body);
        outcomes.push({
          bundle: bundle.name,
          locale: document.locale,
          kind: bundle.kind,
          status: result.unchanged === true ? 'unchanged' : 'updated',
          path: result.path,
          missing: [
            ...new Set([...document.missing, ...(result.missingAssets ?? [])]),
          ],
        });
      } catch (error) {
        if (error instanceof CliError && error.code === EXIT.auth) {
          throw error;
        }
        outcomes.push({
          bundle: bundle.name,
          locale: document.locale,
          kind: bundle.kind,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
          missing: document.missing,
        });
      }
    }
  }

  return outcomes;
}

/** The fields a dry run compares against. */
interface ExistingItem {
  readonly markdown: string;
  readonly assets: Readonly<Record<string, string>>;
  readonly path: string;
}

/** Looks one item up by its natural key; null when the site has none. */
async function findExisting(
  client: SiteClient,
  kind: string,
  locale: string,
  slug: string,
): Promise<ExistingItem | null> {
  try {
    const list = await client.get<{ items: { id: string }[] }>(
      `/content?kind=${encodeURIComponent(kind)}&locale=${encodeURIComponent(locale)}&limit=200`,
    );
    for (const item of list.items) {
      const detail = await client.get<ExistingItem & { slug: string }>(
        `/content/${item.id}`,
      );
      if (detail.slug === slug) {
        return detail;
      }
    }
  } catch {
    // A dry run must not fail because a lookup did; it reports what it can.
  }
  return null;
}

function sameAssets(
  a: Readonly<Record<string, string>>,
  b: Readonly<Record<string, string>>,
): boolean {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => a[key] === b[key])
  );
}

/** Missing-file report (docs/CLI.md §6.6). */
export function reportMissing(
  outcomes: readonly PublishOutcome[],
  bundles: readonly Bundle[],
  report: Reporter,
  failOnMissing: boolean,
): void {
  const withMissing = outcomes.filter((row) => row.missing.length > 0);
  const total = withMissing.reduce((sum, row) => sum + row.missing.length, 0);
  if (total > 0) {
    const items = `${withMissing.length} item${withMissing.length === 1 ? '' : 's'}`;
    const verb = withMissing.length === 1 ? 'references' : 'reference';
    const files =
      total === 1
        ? '1 file that is not present'
        : `${total} files that are not present`;
    report.warn(`${items} ${verb} ${files}:`);
    for (const row of withMissing) {
      report.warn(
        `    ${row.bundle} (${row.locale}): ${row.missing.join(', ')}`,
      );
    }
  }

  const slots = bundles.filter((bundle) => bundle.unfilledSlots.length > 0);
  for (const bundle of slots) {
    report.warn(
      `    ${bundle.name}: image slots not yet filled — ${bundle.unfilledSlots.join(', ')}`,
    );
  }

  if (failOnMissing && (total > 0 || slots.length > 0)) {
    throw new CliError(
      EXIT.user,
      'Some referenced files are missing and --fail-on-missing was set.',
    );
  }
}
