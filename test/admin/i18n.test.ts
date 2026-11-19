import { describe, expect, it } from 'vitest';
import { matchInterfaceLanguage } from '../../src/admin/i18n.js';

/**
 * With nothing stored, the admin speaks the first of the browser's languages
 * it has a catalog for (docs/ADMIN_I18N_AND_UI.md, D2). A Chinese-speaking
 * operator must not be shown English because their browser says `zh` or
 * `zh-Hans-CN` rather than exactly `zh-CN`.
 */
describe('interface language from the browser', () => {
  it.each([
    [['zh-CN'], 'zh-CN'],
    [['zh'], 'zh-CN'],
    [['zh-Hans-CN', 'en'], 'zh-CN'],
    [['ZH-cn'], 'zh-CN'],
    [['en-US', 'zh-CN'], 'en'],
    [['de-DE', 'zh-CN'], 'zh-CN'],
  ])('%j gives %s', (wanted, expected) => {
    expect(matchInterfaceLanguage(wanted)).toBe(expected);
  });

  it('gives nothing for languages without a catalog', () => {
    expect(matchInterfaceLanguage(['de-DE', 'fr'])).toBeUndefined();
    expect(matchInterfaceLanguage([])).toBeUndefined();
  });
});
