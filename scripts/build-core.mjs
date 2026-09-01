/**
 * Bundles `src/core` into a single ESM file for the Node benchmarks and for
 * measuring the size of the rendering pipeline on its own.
 */
import { mkdir } from 'node:fs/promises';
import { build } from 'esbuild';

await mkdir('dist/core', { recursive: true });
const result = await build({
  entryPoints: ['src/core/index.ts'],
  bundle: true,
  format: 'esm',
  // `browser` makes esbuild honor liquidjs' browser field mapping, exactly
  // as Wrangler does when bundling the Worker.
  platform: 'browser',
  conditions: ['workerd', 'worker', 'browser'],
  target: 'es2022',
  outfile: 'dist/core/index.mjs',
  metafile: true,
  logLevel: 'warning',
});

const bytes = Object.values(result.metafile.outputs).reduce(
  (sum, output) => sum + output.bytes,
  0,
);
console.log(`core bundle: ${(bytes / 1024).toFixed(1)} KiB (unminified)`);
