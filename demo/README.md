# Public Atelier demo

Live: <https://demo.mallok.dev/>. English is the default; Chinese is available
at `/zh/`. Public screenshots and promotional images use the English interface.

This is a read-only static showcase, not the release acceptance site. It uses
the repository's Atelier theme and content with the overrides in `demo/content`.
The demo notice identifies the fictional company. Contact pages do not collect
messages, and the static builder removes inquiry forms. Search engines receive
`X-Robots-Tag: noindex` because supplier claims and specifications are examples.

```sh
pnpm build:demo
pnpm exec wrangler deploy --config demo/wrangler.jsonc --dry-run
pnpm exec wrangler deploy --config demo/wrangler.jsonc --strict
```

Deployment creates/updates only the `mallok-demo` static-assets Worker and its
`demo.mallok.dev` custom domain. No D1, R2, secret or cron is required. The
separate `rc5-gate.mallok.dev` acceptance site and its media-retention window
are not changed by this deployment.

The public README screenshot is `docs/images/atelier-desktop.jpg`, captured
from the actual English demo at 1440 × 1000. Re-capture it when the design changes.
