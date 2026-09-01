import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

/**
 * The admin single-page app.
 *
 * It builds into `dist/assets/_mallok/app/`, which Workers Static Assets
 * serves directly — the bundle never enters the Worker script, so the admin's
 * size cannot eat into the rendering pipeline's 3 MB budget
 * (docs/TECH_STACK.md §6).
 */
export default defineConfig({
  root: 'src/admin',
  base: '/_mallok/app/',
  plugins: [preact()],
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
