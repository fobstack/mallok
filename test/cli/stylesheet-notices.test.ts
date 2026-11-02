import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  stylesheetPackages,
  thirdPartyNotices,
  // @ts-expect-error -- a build script, plain JavaScript with no declarations.
} from '../../scripts/third-party-notices.mjs';

/**
 * What the admin stylesheet inlines with `@import` is attributed in
 * THIRD_PARTY_NOTICES (scripts/third-party-notices.mjs). Vite's licence list
 * never sees those packages, so they are read from the stylesheet.
 */
describe('stylesheetPackages', () => {
  it('lists each package a stylesheet imports, once, with its licence', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mallok-css-'));
    const file = join(dir, 'styles.css');
    await writeFile(
      file,
      [
        '@import "tailwindcss";',
        "@import 'tw-animate-css';",
        '@import "shadcn/tailwind.css";',
        '@import "tailwindcss/utilities.css";',
        // Relative imports are the project's own files.
        '@import "./local.css";',
        '.x { color: red; }',
      ].join('\n'),
    );
    const entries = (await stylesheetPackages(file)) as {
      name: string;
      version: string;
      identifier: string;
      text?: string;
    }[];
    expect(entries.map((entry) => entry.name)).toEqual([
      'shadcn',
      'tailwindcss',
      'tw-animate-css',
    ]);
    for (const entry of entries) {
      expect(entry.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(entry.identifier).toBe('MIT');
      expect(entry.text).toMatch(/MIT License/);
    }
  });

  it('covers what the admin stylesheet really imports', async () => {
    const entries = (await stylesheetPackages('src/admin/styles.css')) as {
      name: string;
    }[];
    expect(entries.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(['tailwindcss', 'tw-animate-css', 'shadcn']),
    );
  });
});

/**
 * Vite lists a package's sub-path package (`@hookform/resolvers/zod`) as a
 * package of its own, with a manifest but no licence file. Its licence is
 * the package's it lives in; the notice has to carry that text rather than
 * stop the build.
 */
describe('thirdPartyNotices', () => {
  it('gives a sub-path package the licence text of the package it lives in', async () => {
    const { packages } = (await thirdPartyNotices(
      [],
      [
        {
          name: '@hookform/resolvers/zod',
          version: '1.0.0',
          identifier: 'MIT',
        },
      ],
    )) as {
      packages: { name: string; license: string; text: string | null }[];
    };
    const entry = packages.find(
      (pkg) => pkg.name === '@hookform/resolvers/zod',
    );
    expect(entry?.license).toBe('MIT');
    expect(entry?.text).toContain('MIT License');
  });
});
