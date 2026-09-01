/**
 * PBKDF2-SHA256 CPU cost per iteration count, using WebCrypto in Node as a
 * proxy for workerd. Run with `pnpm bench:pbkdf2`.
 */
import { medianCpuMs } from './synthetic.mjs';

const ITERATIONS = [50_000, 100_000, 200_000, 400_000, 600_000, 1_000_000];
const ROUNDS = 5;
const encoder = new TextEncoder();

const material = await crypto.subtle.importKey(
  'raw',
  encoder.encode('correct horse battery staple'),
  'PBKDF2',
  false,
  ['deriveBits'],
);

console.log('iterations | median CPU ms (Node)');
console.log('-----------|---------------------');
for (const iterations of ITERATIONS) {
  const ms = await medianCpuMs(
    () =>
      crypto.subtle.deriveBits(
        {
          name: 'PBKDF2',
          hash: 'SHA-256',
          salt: encoder.encode('mallok-bench-salt'),
          iterations,
        },
        material,
        256,
      ),
    ROUNDS,
  );
  console.log(`${String(iterations).padStart(10)} | ${ms.toFixed(2)}`);
}
