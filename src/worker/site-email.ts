/**
 * Site-level email settings (docs/PLUGIN_API.md §7.6).
 *
 * One Resend key and one sender address belong to the site and serve every
 * plugin that calls `ctx.sendEmail`. The key is stored encrypted exactly like
 * a plugin secret (docs/SECURITY.md §2.2) and is write-only: no endpoint
 * returns it, and the only place it travels to is Resend.
 */

import { z } from 'zod';
import type { DataMigration } from '../db/migrate.js';
import { loadSite, type SiteRow, updateSite } from '../db/queries.js';
import type { PluginSecretVerdict } from '../plugins/types.js';
import type { Env } from './env.js';
import { json, problem, readJson } from './http.js';
import { decryptSecret, encryptSecret } from './secrets.js';

/**
 * The owner under which the site's own secrets are encrypted. A plugin id
 * must start with a letter, so this can never collide with one and a plugin
 * can never derive the site's key.
 */
const SITE_SECRET_OWNER = '@site';
const RESEND_SECRET = 'resend_api_key';
const RESEND_DOMAINS_URL = 'https://api.resend.com/domains';

/** The plugin whose key and sender an older site carries. */
const INQUIRY_PLUGIN_ID = 'inquiry';

/** A bare address, or a display name followed by one in angle brackets. */
const SENDER_PATTERN = /^(?:[^\s@<>]+@[^\s@<>]+|[^<>]*<[^\s@<>]+@[^\s@<>]+>)$/;

const emailSchema = z
  .object({
    fromAddress: z.string().trim().max(320).nullable(),
    resendApiKey: z.string().trim().max(512).nullable(),
  })
  .partial()
  .strict();

/** What the admin may know about the site's email setup. */
export interface SiteEmailView {
  readonly fromAddress: string;
  /** Whether a key is stored; the key itself is never reported. */
  readonly resendConfigured: boolean;
}

/** The reportable half of the site's email settings. */
export function siteEmailView(row: SiteRow): SiteEmailView {
  return {
    fromAddress: row.email_from ?? '',
    resendConfigured: row.email_resend_key !== null,
  };
}

/** Decrypts the site's Resend key, or `null` when none is usable. */
export async function siteResendKey(
  env: Env,
  row: SiteRow,
): Promise<string | null> {
  if (row.email_resend_key === null) {
    return null;
  }
  return decryptSecret(
    env.MALLOK_SECRET,
    SITE_SECRET_OWNER,
    RESEND_SECRET,
    row.email_resend_key,
  );
}

/**
 * Stores the sender address, the key, or both. A field that is absent is left
 * as it is; `null` or an empty string clears it.
 */
export async function putSiteEmail(
  request: Request,
  env: Env,
): Promise<Response> {
  const parsed = emailSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return problem(
      400,
      'Body must be {"fromAddress"?: string | null, "resendApiKey"?: string | null}.',
    );
  }
  const { fromAddress, resendApiKey } = parsed.data;
  if (
    typeof fromAddress === 'string' &&
    fromAddress !== '' &&
    !SENDER_PATTERN.test(fromAddress)
  ) {
    return problem(
      400,
      'The sender must be an address such as "hello@example.com" or "Acme <hello@example.com>".',
    );
  }
  const existing = await loadSite(env.DB);
  if (existing === null) {
    return problem(503, 'Site is not initialized.');
  }
  await updateSite(
    env.DB,
    {
      ...(fromAddress === undefined
        ? {}
        : { email_from: fromAddress === '' ? null : fromAddress }),
      ...(resendApiKey === undefined
        ? {}
        : {
            email_resend_key:
              resendApiKey === null || resendApiKey === ''
                ? null
                : await encryptSecret(
                    env.MALLOK_SECRET,
                    SITE_SECRET_OWNER,
                    RESEND_SECRET,
                    resendApiKey,
                  ),
          }),
    },
    new Date().toISOString(),
  );
  const row = await loadSite(env.DB);
  return json(siteEmailView(row ?? existing));
}

/** Asks Resend whether the stored key works; only the verdict comes back. */
export async function checkSiteEmail(env: Env): Promise<Response> {
  const row = await loadSite(env.DB);
  if (row === null) {
    return problem(503, 'Site is not initialized.');
  }
  if (row.email_resend_key === null) {
    return json({ ok: false, message: 'No key is stored.' });
  }
  const key = await siteResendKey(env, row);
  if (key === null) {
    return json({
      ok: false,
      message:
        'The stored key cannot be read. Enter it again; this happens when MALLOK_SECRET has changed.',
    });
  }
  return json(await checkResendKey(key));
}

/**
 * Tells a working Resend key from a broken one without sending anything:
 * the domains endpoint is a read.
 */
export async function checkResendKey(
  key: string,
): Promise<PluginSecretVerdict> {
  try {
    const response = await fetch(RESEND_DOMAINS_URL, {
      headers: { authorization: `Bearer ${key}` },
    });
    if (response.status === 401 || response.status === 403) {
      return { ok: false, message: 'Resend rejected this key.' };
    }
    if (!response.ok) {
      return { ok: false, message: `Resend replied ${response.status}.` };
    }
    const body = (await response.json()) as {
      data?: { name: string; status: string }[];
    };
    const verified = (body.data ?? []).filter(
      (domain) => domain.status === 'verified',
    );
    if (verified.length === 0) {
      return {
        ok: false,
        message:
          'The key works, but no sending domain is verified yet. Verify one in Resend before email can be delivered.',
      };
    }
    return {
      ok: true,
      message: `Key works. Verified sending domains: ${verified
        .map((domain) => domain.name)
        .join(', ')}.`,
    };
  } catch {
    return { ok: false, message: 'Could not reach Resend.' };
  }
}

/**
 * Moves the key and sender an older site keeps in the inquiry plugin to the
 * site settings, once.
 *
 * Before site-level email existed the inquiry plugin was the only place to
 * enter them. Without this move an upgraded site would keep delivering (a
 * plugin's own key still wins) while its admin showed an empty Email page and
 * a second sending plugin had nothing to send with.
 *
 * Nothing already set on the site is overwritten, and a key that cannot be
 * decrypted is left where it is — it may become readable again once
 * `MALLOK_SECRET` is put right, and losing it would stop delivery.
 */
export function moveInquiryEmail(env: Env): DataMigration {
  return {
    id: '0005_move_inquiry_email',
    statements: async (db) => {
      const [site, state] = await Promise.all([
        loadSite(db),
        db
          .prepare(
            'SELECT settings, secrets FROM plugin_state WHERE plugin_id = ?',
          )
          .bind(INQUIRY_PLUGIN_ID)
          .first<{ settings: string; secrets: string }>(),
      ]);
      // A new site has neither row yet, and nothing to move.
      if (site === null || state === null) {
        return [];
      }
      const settings = parseObject(state.settings);
      const secrets = parseObject(state.secrets);
      let emailFrom = site.email_from;
      let emailKey = site.email_resend_key;
      let changed = false;

      const storedKey = secrets[RESEND_SECRET];
      if (emailKey === null && typeof storedKey === 'string') {
        const plain = await decryptSecret(
          env.MALLOK_SECRET,
          INQUIRY_PLUGIN_ID,
          RESEND_SECRET,
          storedKey,
        );
        if (plain !== null) {
          emailKey = await encryptSecret(
            env.MALLOK_SECRET,
            SITE_SECRET_OWNER,
            RESEND_SECRET,
            plain,
          );
          delete secrets[RESEND_SECRET];
          changed = true;
        }
      }

      const storedFrom = settings.from_address;
      if (
        emailFrom === null &&
        typeof storedFrom === 'string' &&
        storedFrom.trim() !== ''
      ) {
        emailFrom = storedFrom.trim();
        delete settings.from_address;
        changed = true;
      }

      if (!changed) {
        return [];
      }
      const now = new Date().toISOString();
      return [
        db
          .prepare(
            'UPDATE site SET email_from = ?, email_resend_key = ?, updated_at = ? WHERE id = 1',
          )
          .bind(emailFrom, emailKey, now),
        db
          .prepare(
            'UPDATE plugin_state SET settings = ?, secrets = ?, updated_at = ? WHERE plugin_id = ?',
          )
          .bind(
            JSON.stringify(settings),
            JSON.stringify(secrets),
            now,
            INQUIRY_PLUGIN_ID,
          ),
      ];
    },
  };
}

function parseObject(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
