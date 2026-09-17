import { fileURLToPath } from 'node:url';
import { transformAsync } from '@babel/core';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * The admin single-page app.
 *
 * It builds into `dist/assets/_mallok/app/`, which Workers Static Assets
 * serves directly — the bundle never enters the Worker script, so the admin's
 * size cannot eat into the rendering pipeline's 3 MB budget
 * (docs/TECH_STACK.md §6).
 *
 * State stays on `@preact/signals-react` (module-level `signal()`/`computed()`
 * values read as `.value`) rather than Context or a store library — the admin
 * has a handful of globals and everything else is page-local, so a store
 * would be more machinery than the app has state. The Babel transform below
 * is what makes a bare `.value` read inside JSX subscribe automatically,
 * matching how the Preact build already used signals.
 */

/**
 * Applies `@preact/signals-react-transform`.
 *
 * It used to be passed to `@vitejs/plugin-react` as `babel.plugins`. That
 * plugin is **oxc-only** since v6 and ignores the option without a warning,
 * so the transform silently stopped running: every component still compiled,
 * and none of them subscribed to a signal any more. The admin shipped stuck
 * on "Loading…" — the sign-in screen never replaced it, because the signal
 * that says "the session is known" no longer re-rendered anything. Found by
 * the end-to-end run, invisible to every unit test.
 *
 * The build now **fails** if no component came out subscribed, so this cannot
 * come undone quietly a second time. Checking the bundle instead would not
 * work: minification renames the import.
 */
function signalsTransform(): Plugin {
  let subscribed = 0;
  return {
    name: 'mallok:signals-transform',
    enforce: 'pre',
    async transform(code, id) {
      if (!/\.tsx$/.test(id) || id.includes('node_modules')) {
        return null;
      }
      const result = await transformAsync(code, {
        filename: id,
        babelrc: false,
        configFile: false,
        sourceMaps: true,
        parserOpts: { plugins: ['typescript', 'jsx'] },
        plugins: ['module:@preact/signals-react-transform'],
      });
      if (result?.code === undefined || result.code === null) {
        return null;
      }
      if (result.code.includes('useSignals')) {
        subscribed++;
      }
      return { code: result.code, map: result.map };
    },
    buildEnd() {
      if (subscribed === 0) {
        this.error(
          'The signals transform produced no subscriptions. Every component ' +
            'would render once and never update again — that is the bug that ' +
            'shipped an admin stuck on "Loading…". Check that ' +
            '@preact/signals-react-transform still applies.',
        );
      }
    },
  };
}
export default defineConfig({
  root: 'src/admin',
  base: '/_mallok/app/',
  plugins: [signalsTransform(), react(), tailwindcss()],
  resolve: {
    alias: {
      // shadcn/ui's own import convention (`@/components/ui/button`).
      '@': fileURLToPath(new URL('./src/admin', import.meta.url)),
    },
  },
  build: {
    outDir: '../../dist/assets/_mallok/app',
    emptyOutDir: true,
    target: 'es2022',
    // Hashed asset names, so Static Assets can serve them immutably.
    assetsDir: 'assets',
    // A package build asks Vite for the exact dependency graph of the admin
    // chunks. `scripts/build-package.mjs` merges that machine-readable file
    // into the package's single THIRD_PARTY_NOTICES and removes it before the
    // admin assets are copied. Normal site/admin builds do not emit it, so an
    // internal licence inventory can never become a public Static Asset.
    license:
      process.env.MALLOK_ADMIN_LICENSES === '1'
        ? { fileName: '.mallok-admin-licenses.json' }
        : false,
    rollupOptions: {
      output: {
        // CodeMirror is loaded only when the editor opens
        // (docs/ADMIN.md §13); Rollup keeps it in its own chunk because the
        // import is dynamic.
        chunkFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
});
