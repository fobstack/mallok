import { defineConfig } from '@lingui/cli';
import { formatter } from '@lingui/format-po';

/**
 * The admin's interface languages (docs/ADMIN_I18N_AND_UI.md §5.1).
 *
 * English is the source: the sentence in the code is the message, and
 * `src/admin/locales/en.po` is what `lingui extract` derives from it. Every
 * other language is a translation of that catalog. Adding one is a new entry
 * here and in `src/admin/i18n.ts`.
 */
export default defineConfig({
  sourceLocale: 'en',
  locales: ['en', 'zh-CN'],
  // A message with no translation shows the English, never its id.
  fallbackLocales: { default: 'en' },
  // Origins name the file but not the line, so moving code does not rewrite
  // every catalog.
  format: formatter({ lineNumbers: false }),
  catalogs: [
    {
      path: '<rootDir>/src/admin/locales/{locale}',
      include: ['<rootDir>/src/admin'],
      exclude: ['**/node_modules/**', '<rootDir>/src/admin/locales/**'],
    },
  ],
});
