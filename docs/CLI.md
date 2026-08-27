# Mallok CLI 契约

- 状态：Accepted for MVP
- CLI protocol：`0.1`
- 适用阶段：Phase 1B–3

## 1. 调用与通用规则

正式二进制名为 `mallok`。仓库开发时使用 workspace-local 入口 `pnpm mallok -- <args>`；生成项目使用 `pnpm mallok <args>`。文档不得假设存在全局安装。

```text
mallok [global options] <command> [command options]
```

通用 option：

| option | 默认 | 说明 |
| --- | --- | --- |
| `--cwd <path>` | 当前目录 | 项目根；先 realpath |
| `--config <path>` | `mallok.config.mjs` | 相对 cwd 的配置 |
| `--target static\|cloudflare` | 配置值 | 仅支持 target 的命令使用 |
| `--as-of <ISO>` | 命令开始时 UTC | 构建/可见性固定时钟 |
| `--json` | false | 单一 JSON envelope 输出 |
| `--no-color` | 非 TTY 自动 | 关闭 ANSI |
| `--verbose` | false | 增加不敏感诊断 |
| `--help` | - | 帮助并退出 0 |
| `--version` | - | 版本并退出 0 |

未知 option、缺参数和冲突 option 退出 `2`。`--` 后内容不再次解析。MVP 不读取用户级全局 Mallok 配置。

配置优先级固定为：命令行显式值 > 允许的 `MALLOK_*` 环境变量 > 项目配置 > 文档默认。环境变量只允许：

- `MALLOK_ADMIN_TOKEN`：管理 token；
- `MALLOK_API_URL`：publish endpoint；
- `MALLOK_AS_OF`：非生产测试时钟；
- `NO_COLOR`、`CI`：通用行为。

Cloudflare 认证环境由 Wrangler 管理，不复制进 Mallok 配置。CLI 不接受 `--token`，避免 token 进入 shell history/process list。

## 2. 输出通道

普通模式：

- stdout：主要结果、生成 URL/path、机器可管道的最终值；
- stderr：进度、warning、诊断和交互提示；
- 密钥、完整 Authorization、未发布正文、环境对象、SQL 和内部 stack 不输出；`--verbose` 也不例外。

`--json` 模式 stdout 只输出一个 UTF-8 JSON object，stderr 除进程启动前的致命错误外保持空；禁止 spinner、ANSI 和交互提示。

```json
{"ok":true,"command":"build","data":{},"warnings":[]}
```

```json
{"ok":false,"command":"publish","error":{"code":"PRECONDITION_FAILED","message":"...","hint":"...","details":[]}}
```

JSON 中 path 一律项目相对 POSIX 格式，除非用户显式要求查看恢复目录；token 和文章正文永远不进入 envelope。

## 3. 退出码

| code | 类别 |
| --- | --- |
| `0` | 成功；纯 no-op 也成功 |
| `1` | 未分类内部错误（应视为 bug） |
| `2` | CLI 用法、配置或参数错误 |
| `3` | 内容/主题/安全校验失败 |
| `4` | 构建、文件系统或预览失败 |
| `5` | revision/CAS/idempotency 冲突 |
| `6` | 认证缺失或无效 |
| `7` | 网络、远程 API、D1 或 Cloudflare 工具失败 |
| `8` | 缺确认、doctor 未通过或部署被阻止 |

单次命令多个错误时返回最高业务相关性而非最大数字：auth > conflict > validation > remote > internal。JSON `error.code` 才是程序逻辑的稳定分支，数字只表示类别。

## 4. 命令协议

### 4.1 `init`

```text
mallok init [directory] [--name <name>] [--site-url <url>] [--language <tag>]
```

- directory 默认 `.`；目标必须不存在或为空；MVP 没有 `--force`；
- TTY 可询问缺失的 site 元数据；非 TTY 必须提供全部必填值；
- 生成 basic-blog、固定依赖版本、`.gitignore` 和无 secret 的 `.dev.vars.example`；
- 任何失败都移除仅由本次创建且仍为空/已知的临时目录，不删除原有文件。

### 4.2 `new article`

```text
mallok new article [slug] [--title <title>] [--published]
```

- slug/title 缺失时只在 TTY 询问；
- 使用安全随机 RFC 9562 UUID v4 生成稳定 id；
- 文件为 `content.directory/<slug>.md`；存在则拒绝；
- 新文件显式写 `draft: true`，避免下一次 static build 意外公开半成品；只有 `--published` 才写 `draft: false`；不自动填 `publishedAt` 或 `updatedAt`。

### 4.3 `validate`

```text
mallok validate [file ...]
```

- 无 file 时扫描全内容目录；file 必须位于 content root；
- 校验配置、全部内容、集合唯一性、主题与资源冲突；
- draft 与 future 内容也必须完整校验；validate 不做发布 selection，也不提供 `--include-drafts`；
- 不写文件、不访问网络。

### 4.4 `build`

```text
mallok build [--target static|cloudflare]
```

- build 始终排除 draft 与尚未到期的 future 内容；草稿预览只通过 `mallok dev --include-drafts`，避免生成可被误部署的草稿目录；
- 写入配置的 output directory 和 `.mallok/build-manifest.json`；
- static构建开始固定一次`asOf`；cloudflare candidate不选择文章，显式`--as-of`返回usage 2，环境`MALLOK_AS_OF`/`SOURCE_DATE_EPOCH`被忽略且不记录；
- 不部署、不运行远程 migration。

### 4.5 `dev`

```text
mallok dev [--host <host>] [--port <1..65535>] [--open] [--include-drafts]
```

- host 默认 `127.0.0.1`，port 默认 `3000`；
- 非 loopback host 必须显式给出，并在 stderr 警告；
- 端口占用时不自动随机选择，返回可操作错误；
- `--open` 是唯一允许启动浏览器的 option；
- 默认选择与 production build 相同；`--include-drafts` 额外包含所有 draft，即使其 `publishedAt` 在未来，但非 draft 的 future 内容仍排除；
- `--include-drafts` 只允许 loopback host，不能与非 loopback `--host` 组合；响应必须 `Cache-Control: no-store` 并带 `X-Robots-Tag: noindex, nofollow, noarchive`，且不得写正式 output 或 build manifest；
- watcher 防抖 100ms，失败保留最后成功页面。

### 4.6 `preview`

```text
mallok preview [--host <host>] [--port <1..65535>]
```

- 只服务最近成功的 static output；cloudflare 使用 `wrangler dev` 的封装测试命令，不冒充静态 preview；
- 默认 `127.0.0.1:4173`；
- GET/HEAD only，目录索引遵循 route plan；路径穿越返回 400；未知路径返回构建的 404。

### 4.7 `doctor`

```text
mallok doctor [--target static|cloudflare] [--remote] [--deep]
```

- 默认只读且本地；检查 Node/pnpm、项目、配置、路径、内容、主题、output 权限；
- cloudflare 额外检查项目内 Wrangler 版本、state/binding/migration 和 secret 是否“存在”，不显示值；
- `--remote` 才允许只读 Cloudflare 查询；未授权或网络失败给明确结果；
- 全新、经精确 state/binding 指向且除批准 provider metadata 外为空的 D1 返回 WARN `DATABASE_MIGRATION_REQUIRED`，不是 FAIL 或完整 PASS；存在部分 Mallok/未知用户对象则 FAIL `DATABASE_SCHEMA_INCOMPATIBLE`；
- `--deep` 只可与 cloudflare `--remote` 同用：每页最多 50 个 current pointer，最多运行 300 秒，完整校验 codec/hash/tag/asset refs/payload ledger；deploy preflight 还传入候选 embedded asset manifest，任一 current URL 缺失返回 FAIL `DEPLOY_ASSET_CLOSURE_FAILED`；同 URL hash 变化允许；超时或中断返回 FAIL `DOCTOR_AUDIT_INCOMPLETE`，不能把部分扫描报告为通过；
- JSON 返回每项 `PASS|WARN|FAIL|SKIP`，存在 FAIL 时退出 8。

### 4.8 `db migrate`

```text
mallok db migrate (--local | --remote) [--dry-run] [--yes]
```

- `--local` 与 `--remote` 必须且互斥，不依赖 Wrangler 隐式默认；
- `--dry-run` 只列 migration 和目标，不写；
- remote 非 TTY 必须 `--yes`；TTY 无 `--yes` 时逐次确认；
- 迁移失败不得继续 deploy；
- 对 pristine remote D1 应用 `0001_initial.sql` 后会留下 bootstrap barrier，命令以 `MIGRATED_NOT_DEPLOYED` 明确结束并要求继续执行同一 candidate 的 `mallok deploy`；不得自行删除 barrier或声称内容写入已可用；
- MVP standalone remote migrate只执行这条首次`0001`；准确schema v1且无pending migration/fence时返回no-op，bootstrap/initial pending时继续返回`MIGRATED_NOT_DEPLOYED`。存在后续migration时返回`REMOTE_MIGRATION_REQUIRES_DEPLOY`，只能由deploy的external fence/journal执行。

### 4.9 `publish`

```text
mallok publish <file ...> [--endpoint <https-url>] [--dry-run] [--yes]
```

- file 必须位于 content root；先本地聚合校验、编译和资源检查，再读取远端版本并显示 `create|update-or-republish|no-op|conflict`。管理 GET 只公开 current/latest metadata，任意更早历史 artifact 是否存在只能由服务端 transaction 判定，因此计划不得伪装成能预知 `updated` 或 `republished`；成功后按服务器 outcome 精确报告；
- 默认 TTY 显示计划后确认；非 TTY 写操作必须 `--yes`；`--json` 不允许交互，因此真实写入也必须 `--yes`；
- `--dry-run` 绝不调用写 endpoint，可做只读 list/health；
- 每篇文章生成独立 idempotency key；网络重试只重放相同 key/body，遵守第 7 节固定 HTTP client budget；
- 部分批次成功时退出 7，逐项报告已成功/未执行/冲突，不声称事务跨文章原子。

### 4.10 `unpublish`

```text
mallok unpublish (--id <uuid> | --file <path>) [--expected-version <n>] [--endpoint <https-url>] [--dry-run] [--yes]
```

- `--id` 与 `--file` 恰一；不接受 slug，避免 rename 后指向错误文档；
- expected version 缺失时先只读查询当前 version，并把它显示在计划中；执行时仍发送该 version；
- TTY 二次确认；非 TTY/JSON 必须 `--yes`；
- 已下线且版本相同返回 no-op 0。

### 4.11 `provision`

```text
mallok provision [--environment <name>] [--adopt-database-id <id>] [--apply] [--yes]
```

- 默认只生成计划，不产生云端副作用；
- `--apply` 才创建/复用资源，TTY 确认；非 TTY 同时要求 `--yes`；
- `--adopt-database-id` 显式恢复/接管一个精确 D1：plan-only 时只读检查，配合 `--apply` 时只原子写本地 state，不修改远端；仅允许账号/配置名称匹配且分类为 pristine 或 Mallok schema v1，unknown/partial 失败；
- 保存非敏感 state 到 `.mallok/state.json`；不创建/回显 secret；
- 资源归属无法证明或同名资源不匹配时停止，不自动接管。

### 4.12 `deploy`

```text
mallok deploy [--environment <name>] [--secrets-file <absolute-path>] [--dry-run] [--yes]
```

- MVP 只支持 `cloudflare` target；static target 只 `build`，部署平台由用户选择；
- 执行 doctor、cloudflare build、state/binding 校验、current asset closure、migration/deploy plan；顺序以 `CLOUDFLARE.md` 第 7 节为准；
- deploy 只读取 build service 返回的 `.mallok/candidates/<inputHash>` 不可变 snapshot，并生成 per-lock Wrangler config；不得把可被并发 build 替换的 `dist/**` 传给 Wrangler；
- `--dry-run` 不调用远程 migration/deploy；
- 真实部署在 TTY 要确认，非 TTY/JSON 必须 `--yes`；
- 不隐式 provision，不隐式运行 `wrangler secret put`；
- `--secrets-file` 只用于首次部署并传给非激活的同一次 Wrangler `versions upload`，显式activation不再读取它：文件必须位于项目根外、是普通非 symlink 文件，Unix mode 不宽于 `0600`，且为无 BOM UTF-8 的单行 `MALLOK_ADMIN_TOKEN=<canonical-token>`（仅允许一个尾随 LF）；不复制、不打印、不删除用户文件；
- 部署在 D1 preflight/external fence 内执行：先以 `versions upload` 创建不接流量的 Worker version，将返回的 canonical lowercase version UUID 持久化为 exact target，再以独立 activation attempt 显式切到 100% 流量；禁止使用上传并立即激活的组合命令。每个逻辑 upload/activation 可在同一锁下原样重传，每次物理调用另有 `providerCallId` attempt journal。随后执行 health 和公开只读 smoke；证据不足或 target active但health失败时保留 external barrier，返回 7 `DEPLOY_RECOVERY_REQUIRED`，不能靠 TTL 自动恢复发布。

### 4.13 `deployment recover/repair/rollback`

```text
mallok deployment recover --environment <name> --lock-id <uuid-v4> [--secrets-file <absolute-path>] [--abort-to-baseline] [--apply] [--yes]
mallok deployment repair --environment <name> --lock-id <uuid-v4> [--secrets-file <absolute-path>] [--apply] [--yes]
mallok deployment rollback --environment <name> --version-id <canonical-lowercase-uuid> [--lock-id <uuid-v4>] [--dry-run] [--yes]
```

- recover/repair 默认只读计划；非 TTY/JSON 的真实动作必须 `--yes`，两者还必须显式 `--apply`；不存在 `--force`、`--break-lock` 或“按过期时间直接删除 external”路径；
- recover 读取 exact D1 fence/stage、`deployment-attempt.schema.json` journal、Cloudflare active version/deployment、tag/messages、本地 immutable snapshot/canonical manifest/inventory 和当前 asset closure，默认 resume 同一逻辑意图：`version_upload_started` 先以新的`providerCallId` journal `version-observation`，非空匹配集选最小canonical UUID并持久化exact target，空集才可重复相同非激活upload；`version_ready|activation_started` 只可重复激活该 target；`activation_complete` 复核 health/state后释放。重传保持逻辑 attempt不变，每次实际 provider call 生成新`providerCallId`。首次 upload 缺远端 required secret 时必须重新提供`--secrets-file`；缺失返回`RECOVERY_SECRET_REQUIRED`且barrier不变；
- `--abort-to-baseline` 是 recover 的显式替代动作，和`--secrets-file`互斥，只允许非首次 `purpose=deploy`：provider active精确等于持久化baseline，且尚无activation request，或该logical activation的每份request都有terminal-failed result（不能存在缺result调用）；migration还须对baseline向后兼容，closure/ledger通过。满足后保留既有不可变判据并释放，不创建新evidence格式、不删除未激活version。initial、activation outcome unknown、active为target/第三方version或证据缺失都拒绝；
- repair 只处理 exact `purpose=deploy` external lock，但允许三种已证明边界：version upload terminal-failed且随后完整version-observation success为空；每份activation request都有terminal-failed result、无缺result调用且active仍为baseline（initial仍无active）；target active但health失败。它冻结新candidate，在同一barrier重做manifest/inventory/schema/closure，并以单一CAS替换四hash、清空target/deployment/upload+activation attempts、退回`migration_complete`；旧target已active时才把它设为新baseline。activation outcome unknown只能recover同一target。首次部署无baseline时，recover或repair是仅有路径；
- rollback 的 `--version-id` 必须严格解析为canonical lowercase UUID，禁止默认“上一个”。目标必须存在本地current/previous evidence，并以原始version operation/attempt与四hash重建核对tag/version message、canonical manifest/inventory、D1 schema/profile与current URL closure；短tag不能单独证明；
- 没有既存 external barrier 时 rollback 获取新 rollback fence并把目标直接持久化为`version_ready`，不上传新version。从失败deploy/rollback barrier恢复时必须给准确`--lock-id`，CAS更新baseline/target/四hash、清空target deployment与activation attempt并回到`version_ready`，再以新activation attempt显式切换；不能另开第二把锁。rollback health失败只能同锁选择另一个可信version，不能调用repair；
- Worker 切换结果不确定时保留 barrier；只有目标 version active 且 health/smoke 通过后才能记录 state并释放。数据库 schema 不随 rollback 回退。

## 5. 确认、non-TTY 与 CI

写操作的有效授权矩阵：

| 环境 | 无 `--yes` | `--yes` |
| --- | --- | --- |
| TTY | 显示计划并询问 | 显示计划后执行 |
| non-TTY 且 `CI` 未设置 | 退出 8 | 显示计划后执行 |
| `--json` | 退出 8 | 返回单 JSON envelope |

`--yes` 只跳过交互，不跳过 doctor、校验、计划或安全边界。`--dry-run` 优先于 `--yes`，永远无远端写入。

MVP 检测到 `CI=1` 时，Cloudflare 基础设施 mutation（`provision --apply`、`db migrate --remote`、`deploy`、`deployment recover|repair|rollback`）即使带 `--yes` 也以 8 `REMOTE_MUTATION_UNSUPPORTED_IN_CI` 拒绝；这些命令的 plan/dry-run 仍可执行。原因是 fence recovery 依赖 gitignored 本地 state/snapshot/evidence，而临时 runner 没有已定义的加密 durable store。`publish/unpublish` 是带幂等键的内容 API 操作，不受这条 infrastructure gate 影响，但仍遵守 non-TTY/`--yes` 与 token 边界。

## 6. 中断与信号

- SIGINT 在写操作开始前退出 130；
- 写操作中止时等待当前原子远端请求结束，报告可能已完成的 request id/idempotency key 摘要，不自动反向删除；
- dev/preview 首次 SIGINT 优雅关闭，第二次强制退出；
- CLI 自己不捕获并打印原始 stack，只有 `MALLOK_DEBUG=1` 的本地开发构建可输出经过 secret redaction 的 stack；该变量不属于生成项目文档接口。

## 7. 远程 HTTP client budget

publish/unpublish/management GET 共用一个受控 client：

- 每个 attempt 从 dispatch 到完整读取 response body 的 deadline 为 `15,000 ms`；超时取消 reader并返回 `REMOTE_TIMEOUT`；
- response body 最多 `2,097,152 bytes`；流式读取第 `2,097,153` byte 时立即取消并返回 `REMOTE_RESPONSE_TOO_LARGE`，不能先分配无界字符串；
- 每个 item **最多 3 次总 attempts**，不是 3 次重试。attempt 2/3 的固定 delay 为 `250 ms`、`1,000 ms`；clock/sleeper/AbortSignal 可注入测试；
- 只重试：收到可判定为暂时性的连接/读取网络错误，或 HTTP `502|503|504`。任何 4xx、其他 5xx、schema/JSON 不合法或超大 response 都不重试；
- `Retry-After` 只接受唯一 canonical decimal seconds `0..5`，存在时替代该次固定 delay；缺失使用固定 delay。非法、重复或大于 5（例如 deployment preflight 的 `60`）时不自动等待/重试，直接报告原稳定错误；
- mutation 重试必须复用完全相同 URL、headers、idempotency key 和 body bytes；已读到不符合 OpenAPI 的 2xx 也不能换 key重发。批量的 budget 按 item 独立，不形成跨文章事务。
