# Mallok D1 数据库契约

- 状态：Accepted for MVP
- 版本：0.1
- 适用阶段：Phase 2A–3

本文是 Mallok Cloudflare target 的 D1 schema、发布投影、row codec、查询、并发控制和幂等语义的唯一字段级权威契约；`ARCHITECTURE.md` 只定义端口和数据流，不重复 DDL。

本文使用 [配置与内容契约](CONTENT_CONFIG.md) 中已经规范化的 `ContentEntry`，HTTP header、状态码和 JSON wire format 见 [HTTP API 契约](HTTP_API.md)。

## 1. 边界与不变量

1. Markdown/Git 是作者源，D1 是线上发布投影，不是第二个可直接编辑的主库。
2. 一个 document 由 frontmatter 中不可变的 lowercase canonical RFC 9562 UUID v4 `id` 标识；slug 不是身份。
3. revision 不可变。更新只能创建新 revision 或重新指向已有的相同 artifact，不能 `UPDATE` 历史 revision。
4. published pointer 决定当前公开 revision；删除 pointer 即 unpublish，不删除 document、revision 或 tags。
5. 请求路径只解码已编译 revision 并渲染主题，不重新解析 Markdown。
6. `document.version` 是 CAS generation；每次有效 pointer/slug 状态变化恰好加一。它不是 revision number。
7. `revision_number` 只在创建新 artifact 时按 document 单调增加；重新使用历史 artifact 和 unpublish 不创建 revision。
8. 作者字段 `publishedAt` 与系统发布动作时间不是同一个概念：
   - `document_revisions.content_published_at` 是作者时间，允许 `NULL`，用于公开可见性和排序；
   - `published_documents.activated_at` 是 pointer 最后切换时间，不能为空，只用于审计和诊断。
9. 当前公开 slug 在 `published_documents` 上唯一。unpublish 后 slug 立即释放；原 document 再发布同一 slug 时仍需重新通过唯一性检查。
10. 所有**内容与审计时间**由应用生成并规范化为 `YYYY-MM-DDTHH:mm:ss.sssZ`；SQL 不读取 ambient current time。唯一例外是 deployment fence：acquire、renew 与 mutation trigger 都使用同一 D1 provider clock 的 `unixepoch()` seconds，不能混用 deploy 主机与 Worker 时钟。

## 2. 固定版本 tuple

MVP v1 只接受下面的完整 tuple：

| 维度 | 值 |
| --- | --- |
| D1 schema version | `1` |
| persisted artifact/row codec format version | `1` |
| compiler version | `"1"` |
| content schema version | `"1"` |
| compile profile id | `"mallok-default-v1"` |
| compile options canonical JSON | `{"allowRawHtml":false,"gfm":true,"sanitizeSchemaId":"mallok-default-v1"}` |

`compile_profile_id` 是固定 compile options 的可读标识，不得形成一个未进入 `artifactHash` 的独立行为维度。任何会改变输出的规则必须先反映到 compiler version、content schema version 或 compile options，再计算新的 artifact hash。

MVP 只有一个持久化格式版本轴：`artifact_format_version` 同时标识 immutable artifact envelope 与 D1 row codec 格式，不再维护一个未落库的第二个 `row_codec_version`。运行时遇到不支持的 tuple 必须返回 `PUBLISHED_REVISION_INCOMPATIBLE`，不得猜测兼容、强制类型转换或在公开请求中重新编译。

### 2.1 D1 物理预算

MVP 冻结以下 Cloudflare target 限制：

| 限制 | 值 |
| --- | --- |
| 规范化 source Markdown | 262,144 UTF-8 bytes |
| 编译后 body HTML | 1,048,576 UTF-8 bytes |
| 单条 revision payload | 1,500,000 bytes |
| 单次公开 summary result | 2,097,152 bytes（2 MiB） |
| 单数据库 Mallok revision payload ledger | 268,435,456 bytes（256 MiB） |

`payload_bytes` 是 `document_revisions` 所有 TEXT 字段 UTF-8 bytes 的总和，由应用在进入 batch 前计算、由 SQL `CHECK` 独立重算、由 row codec 读取时再次重算。它不等于 SQLite 页面占用，因此 256 MiB ledger 刻意低于 D1 Free 的 500 MB 数据库上限，为表、索引、幂等记录和页面开销留出空间；这不是对免费套餐永久不超额的保证，doctor 仍须报告 provider 实际 size。

超出单 source/body/row 上限返回 `CONTENT_DYNAMIC_SIZE_EXCEEDED`（HTTP 422）；新 revision 会使 ledger 超过 256 MiB 时返回 `D1_STORAGE_BUDGET_EXCEEDED`（HTTP 507）。两者都必须在 pointer/version/idempotency 写入前失败。static target 继续使用 `CONTENT_CONFIG.md` 的 1 MiB source 上限。

MVP 不自动删除历史 revision，所以频繁更新最终会消耗 ledger；revision export/GC 需要新的保留策略 ADR，不能由 publish 隐式清理。

## 3. Migration 与完整 DDL

首个 migration 文件固定为 `packages/cloudflare/migrations/0001_initial.sql`。Wrangler migration 记录与 `mallok_state.database_schema_version` 必须同时显示版本 `1`；任一缺失或不一致均视为 `DATABASE_SCHEMA_INCOMPATIBLE`。

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE mallok_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  database_schema_version INTEGER NOT NULL CHECK (database_schema_version >= 1),
  projection_version INTEGER NOT NULL CHECK (projection_version >= 0),
  revision_payload_bytes INTEGER NOT NULL
    CHECK (revision_payload_bytes BETWEEN 0 AND 268435456),
  updated_at TEXT NOT NULL
);

INSERT INTO mallok_state (
  singleton,
  database_schema_version,
  projection_version,
  revision_payload_bytes,
  updated_at
) VALUES (1, 1, 0, 0, '1970-01-01T00:00:00.000Z');

CREATE TRIGGER trg_mallok_state_no_delete
BEFORE DELETE ON mallok_state
BEGIN
  SELECT RAISE(ABORT, 'mallok_state_required');
END;

CREATE TABLE documents (
  id TEXT PRIMARY KEY COLLATE BINARY,
  type TEXT NOT NULL DEFAULT 'article' CHECK (type = 'article'),
  version INTEGER NOT NULL CHECK (version >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (id, version)
);

CREATE TABLE document_revisions (
  id TEXT PRIMARY KEY COLLATE BINARY,
  document_id TEXT NOT NULL COLLATE BINARY,
  revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
  artifact_format_version INTEGER NOT NULL CHECK (artifact_format_version = 1),

  slug TEXT NOT NULL COLLATE BINARY,
  title TEXT NOT NULL,
  description TEXT,
  content_published_at TEXT,
  source_updated_at TEXT,
  tags_json TEXT NOT NULL
    CHECK (json_valid(tags_json) = 1 AND json_type(tags_json) = 'array'),
  template TEXT NOT NULL COLLATE BINARY,
  data_json TEXT NOT NULL
    CHECK (json_valid(data_json) = 1 AND json_type(data_json) = 'object'),
  asset_refs_json TEXT NOT NULL
    CHECK (json_valid(asset_refs_json) = 1 AND json_type(asset_refs_json) = 'array'),

  source_markdown TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_html_hash TEXT NOT NULL CHECK (length(body_html_hash) = 64),
  source_hash TEXT NOT NULL CHECK (length(source_hash) = 64),
  artifact_hash TEXT NOT NULL CHECK (length(artifact_hash) = 64),
  compiler_version TEXT NOT NULL COLLATE BINARY CHECK (compiler_version = '1'),
  schema_version TEXT NOT NULL COLLATE BINARY CHECK (schema_version = '1'),
  compile_profile_id TEXT NOT NULL COLLATE BINARY CHECK (compile_profile_id = 'mallok-default-v1'),
  compile_options_json TEXT NOT NULL
    CHECK (
      json_valid(compile_options_json) = 1
      AND json_type(compile_options_json) = 'object'
      AND compile_options_json = '{"allowRawHtml":false,"gfm":true,"sanitizeSchemaId":"mallok-default-v1"}'
    ),
  payload_bytes INTEGER NOT NULL CHECK (
    payload_bytes BETWEEN 1 AND 1500000
    AND payload_bytes =
      length(CAST(id AS BLOB))
      + length(CAST(document_id AS BLOB))
      + length(CAST(slug AS BLOB))
      + length(CAST(title AS BLOB))
      + length(CAST(COALESCE(description, '') AS BLOB))
      + length(CAST(COALESCE(content_published_at, '') AS BLOB))
      + length(CAST(COALESCE(source_updated_at, '') AS BLOB))
      + length(CAST(tags_json AS BLOB))
      + length(CAST(template AS BLOB))
      + length(CAST(data_json AS BLOB))
      + length(CAST(asset_refs_json AS BLOB))
      + length(CAST(source_markdown AS BLOB))
      + length(CAST(body_html AS BLOB))
      + length(CAST(body_html_hash AS BLOB))
      + length(CAST(source_hash AS BLOB))
      + length(CAST(artifact_hash AS BLOB))
      + length(CAST(compiler_version AS BLOB))
      + length(CAST(schema_version AS BLOB))
      + length(CAST(compile_profile_id AS BLOB))
      + length(CAST(compile_options_json AS BLOB))
      + length(CAST(created_at AS BLOB))
  ),
  created_at TEXT NOT NULL,

  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  UNIQUE (document_id, revision_number),
  UNIQUE (document_id, artifact_hash),
  UNIQUE (document_id, id, slug)
);

CREATE TABLE revision_tags (
  revision_id TEXT NOT NULL COLLATE BINARY,
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 19),
  tag TEXT NOT NULL COLLATE BINARY,
  PRIMARY KEY (revision_id, ordinal),
  UNIQUE (revision_id, tag),
  FOREIGN KEY (revision_id) REFERENCES document_revisions(id) ON DELETE CASCADE
);

CREATE INDEX idx_revision_tags_tag
  ON revision_tags(tag, revision_id);

CREATE TABLE published_documents (
  document_id TEXT PRIMARY KEY COLLATE BINARY,
  revision_id TEXT NOT NULL UNIQUE COLLATE BINARY,
  slug TEXT NOT NULL UNIQUE COLLATE BINARY,
  activated_at TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (document_id, revision_id, slug)
    REFERENCES document_revisions(document_id, id, slug)
);

CREATE INDEX idx_revisions_public_order
  ON document_revisions(content_published_at DESC, slug ASC, document_id ASC);

CREATE TRIGGER trg_revision_payload_budget
BEFORE INSERT ON document_revisions
WHEN COALESCE((
  SELECT revision_payload_bytes + NEW.payload_bytes
  FROM mallok_state
  WHERE singleton = 1
), 268435457) > 268435456
BEGIN
  SELECT RAISE(ABORT, 'mallok_revision_payload_budget');
END;

CREATE TRIGGER trg_revision_payload_ledger
AFTER INSERT ON document_revisions
BEGIN
  UPDATE mallok_state
  SET revision_payload_bytes = revision_payload_bytes + NEW.payload_bytes,
      updated_at = NEW.created_at
  WHERE singleton = 1;
END;

CREATE TRIGGER trg_published_documents_limit
BEFORE INSERT ON published_documents
WHEN (SELECT COUNT(*) FROM published_documents) >= 10000
BEGIN
  SELECT RAISE(ABORT, 'mallok_published_document_limit');
END;

CREATE TABLE idempotency_keys (
  key_hash TEXT PRIMARY KEY COLLATE BINARY CHECK (length(key_hash) = 64),
  operation TEXT NOT NULL CHECK (operation IN ('publish', 'unpublish')),
  document_id TEXT NOT NULL COLLATE BINARY,
  request_hash TEXT NOT NULL COLLATE BINARY CHECK (length(request_hash) = 64),
  response_status INTEGER NOT NULL CHECK (response_status BETWEEN 200 AND 299),
  response_json TEXT NOT NULL
    CHECK (json_valid(response_json) = 1 AND json_type(response_json) = 'object'),
  response_etag TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX idx_idempotency_keys_expiry
  ON idempotency_keys(expires_at);

-- A renewable preflight lease plus non-expiring external barrier closes the
-- asset-closure TOCTOU window, including an indeterminate provider outcome.
CREATE TABLE deployment_locks (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  lock_id TEXT NOT NULL UNIQUE COLLATE BINARY,
  purpose TEXT NOT NULL
    CHECK (purpose IN ('bootstrap', 'deploy', 'rollback')),
  phase TEXT NOT NULL
    CHECK (phase IN ('bootstrap', 'preflight', 'external', 'releasing')),
  initial_deploy INTEGER NOT NULL CHECK (initial_deploy IN (0, 1)),
  external_stage TEXT NOT NULL
    CHECK (external_stage IN (
      'none',
      'ready',
      'migration_started',
      'migration_complete',
      'version_upload_started',
      'version_ready',
      'activation_started',
      'activation_complete'
    )),
  target_asset_manifest_hash TEXT COLLATE BINARY,
  target_candidate_input_hash TEXT COLLATE BINARY,
  target_candidate_inventory_hash TEXT COLLATE BINARY,
  target_worker_bundle_hash TEXT COLLATE BINARY,
  baseline_worker_version_id TEXT COLLATE BINARY,
  target_worker_version_id TEXT COLLATE BINARY,
  target_deployment_id TEXT COLLATE BINARY,
  version_upload_attempt_id TEXT COLLATE BINARY,
  activation_attempt_id TEXT COLLATE BINARY,
  acquired_at_epoch INTEGER,
  renewed_at_epoch INTEGER,
  expires_at_epoch INTEGER,
  CHECK (
    (
      purpose = 'bootstrap'
      AND phase = 'bootstrap'
      AND lock_id = 'bootstrap-v1'
      AND initial_deploy = 1
      AND external_stage = 'none'
      AND target_asset_manifest_hash IS NULL
      AND target_candidate_input_hash IS NULL
      AND target_candidate_inventory_hash IS NULL
      AND target_worker_bundle_hash IS NULL
      AND baseline_worker_version_id IS NULL
      AND target_worker_version_id IS NULL
      AND target_deployment_id IS NULL
      AND version_upload_attempt_id IS NULL
      AND activation_attempt_id IS NULL
      AND acquired_at_epoch IS NULL
      AND renewed_at_epoch IS NULL
      AND expires_at_epoch IS NULL
    )
    OR
    (
      purpose IN ('deploy', 'rollback')
      AND phase IN ('preflight', 'external', 'releasing')
      AND length(lock_id) = 36
      AND substr(lock_id, 9, 1) = '-'
      AND substr(lock_id, 14, 1) = '-'
      AND substr(lock_id, 15, 1) = '4'
      AND substr(lock_id, 19, 1) = '-'
      AND substr(lock_id, 20, 1) GLOB '[89ab]'
      AND substr(lock_id, 24, 1) = '-'
      AND length(replace(lock_id, '-', '')) = 32
      AND replace(lock_id, '-', '') NOT GLOB '*[^0-9a-f]*'
      AND typeof(acquired_at_epoch) = 'integer'
      AND typeof(renewed_at_epoch) = 'integer'
      AND typeof(expires_at_epoch) = 'integer'
      AND renewed_at_epoch >= acquired_at_epoch
      AND expires_at_epoch = renewed_at_epoch + 1800
      AND (
        (phase = 'preflight' AND external_stage = 'none')
        OR (
          phase IN ('external', 'releasing')
          AND external_stage <> 'none'
        )
      )
      AND (
        (
          initial_deploy = 1
          AND purpose = 'deploy'
          AND baseline_worker_version_id IS NULL
        )
        OR (
          initial_deploy = 0
          AND baseline_worker_version_id IS NOT NULL
        )
      )
    )
  ),
  CHECK (
    target_asset_manifest_hash IS NULL
    OR (
      length(target_asset_manifest_hash) = 64
      AND target_asset_manifest_hash NOT GLOB '*[^0-9a-f]*'
    )
  ),
  CHECK (
    target_candidate_input_hash IS NULL
    OR (
      length(target_candidate_input_hash) = 64
      AND target_candidate_input_hash NOT GLOB '*[^0-9a-f]*'
    )
  ),
  CHECK (
    target_worker_bundle_hash IS NULL
    OR (
      length(target_worker_bundle_hash) = 64
      AND target_worker_bundle_hash NOT GLOB '*[^0-9a-f]*'
    )
  ),
  CHECK (
    target_candidate_inventory_hash IS NULL
    OR (
      length(target_candidate_inventory_hash) = 64
      AND target_candidate_inventory_hash NOT GLOB '*[^0-9a-f]*'
    )
  ),
  CHECK (
    phase NOT IN ('preflight', 'external', 'releasing')
    OR (
      target_asset_manifest_hash IS NOT NULL
      AND target_candidate_input_hash IS NOT NULL
      AND target_candidate_inventory_hash IS NOT NULL
      AND target_worker_bundle_hash IS NOT NULL
    )
  ),
  CHECK (
    (
      purpose = 'deploy'
      AND (
        (
          external_stage IN ('version_ready', 'activation_started', 'activation_complete')
          AND target_worker_version_id IS NOT NULL
        )
        OR (
          external_stage NOT IN ('version_ready', 'activation_started', 'activation_complete')
          AND target_worker_version_id IS NULL
        )
      )
    )
    OR (purpose = 'rollback' AND target_worker_version_id IS NOT NULL)
    OR (purpose = 'bootstrap' AND target_worker_version_id IS NULL)
  ),
  CHECK (
    target_worker_version_id IS NULL
    OR baseline_worker_version_id IS NULL
    OR target_worker_version_id <> baseline_worker_version_id
  ),
  CHECK (
    baseline_worker_version_id IS NULL
    OR (
      length(baseline_worker_version_id) = 36
      AND substr(baseline_worker_version_id, 9, 1) = '-'
      AND substr(baseline_worker_version_id, 14, 1) = '-'
      AND substr(baseline_worker_version_id, 19, 1) = '-'
      AND substr(baseline_worker_version_id, 24, 1) = '-'
      AND length(replace(baseline_worker_version_id, '-', '')) = 32
      AND replace(baseline_worker_version_id, '-', '') NOT GLOB '*[^0-9a-f]*'
    )
  ),
  CHECK (
    target_worker_version_id IS NULL
    OR (
      length(target_worker_version_id) = 36
      AND substr(target_worker_version_id, 9, 1) = '-'
      AND substr(target_worker_version_id, 14, 1) = '-'
      AND substr(target_worker_version_id, 19, 1) = '-'
      AND substr(target_worker_version_id, 24, 1) = '-'
      AND length(replace(target_worker_version_id, '-', '')) = 32
      AND replace(target_worker_version_id, '-', '') NOT GLOB '*[^0-9a-f]*'
    )
  ),
  CHECK (
    (
      external_stage = 'activation_complete'
      AND target_deployment_id IS NOT NULL
      AND length(target_deployment_id) = 36
      AND substr(target_deployment_id, 9, 1) = '-'
      AND substr(target_deployment_id, 14, 1) = '-'
      AND substr(target_deployment_id, 19, 1) = '-'
      AND substr(target_deployment_id, 24, 1) = '-'
      AND length(replace(target_deployment_id, '-', '')) = 32
      AND replace(target_deployment_id, '-', '') NOT GLOB '*[^0-9a-f]*'
    )
    OR (
      external_stage <> 'activation_complete'
      AND target_deployment_id IS NULL
    )
  ),
  CHECK (
    (
      purpose = 'deploy'
      AND external_stage IN (
        'version_upload_started',
        'version_ready',
        'activation_started',
        'activation_complete'
      )
      AND version_upload_attempt_id IS NOT NULL
      AND length(version_upload_attempt_id) = 36
      AND substr(version_upload_attempt_id, 9, 1) = '-'
      AND substr(version_upload_attempt_id, 14, 1) = '-'
      AND substr(version_upload_attempt_id, 15, 1) = '4'
      AND substr(version_upload_attempt_id, 19, 1) = '-'
      AND substr(version_upload_attempt_id, 20, 1) GLOB '[89ab]'
      AND substr(version_upload_attempt_id, 24, 1) = '-'
      AND length(replace(version_upload_attempt_id, '-', '')) = 32
      AND replace(version_upload_attempt_id, '-', '') NOT GLOB '*[^0-9a-f]*'
    )
    OR (
      (
        purpose <> 'deploy'
        OR external_stage NOT IN (
          'version_upload_started',
          'version_ready',
          'activation_started',
          'activation_complete'
        )
      )
      AND version_upload_attempt_id IS NULL
    )
  ),
  CHECK (
    (
      external_stage IN ('activation_started', 'activation_complete')
      AND activation_attempt_id IS NOT NULL
      AND length(activation_attempt_id) = 36
      AND substr(activation_attempt_id, 9, 1) = '-'
      AND substr(activation_attempt_id, 14, 1) = '-'
      AND substr(activation_attempt_id, 15, 1) = '4'
      AND substr(activation_attempt_id, 19, 1) = '-'
      AND substr(activation_attempt_id, 20, 1) GLOB '[89ab]'
      AND substr(activation_attempt_id, 24, 1) = '-'
      AND length(replace(activation_attempt_id, '-', '')) = 32
      AND replace(activation_attempt_id, '-', '') NOT GLOB '*[^0-9a-f]*'
    )
    OR (
      external_stage NOT IN ('activation_started', 'activation_complete')
      AND activation_attempt_id IS NULL
    )
  ),
  CHECK (
    version_upload_attempt_id IS NULL
    OR activation_attempt_id IS NULL
    OR version_upload_attempt_id <> activation_attempt_id
  )
);

-- 0001 atomically leaves a barrier. The first Worker may not accept writes
-- until a deploy claims and resolves it.
INSERT INTO deployment_locks (
  singleton,
  lock_id,
  purpose,
  phase,
  initial_deploy,
  external_stage
) VALUES (1, 'bootstrap-v1', 'bootstrap', 'bootstrap', 1, 'none');

-- Internal, normally empty. It turns a CAS mismatch into a statement failure,
-- or an active deployment fence into a statement failure, which causes the
-- entire D1 batch to roll back.
CREATE TABLE mutation_guards (
  operation_id TEXT PRIMARY KEY COLLATE BINARY,
  document_id TEXT NOT NULL COLLATE BINARY,
  observed_version INTEGER NOT NULL,
  FOREIGN KEY (document_id, observed_version)
    REFERENCES documents(id, version)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

CREATE TRIGGER trg_mutation_guard_deployment_lock
BEFORE INSERT ON mutation_guards
WHEN EXISTS (
  SELECT 1
  FROM deployment_locks
  WHERE phase IN ('bootstrap', 'external', 'releasing')
     OR (
       phase = 'preflight'
       AND expires_at_epoch > unixepoch()
     )
)
BEGIN
  SELECT RAISE(ABORT, 'mallok_deployment_in_progress');
END;

CREATE TRIGGER trg_deployment_lock_requires_resolution
BEFORE DELETE ON deployment_locks
WHEN OLD.phase IN ('bootstrap', 'external')
BEGIN
  SELECT RAISE(ABORT, 'mallok_deployment_resolution_required');
END;
```

`documents.version = 0` 只允许作为首次 publish 的同一原子 batch 内部状态；成功提交的首次 publish 必须以 version `1` 结束。`mutation_guards` 在每个成功 batch 的最后删除，因此正常稳态必须为空。

`deployment_locks` 是 deployment fence，不是长期环境状态。`preflight` 是可续租 lease，`external`/`releasing` 是不能靠 TTL 自动放行的 hard barrier；否则已经发出的远端操作在客户端失联后仍可能迟到完成，重新打开 stale-closure 窗口。为避免 deploy 主机与 Worker 时钟偏差，三个 `*_epoch` 以及 trigger 都只用 D1 `unixepoch()`；调用者时钟不得参与判断。`initial_deploy` 是首次部署链路的 durable 标记，不得根据本地 state 临时推断；`external_stage` 是远端副作用 journal，不是展示字段。`version_upload_attempt_id` 与 `activation_attempt_id` 都是一次逻辑意图的 UUID v4，若两者同时存在必须不同：同一意图恢复重传时保持不变，只有同锁 retarget 新 candidate/target 才生成新 attempt。每次实际 provider 调用另有唯一 `providerCallId`，只记录在下述本地 attempt journal；不得把物理调用 id 冒充逻辑 attempt。

普通 acquire 只能原子插入空表，或以 conditional upsert 覆盖 `phase='preflight' AND expires_at_epoch <= unixepoch()` 的过期 lease；永远不能覆盖 bootstrap/external/releasing。已部署环境的 acquire 必须写入当前 active `baseline_worker_version_id` 且 `initial_deploy=0`。把 `bootstrap-v1` claim 为第一次 deploy/preflight 时写 `initial_deploy=1`、baseline `NULL`，并必须在同一 conditional statement 证明 documents/revisions/pointers 都为空；若该 initial preflight 在进入 external 前过期，后续 takeover 只可在再次证明数据库内容为空、没有 active Worker/current deployment 且旧 row 的 `initial_deploy=1` 后替换，并继续保留该标记。preflight acquire/renew 把三个 epoch 都由 D1 表达式写入，`expires_at_epoch = unixepoch()+1800`，每 60 秒续租，进入 external 前剩余至少 600 秒；过期后同一旧 id 不能“复活”。`preflight -> external` 也必须带精确 lock id、未过期 phase 谓词并用 `RETURNING` 证明成功。

preflight 可按精确 lock id 直接删除；external/bootstrap 受 trigger 保护，只能在确认成功 activation 的 terminal outcome，或满足第 9.1 节 normal abort-to-baseline 全部证据后，于同一个 D1 batch 先按精确 id 转为 `releasing`，再删除。未激活 upload 的 outcome unknown 本身不会阻止有 baseline 的显式 abort，但任何 activation request 缺 terminal result 都会阻止 abort。没有返回本次 id 就视为失败，不能 SELECT 后无条件覆盖/删除。`external` 即使 `expires_at_epoch` 已过仍继续阻止 publish，直到显式 recovery；这是安全性优先于发布可用性的刻意取舍。

进入 external 后的唯一顺序是 `ready -> migration_started -> migration_complete -> version_upload_started -> version_ready -> activation_started -> activation_complete`。没有待迁移项时仍显式写 `migration_complete`。deploy 的 `version_upload_started` 先持久化逻辑 `version_upload_attempt_id`，然后只调用**不激活流量**的 Worker version upload；返回或恢复查询得到的 version id 必须是 canonical lowercase UUID，并在 `version_ready` 的同一 CAS 中写入 `target_worker_version_id`。同一逻辑 upload 可安全重传，且每次物理调用使用新的 `providerCallId`；若重传形成多个 tag/message/四 hash 完全相同的未激活 version，选择 lowercase UUID 字节序最小者作为 target，其余只记入 journal，不自动删除。rollback 不上传版本：它在验证已有 version evidence 后直接把显式 target 写入 `version_ready`，`version_upload_attempt_id` 保持 `NULL`。

只有 `version_ready` 已持久化 exact target 后才可创建 `activation_attempt_id` 并 CAS 到 `activation_started`，再显式把该 UUID 激活为 100% 流量；不得使用“上传并立即激活”的组合命令。恢复可以用同一逻辑 activation attempt 重传同一个 exact target，每次物理调用仍生成新的 `providerCallId`。provider 当前 active 只能是持久化 baseline 或 target；出现第三个 version 立即以 drift 阻断。只有核实当前 active target、exact activation message 与 canonical lowercase deployment UUID 后，才能在一个 CAS 中写 `activation_complete` 和 `target_deployment_id`。因此 journal-before-call 与进程启动之间的崩溃不再要求 provider 给出 never-started 否定证明：upload 的迟到成功不会接流量，activation 的重复调用仍指向同一已冻结 target。

每次实际 provider 调用使用一对不可变记录：`.mallok/deployments/<lock-id>/attempts/<6位sequence>-<provider-call-id>.request.json` 与同 basename 的 `.result.json`，规范字节与字段由 `docs/schemas/deployment-attempt.schema.json` 定义；`operation` 只能是 `version-upload|version-observation|activation`，`purpose` 只能是 `deploy|rollback`，内容同时携带 D1 logical attempt id。sequence 从 `000001` 单调递增，在 per-lock filesystem mutex 内分配且目录内不得重复；`providerCallId` 是该物理调用独有的 UUID v4。request 必须在 provider call 前通过同目录临时文件、fsync、原子 rename durable 落盘；result 只有观察到 terminal provider 事实后才能以 exclusive create 写一次，永不覆盖。缺 result 表示该物理调用 outcome unknown，但不阻止在同一 logical attempt 下以新 sequence/providerCallId 重传 effect-idempotent upload、version observation 或 exact-target activation。runtime 必须把同一 lock 的全部记录作为一个聚合集合校验：同一 version-upload attempt 下的 upload/observation 必须逐字节保持 purpose、四 hash、tag 与 version message 不变；同一 activation attempt 的全部 request 必须逐字节保持 purpose、四 hash、tag、activation message 与 target version 不变。任一字段漂移都在 provider call 前 fail closed；合法 retarget 必须经 D1 CAS 创建新的 logical attempt id。`version-observation` 必须绑定同一 logical version-upload attempt并使用相同`versionMessage`；它分页读取至provider列表穷尽，成功 result将所有exact tag/message/四hash匹配的canonical version UUID去重、升序写入`observedMatchingVersionIds`，非空时`providerVersionId`必须存在并等于首个最小UUID，空数组时必须省略它。匹配项超过schema上限100时不得截断或选择；写terminal failed result `VERSION_OBSERVATION_TOO_MANY_MATCHES`，对外以`DEPLOY_RECOVERY_REQUIRED`保留barrier。只有这份完整observation success result才能支持`version_ready`的target选择。request缺失/不合法时不得调用，孤立result、重复sequence/call id、request/result字段不一致全部fail closed。D1 stage/attempt是远端恢复权威，这些不可变文件是每次调用与terminal观察的证据，不能事后改写成“看起来已完成”。

未来 migration 只能前向编号，不提供自动 down migration。MVP runtime 只支持 D1 schema version `1`；deploy 和 health 必须在接流量前验证准确版本。不得由 Worker 请求路径隐式执行 migration。

## 4. 字段权威关系

### 4.1 Document

`documents` 只保存稳定身份和 CAS generation，不保存 slug 或当前 revision。是否公开完全由 `published_documents` 决定。

### 4.2 Revision

`document_revisions` 的规范化字段是恢复 `CompiledEntry` 的唯一事实源。早期架构示例中的 `frontmatter_json` 不再使用，避免 JSON blob 与显式列形成双事实源。

字段映射如下：

| `CompiledEntry` 字段 | D1 来源 |
| --- | --- |
| `id` | `document_id` |
| `type` | 固定 `"article"` |
| `slug` | `slug` |
| `title` | `title` |
| `description` | `description`，`NULL` 表示缺失 |
| `status` | 固定 `"published"` |
| `publishedAt` | `content_published_at`，`NULL` 表示缺失 |
| `updatedAt` | `source_updated_at`，`NULL` 表示缺失 |
| `tags` | `tags_json`；`revision_tags` 是查询投影 |
| `template` | `template` |
| `data` | `data_json` |
| `assetReferences` | `asset_refs_json`；只保存站内 `/assets/**` 的 `{url}` |
| `sourceMarkdown` | `source_markdown` |
| `bodyHtml` | 受控恢复后的 `body_html` |
| `sourceHash` | `source_hash` |
| `artifactHash` | `artifact_hash` |
| `compilerVersion` | `compiler_version` |

`body_html_hash` 是 `body_html` UTF-8 字节的 SHA-256 小写 hex，只用于发现损坏或不一致；它不能防御一个同时拥有 D1 写权限并能修改 HTML 与 hash 的主体。MVP 的权限边界仍是“只有 Mallok publish 服务写 D1”。

`asset_refs_json` 是 canonical JSON array：最多 100 项，按 `url` Unicode code unit 升序、URL 唯一；每项只有 `url`。绝对 HTTPS 外部图片不进入该数组。它由 `@mallok/core/media` 的成功校验结果产生，不能由客户端直接提交。MVP 的非指纹资源 URL 可在后续 deploy 更换 bytes，历史 revision 只声明 URL 存在性，不把 asset hash 纳入文章 artifact identity。

`payload_bytes` 必须等于本 row 所有 TEXT column（包括 ids、内容字段、`asset_refs_json`、source/body、hash、profile/options 和时间）的 UTF-8 byte 数总和。它是应用预算 ledger，不是数据库物理页面大小。应用提供的数字不是信任边界；上面的 SQL `CHECK` 必须独立按 BLOB byte length 验证，伪造较小值会让整个 batch 回滚。

### 4.3 Tags

`tags_json` 保存经 NFC、trim、去重后仍按作者首次出现顺序排列的完整数组。`revision_tags` 必须在创建 revision 的同一 batch 内由该数组生成：`ordinal` 从 `0` 连续递增，不允许空洞。

tag 查询为 `COLLATE BINARY` 的大小写敏感精确匹配。查询参数先执行与内容入口相同的 NFC + trim 和长度校验；MVP 不做大小写折叠、词干化或模糊搜索。

## 5. 受控 row codec

D1 adapter 只能通过 core 内部的 `decodePublishedRevisionV1` 恢复 `CompiledEntry`。该函数不得作为任意 `string -> SafeHtml` 构造器从包入口公开。

解码顺序固定如下：

1. 验证 `mallok_state.database_schema_version === 1`。
2. `SELECT` 使用显式列和 alias，不使用 `SELECT *`；验证每个 SQLite 原始值的 `typeof`。
3. 验证 document/revision UUID、slug、标题、可选描述、模板、hash 格式和 UTC 日期。
4. 解析 `tags_json`、`data_json`、`asset_refs_json`、`compile_options_json`；重新 canonical serialize，要求字节与数据库文本完全相同；同时验证 asset reference 数量、排序、唯一性与 URL。
5. 读取按 ordinal 排序的 `revision_tags`，要求与 `tags_json` 数量和值完全相同；summary query 必须在同一 statement 返回该投影，不能用 N+1 查询跳过验证。
6. 验证 `artifact_format_version` 同时等于受支持的 artifact envelope/row codec 格式 `1`，并验证其余完整版本 tuple 与第 2 节完全一致。
7. 从数据库字段重建规范化 `ContentEntry`，严格按 `ARCHITECTURE.md` 第 5 节公式重新计算 `sourceHash`，并与 `source_hash` 常量时间比较。
8. 从 `source_hash`、compiler version、schema version 和 compile options 严格按同一公式重新计算 `artifactHash`，并与 `artifact_hash` 比较。
9. 计算 `body_html` UTF-8 SHA-256，并与 `body_html_hash` 比较；同时验证 source ≤262,144 bytes、body ≤1,048,576 bytes。
10. 重算所有 TEXT column（包括 `asset_refs_json`）的 UTF-8 byte 总和，要求等于 `payload_bytes` 且不超过 1,500,000。
11. 仅在以上步骤全部成功后，由 core 私有 factory 将 `body_html` 恢复成 `SafeHtml`，返回深度冻结的 `PublishedArtifact`；主题只消费其中的 `CompiledEntry` 字段，部署审计消费 `assetReferences`。

任一失败均抛 `PUBLISHED_REVISION_INCOMPATIBLE`。公开文章读取映射为 `503`，不能伪装成 404；`doctor --remote --deep` 与 deploy preflight 可以在本地脱敏显示失败的 document/revision id 与稳定错误码，但不得回显正文或 HTML。同步 HTTP health 不扫描内容，也不返回这些 id。

## 6. 公开读取查询

所有参数都通过 D1 prepared statement 绑定。`asOf` 在进入 repository 前已规范化为 UTC ISO 字符串；其固定长度格式允许 TEXT 词法比较等同时间顺序。

### 6.1 按 slug 查询

```sql
SELECT
  r.document_id,
  r.id AS revision_id,
  r.revision_number,
  r.artifact_format_version,
  r.slug,
  r.title,
  r.description,
  r.content_published_at,
  r.source_updated_at,
  r.tags_json,
  r.template,
  r.data_json,
  r.asset_refs_json,
  r.source_markdown,
  r.body_html,
  r.body_html_hash,
  r.source_hash,
  r.artifact_hash,
  r.compiler_version,
  r.schema_version,
  r.compile_profile_id,
  r.compile_options_json,
  r.payload_bytes,
  p.activated_at
FROM published_documents AS p
JOIN document_revisions AS r
  ON r.document_id = p.document_id
 AND r.id = p.revision_id
WHERE p.slug = ?1 COLLATE BINARY
  AND (r.content_published_at IS NULL OR r.content_published_at <= ?2)
LIMIT 1;
```

pointer 存在但 `content_published_at > asOf` 时结果为空，与不存在和 unpublished 一样进入公开 404。

### 6.2 列表，无 tag

首页和 RSS 只能使用 metadata-only summary query。它不得选择 `source_markdown`、`body_html`、`data_json`、`template` 或 asset references：

```sql
WITH summaries AS (
  SELECT
    r.document_id,
    r.id AS revision_id,
    r.artifact_hash,
    r.slug,
    r.title,
    r.description,
    r.content_published_at,
    r.source_updated_at,
    r.tags_json,
    COALESCE((
      SELECT json_group_array(ordered_tags.tag)
      FROM (
        SELECT rt.tag
        FROM revision_tags AS rt
        WHERE rt.revision_id = r.id
        ORDER BY rt.ordinal ASC
      ) AS ordered_tags
    ), '[]') AS projected_tags_json
  FROM published_documents AS p
  JOIN document_revisions AS r
    ON r.document_id = p.document_id
   AND r.id = p.revision_id
  WHERE r.content_published_at IS NULL OR r.content_published_at <= ?1
)
SELECT
  document_id,
  revision_id,
  artifact_hash,
  slug,
  title,
  description,
  content_published_at,
  source_updated_at,
  tags_json,
  projected_tags_json,
  length(CAST(document_id AS BLOB))
    + length(CAST(revision_id AS BLOB))
    + length(CAST(artifact_hash AS BLOB))
    + length(CAST(slug AS BLOB))
    + length(CAST(title AS BLOB))
    + length(CAST(COALESCE(description, '') AS BLOB))
    + length(CAST(COALESCE(content_published_at, '') AS BLOB))
    + length(CAST(COALESCE(source_updated_at, '') AS BLOB))
    + length(CAST(tags_json AS BLOB))
    + length(CAST(projected_tags_json AS BLOB)) AS summary_bytes
FROM summaries
ORDER BY
  (content_published_at IS NULL) ASC,
  content_published_at DESC,
  slug ASC,
  document_id ASC
LIMIT ?2 OFFSET ?3;
```

### 6.3 列表，带 tag

带 tag 使用独立 SQL，不写 `:tag IS NULL OR ...`，避免破坏索引选择：

```sql
WITH summaries AS (
  SELECT
    r.document_id,
    r.id AS revision_id,
    r.artifact_hash,
    r.slug,
    r.title,
    r.description,
    r.content_published_at,
    r.source_updated_at,
    r.tags_json,
    COALESCE((
      SELECT json_group_array(ordered_tags.tag)
      FROM (
        SELECT rt.tag
        FROM revision_tags AS rt
        WHERE rt.revision_id = r.id
        ORDER BY rt.ordinal ASC
      ) AS ordered_tags
    ), '[]') AS projected_tags_json
  FROM revision_tags AS t
  JOIN document_revisions AS r ON r.id = t.revision_id
  JOIN published_documents AS p
    ON p.document_id = r.document_id
   AND p.revision_id = r.id
  WHERE t.tag = ?1 COLLATE BINARY
    AND (r.content_published_at IS NULL OR r.content_published_at <= ?2)
)
SELECT
  document_id,
  revision_id,
  artifact_hash,
  slug,
  title,
  description,
  content_published_at,
  source_updated_at,
  tags_json,
  projected_tags_json,
  length(CAST(document_id AS BLOB))
    + length(CAST(revision_id AS BLOB))
    + length(CAST(artifact_hash AS BLOB))
    + length(CAST(slug AS BLOB))
    + length(CAST(title AS BLOB))
    + length(CAST(COALESCE(description, '') AS BLOB))
    + length(CAST(COALESCE(content_published_at, '') AS BLOB))
    + length(CAST(COALESCE(source_updated_at, '') AS BLOB))
    + length(CAST(tags_json AS BLOB))
    + length(CAST(projected_tags_json AS BLOB)) AS summary_bytes
FROM summaries
ORDER BY
  (content_published_at IS NULL) ASC,
  content_published_at DESC,
  slug ASC,
  document_id ASC
LIMIT ?3 OFFSET ?4;
```

`limit` 默认 `20`、范围 `1..100`；`offset` 默认 `0`，必须是非负整数。adapter 严格验证 summary 字段，将 `projected_tags_json` 作为 canonical JSON 解析后要求与 `tags_json` **字节完全相同**；因此缺行、额外行、ordinal 空洞或顺序错误都会 fail closed，且没有 N+1 query。`summary_bytes` 同时计算这两个受控字符串，再累加整批；超过 2,097,152 bytes 时返回 `PUBLISHED_SUMMARY_TOO_LARGE`（公开边界为 no-store 503），不得继续分配主题 context。首页、RSS 和 sitemap 必须通过同一个可见性/排序算法与同一个固定 `asOf` 读取，不能各自实现另一套选择规则。

`projection_version` 只用于诊断和缓存 seed，不能单独作为集合 ETag：未来 `publishedAt` 会在没有数据库写入时改变可见集合。集合 ETag 必须基于实际有序可见 revision 集合及 renderer/theme build id，或直接基于最终响应字节计算。

### 6.4 Sitemap summary

sitemap 不可循环调用 `listPublished(limit, offset)`，因为多个 statement 之间没有跨请求 snapshot，且完整 `CompiledEntry` 会无意义读取正文。它必须在一个 D1 statement 中返回全部当前可见轻量行：

```sql
SELECT
  r.document_id,
  r.slug,
  r.content_published_at,
  r.source_updated_at
FROM published_documents AS p
JOIN document_revisions AS r
  ON r.document_id = p.document_id
 AND r.id = p.revision_id
WHERE r.content_published_at IS NULL OR r.content_published_at <= ?1
ORDER BY
  (r.content_published_at IS NULL) ASC,
  r.content_published_at DESC,
  r.slug ASC,
  r.document_id ASC
LIMIT 10001;
```

结果超过 10,000 是数据库不变量损坏，返回 503；正常结果映射为 `SitemapEntry`，不读取 source/body/tags/data。单 statement 提供该 sitemap 所需的一致结果集。

### 6.5 管理 document snapshot

`GET documents` 与 `GET document` 使用独立 `AdminDocumentRepository`，不得从公开 repository 拼装。每个响应 item 必须由一个 D1 statement 同时读取：`documents`、可选 current pointer/current revision，以及按 `revision_number DESC LIMIT 1` 得到的 latest revision；statement 不选择 source/body/data/tags/asset refs。list 在同一 statement 内应用 status filter、`updated_at DESC, id ASC`、`limit + 1` 和 offset；get 增加精确 document id 条件。这样 item 内的 version/current/latest 来自同一 SQLite statement snapshot，不允许 handler 发三次查询后拼出撕裂状态。

平台端口固定为：

```ts
export interface AdminDocumentRepository {
  listDocuments(query: AdminDocumentQuery): Promise<AdminDocumentPage>;
  findDocument(id: string): Promise<AdminDocumentView | null>;
}
```

`AdminDocumentQuery`、`AdminDocumentPage` 与 `AdminDocumentView` 的 wire 字段以 `HTTP_API.md`/OpenAPI 为准；repository 返回深度冻结领域值，不返回 D1 row、SQL 或正文。

## 7. Publish 状态转换

服务端先在数据库事务外完成纯校验、媒体清单检查和编译；事务内仍必须重新做 CAS，事务前读取不能作为并发授权依据。`draft: true` 不可 publish；未来 `publishedAt` 可以写入 pointer，但在对应 `asOf` 之前不可公开。

输入状态与结果固定如下：

| 数据库状态 | 合法前置条件 | artifact 状态 | 结果 | document version |
| --- | --- | --- | --- | --- |
| document 不存在 | `absent` | 必为新 artifact | 创建 document/revision/pointer | `0 -> 1` |
| document 存在 | 当前 version | 与当前 pointer 相同 | `unchanged`，不写 pointer | 不变 |
| document 存在 | 当前 version | 历史 revision 已存在 | 复用历史 revision 并切 pointer | `+1` |
| document 存在 | 当前 version | 新 artifact | 创建下一 revision 并切 pointer | `+1` |
| document 存在但 unpublished | 当前 version | 历史或新 artifact | 创建或复用 revision并创建 pointer | `+1` |
| 任意 | 缺失/过期前置条件 | 任意 | 整批不写入 | 不变 |

新 artifact 的 `revision_number` 在持有 CAS guard 后取该 document 的 `MAX(revision_number) + 1`；历史复用不增加。revision id 使用 Worker Web Crypto `crypto.randomUUID()` 生成的 lowercase canonical UUID v4。相同 artifact 对同一 document 由 `UNIQUE(document_id, artifact_hash)` 保证最多一行。

修改 slug 是同一 document 的新 artifact。pointer 切换与 slug 唯一约束位于同一 transaction；提交后旧 slug 立即 404。若新 slug 已被另一个公开 pointer 使用，整个 publish 返回 `CONTENT_DUPLICATE_SLUG`，没有 revision、version 或 pointer 的部分写入。

### 7.1 系统事件时间

所有 mutation 在进入 domain operation 前固定一个 canonical UTC `now`，同一 batch 内只使用该值：

- 首次 publish：`documents.created_at = documents.updated_at = document_revisions.created_at = published_documents.activated_at = mallok_state.updated_at = now`；
- 创建新 revision 并 publish：新 revision `created_at = now`，document `updated_at = now`，pointer `activated_at = now`，state `updated_at = now`；
- 复用历史 revision 的 republish/update：不改历史 revision 时间；document `updated_at = now`，pointer `activated_at = now`，state `updated_at = now`；
- unpublish 的有效状态变化：document `updated_at = now`，state `updated_at = now`，删除 pointer；
- current artifact no-op、already-unpublished no-op 和 idempotent replay：document/revision/pointer/state 的全部系统时间保持不变；
- `mallok_state.updated_at` 只在 `projection_version` 或 `revision_payload_bytes` 实际变化时更新。仅清理过期 idempotency key 不改它。

任何新 revision insert 后发生的 pointer slug 冲突、CAS 失败或 idempotency 冲突都必须使 revision、ledger 和上述时间一起回滚，不能留下“latest revision 已变化但 publish 失败”的部分状态。作者 `publishedAt/updatedAt` 不参与这些系统时间赋值。

## 8. Unpublish 状态转换

| 数据库状态 | 合法前置条件 | 结果 | document version |
| --- | --- | --- | --- |
| document 不存在 | 任意 | `DOCUMENT_NOT_FOUND` | 无 |
| 已 published | 当前 version | 删除 pointer，保留历史 | `+1` |
| 已 unpublished | 当前 version | `unchanged` | 不变 |
| document 存在 | 缺失/过期前置条件 | 整批不写入 | 不变 |

unpublish 提交后旧公开 slug 立即释放。MVP 没有删除 document 或清除 revision 历史的 HTTP 操作。

## 9. CAS 的 D1 实现

所有 publish/unpublish 使用一个 `D1Database.batch([...preparedStatements])`。不得手写 `BEGIN`/`COMMIT`，不得使用“先 SELECT、再无保护 UPDATE”，也不得在 batch 已提交后才根据 `meta.changes` 判断 CAS 是否成功。

规范流程：

1. 对首次 publish，在 batch 内 `INSERT OR IGNORE` version `0` 的 document。
2. 插入 `mutation_guards(operation_id, document_id, observed_version)`；字段值来自请求的 `expectedVersion`：
   - 首次 publish 的 `observed_version` 值为 `0`；
   - 已存在 document 使用管理 ETag 解出的准确 version。
3. version 不匹配时 composite foreign key 立即失败；D1 provider clock 判断存在 active deployment fence 时 trigger 立即失败。两者都使整个 batch 回滚。
4. 新 artifact 才插入 `document_revisions`、canonical `asset_refs_json` 和全部 `revision_tags`；应用先计算 source/body/row bytes，SQL CHECK 与 payload trigger 在插入时原子校验并增加 ledger；历史 artifact 读取并复用原 revision id，不重复计算 ledger。
5. 已 published document 使用受 CAS 保护的 `UPDATE published_documents`；unpublished/新 document 使用 `INSERT`，由 trigger 保证当前 pointer 总数不超过 10,000；unpublish 使用 `DELETE`。不得用会让 BEFORE INSERT trigger 错误阻止满额站点更新的通用 UPSERT。
6. 仅在 pointer/slug 状态实际变化时更新 `documents.version = version + 1`；`ON UPDATE CASCADE` 同步 guard 的 observed version。
7. 有效 pointer 变化时同时增加 `mallok_state.projection_version`；新 revision 增加 ledger；按第 7.1 节只在二者实际变化时设置 state `updated_at`，no-op 不改变。
8. 在同一 batch 写入完整 idempotency response。
9. 删除本 operation 的 mutation guard。

D1 batch 中任一 UNIQUE、FOREIGN KEY、CHECK 或 trigger abort 都必须使整批回滚。adapter 将 CAS guard/FK 失败映射为 `PRECONDITION_FAILED`，`mallok_deployment_in_progress` 精确映射为 `DEPLOYMENT_IN_PROGRESS`，pointer slug 唯一冲突映射为 `CONTENT_DUPLICATE_SLUG`，published limit trigger 映射为 `CONTENT_COLLECTION_TOO_LARGE`，payload budget trigger 映射为 `D1_STORAGE_BUDGET_EXCEEDED`；其他数据库约束异常是内部 `DATABASE_ERROR`，到 HTTP 边界必须映射为 500 `INTERNAL_ERROR`，不得直接暴露内部 code 或原始 SQL。

若启用 D1 read replication，管理 preflight、idempotency 读取、写后读取以及携带合法 `__mallok_rev` 的公开验证请求必须使用保证 first-primary 的 session。普通公开读取可以使用 replica，但同一个 HTTP 请求内的相关查询必须保持同一 session/bookmark。

### 9.1 Deploy/rollback fence

资产闭包检查与 Worker 切换之间存在真实并发窗口：旧 Worker 若还能 publish 一个引用候选 bundle 已删除 URL 的 pointer，单纯“检查后 deploy”会在上线瞬间产生断图。MVP 用同一 D1 中的单例 fence 关闭该窗口：

1. `0001_initial.sql` 原子留下 `bootstrap-v1` barrier，`initial_deploy=1`。全新 D1 即使 migration 后编排器崩溃，也不能被第一个 Worker 接受写入；首次 deploy 必须原子 claim bootstrap，并再次证明 document/revision/pointer 为空。claim 后、external 前崩溃留下的过期 initial preflight 可由新 lock id 接管，但必须同时证明没有 active Worker/current deployment 且数据库仍为空；它不能误走要求 baseline 的普通 takeover。
2. 已部署环境在 deep audit 前获取 `initial_deploy=0` 的 `preflight` lease；普通 acquire 只可占用空表或覆盖已过期的非 initial preflight。未返回精确 id 时返回 CLI `DEPLOY_LOCK_HELD`，不继续读取闭包或做 remote mutation。
3. 持有者每 60 秒用精确 `lock_id` conditional update 续租；lease 在扫描中途过期时不得复活或进入 external，必须重新 acquire 并从第一页重扫。剩余少于 600 秒前先续租。
4. publish/unpublish 的 mutation guard trigger 与 CAS 位于同一 D1 batch。active preflight 或任意 bootstrap/external/releasing barrier 期间，除已经命中的只读 idempotent replay 外，所有新 publish/unpublish（包括新 key 的 no-op）原子返回 503 `DEPLOYMENT_IN_PROGRESS`，不写 revision、pointer、version、ledger、时间或 idempotency row。
5. 完整 current closure 通过且 preflight 仍未过期后，编排器必须先持久化并校验 immutable candidate snapshot/canonical manifest/inventory evidence。紧邻 external CAS 前重新读取 Cloudflare active deployment/version：普通操作必须仍精确等于持久化 baseline，initial 必须仍无 active Worker；漂移时不得进入 external，按精确 id释放仍为 preflight 的 lease并重新计划。复核通过后才原子转为 `external, external_stage='ready'`。所有 provider version/deployment id 进入 D1、state、plan 或 evidence 前都必须严格解析为 canonical lowercase UUID；大小写变化、非 UUID 或宽松透传一律拒绝。external 不会因 TTL 自动失效；provider 事实不完整时保留 barrier并返回 `DEPLOY_RECOVERY_REQUIRED`。
6. 每次 remote migration、version upload/observation 与 activation 前后都按本节 journal。`recover --apply` 默认 resume exact lock/candidate/target：`ready|migration_started|migration_complete` 先用 migration history确认上一步 terminal；`version_upload_started` 先执行有 request/result 的 `version-observation`，根据去重升序 `observedMatchingVersionIds` 找到并确定性选择 target，空数组才可重传同一非激活 upload；`version_ready` 创建 activation attempt；`activation_started` 在 active 仍为 baseline/target时可重传同一 exact-target activation；`activation_complete` 复核 deployment/health/state 后释放。每次外部调用前都重验 immutable evidence 与 baseline/target。首次部署 required secret 尚不存在时，upload resume 必须重新取得通过同样文件边界的 `--secrets-file`；缺失只返回 `RECOVERY_SECRET_REQUIRED`，不改变 barrier。
7. terminal-failed 不再强迫无限重试坏 candidate。`repair` 只操作 exact `purpose='deploy'` lock，但覆盖三类已证明的安全边界：version upload terminal-failed且随后完整version-observation success为空；该 logical activation 的每份 request 都有terminal-failed result、没有缺result调用，且active仍为baseline（initial仍无active）；target已active但health失败。它冻结新candidate并在同一barrier内重做manifest/inventory/schema/current closure，单一CAS替换四hash、清空target/deployment/upload+activation attempts并退回`migration_complete`。若旧target已active，则同时把它变为新baseline并设置`initial_deploy=0`；否则保留原baseline/initial标记。任一activation outcome unknown只能exact-target recover，不能repair到另一target。initial没有baseline时只能recover exact candidate或repair retarget，绝不能abort/unlock。
8. normal deploy 可由操作者显式执行 `recover --abort-to-baseline --apply`，但只有全部事实同时成立才允许：`initial_deploy=0`、purpose=deploy、provider active 精确等于 baseline、upload 只可能留下未激活 version、（stage 尚未进入 `activation_started` 且不存在 activation request，或该 logical activation 的每一份 request 都有 terminal-failed result且没有缺 result 的调用）、当前 migration 对 baseline Worker/schema/profile 向后兼容、current closure/ledger仍通过。满足后保留作为判据的既有不可变request/result与audit结果，再以精确id执行`external -> releasing -> DELETE`；不创建未定义的新evidence格式，也不删除target version。activation outcome unknown、active为target/第三方version、initial deploy、migration不兼容或证据缺失时必须拒绝。rollback仍只能同锁显式选择另一个可信target：CAS同时更新baseline/target及四hash、清空deployment/activation attempt并回到`version_ready`，随后显式activation；不能伪造upload attempt或另开锁。
9. 成功路径只有核实 `activation_complete`、target active、exact deployment message、health/smoke/state 后，才在一个 D1 batch 以精确 id完成 `external -> releasing -> DELETE`；preflight 阶段确认没有 external call时可直接按 id删除。release response丢失时重读：row不存在视为已释放，不同 id不得操作。每个 logical attempt 必须能由 `lock_id + attempt_id + providerCallId + provider version/deployment id` 关联；同一 attempt 的重传可产生多个 provider call，但绝不能改变 candidate 或 target。

fence 不是跨 Cloudflare 服务的全局 transaction：migration/upload/activation 部分失败仍按 `CLOUDFLARE.md` 报告。但只要 barrier active，旧/新 Worker 共享的 trigger 就会阻止发布集合在闭包检查后发生变化。测试必须用可控制的 D1 provider-clock harness 与两个并发 D1 client证明 acquire-before-publish、publish-before-acquire、普通/initial preflight过期接管、过期 lease不能进入 external、external永不自动放行、错误 `lock_id` release、首次 bootstrap、每个 external stage 崩溃恢复、同 logical attempt 多次 upload/activation、多个匹配 version 的确定性选择、首发 secret resume、首发 upload/activation terminal-failed 后 repair、normal abort-to-baseline、rollback失败后的同锁二次 activation、providerCall A→B→A不误认旧结果、进入 external/upload/activation 前 baseline 漂移，以及 deploy host/Worker本机时钟任意偏移不影响 active 判断。

## 10. Idempotency

`Idempotency-Key` 的 wire 规则见 `HTTP_API.md`。数据库不保存原 key，只保存：

```text
key_hash = SHA-256(UTF-8(Idempotency-Key))
```

严格解析并规范化请求后计算：

```text
request_hash = SHA-256(canonicalJson({
  apiVersion: "v1",
  operation: "publish" | "unpublish",
  documentId,
  precondition: { kind: "absent" } | { kind: "version", version },
  body: normalizedPublishBody | null
}))
```

token、Authorization header 和 idempotency key 本身不进入 request hash。

处理顺序：

1. 在编译和 CAS 前从 primary 查询未过期的 `key_hash`。
2. 同 key hash + 同 request hash：原样回放保存的 status、JSON body 和 ETag；即使 document 后来又变化也不重新执行。
3. 同 key hash + 不同 request hash：返回 `IDEMPOTENCY_CONFLICT`，HTTP 409。
4. 已过期记录视为不存在；新写 batch 先删除该 key 的过期行。
5. 新请求的领域 mutation 与成功 response 必须在同一 batch 写入。只保存 2xx 结果，不保存认证、校验、CAS 或内部错误。
6. 记录从成功提交时保留 24 小时，`expires_at = created_at + 24h`。每次管理写请求可在同一 batch 删除最多 100 条过期记录；定时维护也使用相同上限循环清理。

若两个并发请求都在 preflight 未发现 key，`idempotency_keys` 主键使输家的整个 mutation batch 回滚。捕获任意 CAS/唯一键失败后，adapter 必须先从 primary 重读 key：同 request hash 则回放，不同 request hash 返回 409；仍不存在时才返回原 CAS 或 slug 冲突。

客户端在收到 idempotent replay 后若要继续修改 document，应重新 GET 当前 document；保存的历史 ETag 只描述第一次响应时的状态。

## 11. Repository 与领域端口

平台无关端口保持：

```ts
export interface PublishedRepository {
  listPublishedSummaries(
    query: { limit?: number; offset?: number; tag?: string },
    asOf: string,
  ): Promise<readonly PublishedSummary[]>;

  findPublishedBySlug(
    slug: string,
    asOf: string,
  ): Promise<PublishedArtifact | null>;

  listSitemapEntries(asOf: string): Promise<readonly SitemapEntry[]>;
}
```

Cloudflare 写端必须是一个原子领域端口，而不是向 HTTP handler 暴露低级 repository 步骤：

```ts
export interface PublicationStore {
  publish(command: PublishRevisionCommand): Promise<PublishResult>;
  unpublish(command: UnpublishCommand): Promise<UnpublishResult>;
}
```

`PublishRevisionCommand` 必须包含 operation id、document id、CAS precondition、idempotency/request hash、显式 `now`、规范化 source、服务端编译结果，以及来自 core media validator 的完整 `assetReferences`。`UnpublishCommand` 包含相同控制字段但没有内容 body。handler 不得自行组合“insert revision + update pointer”。管理读取使用第 6.5 节的 `AdminDocumentRepository`；写端不得复用多次管理 GET 当事务授权。

## 12. 运维检查

同步管理 `/health` 必须有界，只验证：D1 binding/ledger row 可读、准确 schema version、`PRAGMA foreign_keys`、支持的固定 profile、空 `mutation_guards`、deployment fence 表可读，以及常数条 sentinel query；不得要求 `deployment_locks` 为空，因为 deploy 后的 health 正由合法持有者在 external barrier 内执行。它不扫描或读取全部正文，只返回 HTTP 契约中的版本和稳定状态，不返回 document/revision/lock id。

`doctor --remote` 与 deploy preflight 另执行可取消、分页的 deep audit：

- 核对 provider 实际数据库 size 与 256 MiB应用 ledger；
- 分页重算全部 current pointer 的 composite FK、版本 tuple、hash、tag 投影和 `payload_bytes`；
- 分页验证每个 current revision 的 `asset_refs_json`；deploy preflight 还必须逐项命中候选 embedded asset manifest URL；MVP 不比较历史 asset hash；
- 验证 ledger 等于全部 immutable revision 的 `SUM(payload_bytes)`；
- 检查过期 idempotency backlog 是否超过 10,000 行。

deep audit 固定每页最多 50 个 current pointer、总时限 300 秒；每页只读取该页完整 revision，处理后释放，不把 10,000 篇正文同时保留在内存。超时或中断返回 `DOCTOR_AUDIT_INCOMPLETE`，下次从头重新验证，不能把部分结果缓存成通过。它可以在本地脱敏输出受影响 document/revision id，不进入 HTTP health response。任何 row 不兼容以 `PUBLISHED_REVISION_INCOMPATIBLE` 阻断；候选 manifest 缺少仍被 current revision 引用的 URL 以 `DEPLOY_ASSET_CLOSURE_FAILED` 阻断，同 URL bytes/hash 变化不阻断。公开请求发现单 row 不兼容时 fail closed，不自动修表、重编译或删除历史。
