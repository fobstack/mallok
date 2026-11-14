/**
 * The admin's sentence for each code the Worker names an error with
 * (docs/ADMIN_I18N_AND_UI.md, D3).
 *
 * Each sentence's id is `server.<code>`, so the admin finds it by the code
 * alone and nothing here is bundled: this file exists to be extracted into
 * the catalogs, and for the tests. `server-messages.ts` looks a code up in
 * whichever catalog is loaded. Each `message` is the Worker's English
 * exactly, so the English interface reads as it always did.
 *
 * Adding a code: add it here, run `pnpm i18n:extract`, translate it.
 */

import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';

/** Every code the admin can say, with its sentence. */
export const SERVER_MESSAGES: Readonly<Record<string, MessageDescriptor>> = {
  not_found: msg({
    id: 'server.not_found',
    message: 'Not found.',
  }),
  method_not_allowed: msg({
    id: 'server.method_not_allowed',
    message: 'Method not allowed.',
  }),

  'auth.unauthorized': msg({
    id: 'server.auth.unauthorized',
    message: 'Unauthorized.',
  }),
  'auth.csrf_invalid': msg({
    id: 'server.auth.csrf_invalid',
    message: 'Missing or invalid CSRF token.',
  }),
  'auth.token_scope': msg({
    id: 'server.auth.token_scope',
    message: 'This token lacks the "{scope}" scope.',
  }),
  'auth.invalid_credentials': msg({
    id: 'server.auth.invalid_credentials',
    message: 'Invalid email or password.',
  }),
  'auth.session_required': msg({
    id: 'server.auth.session_required',
    message: 'Account changes require a browser session.',
  }),
  'auth.session_required_password': msg({
    id: 'server.auth.session_required_password',
    message: 'Password changes require a browser session.',
  }),

  'account.ui_locale_invalid': msg({
    id: 'server.account.ui_locale_invalid',
    message:
      'Give the interface language as a language tag such as "zh-CN", or null.',
  }),
  'account.password_short': msg({
    id: 'server.account.password_short',
    message: 'The new password must be at least {min} characters.',
  }),
  'account.current_password_wrong': msg({
    id: 'server.account.current_password_wrong',
    message: 'The current password is not correct.',
  }),

  'tokens.incomplete': msg({
    id: 'server.tokens.incomplete',
    message: 'Provide a name and at least one scope.',
  }),
  'tokens.scope_unknown': msg({
    id: 'server.tokens.scope_unknown',
    message: 'Unknown scope: {scopes}.',
  }),

  'setup.sign_in_required': msg({
    id: 'server.setup.sign_in_required',
    message: 'Sign in as the administrator to continue.',
  }),
  'setup.site_incomplete': msg({
    id: 'server.setup.site_incomplete',
    message: 'Provide a site name, a default language and a language list.',
  }),
  'setup.default_locale_unlisted': msg({
    id: 'server.setup.default_locale_unlisted',
    message: 'The language list must include the default language.',
  }),
  'setup.starter_missing': msg({
    id: 'server.setup.starter_missing',
    message: 'Name a starter to install.',
  }),
  'setup.starter_unknown': msg({
    id: 'server.setup.starter_unknown',
    message: 'No starter named "{starter}".',
  }),
  'setup.not_initialized': msg({
    id: 'server.setup.not_initialized',
    message: 'Site is not initialized.',
  }),
  'setup.starter_prefix_clash': msg({
    id: 'server.setup.starter_prefix_clash',
    message:
      'The starter prefixes the default locale, but "{from}" would move to "{to}", which another item already uses.',
  }),
  'setup.key_unconfigured': msg({
    id: 'server.setup.key_unconfigured',
    message:
      'This site has no setup key, so it will not create an administrator. Run `mallok create .` in the project directory to finish provisioning it, or `mallok setup-key` to issue one.',
  }),
  'setup.key_used': msg({
    id: 'server.setup.key_used',
    message:
      'The setup key has already been used. Deploy a new key with `wrangler secret put MALLOK_SETUP_KEY` if you need to run setup again.',
  }),
  'setup.key_wrong': msg({
    id: 'server.setup.key_wrong',
    message:
      'That setup key is not correct. It was printed once, by `mallok create`.',
  }),
  'setup.admin_exists': msg({
    id: 'server.setup.admin_exists',
    message: 'An administrator already exists.',
  }),
  'setup.credentials_incomplete': msg({
    id: 'server.setup.credentials_incomplete',
    message: 'Provide an email and a password of at least {min} characters.',
  }),
};
