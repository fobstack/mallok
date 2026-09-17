import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { readE2eRunManifest } from '../../scripts/e2e-server.mjs';
// @ts-expect-error -- a plain ESM script, deliberately dependency-free.
import { serveStatic } from '../../scripts/serve-static.mjs';
import { signIn } from './credentials.js';

/**
 * Accessibility (docs/TESTING.md §2, docs/ADMIN.md §14).
 *
 * The gate is **no serious or critical violations** — those are the two
 * levels that stop somebody using the product rather than annoy them. Minor
 * and moderate findings are reported in the run's output but do not fail it,
 * because a rule like "landmark-unique" firing on a theme's footer is a
 * judgement call, and a gate that fails on judgement calls gets switched off.
 *
 * Two populations are scanned. The admin is scanned live, signed in, against
 * the real Worker. The five official themes are scanned from a real
 * `mallok build` of the repository's own content — one build per theme,
 * served over HTTP so the stylesheets load, because a colour-contrast result
 * on an unstyled page means nothing.
 */

const run = promisify(execFile);

/** Rules whose failures fail this suite. */
const BLOCKING = new Set(['serious', 'critical']);

interface Violation {
  readonly id: string;
  readonly impact: string | null | undefined;
  readonly nodes: readonly {
    readonly target: readonly string[];
    readonly failureSummary?: string;
  }[];
  readonly help: string;
}

/** One line per failure, naming the element so it can actually be fixed. */
function describe(violation: Violation): string {
  const where = violation.nodes
    .slice(0, 4)
    .map((node) => {
      const summary = (node.failureSummary ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('Expected') || line.includes('ratio'))
        .join(' ');
      return `${node.target.join(' ')}${summary === '' ? '' : ` — ${summary}`}`;
    })
    .join('\n      ');
  return `${violation.id} [${violation.impact}] ${violation.help} ×${violation.nodes.length}\n      ${where}`;
}

/** Scans the current page and fails on anything serious or critical. */
async function scan(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    // WCAG 2.1 AA is the standard the docs commit to; `best-practice` rules
    // are advice, and are reported below rather than enforced.
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const violations = results.violations as unknown as Violation[];
  const blocking = violations.filter((violation) =>
    BLOCKING.has(violation.impact ?? ''),
  );
  const rest = violations.filter(
    (violation) => !BLOCKING.has(violation.impact ?? ''),
  );
  if (rest.length > 0) {
    process.stdout.write(
      `  ${label}: ${rest
        .map((violation) => `${violation.id} (${violation.impact})`)
        .join(', ')}\n`,
    );
  }

  expect(blocking.map(describe), label).toEqual([]);
}

test.describe('the admin', () => {
  test('has no serious or critical violations on any screen', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signIn(page);

    for (const [label, path] of [
      ['content list', '/_mallok/app/'],
      ['media', '/_mallok/app/media'],
      ['plugins', '/_mallok/app/plugins'],
      ['settings: site', '/_mallok/app/settings'],
      ['settings: appearance', '/_mallok/app/settings/appearance'],
      ['settings: advanced', '/_mallok/app/settings/advanced'],
      ['account', '/_mallok/app/account'],
    ] as const) {
      await page.goto(path);
      // Every screen loads its data before it is worth scanning; the heading
      // is the signal that the route rendered rather than the shell alone.
      await expect(page.getByRole('heading').first()).toBeVisible();
      await scan(page, `admin: ${label}`);
    }
  });

  test('has no serious or critical violations in the editor', async ({
    page,
  }) => {
    await signIn(page);
    await page.getByRole('button', { name: 'New' }).click();
    await expect(page.locator('#fm-title')).toBeVisible();

    await scan(page, 'admin: editor');
  });

  test('has no serious or critical violations on the sign-in screen', async ({
    page,
  }) => {
    await page.goto('/_mallok/app/');
    await expect(page.locator('#login-password')).toBeVisible();

    await scan(page, 'admin: sign in');
  });
});

/**
 * Every official theme, built from the repository's own content.
 *
 * A theme is compiled into the Worker one at a time (`ACTIVE_THEME`), so a
 * live site can only ever show one of them. `mallok build` renders a whole
 * static site with any theme from the same `src/core` functions the Worker
 * uses, which is what makes scanning all five possible at all.
 */
test.describe('the official themes', () => {
  const Themes = ['atelier', 'folio', 'gazette', 'journal', 'manual'] as const;

  for (const theme of Themes) {
    test(`${theme} has no serious or critical violations`, async ({ page }) => {
      test.setTimeout(180_000);
      const out = await mkdtemp(join(tmpdir(), `mallok-a11y-${theme}-`));
      const { sourceRoot } = await readE2eRunManifest();
      let server: { origin: string; close: () => Promise<void> } | null = null;
      try {
        await run(
          'node',
          [
            // The package this run built, not whatever `dist/` happens to
            // hold. This pointed at `dist/cli/index.js`, a path the build no
            // longer writes, and kept passing against an artifact from an
            // earlier release — the exact shape of a green that means nothing.
            join(sourceRoot, 'dist/pkg/cli/index.js'),
            'build',
            '.',
            '--theme',
            `./src/themes/${theme}`,
            '--out',
            out,
          ],
          { cwd: sourceRoot },
        );
        server = (await serveStatic(out)) as {
          origin: string;
          close: () => Promise<void>;
        };

        // Which pages exist depends on the theme: each declares its own
        // content kinds, so `/products` is a real page under `atelier` and a
        // 404 under `journal`. The built sitemap is the theme's own answer to
        // "what did this site produce", so the sample comes from there.
        const sitemap = await page.request.get(`${server.origin}/sitemap.xml`);
        const paths = [
          ...new Set(
            [...(await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map(
              (match) => new URL(match[1] ?? '/').pathname,
            ),
          ),
        ];
        expect(paths.length, `${theme} produced no pages`).toBeGreaterThan(3);

        // The home page, plus a spread across the rest: between them these
        // cover the layouts a theme actually ships.
        const sample = [
          '/',
          ...[1, 2, 3, 4].map(
            (index) => paths[Math.floor((index * paths.length) / 5)] ?? '/',
          ),
        ];
        for (const path of [...new Set(sample)]) {
          const response = await page.goto(`${server.origin}${path}`);
          expect(response?.status(), `${theme} ${path}`).toBe(200);
          await scan(page, `${theme} ${path}`);
        }
      } finally {
        await server?.close();
        await rm(out, { recursive: true, force: true });
      }
    });
  }
});
