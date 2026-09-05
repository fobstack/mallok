# The Mallok security boundary

- Status: 0.1 baseline
- Date: 2026-08-28
- Standing: defines trust levels, credential handling, authentication and
  sanitisation. **This describes what 0.1 actually does, not a security
  aspiration.** Anything it does not do belongs in §12, "Deliberately not
  defended against", rather than being glossed over.

> Reporting a vulnerability is covered by [`SECURITY.md`](../SECURITY.md) in
> the repository root. This document is the design.

## 1. Trust levels

From `ARCHITECTURE §14`; everything else follows from it:

| Subject | Trust level | Boundary |
| --- | --- | --- |
| Visitor submissions (the inquiry form) | **Untrusted** | zod validation, Turnstile, rate limiting, parameterised SQL, escaped email templates |
| Markdown bodies | **Untrusted**, even when an administrator wrote them | Allow-list sanitisation when the fragment is generated |
| Themes | **Semi-trusted** | A restricted template engine with no code execution |
| Plugins | **Trusted** | Installed and enabled deliberately by the user; **no sandbox** |
| Management API callers | Authenticated | A session or a scoped token |

"Untrusted even when an administrator wrote it" is not a formality:
administrators paste Markdown from elsewhere, AI content pipelines write
automatically, and the importer consumes files exported by other tools.

## 2. Credentials

### 2.1 The three Worker secrets

**Cloudflare's own credentials exist only as Worker secrets and never enter
D1** (`docs/CONVENTIONS.md`, engineering boundaries):

| Secret | Purpose | Scope |
| --- | --- | --- |
| `MALLOK_SECRET` | Signs sessions, encrypts third-party keys, signs preview links, salts `ip_hash` | 32 random bytes |
| `CF_API_TOKEN` | Purging the cache, and the wizard's DNS writes | Zone: Cache Purge and DNS Edit. Account: R2 Edit, only to attach a custom domain |
| `CF_ZONE_ID` | As above | — |

Without `CF_API_TOKEN` the site works normally, it simply cannot purge on
demand (`CLOUDFLARE_RESOURCES.md §6`) — **an honest degradation, not a
fault**.

### 2.2 Third-party keys live in D1

Third-party service keys such as a Resend key are **encrypted into D1** so the
admin can configure them (`DATA_MODEL §2.7`). The format is fixed and an
implementation may not improvise:

```
key      = HKDF-SHA256(MALLOK_SECRET, salt = "mallok.plugin.secret.v1",
                       info = "<plugin_id>:<secret_name>", length = 32)
iv       = 12 random bytes, regenerated on every write
payload  = AES-GCM-256(key, iv, plaintext)          // the tag is appended to the ciphertext
stored   = base64(iv || payload)
```

- Each `(plugin_id, secret_name)` derives its own key, so one leak does not
  reach the others.
- The IV is random on every write and is **never reused**.
- The management API returns only "set" or "not set" and **never echoes a
  value** (`PLUGIN_API.md §7.3`).
- Rotation is supported: writing a new value overwrites.

### 2.3 Rotating `MALLOK_SECRET`

Rotating invalidates every session and makes stored third-party keys
undecryptable. Therefore:

- when the admin offers a rotate action, it must first decrypt every
  third-party key with the old secret, re-encrypt with the new one, and only
  then switch over;
- if the Deploy button path fell back to an instance secret in the `site` table
  (`CLOUDFLARE_RESOURCES.md §7`), the admin must carry a standing notice that
  this is weaker than a Worker secret, and must run that re-encryption
  automatically once the user adds a real secret in the dashboard.

### 2.4 Never leaked

No credential reaches a log, a response body, an export
(`CONTENT_FORMAT §8`), or an error message.

## 3. Administrator authentication

### 3.1 Passwords

- Derived with **WebCrypto's native PBKDF2-SHA256** (`ARCHITECTURE §14`). Not
  a WASM Argon2 or bcrypt — neither runs inside 10 ms of CPU, and both would
  inflate the Worker.
- Parameters live in `admin_user.password_params` (`{iterations, salt}`), with
  **a distinct salt per user of at least 16 random bytes**.
- The iteration count comes from the measurement in `TASK-01 §4.4`
  (`ARCHITECTURE §18`, item 5).

> **A known problem that must be handled honestly**: the local benchmark
> (`TASK-01 §3.3`) suggests only about 50,000 iterations fit in the free
> plan's 10 ms budget, **well below OWASP's 2023 recommendation of 600,000**.
> Once the real-account numbers exist:
> - if this is confirmed, the product must say so plainly in the documentation
>   and in the admin, and offer two hardening paths: protect `/_mallok/*` with
>   Cloudflare Access, or move to Workers Paid and raise the count;
> - it must **not** pretend 50,000 is equivalent to the industry standard, and
>   must not quietly lower the requirement.
>
> The count is upgradable: on a successful login, if the stored iteration
> count is below the current configuration, re-derive with the new parameters
> and write it back.

### 3.2 Sessions

- Logging in issues a random token in a cookie; D1 stores only
  `sha256(token)` (`DATA_MODEL §2.8`) — **the cookie value itself is never
  stored**.
- Cookie attributes: `HttpOnly; Secure; SameSite=Strict; Path=/_mallok`.
- Fourteen days by default; cron cleans up rows past `expires_at`.
- Logging out deletes the row.

### 3.3 CSRF

Every write requires a CSRF token (`ARCHITECTURE §14`):

- the token is generated with the session and stored in `session.csrf`;
- it is submitted in an `X-Mallok-CSRF` header and compared in constant time
  against the stored value;
- **requests authenticated with a Bearer token are exempt** — they carry no
  cookie and are not subject to CSRF.

### 3.4 API tokens

- Generated in the admin, shown in cleartext once; D1 stores `sha256(token)`
  (`DATA_MODEL §2.8`).
- Scoped: `content:write`, `media:write`, `export`, `settings:write`.
- Revocable (`revoked_at`), with `last_used_at` recorded.
- Prefixed `mlk_live_` so secret scanners recognise them.

### 3.5 Constant-time comparison

Token and CSRF comparisons must be constant time. The current implementation
(`bearerMatches` in `src/worker/http.ts`) hashes with SHA-256 and then uses
`crypto.subtle.timingSafeEqual`. That pattern is correct and new code follows
it.

### 3.6 The setup wizard

`/_mallok/setup` **returns 404 permanently** once `site.setup_completed_at` is
non-null (`ARCHITECTURE §15`). This is a hard gate: a wizard still answering
is an unauthenticated administrator-creation endpoint.

## 4. Content sanitisation

- Sanitisation happens **when the fragment is generated**, using
  `rehype-sanitize` in allow-list mode (`ARCHITECTURE §5`).
- It **does not modify the Markdown source** — `markdown` in D1 must be
  exportable verbatim (`CONTENT_FORMAT §8`).
- Inline HTML is parsed into the tree by `rehype-raw` (`remark-rehype`'s
  `allowDangerousHtml`) rather than dropped, then sanitised like everything
  else — settled 2026-09-02, **Gate B'**. `test/core/fragment.test.ts` (`keeps
  benign inline HTML instead of dropping it`) asserts a `<div>`, a `<span>`
  and a `<br>` survive, and that Markdown inside a raw block still renders.
- Removed: `<script>`, event attributes (`on*`), `javascript:` links,
  `<style>`, `<iframe>`, `<object>`, `<embed>`, `<form>`. This is
  `rehype-sanitize`'s `defaultSchema` (the same list GitHub's own renderer
  uses) — it is also more conservative than a first guess might assume: it
  drops tags outside its allow-list entirely (`<mark>`, for one) and strips
  attributes like `class` that are not on its per-tag list, rather than
  passing them through. Widening that schema is a separate decision from
  Gate B' and has not been asked for.
- The allowed `img` attributes extend the default list with `srcSet`, `sizes`,
  `width`, `height`, `loading` and `decoding` (`src/core/fragment.ts`),
  because the core adds those itself.

## 5. Relative paths

Rule 2 of `CONTENT_FORMAT §4` is a security rule, not merely a formatting one:
only the `images/` and `files/` prefixes are allowed, and **`..`, absolute
paths, `file:` and protocol-relative paths are not**.

`normalizeRelativePath` (`src/core/assets.ts`) is the only entry point, and
the management API already uses it to reject illegal paths.

## 6. Uploads

- **Validated against the sniffed type, never the extension**
  (`ARCHITECTURE §14`).
- Only the allow-list in `CONTENT_FORMAT §4.1` is accepted.
- **svg is not accepted in 0.1** — svg can carry script, and sanitising it
  safely needs a separate allow-list, which 0.1 does not build.
- Attachments under `files/` are stored as they are and served with
  `Content-Disposition: attachment`, **never rendered inline**.
- R2 keys are content-addressed, so an uploader cannot control the path.

## 7. Plugin routes

The core does the following for every plugin route (`PLUGIN_API.md §7.2`):

1. body parsing, with a size limit;
2. zod validation;
3. the server-side Turnstile `siteverify`, when `turnstile: true` is declared;
4. rate limiting, through the `RATE_LIMITER` binding.

The rate-limit binding **counts per data centre and is eventually consistent**
(`TECH_STACK §5`). It deters abuse and **must not** back anything requiring an
exact count.

The inquiry path adds a honeypot field and a submission-timing check
(`ARCHITECTURE §13`) — neither needs JavaScript, so both work against scrapers
that run none.

## 8. SQL

- All hand-written and **parameterised**, kept in `src/db/`
  (`TECH_STACK §7`).
- No ORM, and no string concatenation.
- The `p_<plugin_id>_` table prefix is enforced by the core's migrator.

## 9. Error hygiene

**Never leak SQL, a bucket name, a database id, a binding name or a stack
trace to a client** (`CONTRIBUTING.md`).

- The client gets a stable error code and one sentence of plain language.
- The detail goes into one line of structured JSON logging, as
  `src/worker/index.ts` already does.
- The log itself must contain neither credentials nor a complete user
  submission.

## 10. Draft previews

- Links are signed with `MALLOK_SECRET` (HMAC) and expire
  (`ARCHITECTURE §14`).
- Responses carry `Cache-Control: private, no-store` and `noindex`.
- They are **never written to the edge cache** (`ARCHITECTURE §6.4`).

## 11. Personal data

The inquiry table holds a buyer's name, email, company and phone number
(`DATA_MODEL §2.11`).

- The IP address is **never stored in cleartext**; only
  `ip_hash = sha256(ip || MALLOK_SECRET)` is kept, and only for deduplication
  and rate limiting.
- Inquiry data is part of the site export, so the owner can take it away or
  delete it at any time.
- Mallok itself collects nothing and uploads nothing to a Mallok server —
  **Mallok has no servers** (`PRODUCT_VISION §5.3`).
- Compliance for this data rests with the site owner. The documentation says
  so; the product does not promise GDPR compliance on their behalf.

## 12. Deliberately not defended against (which must be stated honestly)

Listing the boundary honestly is safer than implying protection:

1. **Plugins have no sandbox.** A plugin is trusted code with the Worker's
   full permissions: it can read every secret and read and write every table.
   The risk boundary is a WordPress plugin's.
2. **A theme can emit misleading HTML.** It cannot execute code, but it can
   draw a fake login box. The admin warns before a third-party theme is
   installed.
3. **No defence against the administrator.** 0.1 has one administrator, no
   roles and no audit log.
4. **No defence against a compromised Cloudflare account.** Everything lives
   in the user's own account, and its security is theirs — two-factor
   authentication is recommended.
5. **Rate limiting is best-effort.** It counts per data centre and is
   eventually consistent, so a distributed attack gets around it. The real
   protection is Cloudflare's own WAF and bot management.
6. **No defence against a content author uploading a hostile attachment.**
   Files under `files/` are stored as they are with only type sniffing;
   downloaders take their own risk.
7. **PBKDF2 strength may be below the industry recommendation** (§3.1), to be
   stated honestly once measured.

## 13. Supply chain

- Production dependencies are pinned to **exact versions**, never a floating
  tag (`TECH_STACK §11`).
- A new dependency goes through the gate in `TECH_STACK §11`: exact version,
  lockfile, licence, install scripts, transitive count, size, and which layer
  it belongs to.
- **Dynamic `import` of remote code and `eval` in any form are forbidden at
  runtime** (`TECH_STACK §12`).
- No vendor SDK enters the Worker; everything is `fetch`.

## 14. Hostile-input tests (mandatory)

`CONTENT_FORMAT §9`, item 7 already lists this among the round-trip
requirements. The corpus covers at least:

`..` paths, absolute paths, `javascript:` links, `data:` links, inline
`<script>`, event attributes, a body over 2 MB, malformed YAML (aliases,
custom tags, duplicate keys), very long single lines, deeply nested lists,
Unicode direction-control characters, HTML-entity evasion, and an svg
disguised as a png.

Property testing uses `fast-check` (`TECH_STACK §10`): **for any input,
rendering either produces sanitised HTML or throws a clear error — it never
crashes, never leaks, and never emits unescaped output.**
