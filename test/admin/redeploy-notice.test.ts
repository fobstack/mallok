import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  INSTANT,
  NEEDS_DEPLOY,
} from '../../src/admin/pages/settings-advanced.js';

/**
 * `AC-THEME-08`, `AC-PLUGIN-07`, `AC-INV-10` (docs/ACCEPTANCE.md §6, §7,
 * §11): the admin has no theme-switch or plugin-install control, and says so
 * honestly rather than dressing a source change up as one click
 * (docs/ADMIN.md §4.1, §10). Previously walked through by hand only.
 */

function source(path: string): string {
  return readFileSync(
    new URL(`../../src/admin/pages/${path}`, import.meta.url),
    'utf8',
  );
}

/** Collapses whitespace so a sentence wrapped across JSX lines still matches. */
function flatten(text: string): string {
  return text.replace(/\s+/g, ' ');
}

describe('AC-INV-10: the interface names what needs a deploy', () => {
  it('says switching themes and installing plugins are not instant', () => {
    expect(INSTANT).not.toContain('Switching to a different theme');
    expect(NEEDS_DEPLOY).toContain('Switching to a different theme');
    expect(NEEDS_DEPLOY).toContain('Installing, updating or removing a plugin');
  });
});

describe('AC-THEME-08: Appearance has no theme upload or switch control', () => {
  const page = source('settings-appearance.tsx');

  it('states plainly that a theme switch means editing source and deploying', () => {
    expect(flatten(page)).toContain('Changing the theme takes a deploy');
    expect(flatten(page)).toContain(
      'Themes live in the source tree, not the database',
    );
    expect(page).toContain('ACTIVE_THEME');
    expect(page).toContain('src/themes/index.ts');
  });

  it('renders no control that could switch or upload a theme', () => {
    // No file input (an upload) and no call the admin API's theme route,
    // which is read-only — this page never writes to it.
    expect(page).not.toMatch(/type=["']file["']/);
    expect(page).not.toMatch(/\/api\/theme/);
  });
});

describe('AC-PLUGIN-07: the plugin page has no install control', () => {
  const page = source('plugins.tsx');

  it('states plainly that plugins ship with the source', () => {
    const flat = flatten(page);
    expect(flat).toContain(
      'Plugins ship with your source, not through this page',
    );
    expect(page).toContain('src/plugins/');
    expect(flat).toContain(
      'There is no upload here because there is no way to make an upload take effect without a new build.',
    );
  });

  it('renders no control that could install, update or remove a plugin', () => {
    expect(page).not.toMatch(/type=["']file["']/);
    // The only mutating plugin routes this page calls are per-instance
    // runtime controls — the switch, settings and secrets — never a route
    // that installs, updates or removes a plugin from the build.
    const mutatingCalls = [...page.matchAll(/api\(`([^`]+)`/g)].map(
      (match) => match[1],
    );
    expect(mutatingCalls.length).toBeGreaterThan(0);
    for (const call of mutatingCalls) {
      expect(call).toMatch(
        /^\/plugins\/\$\{plugin\.id\}\/(enabled|settings|secrets)/,
      );
    }
  });
});
