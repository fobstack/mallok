/**
 * The Worker's errors, in the interface language (docs/ADMIN_I18N_AND_UI.md,
 * D3).
 *
 * The Worker answers an error with English `error` and, where it has one, a
 * `code` naming the sentence and `params` filling in what varies. The
 * sentences live in the catalogs under `server.<code>`
 * (`server-messages.catalog.ts`), so this looks the code up in whichever
 * catalog is loaded and carries no table of its own onto the first load. A
 * code the catalog lacks — a new one, or a plugin's — is shown as the
 * Worker's English: English is the worst case, never a blank or a key.
 */

import { i18n } from '@lingui/core';

/** The shape of a code: `auth.invalid_credentials`. */
const CODE = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/;

/**
 * The admin's sentence for a Worker error, or `undefined` when it has none
 * for `code` and the Worker's English should be shown.
 */
export function serverMessage(
  code: unknown,
  params: unknown,
): string | undefined {
  if (typeof code !== 'string' || !CODE.test(code)) {
    return undefined;
  }
  const id = `server.${code}`;
  if (!Object.hasOwn(i18n.messages, id)) {
    return undefined;
  }
  const values =
    params !== null && typeof params === 'object' && !Array.isArray(params)
      ? (params as Record<string, unknown>)
      : {};
  return i18n._(id, values);
}
