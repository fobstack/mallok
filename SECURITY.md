# Security policy

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Report it through GitHub's private advisory form:
<https://github.com/FobStack/mallok/security/advisories/new>

Include what you need to reproduce it: the request, the version or commit,
and what an attacker gets out of it. You will get an acknowledgement within
five working days.

Mallok is pre-1.0 and maintained by one person. There is no bounty, and
there is no embargo you have to respect — but a few days between the report
and public disclosure lets a fix reach the people running the code.

## What is in scope

Mallok runs in the site owner's own Cloudflare account, so the interesting
boundaries are:

- **Content is untrusted.** Markdown is sanitised when a fragment is
  generated (`docs/SECURITY.md §4`). Anything that gets script into a
  rendered page is in scope.
- **Credential handling.** `MALLOK_SECRET`, `CF_API_TOKEN` and `CF_ZONE_ID`
  are Worker secrets; third-party keys are AES-GCM encrypted in D1. Anything
  that reads a credential out of a response, a log or an export is in scope.
- **The management API and admin session handling** under `/_mallok/`.
- **The setup wizard**, which must stop answering once setup is finished.
- **Plugin isolation** — plugins are compiled in and trusted, but a plugin
  route that leaks another plugin's secrets is in scope.

## What is not in scope

- Anything requiring the site owner's own admin credentials.
- Denial of service through Cloudflare's own limits.
- Findings from automated scanners with no working proof of exploitation.

## Supported versions

Pre-1.0: only the `main` branch is supported. There are no backports.
