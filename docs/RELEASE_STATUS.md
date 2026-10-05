# Release status

[English](RELEASE_STATUS.md) · [简体中文](zh-CN/RELEASE_STATUS.md)

Snapshot: **October 5, 2026**. Current version: **0.1.0-rc.9**.
This is a public release candidate, not stable 0.1.

## Published rc.9 candidate

- [Public source and release](https://github.com/fobstack/mallok/releases/tag/v0.1.0-rc.9).
- [npm package](https://www.npmjs.com/package/mallok/v/0.1.0-rc.9): `0.1.0-rc.9`. Both `next` and `latest` resolve to this candidate; neither means stable 0.1.
- Source: `8772a77e812336082416bdda9f0e4f393eb4234f`.
- Package: `mallok-0.1.0-rc.9.tgz`.
- SHA-256: `ab2f2993d769cb8f16be30b923501507e3ae790b3a206d19626fae8715891b0a`.
- [CI](https://github.com/fobstack/mallok/actions/runs/37125252372) and
  [complete release gate](https://github.com/fobstack/mallok/actions/runs/37125253859) passed.
- Linux CI, the local build and a clean-clone rebuild produced byte-for-byte
  identical tarballs; 29 exact-artifact consumer checks passed.
- The isolated test site was upgraded from rc.8 with `mallok upgrade` and the
  exact package deployed to `rc5-gate.mallok.dev`. Pages, SEO endpoints, cache
  MISS/HIT and HEAD hits, credential bypass and admin boundaries behaved as
  intended.
- **Checked on the deployed site:**
  - The home pages in both languages show the product section with the site's
    three published products; before rc.9 a served home page was given
    articles only.
  - A two-language bundle without `mallok.json`, published with the real CLI
    and a token created for the check, landed in one translation group, with
    hreflang on both pages; publishing it again reported both unchanged.
  - Reloading an admin route with cache validators answered 200.
- Registry integrity matches the release artifact.

rc.9 fixes defects found building a real site on rc.7 and rc.8: one
translation group per published bundle; `recent.<kind>` on the home page for
every kind the theme lists; text-module types and the setup key for generated
sites; publishing from a project root; dry runs that write nothing; and two
admin fixes. It also exports `escapeHtml` and `renderTextTemplate` for
plugins. The changelog carries four upgrade notes.

Not checked on the deployed site: the type-checking of a generated site and
publishing from a project root, which are verified by the package tests
against the exact tarball and by the CLI tests; and the admin's display of a
revoked token, which is verified in a real browser by the end-to-end suite.

No CPU sample was taken for rc.6 through rc.9. The rc.5 performance
measurements below are historical and must not be reported as rc.9
benchmarks; the home page now runs one statement per listed kind, in one
batch. The maintainer accepted the measured CPU limitation for source opening
and RC evaluation; stable acceptance remains incomplete.

## Historical rc.8 artifact

- Source commit: `ee063e9ffdd9914f1e8560d71fbf11807d1953a6`.
- Package: `mallok-0.1.0-rc.8.tgz`.
- SHA-256: `a1350de000a4776146d1f60b008bf55e3084cc02c6cd1070f777173e50996003`.
- Released October 2, 2026: reading a plugin panel's rows requires the
  `export` scope. Checked on the deployed test site with a real
  `content:write`-only token, which was refused.

## Historical rc.7 artifact

- Source commit: `0af520bf87c81fa3814a3abb3361ca93fa87e457`.
- Package: `mallok-0.1.0-rc.7.tgz`.
- SHA-256: `45813a782d00a2d4984334b8ecb18df21f0c6a2d2694a33652c7b1846dd648a9`.
- Released September 30, 2026 with Atelier 2.5.1 and the theme asset version
  guard; deployed to the same isolated test site.

## Historical rc.6 artifact

- Source commit: `563b366e6e66d535c260543e4c91147269ea2395`.
- Package: `mallok-0.1.0-rc.6.tgz`.
- SHA-256: `aed30e5e2dd828a246665895a1da51696c48b5176a41328c32a147c0f640d3ff`.
- Released September 18, 2026 with Atelier 2.5 and the homepage carousel;
  deployed to the same isolated test site.

## Historical rc.5 artifact

- Source commit: `99df344be185d069412bf68391d3f57c7b443250`.
- Package: `mallok-0.1.0-rc.5.tgz`.
- SHA-256: `de34fb6f73c69e1cd3219d1b3ded94099afba9b5df111e26ccd7a1f240c9df8d`.
- Isolated test hostname: `rc5-gate.mallok.dev`.

Documentation changes after this commit do not change what was tested. They
also do not make a newly packed tarball identical to this one. A subsequent
package must have its own source commit, hash, and applicable package checks.

## Verified results

| Area | Evidence and scope |
| --- | --- |
| Local checks | Lint, typecheck, build, 1,029 unit/integration tests, 27 exact-package consumer tests, and 27 browser/accessibility tests passed on the tested source |
| Packaging | Fresh-clone packaging reproduced the exact tarball; history secret scan passed |
| Deployment | Isolated Worker, D1, R2, custom domain, setup wizard, and content publication exercised |
| Cache safety | MISS/HIT/HEAD browser policy retained; credential-bearing requests bypass shared caching |
| Invalidation | Automatic update observed in 1,540ms; controlled tag purge in 715ms, with a 3,600-second TTL; single-run observations, not global percentiles |
| Media/export | Original and variant hashes checked; export manifest checked; not a full second-site restore test |
| Mobile Lighthouse | Home performance 95/97/95, article 96/96/96; accessibility, best practices, and SEO 100 across the six runs |
| CPU | 30 confirmed MISS and 30 confirmed HIT responses, all HTTP 200, matched to persisted Workers invocation logs |

CPU milliseconds, from the measured deployment:

| Population | n | p50 | p95 | Maximum |
| --- | --- | --- | --- | --- |
| Cache miss | 30 | 11 | 35 | 44 |
| Cache hit | 30 | 0 | 0 | 1 |

16 cold-cache invocations exceeded the project's 10ms target. They did not
fail in this sample. Zero is the platform's recorded value, not a claim of
zero computation. Cold-start attribution was unavailable. The test did not
force regeneration of every D1 content fragment or cover all page types.

## Remaining work and known limitations

- Real Turnstile/Resend inquiry delivery and receipt have not been verified.
- Natural seven-day media cleanup could be checked from September 24, 2026
  at 14:28 UTC and has not been checked yet; changing timestamps is not
  equivalent evidence.
- Scheduled publishing was verified on an intermediate deployment; final
  artifact coverage must not be inferred from it.
- Full export/restore into a second deployment and real upgrade/rollback
  acceptance remain open.
- The test hostname has Cloudflare-injected analytics JavaScript; theme-level
  zero-JavaScript output is not a promise that the whole response has none.
- The generated site's dependency audit was clean at measurement time. The
  framework development toolchain still reported 6 high, 3 moderate, and 2 low
  findings in happy-dom/Lighthouse-related dependencies. These require triage;
  they are not evidence that the shipped runtime is affected or unaffected.
- The Deploy to Cloudflare starter repository/button is not available.

See [the release runbook](RELEASE_GATE.md) for the remaining procedures.
