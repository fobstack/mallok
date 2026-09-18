# Release status

[English](RELEASE_STATUS.md) · [简体中文](zh-CN/RELEASE_STATUS.md)

Snapshot: **September 18, 2026**. Version: **0.1.0-rc.5**. This page is the
current release summary; older task reports and acceptance tables remain
historical evidence, not a claim that their results apply to every build.

## rc.6 publication in progress

The selected source now includes Atelier 2.5 and is versioned 0.1.0-rc.6.
Local carousel checks passed, including touch, keyboard, no-JavaScript fallback,
and accessibility. The rc.5 artifact and performance results below are retained
as historical evidence; they do not apply automatically to rc.6. Final package
provenance and distribution status will be recorded with the GitHub prerelease.

## Source opening versus a stable release

The maintainer accepts the measured CPU limitation for opening the source and
RC evaluation. The failed performance target stays failed; this decision does
not turn it into a passing test. Stable 0.1 acceptance remains incomplete.
GitHub visibility is still private at this snapshot, and npm publication has
not happened. Making the repository public does not publish the npm package.

## Tested artifact

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
- npm publication, public-registry reinstallation, and public GitHub Actions
  execution remain distribution tasks. The Deploy to Cloudflare starter
  repository/button is not available.

## Before changing repository visibility

1. Review the tracked files and full-history secret scan after the final docs
   changes. Keep private credentials and raw request logs out of the repository.
2. Confirm GitHub private vulnerability reporting works; its API returned 404
   while the repository was private, so availability is not verified.
3. Push the reviewed source, run GitHub CI, and make the source public as an RC.
4. Keep npm publication and a stable 0.1 announcement separate. Publish only a
   selected, verified package with matching provenance.

See [the release runbook](RELEASE_GATE.md) for the remaining procedures.
