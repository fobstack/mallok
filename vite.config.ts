import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

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
export default defineConfig({
  root: 'src/admin',
  base: '/_mallok/app/',
  plugins: [
    react({
      babel: { plugins: ['module:@preact/signals-react-transform'] },
    }),
    tailwindcss(),
  ],
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
