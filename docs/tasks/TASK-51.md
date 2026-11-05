# Task 51 — Release 0.1.0-rc.12

- Status: **open — candidate prepared, waiting on the owner.** The version
  is set and the local gate (`docs/RELEASE_GATE.md §4`) is run on the
  preparing commit; the isolated deployment and publishing have not
  happened.
- Date: 2026-11-05
- Source: `docs/IMPLEMENTATION_PLAN.md`, phase seven. **Owner decision,
  2026-11-02:** released together with the admin's move to shadcn/ui, not on
  its own.

## 1. What the candidate carries

Everything on `main` since `0.1.0-rc.11` (`CHANGELOG.md`, `[0.1.0-rc.12]`):

- Tasks 47–50: purges that take effect and say when they do not, the
  default language under a prefix too, slugs of up to four segments, heading
  ids.
- The admin's move to shadcn/ui, React Hook Form, React Router and TanStack
  Query (`docs/ADMIN_MIGRATION.md`). Its first-load budget is 170 KiB,
  raised from 150 and confirmed by the owner on 2026-11-03; it measured
  161.7 KiB.
- Three fixes found on the way, each older than this work: "Create
  `<language>`" in the editor overwrote the original instead of making the
  translation; a second item in one translation group and language answered
  500 instead of 409; the media API sent no preview `url`, so the admin's
  thumbnails and image previews were blank.
- Two schema migrations on the first request after deploying, and one
  re-render of every stored page body (the changelog's upgrade notes).

## 2. What is local and what is not

`RELEASE_GATE.md §4` — the full local suite, the exact-candidate checks and
a clean-clone rebuild — can be closed on this machine and is run on the
preparing commit. Its seven candidate values (filename, size, unpacked
size, integrity, shasum, SHA-256, source commit) are kept **outside this
checkout**, as §4 requires: committing them here would change `HEAD` and
void the candidate. They go into `RELEASE_STATUS.md` with the record of the
published release, as rc.11's did.

Nothing past §4 has been done. Every later step needs the owner's account,
domain or npm credentials.

## 3. What the owner runs, in order

1. **§6–§14 on the isolated site** (`rc5-gate.mallok.dev`), from the exact
   candidate tarball: upgrade the test project from rc.11 with
   `mallok upgrade` and deploy, as for rc.11.
2. Beyond the runbook's checks, the ones this release is about:
   - **Purges:** with a token that holds Zone → Cache Purge → Purge, a save
     and "Clear cached pages" turn a cached page from HIT to MISS; with
     Cache Rules → Edit instead, the admin shows the refusal and names the
     permission (`TASK-47.md`).
   - **The admin**, signed in: edit and publish; upload an image and see its
     thumbnail; open a plugin panel and a record; create a translation from
     the editor's language bar and see the original unchanged; switch the
     colour scheme.
   - **A prefixed default language**, turned on and off again on the test
     site: the root answers 301, the old addresses redirect.
3. **§5:** publish that same tarball to npm under `next`. Whether `latest`
   moves to rc.12 is the owner's call; it stayed on rc.10 for rc.11 because
   of the purge finding that this release fixes.
4. **§5.1:** reinstall from the public registry and smoke it.
5. Tag `v0.1.0-rc.12` on the candidate's source commit and push it.
6. Record the published release in `RELEASE_STATUS.md` (English and
   `zh-CN`) and the install commands in the READMEs, as `f957565` did for
   rc.10.

## 4. Not measured, and not claimed

Cold-render CPU on a real account is still the open item it was for rc.11
(`TASK-35.md`); nothing in this release was measured against it.
