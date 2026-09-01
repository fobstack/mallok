# Task 16 — Deployment entry points

- Status: **code complete, unverified against a real account.** Every step is
  implemented and the logic is tested; nothing has been run against
  Cloudflare, because creating real resources needs the product owner's
  authorisation (`docs/CONVENTIONS.md`, working rules).
- Date: 2026-08-30
- Scope: `mallok create`, `mallok destroy`, the site registry, and the
  per-site wrangler config.
- Contract: `docs/CLOUDFLARE_RESOURCES.md §6`, `§9`, `§10`.

## 1. What is demonstrable, and what is not

> `mallok create acme --domain acme.com --dry-run` prints the exact steps it
> would run and writes nothing.

That runs, and so does slug validation, the registry, config generation and
the destroy ordering. **The loop the plan asks for — `npx mallok create` on a
clean account, all the way to the wizard — has not been run.** It creates a
D1 database, an R2 bucket, a Worker and a secret in someone's account, which
is exactly the kind of action that needs explicit authorisation. Everything
below is therefore "implemented and unit-tested", not "verified".

## 2. It drives wrangler, not the REST API

`create` and `destroy` shell out to `wrangler`, so the user's existing OAuth
login is the only credential involved and the CLI never handles an account
token (`CLI.md §4`). It also means the resources are created exactly the way
`wrangler deploy` would create them, rather than by a second implementation
that could drift.

`MALLOK_SECRET` is generated in memory and piped straight into
`wrangler secret put`. It is never written to a file and never printed.

## 3. The registry holds no secrets

`.mallok/sites.json` records slug, origin, domain, database id, bucket and
rate-limit namespace — enough for a later command to find the site, and
nothing that would be dangerous in a repository
(`CLOUDFLARE_RESOURCES.md §9`). There is a test asserting the written file
contains neither "secret" nor "token", because this is the kind of rule that
decays quietly.

Rate-limit namespaces are assigned from the registry rather than defaulted,
since they must be unique per account and two sites sharing one would make
each other's limits behave strangely.

## 4. Destroy stops rather than continues

The delete order is the documented one — Worker, then database, then bucket —
so bindings release before the resources they point at disappear. Each step
tolerates an already-missing resource, which makes a re-run safe after a
partial failure. A step that genuinely fails **stops the run** and prints how
far it got: a half-deleted site that reports where it stopped is recoverable;
one that carries on silently is not.

Four things the CLI cannot delete are printed as a to-do list: the R2 custom
domain, the Turnstile widget, the `CF_API_TOKEN`, and any DNS records the
wizard added. Leaving them unmentioned would leave a domain occupied and a
token live.

`destroy` also requires `--confirm <slug>` repeated back. It deletes content,
media and inquiries.

## 5. Verification

| Check | Result |
| --- | --- |
| `pnpm lint` | pass |
| `pnpm typecheck` | pass |
| `pnpm test` | 28 files / 306 tests pass |
| `pnpm build` | pass |

`test/cli/provision.test.ts` covers resource naming, slug validation
(including the single-character case a first regex let through), registry
round-tripping and namespace assignment, the no-secrets property, database-id
parsing, config generation with and without a domain, and the destroy order.

Run by hand: `create --dry-run` with and without a domain, an invalid slug,
and `destroy` against an unknown slug. In every case nothing was written.

## 6. Not done / known limits

- **Never run against a real Cloudflare account.** This is the significant
  one. Everything in `CLOUDFLARE_RESOURCES.md §6` steps 3–8 is written from
  the documentation, and `wrangler`'s output format for `d1 create` in
  particular is parsed by regex — if it differs from what is expected, the
  run stops with a message telling the user how to finish by hand, but that
  path has not been exercised.
- **Step 9 of §6 is not implemented**: the R2 custom domain, the Turnstile
  widget and the `CF_API_TOKEN` prompt. All three need Cloudflare API calls
  with an account-scoped token, which is a different credential from the
  wrangler OAuth session this command uses. The wizard tells the user what is
  missing instead.
- **The Deploy-to-Cloudflare button path is not set up.** `CLOUDFLARE_RESOURCES.md §7`
  describes it; the repository has no `deploy.json` and the README has no
  button. The wrangler config does carry default resource names, which is the
  precondition.
- **`--starter` and `--locale` flags** for scripted fleet creation are not
  parsed; the wizard collects both.
- **`buildSiteConfig` edits the base config with regular expressions.** It is
  tested against the real `wrangler.jsonc` and preserves its comments, but a
  future restructuring of that file could break it silently.
