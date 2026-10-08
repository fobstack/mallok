# Task 35 — Re-measure, release and report back to Nundar

- Status: **open — waiting on the owner.** The report is drafted; the
  measurement, the version decision and the release have not happened.
- Date: 2026-10-06
- Source: `docs/IMPLEMENTATION_PLAN.md`, phase six, close-out.

## 1. Where each part stands

| Part | State | What it needs |
| --- | --- | --- |
| Re-measure cold-render CPU and D1 round trips on a real account with `renderData` active | **`NOT_RUN`** | A deployment on a real account that carries a plugin with `renderData`, made by the maintainer (`docs/RELEASE_GATE.md §9`); the samples come from Workers Logs, not from this repository |
| Choose the version | **Decided 2026-10-06: `0.1.0-rc.11`** | — |
| Release through `docs/RELEASE_GATE.md` | **Done 2026-10-07 as far as npm's `next` tag.** `latest` was left on rc.10 and no GitHub release page was created, after the purge finding on the deployed site (`TASK-46.md §7`) | — |
| Report to Nundar | **Drafted**, §3 below | The published version and the measured numbers, once they exist |

Nothing in this task was done by assumption: no number below was measured,
and none is claimed.

## 2. What is released and what is not

- **`0.1.0-rc.10`** (public, `latest` and `next`) carries Tasks 18–30, 36–38,
  40 and 41: all of P0.
- **`0.1.0-rc.11`**, being released: Task 31 (raw-body routes), Task 32
  (action parameters, related rows), Task 33 (isolated `scheduled`, jobs),
  Task 39 (`reference[]`), Task 34 (site starters), and Nundar's later items
  as Tasks 42–46 (form labels from the theme, a tagline per language, 404 at
  a list-less kind's base, `site.kinds`, nothing stored for an unclaimed
  site).

What local tests measure in place of the real account, and what that is
worth: `test/worker/budget.test.ts` counts D1 round trips of a cold render —
two, with relations and a list of references in the second — and
`test/worker/render-data.test.ts` holds each `renderData` hook to one call.
Round trips are a property of the code and carry over. **CPU does not**: the
rc.5 sample had 16 of 30 cold renders over the 10 ms target before any of
this was added, and a hook adds to it.

## 3. The report to Nundar

Kept as a file of its own, beside the task list it answers:
`handoff/2026-10-06-mallok-plugin-api-2-report-for-nundar.md`, in the
directory above this repository. It holds, per item of the owner's list, the
final interface where it differs from the draft, every owner decision, and
what is not verified. Two lines are left to fill in: the version Nundar pins,
and the measured numbers.

## 4. Not covered, and known risks

- Everything in §1 marked `NOT_RUN` or open.
- Plugin API 2 has not been exercised by a real plugin on a deployed site:
  not `renderData`, not a plugin page, not a purge by plugin tag, not the
  relaxed rate-limit tier's separate counting, not a job, not a starter with
  records. The gate site runs rc.10 with no plugin of its own.
- The per-tick bound of five plugin jobs, and how large a starter one
  request can import on the Free plan, are judgement, not measurement
  (`TASK-33.md §5`, `TASK-34.md §5`).
