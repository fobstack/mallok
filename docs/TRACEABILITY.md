# Mallok MVP 需求追踪矩阵

- 状态：Living document
- 当前实现状态：全部 `NOT_STARTED`，以 [STATUS.md](STATUS.md) 为准

状态只能使用：`NOT_STARTED`、`IMPLEMENTED_UNVERIFIED`、`VERIFIED_LOCAL`、`VERIFIED_STAGING`、`ACCEPTED`、`BLOCKED`。

| Requirement | Contract | Task | Acceptance | 主要证据 | 当前状态 |
| --- | --- | --- | --- | --- | --- |
| FR-001 init | CLI §4.1 | T-005/T-012 | AC-1B-01, AC-3-01 | static E2E、tarball install | NOT_STARTED |
| FR-002 config | CONTENT_CONFIG §2–3 | T-002 | AC-1B-02 | config schema/unit/integration | NOT_STARTED |
| FR-003 content load | CONTENT_CONFIG §4–7 | T-001/T-002 | AC-1A-06, AC-1B-03 | canonical JSON + YAML/path/diagnostic corpus | NOT_STARTED |
| FR-004 publish filter | BUILD §2, CLI §4.5 | T-001/T-002/T-006 | AC-1A-04, AC-1B-04, AC-1C-06 | fixed-clock与 loopback draft-isolation vectors | NOT_STARTED |
| FR-005 routes | BUILD §3–4 | T-001/T-004 | AC-1A-05, AC-1B-05 | route/path/conflict tests | NOT_STARTED |
| FR-006 Markdown | CONTENT_CONFIG §6, BUILD §5.1, SECURITY §3 | T-001/T-004/T-009/T-011 | AC-1A-02/03, AC-1B-05, AC-2B-02, AC-2C-09 | sanitizer+mXSS、media manifest与 deploy closure corpus | NOT_STARTED |
| FR-007 theme | THEME_API | T-003 | AC-1B-06/10 | Node/Worker bundle、golden DOM/feed | NOT_STARTED |
| FR-008 static build | BUILD | T-004/T-005 | AC-1B-07/08/10 | determinism/recovery/feed E2E | NOT_STARTED |
| FR-009 dev/preview | CLI §4.5–4.6, BUILD §10 | T-006 | AC-1C-01..06 | subprocess/watch/path/draft-isolation tests | NOT_STARTED |
| FR-010 D1 projection | DATABASE | T-007/T-009 | AC-2A-01..04, AC-2B-15 | local migration/query/codec/snapshot/time matrix | NOT_STARTED |
| FR-011 dynamic render | THEME_API, BUILD §7.2–7.3, CLOUDFLARE §8–9 | T-008 | AC-2A-05..09, AC-NFR-14 | immutable candidate build/metadata-only Worker route/cross-runtime | NOT_STARTED |
| FR-012 update API | HTTP_API, DATABASE publish protocol | T-009 | AC-2B-01..09, AC-2B-15 | auth/CAS/fault injection/admin snapshot | NOT_STARTED |
| FR-013 publish CLI | CLI §4.9–4.10 | T-010 | AC-2B-10..14 | CLI/API/local Worker E2E | NOT_STARTED |
| FR-014 deployment | CLOUDFLARE §3–7 | T-011/T-013 | AC-2C-01..12, AC-3-06 | dry-run/first-deploy/immutable snapshot/fenced closure/non-activating upload→exact UUID→activation/request-result journal/recover+repair+abort+rollback/secret-file + authorized staging | NOT_STARTED |
| FR-015 doctor | CLI §4.7 | T-005/T-011 | AC-1B-09, AC-2C-02 | local/remote check matrix | NOT_STARTED |
| NFR-001 performance/cache | TESTING §11, CLOUDFLARE §9 | T-008/T-010/T-012/T-013 | AC-NFR-01..03, AC-NFR-14 | benchmark/summary memory/local cache/staging | NOT_STARTED |
| NFR-002 security | SECURITY | all, gate T-012 | AC-NFR-04..08 | security/secret/path/API suites | NOT_STARTED |
| NFR-003 compatibility | VERSIONING §6 | T-012 | AC-NFR-09 | Node/OS/Worker matrix | NOT_STARTED |
| NFR-004 maintainability | DEVELOPMENT, TESTING §10 | all | AC-NFR-10..12 | lint/type/coverage/ADR | NOT_STARTED |
| NFR-005 accessibility | THEME_API §5, TESTING §11 | T-003/T-012 | AC-NFR-13 | axe + manual keyboard review | NOT_STARTED |

## 证据记录规则

实现合入后将“主要证据”扩展为具体 test path、命令、结果文件和 verified SHA。不能只写“覆盖率通过”。Cloudflare local 与 staging 必须分别记录；只有产品负责人可以把已验证需求标成 `ACCEPTED`。
