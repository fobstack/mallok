/**
 * The official inquiry plugin — the 0.1 acceptance core
 * (docs/PLUGIN_API.md §11, docs/ARCHITECTURE.md §13).
 *
 * An author places `[[inquiry]]` as its own paragraph; `afterRender` swaps
 * that marker for a native HTML form. Submissions go through honeypot,
 * Turnstile (when configured) and rate-limit checks, land in
 * `p_inquiry_inquiry`, and produce two queued emails: the owner notification
 * and the buyer's confirmation.
 */

import { z } from 'zod';
import { parsePluginManifest, renderTextTemplate } from '../../core/index.js';
import type {
  MallokPlugin,
  PluginRequestContext,
  RouteInput,
} from '../types.js';
import {
  buildAutoreply,
  buildNotification,
  type InquiryEmailInput,
} from './emails.js';
import { buildInquiryForm, INQUIRY_MARKER } from './form.js';
import inquirySql from './migrations/0001_inquiry.sql';
import manifestJson from './plugin.json';

const manifest = parsePluginManifest(manifestJson);

const submitSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z
    .string()
    .trim()
    .min(3)
    .max(320)
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/),
  company: z.string().trim().max(200).default(''),
  phone: z.string().trim().max(60).default(''),
  message: z.string().trim().min(1).max(5000),
  content_id: z.string().max(100).default(''),
  locale: z.string().max(20).default(''),
  source_path: z.string().max(500).default(''),
  /** Honeypot. A human never sees it; bots fill it. */
  website: z.string().max(500).default(''),
});

/** How many rows one panel action or CSV export may touch. */
const ACTION_LIMIT = 100;
const EXPORT_LIMIT = 1000;

async function submit(
  input: RouteInput,
  ctx: PluginRequestContext,
): Promise<Response> {
  const parsed = submitSchema.safeParse(input.fields);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({
        error: 'Please fill in your name, a valid email and a message.',
      }),
      {
        status: 400,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      },
    );
  }
  const form = parsed.data;
  const locale = ctx.site.locales.includes(form.locale)
    ? form.locale
    : ctx.site.defaultLocale;
  const redirect = thanksRedirect(ctx, locale);

  // A filled honeypot gets the success response and nothing else: telling a
  // bot it was caught only teaches it.
  if (form.website !== '') {
    return redirect;
  }

  const sourcePath = form.source_path.startsWith('/') ? form.source_path : '/';
  const emailInput: InquiryEmailInput = {
    siteName: ctx.site.name,
    name: form.name,
    email: form.email,
    company: form.company,
    phone: form.phone,
    message: form.message,
    sourceUrl: `${ctx.url.origin}${sourcePath}`,
    country: ctx.country ?? '',
    locale,
  };

  // Operator spam rules (docs/ARCHITECTURE.md §13): a match is stored as
  // spam and sends nothing, but the bot still sees the success redirect.
  const spam = matchesSpamRules(ctx.settings, {
    country: ctx.country,
    text: `${form.name}\n${form.company}\n${form.message}`,
  });

  const recipient =
    typeof ctx.settings.recipient === 'string' ? ctx.settings.recipient : '';
  // Emails are queued jobs: a missing recipient or Resend outage must never
  // lose the inquiry itself, which is already worth money.
  let notifyJobId: string | null = null;
  let autoreplyJobId: string | null = null;
  if (!spam && recipient !== '') {
    notifyJobId = await ctx.sendEmail(buildNotification(recipient, emailInput));
    if (ctx.settings.autoreply !== false) {
      autoreplyJobId = await ctx.sendEmail(
        buildAutoreply(
          emailInput,
          await renderAutoreplyOverride(ctx.settings, emailInput),
        ),
      );
    }
  }

  await ctx.db
    .prepare(
      `INSERT INTO p_inquiry_inquiry
         (id, content_id, locale, source_path, name, email, company, phone,
          country, message, status, notify_job_id, autoreply_job_id,
          user_agent, ip_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      form.content_id === '' ? null : form.content_id,
      locale,
      sourcePath,
      form.name,
      form.email,
      form.company === '' ? null : form.company,
      form.phone === '' ? null : form.phone,
      ctx.country,
      form.message,
      spam ? 'spam' : 'new',
      notifyJobId,
      autoreplyJobId,
      (ctx.request.headers.get('user-agent') ?? '').slice(0, 300) || null,
      ctx.ipHash,
      new Date().toISOString(),
    )
    .run();

  return redirect;
}

/** Inputs the spam rules look at. */
interface SpamProbe {
  readonly country: string | null;
  readonly text: string;
}

/** Applies the operator's country and keyword rules. Exported for tests. */
export function matchesSpamRules(
  settings: Readonly<Record<string, unknown>>,
  probe: SpamProbe,
): boolean {
  const countries = stringList(settings.blocked_countries).map((entry) =>
    entry.toUpperCase(),
  );
  if (
    probe.country !== null &&
    countries.includes(probe.country.toUpperCase())
  ) {
    return true;
  }
  const haystack = probe.text.toLowerCase();
  return stringList(settings.blocked_keywords).some(
    (keyword) => keyword !== '' && haystack.includes(keyword.toLowerCase()),
  );
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

async function renderAutoreplyOverride(
  settings: Readonly<Record<string, unknown>>,
  input: InquiryEmailInput,
): Promise<{ subject: string; body: string }> {
  const data = {
    name: input.name,
    site_name: input.siteName,
    company: input.company,
    message: input.message,
    locale: input.locale,
  };
  const render = async (source: unknown): Promise<string> => {
    if (typeof source !== 'string' || source.trim() === '') {
      return '';
    }
    try {
      return await renderTextTemplate(source, data);
    } catch {
      // A broken operator template must not lose the inquiry or the email;
      // the built-in text takes over.
      return '';
    }
  };
  return {
    subject: await render(settings.autoreply_subject),
    body: await render(settings.autoreply_body),
  };
}

function thanksRedirect(ctx: PluginRequestContext, locale: string): Response {
  const raw =
    typeof ctx.settings.thanks_path === 'string' &&
    ctx.settings.thanks_path.startsWith('/')
      ? ctx.settings.thanks_path
      : '/thank-you';
  const prefix = locale === ctx.site.defaultLocale ? '' : `/${locale}`;
  return Response.redirect(
    new URL(`${prefix}${raw}`, ctx.url.origin).toString(),
    302,
  );
}

async function setStatus(
  ids: readonly string[],
  status: 'replied' | 'spam',
  db: D1Database,
): Promise<void> {
  const bounded = ids.slice(0, ACTION_LIMIT);
  if (bounded.length === 0) {
    return;
  }
  const marks = bounded.map(() => '?').join(', ');
  await db
    .prepare(`UPDATE p_inquiry_inquiry SET status = ? WHERE id IN (${marks})`)
    .bind(status, ...bounded)
    .run();
}

const CSV_COLUMNS = [
  'id',
  'created_at',
  'status',
  'name',
  'email',
  'company',
  'phone',
  'country',
  'locale',
  'source_path',
  'message',
] as const;

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

/** Renders every inquiry as CSV. Shared by the panel action and the export. */
async function inquiriesCsv(db: D1Database): Promise<string> {
  const rows = await db
    .prepare(
      `SELECT ${CSV_COLUMNS.join(', ')} FROM p_inquiry_inquiry
       ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(EXPORT_LIMIT)
    .all<Record<string, unknown>>();
  const lines = [
    CSV_COLUMNS.join(','),
    ...rows.results.map((row) =>
      CSV_COLUMNS.map((column) => csvCell(row[column])).join(','),
    ),
  ];
  return `${lines.join('\r\n')}\r\n`;
}

/** The official inquiry plugin. */
export const inquiryPlugin: MallokPlugin = {
  manifest,
  migrations: [{ id: 'plugin:inquiry:0001_inquiry', sql: inquirySql }],
  hooks: {
    afterRender: (html, ctx) => {
      if (!html.includes(INQUIRY_MARKER)) {
        return html;
      }
      const sitekey =
        typeof ctx.settings.turnstile_sitekey === 'string'
          ? ctx.settings.turnstile_sitekey
          : '';
      const form = buildInquiryForm({
        locale: ctx.locale,
        path: ctx.path,
        contentId: ctx.content?.id ?? null,
        sitekey,
      });
      return html.replaceAll(INQUIRY_MARKER, form);
    },
  },
  routes: { submit },
  checkSecrets: {
    // Resend's domains endpoint is a read; it tells us whether the key is
    // valid without sending anything to anyone.
    resend_api_key: async (ctx) => {
      const key = ctx.secrets.resend_api_key;
      if (key === undefined || key === '') {
        return { ok: false, message: 'No key is stored.' };
      }
      try {
        const response = await fetch('https://api.resend.com/domains', {
          headers: { authorization: `Bearer ${key}` },
        });
        if (response.status === 401 || response.status === 403) {
          return { ok: false, message: 'Resend rejected this key.' };
        }
        if (!response.ok) {
          return {
            ok: false,
            message: `Resend replied ${response.status}.`,
          };
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
              'The key works, but no sending domain is verified yet. Verify one in Resend before inquiries can be delivered.',
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
    },
    turnstile_secret: async (ctx) => {
      const secret = ctx.secrets.turnstile_secret;
      if (secret === undefined || secret === '') {
        return { ok: false, message: 'No secret is stored.' };
      }
      try {
        // Siteverify with a deliberately invalid token: a wrong *secret*
        // reports `invalid-input-secret`, which is what distinguishes the
        // two failures.
        const response = await fetch(
          'https://challenges.cloudflare.com/turnstile/v0/siteverify',
          {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ secret, response: 'check' }),
          },
        );
        const body = (await response.json()) as {
          'error-codes'?: string[];
        };
        const codes = body['error-codes'] ?? [];
        if (codes.includes('invalid-input-secret')) {
          return { ok: false, message: 'Cloudflare rejected this secret.' };
        }
        return { ok: true, message: 'Secret accepted by Cloudflare.' };
      } catch {
        return { ok: false, message: 'Could not reach Cloudflare.' };
      }
    },
  },
  // Inquiries travel with a site export, so leaving Mallok never means
  // leaving the leads behind (docs/CONTENT_FORMAT.md §5).
  exportFiles: async (ctx) => [
    { path: 'inquiries.csv', text: await inquiriesCsv(ctx.db) },
  ],
  actions: {
    mark_replied: async (ids, ctx) => {
      await setStatus(ids, 'replied', ctx.db);
      return undefined;
    },
    mark_spam: async (ids, ctx) => {
      await setStatus(ids, 'spam', ctx.db);
      return undefined;
    },
    export_csv: async (_ids, ctx) =>
      new Response(await inquiriesCsv(ctx.db), {
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': 'attachment; filename="inquiries.csv"',
        },
      }),
  },
};
