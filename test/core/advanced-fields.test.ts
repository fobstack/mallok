import { describe, expect, it } from 'vitest';
import {
  parsePluginManifest,
  parseThemeManifest,
} from '../../src/core/index.js';

/**
 * `advanced` on a field, an option or a plugin setting
 * (docs/ADMIN_SIMPLE.md, D9): optional, so a manifest without it is read as
 * before; and never on a required field, which the admin would then hide.
 */

const THEME = {
  id: 'sample',
  name: 'Sample',
  version: '1.0.0',
  home: 'layouts/home.liquid',
  locales: ['en'],
  defaultLocale: 'en',
};

describe('the advanced mark', () => {
  it('is optional on a theme field and a theme option', () => {
    const without = parseThemeManifest({
      ...THEME,
      kinds: {
        page: {
          layout: 'layouts/page.liquid',
          fields: { note: { type: 'string' } },
        },
      },
      options: { tone: { type: 'string', label: 'Tone', default: 'calm' } },
    });
    expect(without.kinds.page?.fields?.note?.advanced).toBeUndefined();
    const marked = parseThemeManifest({
      ...THEME,
      kinds: {
        page: {
          layout: 'layouts/page.liquid',
          fields: { note: { type: 'string', advanced: true } },
        },
      },
      options: {
        tone: {
          type: 'string',
          label: 'Tone',
          default: 'calm',
          advanced: true,
        },
      },
    });
    expect(marked.kinds.page?.fields?.note?.advanced).toBe(true);
    expect(marked.options.tone?.advanced).toBe(true);
  });

  it('is optional on a plugin setting', () => {
    const base = { id: 'sample', name: 'Sample', version: '1.0.0' };
    expect(
      parsePluginManifest({
        ...base,
        settings: { to: { type: 'string', required: true } },
      }).settings.to?.advanced,
    ).toBeUndefined();
    expect(
      parsePluginManifest({
        ...base,
        settings: { spam: { type: 'string', advanced: true } },
      }).settings.spam?.advanced,
    ).toBe(true);
  });

  it('is refused on a required field, which it would hide', () => {
    expect(() =>
      parsePluginManifest({
        id: 'sample',
        name: 'Sample',
        version: '1.0.0',
        settings: { to: { type: 'string', required: true, advanced: true } },
      }),
    ).toThrow(/required field cannot be/);
    expect(() =>
      parseThemeManifest({
        ...THEME,
        kinds: {
          page: {
            layout: 'layouts/page.liquid',
            fields: {
              grade: { type: 'string', required: true, advanced: true },
            },
          },
        },
      }),
    ).toThrow(/required field cannot be/);
  });
});
