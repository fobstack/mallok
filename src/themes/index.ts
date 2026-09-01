/**
 * The themes compiled into this build, and which one the site renders with.
 *
 * Themes are source, not data (docs/THEME_FORMAT.md §1). Switching means
 * editing `ACTIVE_THEME` below and deploying again — there is no database
 * column and no admin control for it, because there is no way to make it take
 * effect without a new build.
 */

import type { ThemeFiles, ThemeManifest } from '../core/index.js';
import { atelierFiles, atelierManifest } from './atelier/index.js';
import { folioFiles, folioManifest } from './folio/index.js';
import { gazetteFiles, gazetteManifest } from './gazette/index.js';
import { journalFiles, journalManifest } from './journal/index.js';
import { manualFiles, manualManifest } from './manual/index.js';

/** A theme as it exists inside the Worker bundle. */
export interface BundledTheme {
  readonly manifest: ThemeManifest;
  /** Templates, partials and locale bundles, keyed by path inside the theme. */
  readonly files: ThemeFiles;
}

const atelier: BundledTheme = {
  manifest: atelierManifest,
  files: atelierFiles,
};
const folio: BundledTheme = { manifest: folioManifest, files: folioFiles };
const gazette: BundledTheme = {
  manifest: gazetteManifest,
  files: gazetteFiles,
};
const journal: BundledTheme = {
  manifest: journalManifest,
  files: journalFiles,
};
const manual: BundledTheme = { manifest: manualManifest, files: manualFiles };

/** Every theme in this build, for the admin's "what am I running" panel. */
export const THEMES: Readonly<Record<string, BundledTheme>> = {
  atelier,
  folio,
  gazette,
  journal,
  manual,
};

/**
 * The theme this deployment renders with.
 *
 * **This line is what "switching themes" means.** Change it, run the build,
 * deploy. Content ids, URLs and media are untouched (docs/THEME_FORMAT.md §12).
 *
 * `atelier` is the default because 0.1's acceptance target is a real
 * foreign-trade site (docs/PRODUCT_VISION.md §2), and the `trade-b2b` starter
 * is written for its six content kinds. A fork whose site is a blog or a
 * handbook changes this line to `journal`, `gazette`, `manual` or `folio`.
 */
export const ACTIVE_THEME: BundledTheme = atelier;
