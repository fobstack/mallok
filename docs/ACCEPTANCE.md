# Mallok MVP 验收标准

- 状态：Normative
- 日期：2026-08-27

本文件定义可验证结果；字段行为以各 reference 为准。命令仅在对应实现 task 合入后生效。每条证据必须记录 verified SHA，未运行不得标记通过。

## 0. 文档阶段

- **AC-0-01**：docs index 列出的 required 文件全部存在，Markdown 相对链接无断链。
- **AC-0-02**：PRD 的 FR-001..015、NFR-001..005 全部出现在 TRACEABILITY，且映射 task/AC。
- **AC-0-03**：config/build-manifest/asset-manifest/candidate-inventory/deploy-state/deploy-plan/deployment-attempt/release-evidence/staging-authorization/staging-ownership JSON Schema 与 OpenAPI 可被标准 parser 读取；schema 能表达的 URL/path/type 反例必须失败，UTF-8 bytes、aggregate key/depth、realpath、exact-origin/cross-field equality 等不可准确表达的限制必须有显式 machine description/vendor extension并由Mallok runtime validator反例覆盖。
- **AC-0-04**：reference 不含待定占位符、未裁决的互斥行为或从 `.claude/**` 读取的阈值。
- **AC-0-05**：publishedAt/activatedAt、artifact/no-op/re-publish、route/asset、codec/profile 在所有文档中语义一致。
- **AC-0-06**：STATUS 明确主分支实现状态；未实现命令不被描述为当前已通过。

文档 lint 命令目标：`pnpm docs:check`；在 package scripts 创建前由 reviewer 使用只读 link/schema/OpenAPI checker，证据注明实际命令。

## 1. Phase 1A

- **AC-1A-01**：core production dependency graph 无 Node/Cloudflare/FS/HTTP API，ESM package export 在 tarball consumer 可解析。
- **AC-1A-02**：合法 CommonMark/GFM 编译为运行时不可伪造 `SafeHtml`，caller-owned object 不被修改/冻结。
- **AC-1A-03**：HTML/URL/JSON helper 与 sanitizer 通过 SECURITY §3 corpus；script/style/comment/raw-text 歧义 fail closed；`jsonScript` 的精确 UTF-8 bytes → SHA-256 → 标准 Base64 CSP source、组合去重排序和伪造拒绝通过 golden；Markdown 图片 URL 类别只接受 HTTPS 或绝对 `/assets/...`。
- **AC-1A-04**：固定 clock 的 draft/future/no-date 可见性与 BUILD §2 排序向量一致。
- **AC-1A-05**：slug/route/output path 拒绝 POSIX/Windows/percent/NUL/device/path traversal corpus。
- **AC-1A-06**：canonical JSON 拒绝 cycle/sparse/array extra key/symbol/getter/Proxy/非有限数；跨运行时 golden hash 一致。
- **AC-1A-07**：sourceHash/artifactHash 覆盖准确 profile；相同 source + 新 compiler/schema/sanitize 产生新 artifact。
- **AC-1A-08**：core 覆盖率 lines/statements/functions ≥90%、branches ≥85%，lint/typecheck/build 成功。

命令：`pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm test:security && pnpm build && pnpm pack:check:core`。

## 2. Phase 1B

- **AC-1B-01**：workspace-local CLI 在空目录 init，生成项目无需全局 Mallok 即可 build 全部核心 routes/assets。
- **AC-1B-02**：CONTENT_CONFIG 的 default/strict field/path/project-root 行为与 JSON Schema 一致。
- **AC-1B-03**：YAML/parser/file discovery/UTF-8/size/symlink/聚合诊断 corpus 通过，诊断稳定排序并包含 file/field/code/hint。
- **AC-1B-04**：同 `asOf` 下 loader/build 的可见集合和顺序与 core 相同；mtime 不影响。
- **AC-1B-05**：public/generated/theme 路由冲突全部阻止，写入不越界；asset 单/总 bytes、文件/entry 数、path segment/UTF-8 bytes 的边界和 `+1` 反例稳定失败；production build 对全部可见内容、`mallok validate` 对包括 draft/future 在内的全部内容执行同一 media manifest 校验，Markdown `/assets/...` 引用缺失都必须失败。
- **AC-1B-06**：基础主题全部 renderer/template/context/head/jsonLd 通过 THEME_API；Node/Worker bundle smoke 成功。
- **AC-1B-07**：static output 包含首页、文章、404、RSS、sitemap、theme/public assets，默认无 client JS。
- **AC-1B-08**：两个绝对根、改变 mtime/enumeration 后 build bytes/manifest hash 一致；故障注入保留旧 output 或给出可恢复路径。
- **AC-1B-09**：doctor 对 Node/pnpm/config/content/theme/path/output 返回稳定 PASS/WARN/FAIL，FAIL 退出 8 且无 secret。
- **AC-1B-10**：RSS 固定 RSS 2.0、最多 50 篇、canonical URL guid、无正文且缺 `publishedAt` 时省略 `pubDate`；sitemap 固定 Sitemap XML 0.9、首页+全部可见文章、`lastmod` 优先 `updatedAt`；两者 XML escaping、排序、换行和 fixed-`asOf` bytes 确定。

命令：

```bash
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm build
pnpm test:integration
pnpm test:e2e:static
pnpm test:determinism
pnpm test:cross-runtime
```

## 3. Phase 1C

- **AC-1C-01**：dev 默认 `127.0.0.1:3000`，非 loopback 仅显式启用并警告。
- **AC-1C-02**：content/theme/config/public 变化按 100ms trailing debounce 更新；每次成功 generation 通过仅 dev 的 SSE `reload` event 驱动同源 external client 恰好刷新一次，断连不泄漏 listener；production build 与 preview 均无 client 注入且两个 dev endpoint 都为 404。
- **AC-1C-03**：重建失败 watcher 存活、继续服务最后成功页面，并输出聚合安全诊断。
- **AC-1C-04**：preview GET/HEAD、404/MIME/nosniff 正确，traversal/double-decode/encoded separator 阻止。
- **AC-1C-05**：SIGINT、端口占用、并发变更与关闭句柄测试通过；不残留 temp server/process。
- **AC-1C-06**：dev 默认排除 draft/future；loopback `--include-drafts` 包含全部 draft、仍排除非 draft future，响应 no-store/noindex 且不写 output/manifest；与非 loopback host 组合必须在监听前拒绝。

命令：`pnpm test:integration && pnpm test:e2e:dev && pnpm test:security`。

## 4. Phase 2A

- **AC-2A-01**：全新 local D1 依次应用全部 migration；重复 apply no-op；失败 migration 回滚。
- **AC-2A-02**：row codec 用单一 `artifact_format_version` 验证 artifact envelope/codec、schema/compiler/sanitize/options/hash/asset refs/payload bytes；篡改/未知 profile fail closed，不能伪造 SafeHtml；SQL CHECK 独立拒绝伪造 payload，state singleton 不可删除且缺失时 insert fail closed；0001 原子创建 bootstrap deployment barrier。
- **AC-2A-03**：published repository 使用参数化 query，limit/offset/tag/稳定排序与 no-date/future 语义正确；首页/RSS 只取 metadata summary、绝不选择 source/body/data/template/asset refs，并在同一 statement 将 ordered `revision_tags` 投影与 canonical `tags_json` 字节比较，缺/多/乱序均 fail closed且无 N+1；单批 aggregate 超过 2 MiB 返回稳定 503。
- **AC-2A-04**：slug rename、revision/tag/current pointer row mapping 符合 DATABASE，不丢 identity/history。
- **AC-2A-05**：Worker GET/HEAD/308/404/405/raw-path routing 符合 HTTP/CLOUDFLARE；只有不带 query 的 `/index.html` 与合法 article redirect candidate 返回 308；Worker-managed canonical dynamic route 除唯一合法 `__mallok_rev` 外的 query、以及 redirect candidate 的任何 query 为 400；未知 path 在 asset miss 后保持主题 404，asset-first 命中的静态资源 query 由平台处理且不访问 D1；malformed/危险 path encoding 为 400，语法有效但非 canonical article path 为 404。由 Worker 前置拒绝的请求其 redirect、D1 和显式 `env.ASSETS.fetch` 调用数为 0。
- **AC-2A-06**：文章、首页、RSS、sitemap 来自同一 published projection；draft/future/unpublished 不可访问；sitemap 使用一次有界轻量查询取得同一 statement snapshot，最多返回 10,001 行以检测越界。
- **AC-2A-07**：生成 Wrangler config 固定 `assets.html_handling="none"`；ASSETS 命中不访问 D1，动态路由不存在同名 static asset，平台默认 HTML handling 不产生契约外 307。
- **AC-2A-08**：固定 fixture/theme/clock 的 static 与 Worker DOM/feed/asset URL golden 一致。
- **AC-2A-09**：ETag/If-None-Match/HEAD/cache header local logic 正确；cache-busted D1 request 使用 `first-primary`、普通公开读取可用 replica；JSON-LD CSP hash 与最终 script text bytes 一致且 header snapshot 不含 `unsafe-inline`；生成 `_headers` 固定资产 300 秒缓存、不可被 public/theme 覆盖且不进入 manifest；不在此阶段声称真实 CDN 60 秒。

命令：`pnpm test:e2e:cloudflare-local && pnpm test:cross-runtime && pnpm test:security`。

## 5. Phase 2B

- **AC-2B-01**：缺/错/未配置 auth、错误 Content-Type/method/header 按 OpenAPI status/envelope 拒绝且 no-store。
- **AC-2B-02**：publish 2 MiB request 门在 parse 前执行；schema strict；带 offset RFC3339 输入时间规范化为 `.sssZ` response/persistence；服务端编译，客户端不能提交 trusted HTML/hash/time；dynamic source/body/row byte 上限分别准确执行。
- **AC-2B-03**：publish CAS + deployment fence + revision/pointer/version/idempotency/payload ledger 在单个 transaction-safe operation；active preflight/bootstrap/external/releasing 时新 publish/unpublish 原子 503且零写，已保存 replay 可返回；每个故障点无半状态，256 MiB ledger 超限原子返回 507。
- **AC-2B-04**：同 key/same request 重放保存响应；same key/different hash 409；response 丢失重试安全。
- **AC-2B-05**：当前已发布相同 artifact 为 no-op/version 不变；unpublish 后相同 artifact re-publish 恢复 pointer/version+1/action=republished。
- **AC-2B-06**：同 id 改 slug 保留 history，新 URL 200、旧 URL 404；重复 slug conflict 无写入。
- **AC-2B-07**：unpublish CAS/idempotency/pointer/version 原子；已下线同 expected version no-op。
- **AC-2B-08**：API/error/log 无 token、SQL、stack、绝对 home path或 Markdown/frontmatter body。
- **AC-2B-09**：存储型 XSS、JSON-LD breakout、SQL injection、tampered row/security corpus 通过。
- **AC-2B-10**：publish CLI 先完整本地校验/asset manifest 检查，再显示 `create|update-or-republish|no-op|conflict`；任意历史 artifact 是否复用以服务端 `updated|republished` outcome 为准。
- **AC-2B-11**：TTY/non-TTY/JSON/--yes/--dry-run 行为符合 CLI；dry-run 无写。
- **AC-2B-12**：批量部分成功准确报告并非零退出，不把跨文章操作声称为原子；HTTP client 固定每 attempt 15 秒、response 2 MiB、最多 3 个总 attempts、250/1000ms backoff和闭合 retry status/Retry-After 规则，clock/reader cancellation 可测。
- **AC-2B-13**：当前可见 publish 的 cache-busted verification 返回新 revision/artifact headers与合法公开弱 ETag，随后同 ETag 得 304；管理 response body/header 使用另一条强 document ETag且互相一致；future publish 以管理 GET 验证 pointer/revision且公开 cache-busted URL 保持 no-store 404；本地 cache logic 覆盖首页/文章/feed。
- **AC-2B-14**：unpublish 只接受 id/file，不接受歧义 slug，并携带 expected version。
- **AC-2B-15**：管理 list/get 每个 item 来自单 statement snapshot；created/updated/republished/unpublished/no-op/replay 的 document/revision/pointer/state 系统时间严格符合 DATABASE §7.1，失败 batch 不留下 latest revision 或时间变化。

命令：`pnpm test:e2e:publish-local && pnpm test:e2e:publish-cli-local && pnpm test:security && pnpm test:integration`。

## 6. Phase 2C

- **AC-2C-01**：state/generated Wrangler config 符合 schema且 gitignored，无 secret；固定 DB/ASSETS/required secret，并显式启用 Workers Caching。
- **AC-2C-02**：doctor 能核验 local state、project Wrangler、binding/migration/profile/secret existence，不显示 secret；state 缺失时 remote doctor 只读发现候选并给 `provision --adopt-database-id` 指引，文件写入数为 0。
- **AC-2C-03**：provision 默认 plan-only；同资源重复 apply no-op；显式 adopt 必须验证完整 id/账号/名称/closed DB classification并确认，apply 只原子重建当前 projectId 的本地 state、远端 mutation=0；无法证明目标时 blocked。
- **AC-2C-04**：所有 D1 操作显式 local/remote；remote mutation 要确认；migration 失败不 deploy。
- **AC-2C-05**：deploy dry-run 不创建、迁移、设置 secret或部署任何资源。
- **AC-2C-06**：真实动作前计划列 account/environment/Worker/D1/migrations/assets，non-TTY 缺 `--yes` 退出 8；`CI=1` 的 Cloudflare infrastructure mutation 即使有 `--yes` 也退出 8，plan/dry-run 保持零写。
- **AC-2C-07**：模拟失败正确分类 NO_REMOTE_CHANGE/MIGRATED_NOT_DEPLOYED/DEPLOYED_HEALTH_FAILED 并给恢复方式。
- **AC-2C-08**：只调用项目锁定 Wrangler；静态 target 不虚构平台 deploy。
- **AC-2C-09**：revision 持久化最多 100 个 canonical local asset URL refs；deploy 在 D1 preflight fence 内将候选 manifest 与全部 current pointer 分页交叉校验，缺 URL 以 `DEPLOY_ASSET_CLOSURE_FAILED` 阻断；同 URL bytes/hash 变化允许。publish-before-acquire 必须被扫描看到，acquire-before-publish 必须原子 503，过期 preflight 不得进入 external。closure、canonical full-file inventory、evidence、per-lock config 与 Wrangler 必须消费同一只读 candidate snapshot；并发替换 `dist` 不改变实际部署字节，inventory漏项/多项/hash漂移均在external call前阻断。
- **AC-2C-10**：首次 deploy 的 `--secrets-file` 只接受项目外、普通非 symlink、Unix owner-only 文件且只含一个 canonical `hex:` 或 `b64u:` 管理 token；decode 后 raw length 必须为 32–128 bytes，非 canonical 编码失败；内容不进入 argv/log/state/evidence，deploy 不调用 `wrangler secret put`，用户文件不被 Mallok 删除。
- **AC-2C-11**：state/binding 精确匹配且 schema 检查证明 pristine/unmigrated 的新 D1 将 current set 视为空；0001 原子留下 bootstrap barrier，首次 deploy claim 后按 classify→confirm→initial migration→schema/profile/empty-set recheck→external→非激活version upload→持久化exact target UUID→显式activation→resolve 完成。claim 后崩溃形成的 initial preflight 可在再次证明 DB 空且无 active Worker 后安全 takeover；首次 upload/activation terminal-failed 可同锁 repair 新 candidate，但没有 baseline 时绝不能 abort/unlock。partial/unknown/nonempty incompatible D1 在任何未授权 remote mutation 前以 `DATABASE_SCHEMA_INCOMPATIBLE` 阻断。
- **AC-2C-12**：deploy保存canonical lowercase active/previous Worker version/deployment UUID、immutable candidate/manifest/inventory及独立version-upload/activation logical attempt evidence并验证tag/messages。no-op要求D1无active barrier、provider current、四hash、三份exact-bytes evidence、migration和health全部匹配。external journal覆盖`ready/migration_started/migration_complete/version_upload_started/version_ready/activation_started/activation_complete`逐点故障；upload永不激活，target先持久化再activation，同logical attempt可重传且每次providerCallId唯一，多个匹配version按UUID确定性选择；同一logical attempt跨全部journal record的purpose、四hash、tag、message以及activation target保持不变，跨文件漂移在provider call前fail closed。recover重传exact intent；terminal-failed可同锁repair新candidate；normal仅在active=baseline、尚无activation request或其每份request都有terminal-failed result且无缺result调用、migration兼容及closure/ledger通过时显式abort-to-baseline，initial不可abort。rollback显式canonical version UUID，在同锁回到version_ready并以新activation attempt切换，不能另开锁。

命令：`pnpm test:e2e:deploy-dry-run && pnpm test:integration`。第一个脚本必须通过测试 composition root 启动真实 CLI parser/dispatcher，注入 `RecordingCloudflarePort`，覆盖 provision、deploy dry-run、db migrate、fence/recover/repair/rollback plan；remote network 与 mutation 均为零，禁止用 production-visible 环境变量切换 fake。

## 7. Phase 3

- **AC-3-01**：在无全局 Mallok 的临时目录安装 tarball，按 README 完成 init/new/build/preview。
- **AC-3-02**：packlist、ESM/type consumer、license、prod audit、secret/history scan 通过。
- **AC-3-03**：migration/upgrade/rollback/troubleshooting/known limitations 文档可按步骤执行，无隐含 prompt。
- **AC-3-04**：性能/a11y/OS/Node matrix 按 TESTING 固定环境记录，不用单次最好值。
- **AC-3-05**：全套 `pnpm verify` 对 release SHA 通过，无 P0/P1 finding。
- **AC-3-06**：由人工云端操作者在有效、限时、绑定 candidate SHA 与 T-012 evidence hash 的授权 marker 下完成 fresh-only staging provision→migrate→deploy→health→publish→GET→unpublish→cleanup；同名 Worker/D1 或本地 staging state 任一已存在则在写入前阻断，不 reuse/adopt；只删除同 run ownership manifest 证明为本次创建的精确资源，保存脱敏证据；无授权、超出 cleanup window 或 ownership 不明则未通过且不删除。

## 8. 跨阶段 NFR

- **AC-NFR-01**：1000 篇 fixture clean static build 中位数 ≤10s（指定机器/5 次）。
- **AC-NFR-02**：local warm Worker article p95 ≤100ms，查询有 limit/index；只作本地基线。
- **AC-NFR-03**：真实 staging 普通首页/文章/RSS/sitemap publish 后 ≤60s 一致；只在 AC-3-06 测。
- **AC-NFR-04**：secret/history scan 无真实 credential。
- **AC-NFR-05**：HTML/mXSS/URL/JSON 安全 corpus 全通过。
- **AC-NFR-06**：SQL/CAS/idempotency/fault injection 全通过。
- **AC-NFR-07**：path/symlink/junction/output recovery corpus 全通过。
- **AC-NFR-08**：管理 API/日志/错误隐私规则全通过。
- **AC-NFR-09**：Node/OS/Worker compatibility matrix 通过或明确记录 best-effort 不支持项。
- **AC-NFR-10**：所有包 strict type/lint，core production boundary 无平台泄漏。
- **AC-NFR-11**：覆盖率达到 TESTING §10，不存在未说明 skip/ignore/hardcode。
- **AC-NFR-12**：公共破坏性变更有 ADR、version bump 和 migration guide。
- **AC-NFR-13**：基础主题 axe 无 critical/serious violation，键盘/landmark/contrast 人工检查通过。
- **AC-NFR-14**：Cloudflare local 的 100 条最大合法 summary fixture 不读取正文且峰值受 2 MiB aggregate 门约束；不得构造可能超过 Workers 128 MiB isolate 限制的集合读取。
