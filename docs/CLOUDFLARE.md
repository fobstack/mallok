# Mallok Cloudflare 运行与部署契约

- 状态：Accepted for MVP
- Deployment state：`1`
- 适用阶段：Phase 2A–3

## 1. 支持边界

MVP 动态 target 只支持：

- Cloudflare Workers Module Worker；
- Workers Static Assets；
- D1；
- 项目本地 `wrangler@4.126.0`。

不使用 Pages、Workers Sites、KV、R2、Durable Objects、Queues 或远程主题。R2 媒体上传是 P1。

“一键部署”在产品文案中的准确含义是：资源已经 provision、secret 已由用户配置后，`mallok deploy --yes` 可完成本地校验、构建、migration、Worker/asset deploy 与 smoke。首次授权、账号选择、购买域名、自定义 DNS、secret 创建和资源清理不可能无条件自动完成。

## 2. 固定 binding 与 secret

| 名称 | 类型 | 用途 |
| --- | --- | --- |
| `DB` | D1 binding | 发布文档、revision、幂等记录 |
| `ASSETS` | Workers Static Assets binding | theme/public 资源；不含动态 404 |
| `MALLOK_ADMIN_TOKEN` | Worker secret | 管理 API Bearer token |

项目代码不得接受别名，避免环境间 binding 漂移。`MALLOK_ADMIN_TOKEN` 只接受两种 canonical 字符串：`hex:` + 64–256 个小写 hex 字符（每两个字符一个 byte），或 `b64u:` + RFC 4648 URL-safe、无 padding Base64。运行时必须 decode 为 32–128 raw bytes，再按相同前缀 re-encode 并要求完全相同；空白、uppercase hex、padding、非 canonical 尾位和未知前缀都失败。官方生成器固定用 CSPRNG 产生 32 个 raw bytes；不能从现成字符串可靠估算熵，因此运行时只声称完成格式、canonical encoding 与 decoded-length 校验，不维护主观字符串黑名单。Mallok 不生成后写入跟踪文件。

Wrangler 当前支持 required secret 声明；生成配置必须把 `MALLOK_ADMIN_TOKEN` 标记为 required。`wrangler secret put` 会生成并部署新 Worker version，因此 Mallok 不在 `deploy` 内隐式调用它。已有远端 secret 时普通 deploy 不读取 secret 值；首次部署可由用户显式传 `mallok deploy --secrets-file <absolute-path-outside-project>`，Mallok 只把该文件交给非激活的 `wrangler versions upload --secrets-file`，不另调 `secret put`，后续 `versions deploy` 不再接触该文件。

`--secrets-file` 只接受项目根之外的绝对路径、普通非 symlink 文件；Unix 上必须由当前 uid 拥有且 mode 不宽于 `0600`。文件必须是无 BOM 的 UTF-8，精确包含 `MALLOK_ADMIN_TOKEN=<canonical-token>` 和可选的单个尾随 LF；不得有空行、注释、引号、`export` 或第二个 key，值需通过上段格式检查。内容不得复制进 `.mallok`、日志、plan、evidence 或 process argv。Mallok 不删除用户提供的文件。MVP 对 `CI=1` 的 Cloudflare infrastructure mutation fail closed，因为 gitignored fence/snapshot recovery evidence 尚无远端持久存储；CI 只能运行 plan、dry-run 和本地测试。

本地只能二选一使用 `.dev.vars` 或 `.env`；Mallok starter 选择 `.dev.vars`，将 `.dev.vars` gitignore，只提交 `.dev.vars.example` 的变量名。配置中的 `vars` 不能存 secret。

## 3. 本地状态

`.mallok/state.json` 是本机非权威状态，必须 gitignore，权限建议 `0600`：

```json
{
  "schemaVersion": "1",
  "projectId": "123e4567-e89b-42d3-a456-426614174000",
  "environments": {
    "production": {
      "provider": "cloudflare",
      "accountId": "<cloudflare-account-id>",
      "workerName": "my-mallok-site",
      "databaseName": "my-mallok-site-content",
      "databaseId": "<d1-id>",
      "lastObservedMigration": "0001_initial.sql",
      "currentDeployment": {
        "workerVersionId": "123e4567-e89b-42d3-a456-426614174101",
        "deploymentId": "123e4567-e89b-42d3-a456-426614174201",
        "versionOperationId": "123e4567-e89b-42d3-a456-426614174001",
        "versionAttemptId": "123e4567-e89b-42d3-a456-426614174011",
        "activationOperationId": "123e4567-e89b-42d3-a456-426614174001",
        "activationAttemptId": "123e4567-e89b-42d3-a456-426614174021",
        "activationKind": "deploy",
        "candidateInputHash": "<sha256>",
        "workerBundleHash": "<sha256>",
        "snapshotPath": ".mallok/candidates/<sha256>",
        "assetManifestHash": "<sha256>",
        "manifestPath": ".mallok/deployments/<sha256>.asset-manifest.json",
        "candidateInventoryHash": "<sha256>",
        "inventoryPath": ".mallok/deployments/<sha256>.candidate-inventory.json",
        "versionTag": "mallok-<24-hex>",
        "observedAt": "2026-08-27T00:00:00.000Z"
      },
      "previousDeployment": {
        "workerVersionId": "123e4567-e89b-42d3-a456-426614174102",
        "deploymentId": "123e4567-e89b-42d3-a456-426614174202",
        "versionOperationId": "123e4567-e89b-42d3-a456-426614174002",
        "versionAttemptId": "123e4567-e89b-42d3-a456-426614174012",
        "activationOperationId": "123e4567-e89b-42d3-a456-426614174002",
        "activationAttemptId": "123e4567-e89b-42d3-a456-426614174022",
        "activationKind": "deploy",
        "candidateInputHash": "<previous-sha256>",
        "workerBundleHash": "<previous-sha256>",
        "snapshotPath": ".mallok/candidates/<previous-sha256>",
        "assetManifestHash": "<previous-sha256>",
        "manifestPath": ".mallok/deployments/<previous-sha256>.asset-manifest.json",
        "candidateInventoryHash": "<previous-sha256>",
        "inventoryPath": ".mallok/deployments/<previous-sha256>.candidate-inventory.json",
        "versionTag": "mallok-<24-hex>",
        "observedAt": "2026-08-26T00:00:00.000Z"
      },
      "observedAt": "2026-08-27T00:00:00.000Z"
    }
  }
}
```

它不保存 token、secret、文章正文或 idempotency key。`currentDeployment/previousDeployment` 保存最多两份 rollback evidence；对应 canonical manifest/inventory 位于 gitignored `.mallok/deployments/**`，不可变 candidate 位于 `.mallok/candidates/**`。`versionOperationId` 是上传该 version 时的 D1 `lock_id`，`versionAttemptId` 是其逻辑 upload attempt；`activationOperationId` 是产生当前 deployment 时的 D1 `lock_id`，`activationAttemptId` 是把 exact version 切到100%流量的独立逻辑attempt。普通deploy的两个operation id可以同为当前lock，但两个attempt必须不同；rollback激活旧version时保留原version对，只写新的activation对。provider `workerVersionId/deploymentId`必须是canonical lowercase UUID；operation/attempt是canonical UUID v4，它们都不是凭据。state、snapshot inventory、manifest SHA与Worker version/deployment tag/message必须互相一致。被current/previous state或active D1 fence引用的manifest/inventory/snapshot/attempt journal必须保留，不能套用普通30天evidence清理。account/database id虽不是认证secret，仍不提交，减少环境泄漏和误部署。state删除后，`doctor --remote`只能只读发现候选并输出精确repair命令，不能自行写回；恢复必须由用户执行`mallok provision --adopt-database-id <id> --apply`的计划/确认流程。state不是云端资源存在性或归属的唯一证据，缺rollback/recovery evidence时只能阻断。

Worker version annotation 使用以下唯一算法：

```text
deploymentFingerprint = sha256(canonicalJson({
  assetManifestHash,
  candidateInputHash,
  candidateInventoryHash,
  workerBundleHash
}))
versionTag = "mallok-" + deploymentFingerprint.slice(0, 24)
versionMessage = "mallok-version;lock=" + versionOperationId
  + ";attempt=" + versionAttemptId
  + ";candidate=" + candidateInputHash
  + ";worker=" + workerBundleHash
  + ";assets=" + assetManifestHash
  + ";inventory=" + candidateInventoryHash
deployMessage = "mallok-activate;lock=" + activationOperationId
  + ";attempt=" + activationAttemptId
  + ";target=" + workerVersionId
  + ";candidate=" + candidateInputHash
  + ";worker=" + workerBundleHash
  + ";assets=" + assetManifestHash
  + ";inventory=" + candidateInventoryHash
rollbackMessage = "mallok-rollback;lock=" + activationOperationId
  + ";attempt=" + activationAttemptId
  + ";target=" + workerVersionId
  + ";candidate=" + candidateInputHash
  + ";worker=" + workerBundleHash
  + ";assets=" + assetManifestHash
  + ";inventory=" + candidateInventoryHash
```

输入 hash 均为 64 位小写 hex，operation/attempt id 均为 canonical UUID v4，`workerVersionId` 是 canonical lowercase UUID；每个 message 只含 ASCII，必须不超过 512 字符。version upload 只写 `versionMessage`，普通 deploy 的独立 activation 写 `deployMessage`；rollback 不改变目标 version annotation，只给新 deployment 写 `rollbackMessage`。`versionTag` 恰为 31 字符，符合本项目冻结的最大 32 字符限制；96-bit 短指纹只是索引提示，完整证明必须同时匹配 provider canonical version/deployment UUID、对应精确 message、四份完整 hash、本地 snapshot/manifest/inventory/attempt evidence 与当前 closure。任何字段、顺序、分隔符或大小写变化都不等价。若锁定 Wrangler/API 改变 annotation 限制，必须先更新契约测试和版本文档，不能静默截断。

`projectId` 由 `mallok init` 生成并提交在配置的 `project.id`；它把本地 state 绑定到当前项目，不能冒充 D1 端的 ownership 证明。Cloudflare D1 没有可依赖的任意 ownership metadata 时，现有同名资源默认阻止；只有用户显式提供完整 database id，并在只读验证账号、名称及 `PRISTINE_UNMIGRATED|MALLOK_SCHEMA_V1` 分类后确认 adopt plan，才可写回本地 state。这个显式选择是接管授权，不由名称或 projectId 自动推断；MVP 不提供 `--force`。

## 4. 生成配置

Mallok 写 `.mallok/cloudflare/wrangler.jsonc` 作为本次 build 的本地检查视图，不修改用户手写 `wrangler.toml`。真实 deploy 在取得 lock id 后把等价配置写入 `.mallok/deployments/<lock-id>/wrangler.jsonc`，并只引用已冻结的 candidate snapshot：

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "my-mallok-site",
  "main": "../../candidates/<candidate-input-hash>/worker/index.js",
  "compatibility_date": "2026-08-27",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "my-mallok-site-content",
      "database_id": "<from local state>",
      "migrations_dir": "../../../packages/cloudflare/migrations"
    }
  ],
  "assets": {
    "directory": "../../candidates/<candidate-input-hash>/assets",
    "binding": "ASSETS",
    "html_handling": "none",
    "run_worker_first": ["/__mallok/api/*"]
  },
  "cache": { "enabled": true },
  "secrets": { "required": ["MALLOK_ADMIN_TOKEN"] }
}
```

示例路径以 `.mallok/deployments/<lock-id>/wrangler.jsonc` 为基准；本地检查视图使用等价的 `../candidates/...` 相对路径。两份配置写入后都由锁定 Wrangler config schema 验证。deploy 只把 per-lock config 的绝对路径作为 argv 项传给 Wrangler，并在启动 subprocess 前再次验证其普通文件/realpath、candidate inventory 与所有摘要；配置、snapshot 或 manifest 任一 symlink/字节漂移都在外部调用前阻断。真实格式若随锁定 Wrangler 版本不同，以该版本官方 schema 为准；Mallok adapter 的 snapshot 测试必须固定输出。

Mallok 动态页面不写入 assets directory。`html_handling: "none"` 禁止平台按 HTML 文件名自动制造 307/尾斜杠行为；Mallok 的 canonical 308 只由 Worker/dev/preview router 实现。这样 asset-first 对静态文件直接响应，对 `/`、`/articles/*`、`/rss.xml`、`/sitemap.xml` 因无匹配文件而进入 Worker。`/__mallok/api/*` 明确 worker-first。不得使用全局 `run_worker_first: true`，以免普通静态 asset 请求无谓访问 Worker/D1。

`cache.enabled` 必须显式开启 Workers Caching；仅在响应上写 `s-maxage` 而没有启用 Worker 缓存，不能作为“边缘 60 秒缓存已经生效”的证据。管理 API 与 cache-busted 验证响应使用 `no-store`，不会进入该缓存。

## 5. provision 状态机

`mallok provision` 默认仅生成计划：

```text
DISCOVER_ACCOUNT -> READ_STATE -> INSPECT_REMOTE -> PLAN -> [CONFIRM] -> CREATE_OR_ADOPT_D1 -> WRITE_STATE -> VERIFY
```

不创建 Worker deployment；Worker 在 deploy 阶段产生。计划包含 account、environment、resource logical name、动作 `create|reuse|blocked` 和恢复说明，不包含凭据。

规则：

- 账号必须由 Wrangler 已登录身份或 `CLOUDFLARE_ACCOUNT_ID` 明确选定；多个账号且未指定时阻止；
- `--environment` 默认 `production`，匹配 `[a-z][a-z0-9-]{0,31}`；
- 资源名来自规范化配置，不从 cwd 临时推导；
- 同一 state/远端资源重复 apply 是 no-op；
- `--adopt-database-id <id>` 只可与 `--apply` 一起实际写 state；它不创建、迁移或修改远端 D1。计划必须显示脱敏账号、精确配置名称、ID 后缀、数据库分类与“只写本地 state”，并重新确认；unknown/partial、名称/账号不匹配时阻断；
- create 成功但 state 写入失败时不删除远端资源，只向当前操作者显示完整 resource id，并输出 `mallok provision --environment <env> --adopt-database-id <id> --apply` 恢复指引；持久日志/证据继续脱敏；
- Mallok 不自动删除、重命名或清空现有 D1。

## 6. migration

- migration 文件由 `@mallok/cloudflare` 版本化并按字典顺序执行；已发布 migration 永不修改；
- 所有命令显式传 `--local` 或 `--remote`，不依赖 Wrangler 默认；
- 本地测试以 database name 定位；remote 以 state 中已核验的 database id/name 生成配置；
- `wrangler d1 migrations apply` 的失败 migration 由 D1 回滚，Mallok 仍需保存脱敏 stdout/stderr 与失败文件名；
- schema migration 必须向后兼容当前正在运行的 Worker，或 deploy 直接阻止并要求维护窗口；
- 迁移前列出待应用文件；remote 需要确认；
- `deploy` 不在 migration 失败后继续发布 Worker。
- remote migration/deploy 在计划前必须按下述分类目标数据库；不能因为缺少 `mallok_state` 就直接写入一个来源不明或部分初始化的数据库。
- MVP 的 standalone `mallok db migrate --remote` 只允许 `PRISTINE_UNMIGRATED -> 0001_initial.sql + bootstrap-v1`；准确 schema v1 且无 pending migration/fence 时返回 no-op，bootstrap/initial pending时返回 `MIGRATED_NOT_DEPLOYED`并要求继续deploy。schema v1 的后续 remote migration 只能在 `mallok deploy` fence 内执行。不得单独留下没有 journal/recovery路径的migration external call。

D1 `batch()` 对整批 statement 提供事务语义；领域原子写必须使用数据库约束/trigger 加 batch，不能用未受保护的“SELECT 后多个独立请求写入”。具体见 [DATABASE.md](DATABASE.md)。

### 6.1 首次部署前的远端数据库分类

使用 state 中已经核验的 account/database id 与配置名称进行只读检查，并只产生三个 closed outcome：

- `PRISTINE_UNMIGRATED`：不存在 `mallok_state`，且除锁定 Wrangler/D1 明确列出的 provider-owned metadata 外，`sqlite_schema` 无用户 table/index/trigger，migration history 也没有已应用记录。此时 current published set **定义为空**，asset closure 是 vacuous pass；确认后只允许从 `0001_initial.sql` 开始 migration。
- `MALLOK_SCHEMA_V1`：存在准确 singleton/version/profile，执行完整 `doctor --remote --deep`、ledger 与 current asset closure 后才可继续。
- `UNKNOWN_OR_PARTIAL`：存在任何用户对象但缺 Mallok state、只有部分 Mallok table、未知 migration/version、state/binding/name 不匹配或只读分类不完整；以 `DATABASE_SCHEMA_INCOMPATIBLE` 阻断，绝不自动 adopt、清空或覆盖。

`PRISTINE_UNMIGRATED` 不是完整 doctor PASS；独立 `doctor --remote` 应报告 WARN `DATABASE_MIGRATION_REQUIRED`。deploy 可以在同一已经确认的计划中继续首次 migration，但 migration 成功后、Wrangler deploy 前必须重新验证为 `MALLOK_SCHEMA_V1`。分类查询失败或无法证明 pristine 时 fail closed。准确 schema v1 还要读取 deployment fence substate：`bootstrap-v1` 或 `initial_deploy=1` 的过期 preflight 且数据库为空/无 active Worker 时归类为 `INITIAL_DEPLOY_PENDING`，只能恢复首次部署链路；active external/releasing 必须进入 `deployment recover|repair|rollback`，不能普通 acquire。

## 7. deploy 状态机

```text
DOCTOR
  -> BUILD_CLOUDFLARE
  -> FREEZE_AND_VERIFY_CANDIDATE_SNAPSHOT
  -> VERIFY_STATE_AND_BINDINGS
  -> CLASSIFY_REMOTE_DATABASE
  -> PLAN_MIGRATIONS_AND_DEPLOY
  -> CONFIRM
  -> [PRISTINE_ONLY: APPLY_INITIAL_MIGRATION -> VERIFY_SCHEMA]
  -> CLAIM_BOOTSTRAP_OR_ACQUIRE_PREFLIGHT
  -> VERIFY_CURRENT_ASSET_CLOSURE
  -> PERSIST_CANONICAL_MANIFEST_EVIDENCE
  -> WRITE_PER_LOCK_WRANGLER_CONFIG
  -> VERIFY_AND_TRANSITION_EXTERNAL_BARRIER
  -> JOURNAL_MIGRATION_STARTED
  -> [APPLY_APPROVED_MIGRATIONS]
  -> JOURNAL_MIGRATION_COMPLETE
  -> VERIFY_SCHEMA_AND_CLOSURE
  -> JOURNAL_VERSION_UPLOAD_STARTED
  -> WRANGLER_VERSIONS_UPLOAD_EXACT_CANDIDATE_WITHOUT_ACTIVATION
  -> PERSIST_EXACT_TARGET_VERSION_AND_JOURNAL_VERSION_READY
  -> JOURNAL_ACTIVATION_STARTED
  -> WRANGLER_VERSIONS_DEPLOY_EXACT_TARGET_AT_100_PERCENT
  -> JOURNAL_ACTIVATION_COMPLETE
  -> HEALTH_AND_PUBLIC_SMOKE
  -> RECORD_OBSERVED_STATE
  -> RESOLVE_AND_RELEASE_BARRIER
```

部署不是跨 Cloudflare API 的全局事务。失败报告必须区分：

- `NO_REMOTE_CHANGE`：确认前/构建阶段失败；
- `DEPLOY_LOCK_HELD|DEPLOY_LOCK_LOST`：未取得 fence，或 preflight 在进入 external 前丢失；没有 external call；
- `MIGRATED_NOT_DEPLOYED`：migration 成功，但 version upload 或显式 activation 尚未完成；
- `DEPLOYED_HEALTH_FAILED`：exact target 已 active，但 health/smoke 失败；
- `DEPLOY_RECOVERY_REQUIRED`：已经进入 external 且 provider terminal outcome/active version未被完整证明；barrier 保留；
- `COMPLETE`。

no-op 判定必须发生在数据库分类之后，并同时证明：D1不存在bootstrap/external/releasing，且不存在按D1 `unixepoch()`仍有效的preflight（已过期preflight不算active barrier）；本地state与provider当前active canonical version/deployment UUID一致；version tag、version message、activation message完全一致；candidate input、candidate inventory、Worker bundle、asset manifest四个hash完全一致；snapshot、manifest、inventory三份文件仍存在且从exact bytes重算得到相同hash；migration set完全一致；authenticated health通过。全部成立才返回`COMPLETE`，不获取fence、不调用Wrangler、不滚动previous evidence。缺任一事实都继续受控部署；若存在active barrier，优先进入recover/repair/rollback，绝不能走no-op。

`MALLOK_SCHEMA_V1` 在确认后、deep audit 前先获取 `DATABASE.md` 第 9.1 节的 D1 preflight lease，并记录当前 active Worker 作为 baseline；`PRISTINE_UNMIGRATED` 先执行 `0001_initial.sql`，该 migration 原子留下 bootstrap barrier，再由首次 deploy 原子 claim并复验 schema/空集合，此时且仅此时 `initial_deploy=1` 且 baseline version 可以为空。claim 后、external 前中断形成的过期 initial lease，只能在再次证明数据库为空、无 active Worker/current deployment 时 takeover；它不能按普通已部署环境处理。获取失败以 `DEPLOY_LOCK_HELD` 阻断。fence active 后，旧/新 Worker 的 publish/unpublish transaction 都会在同一 D1 trigger 上以 503 `DEPLOYMENT_IN_PROGRESS` fail closed，关闭“闭包已检查、旧 Worker 又发布新 pointer”的 TOCTOU 窗口。

持锁后的 `VERIFY_CURRENT_ASSET_CLOSURE` 使用 `doctor --remote --deep` 分页读取，把全部 current revision 持久化 `{url}` 与本次 candidate embedded asset manifest 对比；URL 缺失就在 migration/Wrangler 前返回 `DEPLOY_ASSET_CLOSURE_FAILED`。`PRISTINE_UNMIGRATED` 的 current set为空，但迁移后的同一检查仍执行。这一步不能只检查当前 Git 中仍存在的 Markdown，因为 D1 current pointer 可能来自已经删除的作者文件。同 URL bytes/hash 变化允许部署：MVP 资源未指纹化且缓存为 300 秒；强行比较历史 hash 会形成无法先 publish/先 deploy 的顺序死锁。

preflight lease 固定 30 分钟，acquire/renew/active 判断统一使用 D1 provider clock；编排器每 60 秒 heartbeat，进入 external 前确认剩余至少 10 分钟。续租失败或 lease 已过期时停止并从新 acquire/全量重扫开始，绝不能复活旧 id。closure 通过后，先把 exact canonical candidate manifest、candidate inventory 与 per-lock Wrangler config 原子写入 gitignored evidence 路径并重算 hash；inventory canonical bytes 另存 `.mallok/deployments/<inventory-hash>.candidate-inventory.json`，必须通过 BUILD §7.3 的 schema并覆盖snapshot全部文件。写入/校验失败仍在 preflight，可安全按精确 id释放。紧邻 external CAS 前重新读取 active deployment/version：normal必须仍等于lock中的baseline，initial必须仍不存在；所有 provider version/deployment id 都先严格规范为 lowercase UUID，无法规范或发生漂移时不得进入external，释放preflight并重新计划。随后编排器以精确 id 原子转为 `external, external_stage='ready'`；只有 transition 返回成功才可发出 migration、version upload 或 activation。external/releasing 不因 TTL 过期自动放行，provider 事实不完整或进程崩溃时返回 `DEPLOY_RECOVERY_REQUIRED` 并保持 barrier，直到受控恢复。deep audit 总时限 300 秒；Wrangler 单次 remote subprocess 上限 10 分钟，但超时后的 upload/activation按下述 exact-intent协议安全重传，不能仅凭本地退出码解锁。

进入 external 后，编排器先 conditional 写 `migration_started`，确认 terminal 后写 `migration_complete`；没有待迁移项也显式写 complete。deploy 随后创建逻辑 `version_upload_attempt_id`，CAS 到 `version_upload_started`，再调用锁定 Wrangler 的 `versions upload`，该命令只上传、不激活。每次物理调用先按`deployment-attempt.schema.json` durable 写`.mallok/deployments/<lock-id>/attempts/<6位sequence>-<provider-call-id>.request.json`，terminal 后才 exclusive-create 同 basename `.result.json`；两者永不更新，缺 result 表示 unknown。相同 logical attempt 的重传必须使用相同 candidate、tag、version message 与 secrets 边界，但使用新 sequence 与`providerCallId`。upload 返回或恢复时必须另做同样 journaled 的`version-observation`，以相同version message分页读完provider version列表：成功result把所有exact tag/message/四hash匹配的canonical UUID去重升序写入`observedMatchingVersionIds`，非空时`providerVersionId`等于最小值，空时省略；超过100项写failed result `VERSION_OBSERVATION_TOO_MANY_MATCHES`并以`DEPLOY_RECOVERY_REQUIRED`保留barrier，不得截断。只有success result可驱动把exact UUID与`version_ready`同一CAS持久化；空数组才允许再次upload。未选版本只记evidence，不自动删除。rollback不上传，验证目标evidence后直接进入`version_ready`。

`version_ready` 后创建独立 `activation_attempt_id` 与 journal，CAS 到 `activation_started`，再调用 `versions deploy <target-uuid>@100% --yes --message <deployMessage|rollbackMessage>`。同一 activation 可原样重传，绝不能换 target；每次调用产生新的 `providerCallId`。调用前 provider active 只能是 baseline 或 target，initial 只能是无 active 或 target；第三个 version 表示 out-of-band drift并阻断。确认 active target、exact activation message及 canonical deployment UUID后，CAS 写 `activation_complete + target_deployment_id`。deployment state保存version/activation operation+attempt id、四hash、snapshot/manifest/inventory路径与observed time；attempt records不增加可漂移的state字段：version相关记录由`.mallok/deployments/<versionOperationId>/attempts/`定位，activation记录由`.mallok/deployments/<activationOperationId>/attempts/`定位。health/public smoke成功后才滚动 local current/previous state，并以同一D1 batch完成`external -> releasing -> delete`；state写失败时 barrier 保留，recover复核后补写。

恢复按 D1 stage 与 attempt journal 判定，不再依赖 provider 的 never-started 否定证明。`recover --apply` 默认 resume exact candidate/target：upload 结果不明可重复非激活 upload；activation 结果不明先查 active/deployment evidence，未达到 exact target时可重复相同 target activation。任何重传前都重算三份 evidence、四 hash并核对baseline/target。首次 upload 仍需要尚未配置 secret 时，操作者重新提供同边界 `--secrets-file`；缺失返回`RECOVERY_SECRET_REQUIRED`且barrier不变。exact target 已 active但health失败时保留barrier和`DEPLOYED_HEALTH_FAILED`。

`deployment repair` 只处理 exact `purpose="deploy"` lock，但不再要求 target 已 active：version upload terminal-failed且随后完整version-observation success为空；每份activation request都有terminal-failed result、无缺result调用且active仍为baseline/initial-none；或target active但health失败，都可以同锁冻结新candidate并重做evidence/schema/closure。单一CAS替换四hash，清空target deployment/version及两个attempt，退回`migration_complete`；若旧target已active则把它设为新baseline并令`initial_deploy=0`，否则保留原baseline/initial。activation outcome unknown只能recover同一target，不能repair。首次部署没有baseline时只能recover或repair，不能释放barrier。normal deploy可显式执行`recover --abort-to-baseline --apply`，但仅在active精确等于baseline，且尚无activation request或每份activation request都有terminal-failed result、没有缺result调用，同时migration向后兼容且closure/ledger通过时保留既有不可变判据并释放；不创建新evidence格式、不删除未激活版本。事实不完整一律拒绝。

Mallok 不自动回滚数据库。Worker rollback 必须显式提供 canonical lowercase Worker version UUID，禁止默认“上一个”；目标原始version attempt、四hash、tag/message及snapshot/manifest/inventory都须匹配。无 barrier 时获取 rollback fence，验证 current closure/schema 后把 target 持久化为`version_ready`并只执行显式 activation。失败deploy/rollback已有barrier时，可同锁选择另一个可信version：CAS更新purpose/baseline/target/四hash，清空target deployment与activation attempt，stage回到`version_ready`，再用新activation attempt切换。rollback不产生version upload attempt；health失败不能调用repair，只能同锁再选可信target。任何 provider UUID/evidence/message/closure 不匹配均保留barrier。

实际 remote mutation 只能从能持久保存 `.mallok/state.json`、`.mallok/candidates/**` 和 `.mallok/deployments/**` 的人工操作者工作目录执行。MVP 检测到 `CI=1` 时，provision apply、remote migrate、deploy、recover、repair、rollback 一律以 `REMOTE_MUTATION_UNSUPPORTED_IN_CI` 退出；plan/dry-run 保持可用。未来支持 CI 必须先设计加密 durable evidence store 与中断恢复协议，不能仅把临时 runner artifact 当作已解决。

## 8. Worker 请求路由

处理顺序：

1. 请求进入 Worker 后，在规范化/解码前检查可观察的 raw pathname，拒绝 malformed/危险 encoding、NUL/control 和 dot segment；asset-first 已命中的普通静态资源可能完全不执行 Worker；
2. `/__mallok/api/v1/*` 进入管理 router，并使用管理 endpoint 自己的 query whitelist；
3. 对 `/`、article canonical/redirect candidate、`/index.html` redirect candidate、`/rss.xml`、`/sitemap.xml` 执行公开 query contract：canonical dynamic route 只允许唯一合法 `__mallok_rev`，redirect candidate 不允许任何 query，拒绝发生在 redirect/D1 前；
4. 不带 query 的 `GET|HEAD /index.html` 以 `308` 跳转到 `/`；其他 method 返回 405；
5. `/`、`/articles/<slug>/`、`/rss.xml`、`/sitemap.xml` 进入公开 router；
6. 不带 query 的 `/articles/<slug>` 308 到 trailing-slash canonical；
7. 其余请求尝试 `env.ASSETS.fetch(request)`；
8. asset 404 时由 Worker 渲染统一主题 404；cloudflare assets 中不生成 `404.html`。

raw path/query 的 400/404 矩阵和 `__mallok_rev` 规则以 [HTTP_API.md](HTTP_API.md) 第 3 节为准；动态 query 拒绝必须发生在 redirect/D1 前。asset-first 命中的静态资源 query 由平台处理且不访问 D1，不能在当前配置下声称 Worker 已统一拦截。MVP 动态 route 有意不接受 UTM；需要保留时应在未来加入独立 gateway/cache-key 规范化设计。

公开只支持 GET/HEAD；其他 method 返回 405 和 `Allow: GET, HEAD`。管理 API 只接受各 endpoint 指定 method，不自动 CORS。公开 HTML 设置：

```text
Content-Type: text/html; charset=utf-8
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Content-Security-Policy: default-src 'self'; script-src 'self'<SCRIPT_HASH_SOURCES>; style-src 'self'; img-src 'self' https:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'
```

`<SCRIPT_HASH_SOURCES>` 不是原样发送的占位符，而是通过 `await serializeSafeHtml(finalDocument)` 从最终 `SafeHtml` 私有 contribution 确定性展开：

1. `jsonScript()` 记录 `<script>` 起止标签之间的**精确文本**；标签、属性和首尾外部空白不进入 contribution，helper 自己生成的内部空白则属于文本；
2. 异步 serializer 用 `TextEncoder` 取得 UTF-8 bytes，以 Web Crypto 计算 SHA-256，再以 RFC 4648 标准 Base64（不是 base64url，保留 `=` padding）编码，并形成一个 CSP source expression：`'sha256-<base64>'`；
3. `html` 组合时只合并受控 helper 携带的内部 hash 元数据，不扫描/正则解析最终 HTML；
4. sources 去重后按完整 source expression 的 Unicode code unit 升序排列；每项前置一个 ASCII space。没有内联 JSON script 时占位展开为空字符串；
5. header 中不得出现 `'unsafe-inline'`。例如一个 hash 时 `script-src 'self' 'sha256-AbCd...=';`。

最终发送的 script 文本 bytes 必须与 hash 输入逐字节相同；任何序列化改动都必须重新计算。Article JSON-LD 由 `jsonScript` 确定性内联。static target 的任意托管商 header 不在 Cloudflare adapter 控制范围内；静态文档仍依靠安全转义保证基础安全，并在托管指南中给出按产物生成 CSP header 的方法，不能宣传为所有 host 已自动生效。

## 9. 缓存与一致性

- 管理 API：`Cache-Control: no-store`；
- 公开 HTML/feed：`Cache-Control: public, max-age=0, s-maxage=60, must-revalidate`；
- 合法 canonical 308：`Cache-Control: public, max-age=300`；公开 400/405/409/500/503 与 cache-busted 验证：`Cache-Control: no-store`；
- 资产：MVP 不重写资源文件名，生成的 `dist/assets/_headers` 对 `/*` 固定设置 `Cache-Control: public, max-age=300` 与 `X-Content-Type-Options: nosniff`；该控制文件不进入公开/embedded manifest，且用户 public/theme 不得覆盖；
- HTML/feed ETag 是最终未压缩 response body bytes 的 SHA-256 所形成的弱 ETag `W/"mallok-v1-<hash>"`；HEAD 与 GET 相同，压缩响应携带 `Vary: Accept-Encoding`；
- `If-None-Match` 命中返回 304，无 body；
- `?__mallok_rev=<artifact-hash>` 是 Worker-managed canonical dynamic route 唯一允许的 query，只用于 publish 后生成新 cache key并验证：参数必须为 64 位小写 hex，仍只读取当前 pointer并使用 D1 `first-primary` session，响应 `Cache-Control: no-store`，且不能改变 canonical；文章 route 无 pointer 时 404、pointer 存在但 artifact 不匹配时 409，集合/feed route 只 cache-bust；它不是历史 revision selector。redirect candidate 带任何 query（包括该参数）都先返回 400，调用者必须请求 canonical URL。

publish 成功后，CLI 用 cache-busted URL 验证新 revision。普通 URL 的产品目标是 60 秒内一致；这个 CDN 时限只能在 Phase 3 staging 验证，本地 Phase 2B 只验证 cache key/headers/conditional request 逻辑。

## 10. 本地与 staging 证据

本地验收：

- `wrangler d1 migrations apply <name> --local`；
- Cloudflare local test pool / Miniflare 运行真实 D1 binding；
- Worker routes、ASSETS fallback、认证、CAS 和故障注入；
- 不读取真实账号。

staging 验收必须单独授权，使用临时命名空间完成：provision → migrate → deploy → health → publish → public GET → unpublish → cleanup。保存命令版本、时间、脱敏 resource/deploy id、HTTP status/hash；不保存 token 或正文。没有 staging 凭据时状态保持 `NOT_VERIFIED_STAGING`，不能用 local 结果替代。

## 11. 官方行为依据

- [D1 binding API 与 transactional batch](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [D1 Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/)
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [D1 platform limits](https://developers.cloudflare.com/d1/platform/limits/)
- [D1 read replication 与 Sessions API](https://developers.cloudflare.com/d1/best-practices/read-replication/)
- [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Workers Static Assets binding](https://developers.cloudflare.com/workers/static-assets/binding/)
- [Workers Static Assets HTML handling](https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/)
- [Workers Static Assets `_headers`](https://developers.cloudflare.com/workers/static-assets/headers/)
- [Workers Caching configuration](https://developers.cloudflare.com/workers/cache/configuration/)
- [Wrangler `versions upload` / `versions deploy` commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/#versions)
- [Workers Upload Version API（version annotation 限制）](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/versions/methods/create/)
- [Workers Create Deployment API（exact version UUID activation）](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/create/)
- [Workers memory limits](https://developers.cloudflare.com/workers/platform/limits/#memory)

这些链接解释平台事实；本文件冻结 Mallok 行为。升级 Wrangler 前必须重新核对并更新兼容矩阵与 snapshot。
