# Mallok 运行、恢复与排障手册

- 状态：MVP runbook baseline
- 适用阶段：Phase 2A–3

## 1. 环境与责任

MVP 约定 `local`、`staging`、`production` 三类环境。local 无真实账号；staging/production 必须使用不同 Worker/D1 名称、state entry 和 secret。Mallok 不提供多租户控制面，资源和账单仍由用户 Cloudflare 账号负责。

## 2. 发布前检查

```bash
mallok validate
mallok build --target cloudflare
mallok doctor --target cloudflare --remote --deep
mallok db migrate --remote --dry-run
mallok deploy --dry-run
```

确认：目标 account/environment/resource、待应用 migration、candidate asset manifest、全部 current revision 的 asset closure、required secret existence、当前 published row codec、git status/secret scan。deep doctor 需要已生成 candidate manifest；dry-run 无任何远端写入。

## 3. 健康状态

管理 health 成功时返回 HTTP 200 和 `status: "ok"`。失败时按 HTTP 契约返回 503 error envelope；运行手册将 `PUBLISHED_REVISION_INCOMPATIBLE`/数据库读取失败归为 degraded，将 binding、secret 或 schema 缺失归为 unavailable。这两个词是运维分类，不是额外的 HTTP `status` 枚举。

health 不返回 account/database id、表名细节、token、文章内容或 stack。公开监控可只检查首页和一篇 synthetic article 的 status/ETag；详细 health 需要 auth。

## 4. 常见事件

### 4.1 `PRECONDITION_FAILED`

原因通常是另一发布者已更新。先重新读取 document version、slug 与 revision/source/artifact hash，和本地作者源比较可用的 metadata/hash；MVP 管理 GET 不返回远端正文，不能伪造逐字段 body diff。用户决定保留远端或以新 expectedVersion 重试。不得自动 `force` 覆盖。

### 4.2 idempotency 冲突

同 key 不同 request 表示客户端 bug或错误重用。生成新 key 之前必须确认原请求是否已提交；不要删数据库记录“解锁”。同 key同 hash 应返回第一次保存的 response。

### 4.3 `PUBLISHED_REVISION_INCOMPATIBLE`

立即停止 deploy/publish；公开 route 对受影响内容返回通用 503。记录数量/profile 摘要，按 [VERSIONING.md](VERSIONING.md) 的过渡 decoder/re-publish 流程处理。不要直接把 D1 body_html 标为安全，也不要请求时重编译。

### 4.4 migration 成功、deploy 失败

状态为 `MIGRATED_NOT_DEPLOYED`。检查 D1 fence journal：首次 `0001` 后的 bootstrap/initial 状态由 deploy 继续；external 中断只能用 exact lock 的 recover/repair/rollback。`recover --apply` resume 原 candidate：非激活 version upload 可以按同一逻辑 attempt 安全重传，得到 canonical target UUID 后才显式 activation；首次 required secret 尚不存在时重新提供`--secrets-file`。先确认 migration terminal 且对 baseline Worker 向后兼容；不得另开普通 deploy。candidate 确定性失败时同锁 repair；normal 且满足全部证据时可显式`recover --abort-to-baseline --apply`，initial 不可 abort。

### 4.5 deploy 成功、health 失败

状态为 `DEPLOYED_HEALTH_FAILED/DEPLOY_RECOVERY_REQUIRED`。D1 external barrier 保持 active，新 publish/unpublish 会 503；保留 lock、version-upload/activation attempt、deployment evidence 和 candidate snapshot，检查 binding/schema/secret existence 与 Worker logs。不得按 TTL 或手写 DELETE 解锁。健康 target 可用 `recover` 补写 state/release；有可靠旧 baseline可同锁显式 `rollback`；target 已 active但不健康（包括没有 baseline的首次部署）用同一 lock 的 `deployment repair` 构建新 candidate，先上传新 version、持久化 exact target，再激活。数据库schema不自动回滚。

### 4.5.1 deployment fence recovery/rollback

- preflight lease 失败且没有发出 external call 时可按精确 id 安全释放；过期 lease 可由新计划原子接管，旧 id 不能复活；
- external/releasing barrier 永不因时间自动失效。recover 必须核实 Cloudflare canonical lowercase active/baseline/target version UUID、deployment UUID、version/activation tag/message、保存的 immutable snapshot/canonical manifest/inventory、通过`deployment-attempt.schema.json`的attempt journal和当前D1 closure；事实不完整就继续阻止发布；
- `ready|migration_started|migration_complete`按terminal migration history继续；`version_upload_started`先用新`providerCallId`记录`version-observation` request/result，按去重升序匹配集的最小lowercase UUID持久化`version_ready`，空集才重传相同非激活upload；`activation_started`只可重传同一exact target。每次物理调用都有新的`providerCallId`，首次缺required secret时重新提供安全`--secrets-file`；
- repair 只可在`purpose=deploy`同一lock进行：upload terminal-failed且随后完整version-observation success为空；每份activation request都有terminal-failed result、无缺result调用且active仍为baseline/initial-none；或target active但health失败时，conditional retarget新snapshot/inventory并清空旧target及两类attempt。activation unknown只能exact-target recover；repair不能用于rollback、新开lock或修改D1 schema；
- normal deploy 只有active精确等于baseline，且尚无activation request或每份request都有terminal-failed result、没有缺result调用，同时migration向后兼容且closure/ledger通过时，才可由操作者显式`recover --abort-to-baseline --apply`。initial无baseline时永不允许abort，只能recover或repair；
- rollback 必须显式 canonical lowercase Worker version UUID，禁止默认“上一个”。目标 evidence 必须用原始version operation/attempt与完整candidate/Worker/asset/inventory hashes重建并核对version tag/message；目标manifest在现有barrier覆盖全部current refs并兼容当前schema/profile。失败rollback同锁选择另一个可信version，原子写target并回到`version_ready`，用新activation attempt重试；
- 只有`activation_complete`、exact target active、deployment message匹配且health/smoke通过，或满足上述normal abort全部前提时，工具才可按精确lock id执行`external -> releasing -> delete`。错误id、第三方active version、缺evidence时不删除。

### 4.5.2 首次 D1 分类失败

`PRISTINE_UNMIGRATED` 只适用于 state/binding/name 精确匹配且只读 schema 检查证明无用户对象、无 migration history 的数据库。出现 `DATABASE_SCHEMA_INCOMPATIBLE` 时不得用 `--yes` 绕过或手工伪造 `mallok_state`；先核对是否选错账号/database id。确需接管已有数据库时必须备份并新增专门 import/adoption ADR 与工具，MVP deploy 不会清空或自动 adopt。

若只是本地 `.mallok/state.json` 丢失，先运行只读 `mallok doctor --target cloudflare --remote` 获取候选和脱敏诊断，再由操作者从 Cloudflare 控制面核对完整 ID，执行 `mallok provision --environment <env> --adopt-database-id <id> --apply`。该流程只重建本地 state，不修改远端；账号、配置名称或数据库分类不匹配时必须停止。

### 4.6 build replace 失败

遵循 `BUILD_RECOVERY_REQUIRED` 输出的 output/stage/backup 精确路径。只读比较 manifest/hash 后手工选择恢复；不要递归删除项目根或未知目录。Windows 先关闭占用文件的 preview/editor。

### 4.7 secret 泄露

1. 立即在 Cloudflare 轮换/撤销 token；
2. 检查 Worker version 与 CI logs/artifacts；
3. 从工作树移除不是撤销，仍要审计 Git history/远端 mirror；
4. 使用合适的历史清理流程并协调所有 clone；
5. 增加 secret scan 回归和 incident record。

### 4.8 `DEPLOY_ASSET_CLOSURE_FAILED`

候选 bundle 删除了 current D1 revision 仍引用的 `/assets/**` URL。deploy 在 migration/Wrangler 前停止。恢复选择：把 URL 对应资源恢复后重建，或先把所有引用该 URL 的 current 内容发布为不再引用/引用新 URL，再重新 build/deploy；不能忽略检查，否则部署后会产生断图。同 URL bytes/hash 变化在 MVP 中允许，因为 URL 未指纹化且缓存为 300 秒；外部 HTTPS 图片不属于这项本地 closure。

## 5. 内容恢复

Markdown/Git 是作者真相。恢复当前线上内容优先从已审核 commit 重新 publish，而不是手改 D1。

- 错误文章：显式 unpublish；
- 错误更新：checkout 目标源 revision，以当前 expectedVersion 再 publish，产生新不可变 revision；
- slug rename 回滚：恢复原 slug 后 publish，旧新 URL 行为按当前 revision；MVP 无自动 redirect；
- 删除本地文件不会下线线上内容。

D1 provider backup/time-travel 只用于灾难恢复，不替代文章 revision 工作流。使用前按当时 Cloudflare 官方文档核实保留期/命令，并先在 staging 恢复验证；本文不承诺固定保留窗口。

## 6. 缓存排障

检查响应的 ETag、Cache-Control、revision header/验证参数：

1. cache-busted publish verification 是否命中新 revision；
2. 普通 URL 60 秒目标是否超时；
3. 每个首页/RSS/sitemap 响应是否使用一次固定 `asOf` 和同一 published projection 规则；不同 HTTP 请求之间不承诺跨请求数据库 snapshot，只受 first-primary 验证与 60 秒缓存目标约束；
4. Worker-managed canonical dynamic route 只接受唯一 `__mallok_rev`，UTM/其他 query 返回 400；asset-first 静态资源 query 由平台处理但不访问 D1，未知 path query 不改变 404；不要通过随机 query 试图绕过动态内容缓存；
5. 只有确认 Cloudflare cache 是原因时才做 scoped purge，不能把 purge 当发布正确性的默认步骤。

## 7. 日志与保留

未被引用的本地脱敏诊断日志和 orphan evidence 默认保留 30 天；被 `.mallok/state.json` 的 current/previous deployment 或任何 active D1 fence 引用的 manifest/candidate snapshot必须无期限保留，直到安全轮换/resolve 后变成 orphan。清理前先重读 state与remote fence，不能只按mtime。idempotency record默认24小时后可由显式maintenance job分批清理。Mallok MVP不自动清理历史document revision；容量观察达到阈值后另写保留ADR，避免误删审计历史。

Worker log 不含正文/token/IP。需要调试单文档时用 document/revision id 摘要关联，不临时开启 request-body logging。

`D1_STORAGE_BUDGET_EXCEEDED` 表示 Mallok 的 256 MiB revision payload ledger 已满，不等同于 provider 物理数据库恰好用满。MVP 没有自动 revision GC；停止发布、导出并评估保留策略，不要手工删除 revision 或篡改 ledger。`CONTENT_DYNAMIC_SIZE_EXCEEDED` 则是单篇 source/body/row 超限，可缩短文章或改用 static target。

## 8. 资源清理

MVP 没有通用 `mallok destroy`。staging full smoke 是 fresh-only：Worker/D1 名称或本地 staging state 任一已存在即阻断；cleanup 是独立、显式、只按同 run `ownership.json` 标为 `created` 的精确资源 id 执行的操作。partial create 只清理已经获得并写入 ownership 的本 run 资源；ownership 不明资源永不删除，生产资源永不由测试脚本清理。任何删除前必须重新验证 authorization/cleanup deadline、account hash、run id、environment、resource id 和 ownership evidence，并把不可恢复性展示给人工操作者。

## 9. 发布检查单

- 全套 local quality gates 对 release SHA 通过；
- migration backward compatibility 已审查；
- release note/upgrade guide/known issues 完成；
- pack/license/audit/secret/history scan 完成；
- staging smoke 已授权并成功，cleanup 有证据；
- production deploy plan 由人确认；
- 回滚目标 Worker version id、version tag、canonical manifest evidence、数据库兼容窗口和负责人已记录；
- 没有把“本地通过”“dry-run”写成“线上验证”。
