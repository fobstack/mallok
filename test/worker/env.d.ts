/**
 * Tells the Workers Vitest integration what `env` from `cloudflare:test`
 * looks like: the same bindings the Worker receives.
 */
import type { Env as WorkerEnv } from '../../src/worker/env.js';

declare global {
  // biome-ignore lint/style/noNamespace: the integration keys `env` off this global namespace.
  namespace Cloudflare {
    interface Env extends WorkerEnv {}
  }
}
