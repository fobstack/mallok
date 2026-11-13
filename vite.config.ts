import { fileURLToPath } from 'node:url';
import { lingui } from '@lingui/vite-plugin';
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
 */

/**
 * Fails the build when a Lingui macro survives to module resolution.
 *
 * The transform replaces every `@lingui/…/macro` import. If it ever stops
 * running — a reordered plugin list, a changed option — the browser build of
 * `@lingui/react/macro` is a set of empty functions, so `<Trans>` would
 * render nothing and the build would pass. This turns that silent blank
 * into a build error (docs/ADMIN_I18N_AND_UI.md §8).
 */
function refuseUntransformedMacros(): Plugin {
  return {
    name: 'mallok:refuse-untransformed-lingui-macros',
    enforce: 'pre',
    resolveId(source, importer) {
      if (/^@lingui\/[^/]+\/macro$/.test(source)) {
        throw new Error(
          `${importer ?? 'A module'} imports ${source}, but Lingui's macro ` +
            'transform did not replace it. Check the lingui() plugin in ' +
            'vite.config.ts.',
        );
      }
      return null;
    },
  };
}

export default defineConfig(({ command }) => {
  if (command === 'build') {
    // Vite computes `isProduction` after loading this file and explicitly
    // supports setting NODE_ENV here. A build is the artifact we ship, so it
    // must not inherit `test` from the Vitest process that requested it.
    process.env.NODE_ENV = 'production';
  }

  return {
    root: 'src/admin',
    base: '/_mallok/app/',
    // Lingui's macros (`<Trans>`, `t`) compile to catalog lookups here, and
    // `.po` catalogs compile on import. Its own transform, not Babel: the
    // admin dropped a Babel step once because it could fail silently
    // (docs/ADMIN_I18N_AND_UI.md §2.2).
    plugins: [
      react(),
      lingui({
        macroTransform: true,
        configPath: fileURLToPath(
          new URL('./lingui.config.ts', import.meta.url),
        ),
      }),
      tailwindcss(),
      refuseUntransformedMacros(),
    ],
    resolve: {
      alias: {
        // shadcn/ui's own import convention (`@/components/ui/button`).
        '@': fileURLToPath(new URL('./src/admin', import.meta.url)),
      },
    },
    // Vite derives JSX development mode from NODE_ENV, even for `vite build`.
    // Keep the production setting explicit at the transform boundary as
    // well: jsxDEV's fileName is the absolute module id and is therefore not
    // reproducible across checkouts.
    ...(command === 'build'
      ? {
          oxc: {
            jsx: { development: false },
          },
        }
      : {}),
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
  };
});
