# Release status

[English](RELEASE_STATUS.md) · [简体中文](zh-CN/RELEASE_STATUS.md)

Snapshot: **October 6, 2026**. Current version: **0.1.0-rc.10**.
This is a public release candidate, not stable 0.1.

## Published rc.10 candidate

- [Public source and release](https://github.com/fobstack/mallok/releases/tag/v0.1.0-rc.10).
- [npm package](https://www.npmjs.com/package/mallok/v/0.1.0-rc.10): `0.1.0-rc.10`. Both `next` and `latest` resolve to this candidate; neither means stable 0.1.
- Source: `476eb32b6042f5ae9d2045a7179fb1c32ff1a152`.
- Package: `mallok-0.1.0-rc.10.tgz`.
- SHA-256: `899d942af9a76ca07a90e6ebce620c8555a08bcd85731478712ddc991dec234f`.
- [CI](https://github.com/fobstack/mallok/actions/runs/37341569691) and
  [complete release gate](https://github.com/fobstack/mallok/actions/runs/37341595427) passed.
- Linux CI, the local build and a clean-clone rebuild produced byte-for-byte
  identical tarballs; the exact-artifact consumer checks passed against it.
- The isolated test site was upgraded from rc.9 with `mallok upgrade`, given
  the second rate-limit binding the upgrade notes ask for, and the exact
  package deployed to `rc5-gate.mallok.dev`.
- **Checked on the deployed site, without signing in:** pages in both
  languages, SEO endpoints, cache MISS/HIT and HEAD hits, credential bypass
  and the admin boundary; exactly one JSON-LD node on a product page; a
  cross-site `POST` to the inquiry form answered 403 and a same-site one was
  accepted; a two-segment path on the version 1 inquiry plugin answered 404.
- **Reported by the maintainer from the deployed admin, signed in, after the
  upgrade:** Settings → Email showed the sender and the Resend key already
  set, so the move from the inquiry plugin ran on a real site; and a second
  content item opened in the same session showed the editor, with nothing
  marked unsaved.
- Registry integrity matches the release artifact.

rc.10 ships plugin API 2 — `renderData` with structured data and cache tags,
routes with parameters and a locale segment, rate-limit tiers, plugin pages
rendered through theme layouts, the content save and delete hooks, editable
records panels and panels attached to the editor — site-level email
settings, and four fixes: the admin going blank when a second item was
opened, an opened item marked unsaved, a removed plugin secret still shown as
set, and themes with a declared script escaping the script check. **The
changelog's upgrade notes list what existing sites, themes and plugins have
to do.**

**Not checked on a deployed site**, and so resting on Worker and browser
tests only:

- Plugin API 2 as a whole. It has been exercised by test plugins; no real
  plugin on a deployed site has used `renderData`, plugin pages, records
  panels or the content hooks.
- That email is still delivered with the moved Resend key. The move itself
  was seen on the deployed site; no message was sent through it.
- A purge by plugin cache tag evicting only the pages that carry it.
- The two rate-limit bindings counting separately. Both deployed on the test
  account; that shows they can be declared, nothing more. Cloudflare's
  documentation still does not say whether the Free plan includes them.
- The removed-plugin-secret fix, which is verified in a real browser by the
  end-to-end suite against a local Worker.

No CPU sample was taken for rc.6 through rc.10. The rc.5 performance
measurements below are historical and must not be reported as rc.10
benchmarks; `renderData` and the save hooks add work to requests that already
exceeded the 10 ms target there. The maintainer accepted the measured CPU
limitation for source opening and RC evaluation; stable acceptance remains
incomplete.

## Historical rc.9 artifact

- Source commit: `8772a77e812336082416bdda9f0e4f393eb4234f`.
- Package: `mallok-0.1.0-rc.9.tgz`.
- SHA-256: `ab2f2993d769cb8f16be30b923501507e3ae790b3a206d19626fae8715891b0a`.
- Released October 3, 2026: defects found building a real site on rc.7 and
  rc.8. Checked on the deployed test site: the product section on both home
  pages, one translation group for a bundle published with the real CLI, and
  an admin route reloaded with cache validators.

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
