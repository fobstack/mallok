import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  compareThemeAssets,
  fingerprintThemes,
  RECORD_PATH,
  recordThemeAssets,
  type ThemeAssetRecord,
} from '../../scripts/theme-asset-versions.mjs';

const released: ThemeAssetRecord = {
  atelier: {
    version: '2.5.0',
    assets: { 'hero-carousel.js': 'aaa', 'style.css': 'bbb' },
  },
};

describe('theme asset versions', () => {
  it('keeps every official theme serving the bytes its version names', async () => {
    const record = JSON.parse(
      readFileSync(RECORD_PATH, 'utf8'),
    ) as ThemeAssetRecord;

    expect(compareThemeAssets(record, await fingerprintThemes())).toEqual([]);
  });

  it('accepts a theme whose assets and version are both unchanged', () => {
    expect(compareThemeAssets(released, released)).toEqual([]);
  });

  it('refuses a changed asset under the version it was released as', () => {
    const current = {
      atelier: {
        version: '2.5.0',
        assets: { 'hero-carousel.js': 'ccc', 'style.css': 'bbb' },
      },
    };

    const [problem] = compareThemeAssets(released, current);
    expect(problem).toContain('atelier@2.5.0 changed assets/hero-carousel.js');
    expect(problem).toContain('src/themes/atelier/theme.json');
  });

  it('refuses an added or removed asset under the same version', () => {
    const current = {
      atelier: {
        version: '2.5.0',
        assets: { 'hero-carousel.js': 'aaa', 'extra.js': 'ddd' },
      },
    };

    expect(compareThemeAssets(released, current)).toEqual([
      expect.stringContaining('changed assets/extra.js, assets/style.css'),
    ]);
  });

  it('asks for a newer version to be recorded rather than trusting it', () => {
    const current = {
      atelier: {
        version: '2.5.1',
        assets: { 'hero-carousel.js': 'ccc', 'style.css': 'bbb' },
      },
    };

    expect(compareThemeAssets(released, current)).toEqual([
      expect.stringContaining('atelier@2.5.1 is not recorded'),
    ]);
  });

  it('refuses a version that moves backwards', () => {
    const current = {
      atelier: { version: '2.4.9', assets: released.atelier?.assets ?? {} },
    };

    expect(compareThemeAssets(released, current)).toEqual([
      expect.stringContaining('went from 2.5.0 back to 2.4.9'),
    ]);
  });

  it('reports new themes and themes that no longer exist', () => {
    const current = { folio: { version: '2.0.0', assets: {} } };

    expect(compareThemeAssets(released, current)).toEqual([
      expect.stringContaining('folio@2.0.0 is not recorded'),
      expect.stringContaining('atelier is recorded but no longer exists'),
    ]);
  });

  it('records a bumped version and forgets removed themes', () => {
    const current = {
      atelier: {
        version: '2.5.1',
        assets: { 'hero-carousel.js': 'ccc', 'style.css': 'bbb' },
      },
    };

    const { record, refused } = recordThemeAssets(released, current);
    expect(refused).toEqual([]);
    expect(record).toEqual(current);
    expect(compareThemeAssets(record, current)).toEqual([]);
  });

  it('will not record changed assets under an unchanged version', () => {
    const current = {
      atelier: {
        version: '2.5.0',
        assets: { 'hero-carousel.js': 'ccc', 'style.css': 'bbb' },
      },
    };

    const { record, refused } = recordThemeAssets(released, current);
    expect(refused).toEqual([
      expect.stringContaining('atelier@2.5.0 changed assets/hero-carousel.js'),
    ]);
    expect(record).toEqual(released);
  });
});
