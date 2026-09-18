# Release status

[English](RELEASE_STATUS.md) · [简体中文](zh-CN/RELEASE_STATUS.md)

Snapshot: **September 18, 2026**. Current version: **0.1.0-rc.6**.
This is a public release candidate, not stable 0.1.

## Published rc.6 candidate

- [Public source and release](https://github.com/fobstack/mallok/releases/tag/v0.1.0-rc.6).
- npm publication is pending account 2FA setup. The registry rejected the publication attempt; `mallok@0.1.0-rc.6` is not yet available from npm.
- Source: `563b366e6e66d535c260543e4c91147269ea2395`.
- Package: `mallok-0.1.0-rc.6.tgz`.
- SHA-256: `aed30e5e2dd828a246665895a1da51696c48b5176a41328c32a147c0f640d3ff`.
- [CI](https://github.com/fobstack/mallok/actions/runs/35333476382) and
  [complete release gate](https://github.com/fobstack/mallok/actions/runs/35333476953) passed.
- The exact package was deployed to `rc5-gate.mallok.dev`; English and Chinese
  pages and Atelier 2.5 assets returned HTTP 200. This is a test site with
  verification content, not a curated demo.
- Public-registry integrity and reinstallation remain pending npm publication.
- Linux CI and the local build produced byte-for-byte identical tarballs.
- GitHub private vulnerability reporting is enabled.

The release includes Atelier 2.5, responsive imagery, and a three-slide homepage
carousel with keyboard, touch and no-JavaScript navigation. Local and Linux CI
browser/accessibility checks passed. The editor and its rendered preview are
scanned separately because axe cannot complete inside the script-disabled
preview frame on Linux; the product's sandbox remains enabled.

Documentation commits after the selected source do not change the released
artifact. rc.5 performance measurements below are historical and must not be
reported as rc.6 benchmarks. The maintainer accepted the measured CPU limitation
for source opening and RC evaluation; stable acceptance remains incomplete.

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
- Natural seven-day media cleanup cannot be checked before September 24,
  2026 at 14:28 UTC; changing timestamps is not equivalent evidence.
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
