import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- a build script, plain JavaScript with no declarations.
import { stylesheetPackages } from '../../scripts/third-party-notices.mjs';

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
