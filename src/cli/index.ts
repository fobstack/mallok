/**
 * The `mallok` command (docs/CLI.md).
 *
 * The published bundle gets its `#!/usr/bin/env node` line from the build
 * script, so this file does not carry one.
 *
 * Every command here goes through the same management API the admin uses, so
 * there is nothing the interface can do that a script cannot
 * (docs/PRODUCT_VISION.md §5.9).
 */

import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  boolFlag,
  parseArgs,
  resolveOrigin,
  resolveToken,
  stringFlag,
} from './args.js';
import { createClient, type SiteClient } from './client.js';
import { createSite } from './create.js';
import { exportSite } from './export.js';
import {
  CliError,
  EXIT,
  makeReporter,
  type Reporter,
  reportFailure,
  table,
} from './output.js';
import { destroySteps, MANUAL_CLEANUP, runWrangler } from './provision.js';
import { publishBundles, reportMissing, reportWarnings } from './publish.js';
import { readRegistry, resourceNames, writeRegistry } from './registry.js';
import { scanDirectory } from './scan.js';

/**
 * The published version.
 *
 * Substituted at build time from the manifest, so `mallok --version` cannot
 * disagree with the package a user installed — the two came from one source.
 * Running from source there is no substitution and it reports `dev`, which is
 * the honest answer for a build nobody published.
 */
declare const __MALLOK_VERSION__: string | undefined;

export const VERSION: string =
  typeof __MALLOK_VERSION__ === 'string' ? __MALLOK_VERSION__ : 'dev';

const USAGE = `mallok — publish and manage a Mallok site

  mallok publish <dir>     Publish article bundles (defaults to published)
  mallok import <dir>      Import, keeping each bundle's own status
  mallok export <dir>      Write the whole site to a directory
  mallok preview <dir>     Render bundles locally, with no network
  mallok build <dir>       Build a whole static site from local files (no D1)
  mallok media push <dir>  Upload media without touching content
  mallok create <dir>      Create a Mallok project, then deploy it
  mallok destroy <slug>    Delete a site's Worker, database and bucket

Options
  --site <slug>        Target site from .mallok/sites.json
  --url <origin>       Target site directly
  --token <token>      API token (default: MALLOK_TOKEN)
  --kind <kind>        Content type for every bundle
  --theme <dir>        Theme directory, for preview
  --out <dir>          Output directory (preview, build)
  --origin <url>       Absolute site URL for canonical, sitemap and feed
  --draft              Save everything as a draft
  --with-settings      Also apply site.json from an export directory
  --create-only        Fail instead of updating existing content
  --fail-on-missing    Treat missing referenced files as an error
  --slug <slug>        Cloudflare resource slug for create (default: the
                       directory's own name)
  --domain <host>      Custom domain, for create
  --no-deploy          create: generate and verify the project, touch nothing
                       on Cloudflare
  --confirm <slug>     Required by destroy; repeat the slug
  --dry-run            Report what would happen, write nothing
  --json               Emit one JSON object on stdout
  --version            Print the version
  -v, --verbose        Print each request
`;

/** Site settings the CLI needs before it can interpret a directory. */
interface RemoteContext {
  readonly defaultLocale: string;
  readonly kinds: readonly string[];
  readonly maxEdge: number | null;
  readonly widths: readonly number[];
  readonly fields: Record<string, Record<string, never>>;
}

async function loadContext(client: SiteClient): Promise<RemoteContext> {
  const [settings, theme] = await Promise.all([
    client.get<{
      defaultLocale: string;
      kinds: Record<string, { base: string }>;
      maxImageEdge: number | null;
    }>('/settings'),
    client.get<{
      imageWidths: number[];
      kinds: Record<string, { fields?: Record<string, never> }>;
    }>('/theme'),
  ]);
  const fields: Record<string, Record<string, never>> = {};
  for (const [kind, config] of Object.entries(theme.kinds)) {
    fields[kind] = config.fields ?? {};
  }
  return {
    defaultLocale: settings.defaultLocale,
    kinds: Object.keys(settings.kinds),
    maxEdge: settings.maxImageEdge,
    widths: theme.imageWidths,
    fields,
  };
}

/** Reads `.mallok/sites.json`, which never contains a secret. */
async function loadRegistry(): Promise<Record<string, { origin: string }>> {
  try {
    const text = await readFile('.mallok/sites.json', 'utf8');
    const parsed = JSON.parse(text) as {
      sites?: Record<string, { origin: string }>;
    };
    return parsed.sites ?? {};
  } catch {
    return {};
  }
}

async function connect(
  args: ReturnType<typeof parseArgs>,
): Promise<SiteClient> {
  const origin = resolveOrigin(args, await loadRegistry());
  return createClient(
    origin,
    resolveToken(args, process.env),
    boolFlag(args, 'verbose'),
  );
}

async function runPublish(
  args: ReturnType<typeof parseArgs>,
  report: Reporter,
  mode: 'publish' | 'import',
): Promise<number> {
  const dir = args.positional[0];
  if (dir === undefined) {
    throw new CliError(EXIT.user, `mallok ${mode} needs a directory.`);
  }
  const client = await connect(args);
  const context = await loadContext(client);

  // An export carries `site.json`; importing it is opt-in because it
  // overwrites navigation, kinds and theme options (docs/CONTENT_FORMAT.md §7.1).
  if (boolFlag(args, 'with-settings')) {
    const applied = await applySiteJson(client, resolve(dir), report);
    if (!applied) {
      report.warn('No site.json found; settings were left alone.');
    }
  }

  report.step(`Scanning ${resolve(dir)}…`);
  const scan = await scanDirectory(resolve(dir), {
    defaultLocale: context.defaultLocale,
    kinds: context.kinds,
    ...(stringFlag(args, 'kind') === undefined
      ? {}
      : { kind: stringFlag(args, 'kind') as string }),
    fields: context.fields,
  });
  report.step(
    `Found ${scan.bundles.length} bundle${scan.bundles.length === 1 ? '' : 's'} (${scan.layout} layout).`,
  );

  const outcomes = await publishBundles(
    client,
    scan.bundles,
    {
      mode,
      draft: boolFlag(args, 'draft'),
      createOnly: boolFlag(args, 'create-only'),
      dryRun: boolFlag(args, 'dry-run'),
      failOnMissing: boolFlag(args, 'fail-on-missing'),
      widths: context.widths,
      maxEdge: context.maxEdge,
      defaultLocale: context.defaultLocale,
    },
    report,
  );

  reportMissing(
    outcomes,
    scan.bundles,
    report,
    boolFlag(args, 'fail-on-missing'),
  );
  reportWarnings(outcomes, report);

  const failed = outcomes.filter((row) => row.status === 'failed');
  report.done(
    {
      command: mode,
      dryRun: boolFlag(args, 'dry-run'),
      items: outcomes,
      counts: {
        total: outcomes.length,
        unchanged: outcomes.filter((row) => row.status === 'unchanged').length,
        failed: failed.length,
      },
    },
    table(
      ['bundle', 'locale', 'status', 'path'],
      outcomes.map((row) => [
        row.bundle,
        row.locale,
        row.status,
        row.path ?? row.error ?? '',
      ]),
    ),
  );

  if (failed.length > 0) {
    return outcomes.length === failed.length ? EXIT.remote : EXIT.partial;
  }
  return EXIT.ok;
}

async function runExport(
  args: ReturnType<typeof parseArgs>,
  report: Reporter,
): Promise<number> {
  const dir = args.positional[0];
  if (dir === undefined) {
    throw new CliError(EXIT.user, 'mallok export needs a target directory.');
  }
  const client = await connect(args);
  const result = await exportSite(client, resolve(dir), report);
  report.done(
    { command: 'export', directory: resolve(dir), ...result },
    table(
      ['written', 'content', 'media'],
      [[String(result.files), String(result.content), String(result.media)]],
    ),
  );
  return EXIT.ok;
}

/**
 * Applies an export's `site.json`.
 *
 * Only the fields the settings API accepts are sent; the theme block is
 * informational, because a theme is source code and an import cannot install
 * one (docs/CONTENT_FORMAT.md §5).
 */
async function applySiteJson(
  client: SiteClient,
  root: string,
  report: Reporter,
): Promise<boolean> {
  const { readFile } = await import('node:fs/promises');
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(
      await readFile(resolve(root, 'site.json'), 'utf8'),
    ) as Record<string, unknown>;
  } catch {
    return false;
  }
  const patch: Record<string, unknown> = {};
  for (const key of [
    'name',
    'tagline',
    'kinds',
    'nav',
    'seo',
    'themeOptions',
  ]) {
    if (parsed[key] !== undefined) {
      patch[key] = parsed[key];
    }
  }
  if (Array.isArray(parsed.locales)) {
    patch.locales = parsed.locales;
  }
  report.step('Applying site.json…');
  await client.patch('/settings', patch);

  const theme = parsed.theme as { id?: string } | undefined;
  if (theme?.id !== undefined) {
    const active = await client.get<{ id: string }>('/theme');
    if (active.id !== theme.id) {
      report.warn(
        `This export was made with the "${theme.id}" theme; the site runs "${active.id}". Content and URLs are unaffected, but kinds that theme does not declare fall back to the page layout.`,
      );
    }
  }
  return true;
}

/**
 * `mallok build` — a whole static site from local files, with no D1 and no
 * network. The trade is stated rather than hidden: no admin, no instant
 * publishing, and the inquiry form needs a server.
 */
async function runBuild(
  args: ReturnType<typeof parseArgs>,
  report: Reporter,
): Promise<number> {
  const root = args.positional[0];
  if (root === undefined) {
    throw new CliError(
      EXIT.user,
      'mallok build needs a directory containing site.json and content/.',
      'For example: mallok build ./my-site --theme ./src/themes/atelier',
    );
  }
  const themeDir = stringFlag(args, 'theme');
  if (themeDir === undefined) {
    throw new CliError(
      EXIT.user,
      'mallok build needs --theme.',
      'A build renders offline, so it cannot ask a site which theme to use.',
    );
  }
  const { buildStatic } = await import('./build.js');
  const result = await buildStatic(
    {
      root: resolve(root),
      themeDir: resolve(themeDir),
      outDir: resolve(stringFlag(args, 'out') ?? 'dist-site'),
      origin: (stringFlag(args, 'origin') ?? 'http://localhost').replace(
        /\/$/,
        '',
      ),
      now: new Date(),
    },
    report,
  );
  for (const warning of result.warnings) {
    report.warn(warning);
  }
  report.done(
    { command: 'build', ...result },
    table(
      ['pages', 'files copied', 'warnings'],
      [
        [
          String(result.pages),
          String(result.assets),
          String(result.warnings.length),
        ],
      ],
    ),
  );
  return EXIT.ok;
}

async function runPreview(
  args: ReturnType<typeof parseArgs>,
  report: Reporter,
): Promise<number> {
  const dir = args.positional[0];
  if (dir === undefined) {
    throw new CliError(EXIT.user, 'mallok preview needs a directory.');
  }
  const themeDir = stringFlag(args, 'theme');
  if (themeDir === undefined) {
    throw new CliError(
      EXIT.user,
      'mallok preview needs --theme.',
      'It renders offline, so it cannot ask a site which theme to use. For example: --theme ./src/themes/atelier',
    );
  }
  const outDir = stringFlag(args, 'out') ?? 'preview';
  const { loadThemeFromDisk, previewBundle } = await import('./preview.js');
  const theme = await loadThemeFromDisk(resolve(themeDir));
  const scan = await scanDirectory(resolve(dir), {
    defaultLocale: theme.manifest.defaultLocale,
    kinds: Object.keys(theme.manifest.kinds),
    ...(stringFlag(args, 'kind') === undefined
      ? {}
      : { kind: stringFlag(args, 'kind') as string }),
    fields: Object.fromEntries(
      Object.entries(theme.manifest.kinds).map(([kind, config]) => [
        kind,
        config.fields ?? {},
      ]),
    ),
  });

  const { mkdir } = await import('node:fs/promises');
  await mkdir(resolve(outDir), { recursive: true });
  const written: string[][] = [];
  for (const bundle of scan.bundles) {
    const outFile = resolve(outDir, `${bundle.kind}-${bundle.name}.html`);
    await previewBundle(bundle, {
      manifest: theme.manifest,
      files: theme.files,
      siteName: stringFlag(args, 'site-name') ?? 'Preview',
      defaultLocale: theme.manifest.defaultLocale,
      outFile,
    });
    written.push([bundle.name, bundle.kind, outFile]);
  }
  report.done(
    { command: 'preview', theme: theme.manifest.id, files: written.length },
    table(['bundle', 'kind', 'file'], written),
  );
  return EXIT.ok;
}

async function runCreate(
  args: ReturnType<typeof parseArgs>,
  report: Reporter,
): Promise<number> {
  const directory = args.positional[0];
  if (directory === undefined) {
    throw new CliError(
      EXIT.user,
      'mallok create needs a directory.',
      'For example: mallok create my-site --domain example.com',
    );
  }

  const result = await createSite(
    {
      directory,
      // The directory is where the project goes; the slug names the Cloudflare
      // resources. They are usually the same word and do not have to be — a
      // directory can be `.`, and a slug cannot.
      ...(stringFlag(args, 'slug') === undefined
        ? {}
        : { slug: stringFlag(args, 'slug') as string }),
      domain: stringFlag(args, 'domain') ?? null,
      noDeploy: boolFlag(args, 'no-deploy'),
      dryRun: boolFlag(args, 'dry-run'),
    },
    report,
  );

  const setupUrl =
    result.origin === null || result.origin === ''
      ? ''
      : `${result.origin}/_mallok/setup`;
  if (setupUrl !== '') {
    report.step(`\nOpen ${setupUrl} to finish setting up the site.`);
  }
  report.done(
    {
      command: 'create',
      directory,
      slug: result.slug,
      origin: result.origin,
      deployed: result.deployed,
      setupUrl,
    },
    table(
      ['directory', 'slug', 'origin'],
      [[directory, result.slug, result.origin ?? '—']],
    ),
  );
  return EXIT.ok;
}

async function runDestroy(
  args: ReturnType<typeof parseArgs>,
  report: Reporter,
): Promise<number> {
  const slug = args.positional[0];
  if (slug === undefined) {
    throw new CliError(EXIT.user, 'mallok destroy needs a site slug.');
  }
  const sites = await readRegistry();
  const record = sites.find((site) => site.slug === slug);
  if (record === undefined) {
    throw new CliError(
      EXIT.user,
      `"${slug}" is not in .mallok/sites.json.`,
      `Known sites: ${sites.map((site) => site.slug).join(', ') || 'none'}.`,
    );
  }
  if (stringFlag(args, 'confirm') !== slug) {
    // Deleting a site destroys its content, its media and its inquiries.
    throw new CliError(
      EXIT.user,
      'This permanently deletes the Worker, the database and the bucket.',
      `Export a backup first, then run: mallok destroy ${slug} --confirm ${slug}`,
    );
  }

  const config = resourceNames(slug).config;
  const results: { step: string; ok: boolean; detail: string }[] = [];
  for (const step of destroySteps(slug, config)) {
    report.step(`${step.label}…`);
    if (boolFlag(args, 'dry-run')) {
      results.push({ step: step.label, ok: true, detail: 'dry run' });
      continue;
    }
    const run = await runWrangler(step.args);
    const missing = /not found|does not exist|no such/i.test(run.stderr);
    const ok = run.code === 0 || (step.tolerateMissing && missing);
    results.push({
      step: step.label,
      ok,
      detail: ok
        ? missing
          ? 'already gone'
          : 'deleted'
        : (run.stderr.trim().split('\n').at(-1) ?? 'failed'),
    });
    if (!ok) {
      // Stop rather than continue past a failure: a half-deleted site with no
      // report is worse than one that says where it stopped.
      report.done(
        { command: 'destroy', slug, results, stoppedAt: step.label },
        table(
          ['step', 'result'],
          results.map((row) => [row.step, row.detail]),
        ),
      );
      return EXIT.remote;
    }
  }

  if (!boolFlag(args, 'dry-run')) {
    await writeRegistry(sites.filter((site) => site.slug !== slug));
  }
  for (const line of MANUAL_CLEANUP) {
    report.warn(`Still to do by hand: ${line}`);
  }
  report.done(
    { command: 'destroy', slug, results, manual: MANUAL_CLEANUP },
    table(
      ['step', 'result'],
      results.map((row) => [row.step, row.detail]),
    ),
  );
  return EXIT.ok;
}

async function runMediaPush(
  args: ReturnType<typeof parseArgs>,
  report: Reporter,
): Promise<number> {
  const dir = args.positional[1];
  if (dir === undefined) {
    throw new CliError(EXIT.user, 'mallok media push needs a directory.');
  }
  const client = await connect(args);
  const context = await loadContext(client);
  const scan = await scanDirectory(resolve(dir), {
    defaultLocale: context.defaultLocale,
    kinds: context.kinds,
    ...(stringFlag(args, 'kind') === undefined
      ? {}
      : { kind: stringFlag(args, 'kind') as string }),
    fields: context.fields,
  });

  const { existingHashes, prepareMedia, uploadMedia } = await import(
    './media.js'
  );
  let uploaded = 0;
  let skipped = 0;
  for (const bundle of scan.bundles) {
    for (const document of bundle.documents) {
      for (const [relative, absolute] of document.assets) {
        const media = await prepareMedia(absolute, relative, context.maxEdge);
        const known = await existingHashes(client, [media.sha256]);
        if (known.has(media.sha256)) {
          skipped++;
          continue;
        }
        report.step(`  uploading ${relative}`);
        await uploadMedia(client, media, context.widths);
        uploaded++;
      }
    }
  }
  report.done(
    { command: 'media push', uploaded, skipped },
    table(
      ['uploaded', 'already present'],
      [[String(uploaded), String(skipped)]],
    ),
  );
  return EXIT.ok;
}

/** Entry point. Returns the process exit code. */
export async function main(argv: readonly string[]): Promise<number> {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(argv);
  } catch (error) {
    return reportFailure(error);
  }

  if (boolFlag(args, 'version')) {
    process.stdout.write(`${VERSION}\n`);
    return EXIT.ok;
  }

  if (args.command === '' || boolFlag(args, 'help')) {
    process.stdout.write(USAGE);
    // `--help` is a request that succeeded, whether or not a command came with
    // it: `mallok --help` exiting non-zero makes every script that checks the
    // status treat a working install as broken. Only a bare invocation with no
    // command and no `--help` is a usage error.
    return boolFlag(args, 'help') ? EXIT.ok : EXIT.user;
  }

  const report = makeReporter(boolFlag(args, 'json'));
  try {
    switch (args.command) {
      case 'publish':
        return await runPublish(args, report, 'publish');
      case 'import':
        return await runPublish(args, report, 'import');
      case 'export':
        return await runExport(args, report);
      case 'preview':
        return await runPreview(args, report);
      case 'build':
        return await runBuild(args, report);
      case 'media':
        if (args.positional[0] !== 'push') {
          throw new CliError(EXIT.user, 'The only media command is "push".');
        }
        return await runMediaPush(args, report);
      case 'create':
        return await runCreate(args, report);
      case 'destroy':
        return await runDestroy(args, report);
      default:
        throw new CliError(EXIT.user, `Unknown command "${args.command}".`);
    }
  } catch (error) {
    return reportFailure(error);
  }
}

/**
 * Runs only when this file is what Node was asked to run.
 *
 * The previous check was `argv[1].endsWith('cli/index.js')`, which is true
 * when the bundle is run from the repository and **false once the package is
 * installed**: npm links the binary as `node_modules/.bin/mallok`, so `argv[1]`
 * ends with `mallok`. The published CLI therefore exited silently with status
 * 0 and did nothing at all — a failure with no error message, which is the
 * worst kind to ship.
 *
 * Comparing real paths handles both: `realpathSync` follows npm's symlink to
 * the same file `import.meta.url` names, and under a test runner `argv[1]` is
 * the runner, so importing this module still has no side effect.
 */
function invokedDirectly(): boolean {
  const invoked = process.argv[1];
  if (invoked === undefined) {
    return false;
  }
  try {
    return realpathSync(invoked) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  process.exitCode = await main(process.argv.slice(2));
}
