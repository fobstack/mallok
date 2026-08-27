# Mallok 版本与兼容性策略

- 状态：Accepted for MVP
- 适用阶段：首次持久化数据之前及之后

## 1. 发布单位

MVP monorepo 的 `@mallok/core`、`@mallok/cli`、`@mallok/cloudflare` 与 `create-mallok` 锁步发布同一 Mallok version。生成项目固定精确版本，不使用 `^`/`latest`。主题和配置 contract 有独立 schema/API version，但由同一兼容矩阵解释。

## 2. 版本轴

| 轴 | 初始值 | 破坏性变化要求 |
| --- | --- | --- |
| Mallok package | `0.1.0` | SemVer；pre-1.0 minor 可破坏但必须 migration guide |
| Config schema | `1` | schema bump + loader 错误/迁移器 |
| Content schema | `1` | schema bump + artifact hash 变化 |
| Compiler | `1` | output 语义变化即 bump |
| Sanitize profile | `mallok-default-v1` | allowlist/URL/raw HTML 变化即新 id |
| Persisted artifact/row-codec format | `1` | `artifact_format_version`；D1 representation/envelope/codec validation 任一变化即 bump，不另设第二版本轴 |
| Theme API | `0.1` | pre-1.0 minor 可破坏，必须 codemod/guide |
| Admin HTTP API | path `/v1` | wire breaking change使用 `/v2` |
| Build manifest | `1` | reader/writer兼容或 schema bump |
| Candidate inventory | `1` | exact-file-set/hash/path语义变化即 schema bump |
| Deploy plan | `1` | action/recovery wire变化即 schema bump |
| Deployment state | `1` | 本地迁移或明确拒绝 |
| Deployment attempt evidence | `1` | request/result、operation/purpose或重传语义变化即 schema bump |
| D1 schema | migration sequence | 已发布 migration 不修改 |

## 3. artifact 与 row 兼容

`artifactHash` 覆盖 source hash、content schema、compiler、sanitize profile 和 compile options，精确 canonical 输入以 [ARCHITECTURE.md](ARCHITECTURE.md) 第 5 节为准。任何影响 HTML 的变化必须产生新 artifact，即使 Markdown 不变。

`decodeCompiledEntry` 是 core 提供给 adapter 的窄 codec API：它校验完整 row shape、hash 与受支持 profile 后才在 core 内 mint `SafeHtml`。不公开任意 string → SafeHtml。

Worker 至少支持当前发布声明的 profile。未知/被撤销 profile：

- 公开文章返回 503 与通用错误页，不回传 source/body；
- 同步 health 只检查全局 runtime/schema tuple，不扫描 current row，因此不能承诺发现某个未知 row profile；该问题由公开 row 读取或 `doctor --remote --deep` 发现，运维层将相应 503 分类为 degraded，这不是新增 wire `status` 值；
- `doctor --remote --deep` / deploy preflight 阻止并列出受影响 revision 数量；
- 不在访客请求中重编译；
- 通过经审阅 migration/re-publish 流程修复。

MVP `0.1.x` 内冻结 content/compiler/sanitize/codec profile，不允许写入后再做破坏性变更。若安全修复必须变化，发布一个同时解码旧 profile 的过渡 Worker，部署后用新 server compiler 重发布当前 Markdown，再在后续 minor 移除旧 decoder。该过程必须有新 ADR、staging 演练和回滚窗口。

## 4. D1 滚动升级规则

1. schema migration 必须先保持旧 Worker 可运行；
2. 应用 migration；
3. 部署可读旧/新 row 的新 Worker；
4. 按需重发布或 backfill；
5. 验证无旧 row；
6. 后续版本才删除兼容字段/decoder。

无法满足向后兼容时必须声明维护窗口、备份和恢复步骤，不得在普通 `mallok deploy` 中隐藏破坏性操作。

部署协议的持久版本轴不能由 package version 暗示。D1 `external_stage`、`.mallok/state.json` 与 `deployment-attempt.schema.json` 必须分别按自身 schema/version 解析；未知值 fail closed。MVP 冻结为非激活 version upload → journaled version observation → 持久化 canonical lowercase target UUID → 独立 100% activation。改变 stage 名称、version/activation message 字节、`observedMatchingVersionIds`/target选择、logical attempt 与 `providerCallId` 关系、request/result 路径或同锁重传规则，必须同步 bump 对应 deployment schema 并提供本地 evidence migration；不能把旧 evidence 按新语义猜测恢复。

## 5. Theme 与生成项目

- Theme API `0.1` 只保证同一 Mallok minor 内兼容；
- 主题 default export 必须显式 `apiVersion`，不猜测旧接口；
- create-mallok 固定 Mallok 精确版本与 lockfile；
- `mallok upgrade` 不在 MVP。升级由用户修改依赖、阅读 migration guide、运行 doctor/build/test；
- basic-blog golden fixture 与每个受支持 Theme API 版本一起测试。

## 6. 环境兼容矩阵

首个 MVP 开发/CI 基线：

| 项 | 支持/锁定 |
| --- | --- |
| Repository Node | `22.22.2`（CI 另测最新 Node 24） |
| pnpm | `11.1.3`，通过 `packageManager` 锁定 |
| Core runtime | `>=22.0.0`，以实际 production deps engines 为准 |
| Repository tooling | `^22.13.0 || >=24.0.0` |
| Wrangler | `4.126.0` 精确版本 |
| Workers types | `5.20260827.1` 精确版本 |
| Cloudflare local pool | `0.22.0` 精确版本 |
| YAML parser | `yaml@2.9.0` 精确版本 |
| HTML5 parser | `parse5@8.0.1` 精确版本 |
| Neutral bundle gate | `esbuild@0.28.2` 精确版本 |
| Admin JSON parser | `jsonc-parser@3.3.1` 精确版本（MIT；strict mode + duplicate-key visitor） |
| OS | macOS、Linux；Windows 路径测试，运行支持为 best effort |

锁定版本是 2026-08-27 的开发基线，不是永久推荐。升级必须单独提交、运行完整 matrix，并核对 Cloudflare 生成配置官方 schema。

## 7. 弃用

- CLI option/JSON field 在移除前至少跨一个 minor 发出稳定 warning；
- HTTP v1 request/response 均以当前 OpenAPI strict schema 为准；增加 response 字段也要更新文档版本与 consumer tests，客户端是否宽松处理不属于服务端保证；既有字段类型/语义的破坏性变化使用新 major path；
- 数据库 migration 和错误码一旦发布不可复用旧编号/含义；
- 安全漏洞导致的立即移除可以跳过普通弃用周期，但必须在 release note 与 migration guide 解释。
