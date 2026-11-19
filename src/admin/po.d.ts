/**
 * A `.po` catalog, as Lingui's Vite plugin compiles it on import
 * (`src/admin/i18n.ts`).
 */
declare module '*.po' {
  import type { Messages } from '@lingui/core';

  /** The compiled messages, keyed by message id. */
  export const messages: Messages;
}
