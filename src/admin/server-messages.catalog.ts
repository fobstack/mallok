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

  'content.status_filter_unknown': msg({
    id: 'server.content.status_filter_unknown',
    message: 'Unknown status filter.',
  }),
  'content.kind_disabled': msg({
    id: 'server.content.kind_disabled',
    message: 'Kind "{kind}" is not enabled on this site.',
  }),
  'content.locale_disabled': msg({
    id: 'server.content.locale_disabled',
    message: 'Locale "{locale}" is not enabled on this site.',
  }),
  'content.frontmatter_invalid': msg({
    id: 'server.content.frontmatter_invalid',
    message: '{reason}',
  }),
  'content.title_missing': msg({
    id: 'server.content.title_missing',
    message: 'Front matter must include a non-empty "title".',
  }),
  'content.slug_underivable': msg({
    id: 'server.content.slug_underivable',
    message: 'Could not derive a slug; provide one explicitly.',
  }),
  'content.asset_path_invalid': msg({
    id: 'server.content.asset_path_invalid',
    message: 'Invalid asset path "{path}".',
  }),
  'content.asset_path_conflict': msg({
    id: 'server.content.asset_path_conflict',
    message:
      'Asset path "{path}" conflicts with another path on a case-insensitive filesystem.',
  }),
  'content.exists_create_only': msg({
    id: 'server.content.exists_create_only',
    message:
      '"{slug}" already exists in {locale}. Remove --create-only to update it.',
  }),
  'content.translation_exists': msg({
    id: 'server.content.translation_exists',
    message:
      'This translation group already has an item in {locale}: the {kind} "{slug}" at {path} (id {id}). Edit that item instead.',
  }),
  'content.plugin_too_large': msg({
    id: 'server.content.plugin_too_large',
    message:
      'A plugin made this item larger than can be stored. Nothing was saved.',
  }),
  'content.plugin_rewrite_invalid': msg({
    id: 'server.content.plugin_rewrite_invalid',
    message:
      'A plugin rewrote this item into something that cannot be saved: {reason}',
  }),
  'content.path_taken': msg({
    id: 'server.content.path_taken',
    message:
      '{path} is already the address of the {kind} "{slug}" ({locale}). Choose another slug.',
  }),

  'slug.too_long': msg({
    id: 'server.slug.too_long',
    message: 'The slug is longer than {max} characters.',
  }),
  'slug.too_many_segments': msg({
    id: 'server.slug.too_many_segments',
    message: 'The slug has {count} segments; at most {max} are allowed.',
  }),
  'slug.too_many_segments_use': msg({
    id: 'server.slug.too_many_segments_use',
    message:
      'The slug has {count} segments; at most {max} are allowed. Use "{use}".',
  }),
  'slug.empty': msg({ id: 'server.slug.empty', message: 'The slug is empty.' }),
  'slug.empty_use': msg({
    id: 'server.slug.empty_use',
    message: 'The slug is empty. Use "{use}".',
  }),
  'slug.empty_segment': msg({
    id: 'server.slug.empty_segment',
    message:
      'The slug has an empty segment: it starts or ends with "/", or has "//".',
  }),
  'slug.empty_segment_use': msg({
    id: 'server.slug.empty_segment_use',
    message:
      'The slug has an empty segment: it starts or ends with "/", or has "//". Use "{use}".',
  }),
  'slug.no_latin': msg({
    id: 'server.slug.no_latin',
    message:
      'The slug "{slug}" has no Latin letters or digits to build a folder name from. Provide one written in Latin characters.',
  }),
  'slug.not_canonical_use': msg({
    id: 'server.slug.not_canonical_use',
    message:
      'The slug must use lowercase Latin letters, digits and single dashes. Use "{use}".',
  }),
  'slug.segment_no_latin': msg({
    id: 'server.slug.segment_no_latin',
    message:
      'Segment {position} ("{segment}") has no Latin letters or digits to build a folder name from. Write it in Latin characters.',
  }),
  'slug.segment_no_latin_use': msg({
    id: 'server.slug.segment_no_latin_use',
    message:
      'Segment {position} ("{segment}") has no Latin letters or digits to build a folder name from. Write it in Latin characters. Use "{use}".',
  }),
  'slug.segment_not_canonical': msg({
    id: 'server.slug.segment_not_canonical',
    message:
      'Segment {position} ("{segment}") must use lowercase Latin letters, digits and single dashes.',
  }),
  'slug.segment_not_canonical_use': msg({
    id: 'server.slug.segment_not_canonical_use',
    message:
      'Segment {position} ("{segment}") must use lowercase Latin letters, digits and single dashes. Use "{use}".',
  }),
  'slug.list_page': msg({
    id: 'server.slug.list_page',
    message:
      'A slug cannot start with "page/{page}": that is the address of a list\'s page {page}.',
  }),
  'slug.reserved_start': msg({
    id: 'server.slug.reserved_start',
    message:
      'A slug with several segments cannot start with "{first}/": the site answers that address itself.',
  }),
  'slug.kind_start': msg({
    id: 'server.slug.kind_start',
    message:
      'A slug with several segments cannot start with "{first}/": that is the address of the kind "{kind}".',
  }),
  'slug.locale_start': msg({
    id: 'server.slug.locale_start',
    message:
      'A slug with several segments cannot start with "{first}/": that is the prefix of the language "{first}".',
  }),
  'media.hashes_missing': msg({
    id: 'server.media.hashes_missing',
    message: 'Provide a list of sha256 hashes.',
  }),
  'media.id_invalid': msg({
    id: 'server.media.id_invalid',
    message: 'The media id must be a sha256 hex digest.',
  }),
  'media.too_large': msg({
    id: 'server.media.too_large',
    message: 'Media objects are limited to {max} bytes.',
  }),
  'media.body_empty': msg({
    id: 'server.media.body_empty',
    message: 'The request body is empty.',
  }),
  'media.hash_mismatch': msg({
    id: 'server.media.hash_mismatch',
    message: 'The body does not match the sha256 in the path.',
  }),
  'media.type_unsupported': msg({
    id: 'server.media.type_unsupported',
    message:
      'Unsupported file type. Accepted: jpg, png, gif, webp, avif, pdf, xlsx, docx, zip.',
  }),
  'media.variant_width': msg({
    id: 'server.media.variant_width',
    message: 'Variant width must be 1..{max}.',
  }),
  'media.original_missing': msg({
    id: 'server.media.original_missing',
    message: 'Upload the original before its variants.',
  }),
  'media.variant_not_image': msg({
    id: 'server.media.variant_not_image',
    message: 'Only images have variants.',
  }),
  'media.variant_not_webp': msg({
    id: 'server.media.variant_not_webp',
    message: 'Variants must be WebP.',
  }),
  'media.kind_filter_unknown': msg({
    id: 'server.media.kind_filter_unknown',
    message: 'Unknown kind filter.',
  }),
  'media.alt_invalid': msg({
    id: 'server.media.alt_invalid',
    message: 'Provide an "alt" string or null.',
  }),
  'media.in_use_count': msg({
    id: 'server.media.in_use_count',
    message:
      'This file is used by {count} item(s). Remove those references first.',
  }),
  'media.in_use': msg({
    id: 'server.media.in_use',
    message: 'This file is in use.',
  }),
  'settings.default_locale_endpoint': msg({
    id: 'server.settings.default_locale_endpoint',
    message:
      'Changing the default locale rewrites every URL. Use POST /_mallok/api/settings/default-locale.',
  }),
  'settings.locale_prefix_endpoint': msg({
    id: 'server.settings.locale_prefix_endpoint',
    message:
      'Prefixing the default locale rewrites every URL. Use POST /_mallok/api/settings/locale-prefix.',
  }),
  'settings.base_reserved': msg({
    id: 'server.settings.base_reserved',
    message:
      '"{base}" is reserved for stored files and cannot be a content base path.',
  }),
  'settings.default_locale_unlisted': msg({
    id: 'server.settings.default_locale_unlisted',
    message: 'The enabled locales must include the default locale "{locale}".',
  }),
  'settings.default_locale_confirm': msg({
    id: 'server.settings.default_locale_confirm',
    message:
      'Provide the target locale and "confirm": true; this rewrites every URL.',
  }),
  'settings.locale_prefix_confirm': msg({
    id: 'server.settings.locale_prefix_confirm',
    message:
      'Provide "enabled": true or false, and "confirm": true; this rewrites every URL.',
  }),
  'settings.path_clash': msg({
    id: 'server.settings.path_clash',
    message:
      '"{from}" would move to "{to}", which another item already uses. Change one of their slugs first. Nothing was changed.',
  }),
  'settings.invalid': msg({
    id: 'server.settings.invalid',
    message: 'Invalid settings.',
  }),
  'settings.slugs_stranded': msg({
    id: 'server.settings.slugs_stranded',
    message:
      '{count, plural, one {# slug would start at an address the new settings give to a language or a kind. Change it first.} other {# slugs would start at an address the new settings give to a language or a kind. Change them first.}}',
  }),
  'email.body_invalid': msg({
    id: 'server.email.body_invalid',
    message:
      'Body must be {"fromAddress"?: string | null, "resendApiKey"?: string | null}.',
  }),
  'email.sender_invalid': msg({
    id: 'server.email.sender_invalid',
    message:
      'The sender must be an address such as "hello@example.com" or "Acme <hello@example.com>".',
  }),
  'export.unsafe': msg({
    id: 'server.export.unsafe',
    message: 'The stored content cannot be exported safely: {reason}.',
  }),
  'auth.operation_scope': msg({
    id: 'server.auth.operation_scope',
    message: 'This operation needs the "{scope}" scope.',
  }),
  'plugins.unknown': msg({
    id: 'server.plugins.unknown',
    message: 'No such plugin is compiled into this build.',
  }),
  'plugins.enabled_body_invalid': msg({
    id: 'server.plugins.enabled_body_invalid',
    message: 'Body must be {"enabled": true | false}.',
  }),
  'plugins.state_missing': msg({
    id: 'server.plugins.state_missing',
    message: 'Plugin state row is missing.',
  }),
  'plugins.settings_body_invalid': msg({
    id: 'server.plugins.settings_body_invalid',
    message: 'Body must be a JSON object of settings.',
  }),
  'plugins.settings_invalid': msg({
    id: 'server.plugins.settings_invalid',
    message: 'Invalid settings: {reason}.',
  }),
  'plugins.settings_invalid_at': msg({
    id: 'server.plugins.settings_invalid_at',
    message: 'Invalid settings at "{field}": {reason}.',
  }),
  'plugins.secrets_body_invalid': msg({
    id: 'server.plugins.secrets_body_invalid',
    message: 'Body must be a JSON object of secret values.',
  }),
  'plugins.secret_unknown': msg({
    id: 'server.plugins.secret_unknown',
    message: 'Unknown secret "{name}".',
  }),
  'plugins.secret_not_string': msg({
    id: 'server.plugins.secret_not_string',
    message: 'Secret "{name}" must be a string or null.',
  }),
  'plugins.secret_uncheckable': msg({
    id: 'server.plugins.secret_uncheckable',
    message: '"{name}" cannot be checked automatically.',
  }),
  'plugins.panel_unknown': msg({
    id: 'server.plugins.panel_unknown',
    message: 'No such panel.',
  }),
  'plugins.records_panel_unknown': msg({
    id: 'server.plugins.records_panel_unknown',
    message: 'No such records panel.',
  }),
  'plugins.record_unknown': msg({
    id: 'server.plugins.record_unknown',
    message: 'No such record.',
  }),
  'plugins.record_not_removable': msg({
    id: 'server.plugins.record_not_removable',
    message: 'Records of this panel cannot be deleted here.',
  }),
  'plugins.action_unknown': msg({
    id: 'server.plugins.action_unknown',
    message: 'No such panel action.',
  }),
  'plugins.action_ids_missing': msg({
    id: 'server.plugins.action_ids_missing',
    message: 'Body must carry the row ids to act on.',
  }),
  'plugins.related_unknown': msg({
    id: 'server.plugins.related_unknown',
    message: 'No such related table.',
  }),
  'plugins.related_parent_missing': msg({
    id: 'server.plugins.related_parent_missing',
    message: 'Name the row with ?parent=<id>.',
  }),
  'plugins.record_body_invalid': msg({
    id: 'server.plugins.record_body_invalid',
    message: 'Body must be {"values": { … }}.',
  }),
  'plugins.attached_to_missing': msg({
    id: 'server.plugins.attached_to_missing',
    message:
      'This panel belongs to a content item: send its translation group as "attachedTo".',
  }),
  'plugins.attached_owner_missing': msg({
    id: 'server.plugins.attached_owner_missing',
    message: 'No {kind} with that translation group exists.',
  }),
  'plugins.fields_invalid': msg({
    id: 'server.plugins.fields_invalid',
    message: 'Some fields need attention.',
  }),
  'field.required': msg({
    id: 'server.field.required',
    message: 'This field is required.',
  }),
  'field.number': msg({
    id: 'server.field.number',
    message: 'Enter a number.',
  }),
  'field.min': msg({
    id: 'server.field.min',
    message: 'Must be at least {min}.',
  }),
  'field.max': msg({
    id: 'server.field.max',
    message: 'Must be at most {max}.',
  }),
  'field.boolean': msg({
    id: 'server.field.boolean',
    message: 'Must be yes or no.',
  }),
  'field.choice': msg({
    id: 'server.field.choice',
    message: 'Choose one of the listed values.',
  }),
  'field.date': msg({
    id: 'server.field.date',
    message: 'Enter a date as YYYY-MM-DD.',
  }),
  'field.color': msg({
    id: 'server.field.color',
    message: 'Enter a colour as #rrggbb.',
  }),
  'field.text_list': msg({
    id: 'server.field.text_list',
    message: 'Must be a list of text values.',
  }),
  'field.max_entries': msg({
    id: 'server.field.max_entries',
    message: 'At most {max} entries.',
  }),
  'field.pairs': msg({
    id: 'server.field.pairs',
    message: 'Must be a set of name and value pairs.',
  }),
  'field.amount': msg({
    id: 'server.field.amount',
    message: 'Enter an amount.',
  }),
  'field.currency': msg({
    id: 'server.field.currency',
    message: 'Choose one of the listed currencies.',
  }),
  'field.amount_low': msg({
    id: 'server.field.amount_low',
    message: 'The amount is too low.',
  }),
  'field.amount_high': msg({
    id: 'server.field.amount_high',
    message: 'The amount is too high.',
  }),
  'field.text': msg({
    id: 'server.field.text',
    message: 'Must be text.',
  }),
  'field.max_length': msg({
    id: 'server.field.max_length',
    message: 'Must be at most {max} characters.',
  }),
  'field.rows_required': msg({
    id: 'server.field.rows_required',
    message: 'Add at least one row.',
  }),
  'field.rows_list': msg({
    id: 'server.field.rows_list',
    message: 'Must be a list of rows.',
  }),
  'field.max_rows': msg({
    id: 'server.field.max_rows',
    message: 'At most {max} rows.',
  }),
};
