# Task 08 — The `inquiry` plugin

- Status: **complete**, all checks green locally; one deliberate deviation
  from `ARCHITECTURE §13` recorded in §4 for the product owner to ratify.
- Date: 2026-08-29
- Scope: the official inquiry plugin — form injection, submit route with
  honeypot / Turnstile / rate limit / spam rules, storage, two queued emails
  with Resend delivery and retry, the admin panel, CSV export.
- Contract: `docs/PLUGIN_API.md §11`, `docs/ARCHITECTURE.md §13`,
  `docs/DATA_MODEL.md §2.11`.

## 1. Demonstrable loop (the 0.1 acceptance core)

> An author writes `[[inquiry]]` as its own paragraph → the product page
> shows a native form → a buyer submits → the row lands in
> `p_inquiry_inquiry`, the owner gets a notification with Reply-To set to
> the buyer, the buyer gets a confirmation in their language → the browser
> lands on the thank-you page → the admin panel lists the inquiry, can mark
> it replied/spam and export CSV.

`test/worker/inquiry.test.ts` walks this loop end-to-end (13 tests), with
Resend and Turnstile served by a fetch stub per `TESTING.md` (no live
third-party calls).

## 2. How the form gets into the page

Stage one's sanitizer strips `<form>` from content **on purpose** — content
is untrusted. The form is trusted plugin output, so it enters at stage two:
the `afterRender` hook replaces the exact paragraph `<p>[[inquiry]]</p>` in
the final page HTML. Consequences, all tested:

- the Markdown source is untouched (`CONTENT_FORMAT` invariant: HTML is
  derived, Markdown is truth);
- disabling the plugin instantly returns the page to plain text, no
  re-render of fragments needed (`affectsFragmentCache: false`);
- the page stays fully cacheable at the edge, form included;
- zero client JavaScript unless a Turnstile site key is configured — the one
  allowed exception (`PRODUCT_VISION §5.6`), and the script tag is emitted
  only when the widget is actually on the page.

## 3. The submit chain, as implemented

```
POST /_mallok/p/inquiry/submit  (form-urlencoded; JSON also accepted)
  → rate limit (RATE_LIMITER binding, best-effort, skipped when absent)
  → body parsing, Turnstile server-side verification (when secret configured)
  → zod validation (name/email/message required, bounded lengths)
  → honeypot "website": filled ⇒ success redirect, nothing stored
  → spam rules: blocked country (request.cf.country) or keyword ⇒ stored as
    status='spam', no emails, success redirect
  → INSERT p_inquiry_inquiry (country, UA ≤300 chars, ip_hash =
    sha256(ip‖MALLOK_SECRET); raw IP never stored)
  → two jobs via ctx.sendEmail: owner notification (Reply-To = buyer),
    buyer autoreply (per-locale built-in, or operator Liquid override)
  → immediate send attempt; failures retried by cron with backoff
  → 302 to the locale-prefixed thanks_path
```

Settings (`plugin.json`): `recipient`, `from_address`, `autoreply`,
`autoreply_subject` / `autoreply_body` (restricted Liquid; variables `name`,
`site_name`, `company`, `message`, `locale`; a broken template falls back to
the built-in text instead of losing the email), `turnstile_sitekey`,
`thanks_path`, `blocked_countries`, `blocked_keywords`. Secrets:
`resend_api_key` (required), `turnstile_secret`.

Panel: `inquiries` table over `p_inquiry_inquiry` with status filter,
detail fields, `mark_replied` / `mark_spam` (update, `content:write`) and
`export_csv` (download, `export` scope, RFC-4180-style quoting, newest 1000
rows).

## 4. Deviations from `ARCHITECTURE §13` (need ratification)

1. **The submission-duration check ("提交耗时检测") was dropped.** It
   requires the form to carry its own render timestamp, and the form is baked
   into an edge-cached page — a timestamp would either break the
   deterministic-rendering rule (`ARCHITECTURE §5`) or measure the cache
   entry's age instead of the visitor's fill time. Honeypot, Turnstile, rate
   limit and the operator spam rules remain. If ratified, `ARCHITECTURE §13`
   should drop those four characters; if not, the alternative is a
   client-side timestamp, which would violate the zero-JS promise.
2. **Check order differs slightly**: rate limit runs first (cheapest rejection
   before any parsing), then Turnstile, then zod, then honeypot. The
   documented order (zod → honeypot/timing → Turnstile → rate limit) spends
   CPU and a Turnstile subrequest on traffic the limiter would have dropped.
3. **Autoreply template override is site-wide, not per-locale.** Plugin
   settings are a flat field map (`THEME_FORMAT §5.2` types), which cannot
   declare a per-locale record. Built-in templates remain per-locale (en/zh);
   a non-empty operator override applies to all locales. A per-locale
   override needs a settings-schema extension — 0.2 material.
4. **SPF/DKIM wizard DNS writing** (mentioned in §13's closing note) belongs
   to Task 15 (setup wizard), not this task.

## 5. Verification

| Check | Result |
| --- | --- |
| `pnpm lint` | pass (12 pre-existing theme-CSS warnings, no errors) |
| `pnpm typecheck` | pass |
| `pnpm test` | 16 files / 178 tests pass |
| `pnpm build` | pass |
| `pnpm bundle:size` | 223.2 KiB gzip = 7.3 % of the Free limit (inquiry plugin included) |

Covered by `test/worker/inquiry.test.ts`: marker swap and Markdown
preservation; hidden fields and honeypot; valid submit → row + 302 + both
Resend payloads inspected (Reply-To, from, recipients); honeypot drop;
validation reject; spam rules (unit + end-to-end keyword case, stored as
spam with no send); operator Liquid autoreply (subject and body rendered);
Resend 500 → job back to `pending` with `attempts = 1`, backed-off `run_at`;
panel list/filter, `mark_spam`, CSV export; Turnstile widget emission,
missing/rejected/accepted token paths; disabled plugin → route 404 and
marker restored.

Not verified locally: real Resend delivery (needs a verified sender and a
real key), real Turnstile round-trip, the rate-limit 429 (binding absent in
tests), and inbox rendering of the HTML email bodies. These land in the
real-account pass together with `TASK-01 §4`.
