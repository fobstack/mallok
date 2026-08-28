# Task 04：更新、原子发布与恢复

- 状态：`BLOCKED_BY_03`
- 依赖：Task 03 已在授权 staging 完成首次发布并被接受
- 用户可见退出结果：编辑线上文章后发布更改；中断后安全重试；必要时恢复上一个已知正常版本
- 验收映射：`AC-04-01` 至 `AC-04-08`，以及适用的 `AC-X-*`

## 1. 目标

让内容更新成为普通的 Studio 操作，而不是重新部署技术教程。用户看到变更摘要、发布、重试和恢复；底层必须完成不可变 PublishBundle、R2 资源闭合、D1 staging、`expectedCurrentBundleHash` 并发 guard、current bundle 原子切换和可审计结果。0.1 以 bundle hash 与不可变 row 自然提供安全重放，不增加文档 revision 系统或 idempotency ledger。

## 2. 依赖

- Task 03 的账号连接、credential、provider、provision state 和默认 URL 已稳定；
- 首次发布资源在授权 staging 可复用，R2 conditional create/public registry 与 inactive-bundle cleanup/容量责任明确；
- PublishBundle manifest、`bundleHash`、asset closure、staging/ready 状态和 current bundle 语义已冻结；
- publish/unpublish 的 `expectedCurrentBundleHash` guard、重复 bundle/body no-op、hash 冲突、响应证据与 result-unknown 协议已接受；
- “上一个已知正常版本”的本地 bundle 保留、hash 复核、恢复影响和远端 asset 生命周期已接受。

## 3. 范围

### Studio 流程

- 对已发布站点显示本地与线上基线之间的普通语言变更摘要；
- “发布更改”是一次明确意图，重复点击只补齐/完成同一个 `bundleHash`，不会生成多个不同 bundle；
- 显示准备资源、上传、切换、公开验证的真实阶段，但默认不暴露 SQL/CAS/migration；
- 网络中断、响应丢失或应用退出后，重开项目先观察同一 attempt，再提供继续/安全重试；
- 提供文章下线和“恢复上一版本”，后者从本地保留且 hash 已复核的旧 bundle 发起一次新的明确发布；执行前说明影响，完成后验证公开 URL；
- 发布页显示最近成功/失败/待确认记录；protocol 不兼容时普通发布阻断，用户可在独立确认中更新网站托管，不自动升级；
- 无法自动判断时显示“需要处理”与安全下一步，不能猜测成功或失败。

### 原子发布能力

- 从同一编译管线生成不可变 bundle，正文、route、SEO head、robots、root sitemap/shards 和所需资产形成闭合清单；发布、下线和恢复必须原子切换整套结果，不能让新页面配旧 sitemap 或反之；
- 新资产只以 conditional create 上传并核对 checksum/bytes/MIME；existing/timeout 路径经 HEAD 证明 exact 才 no-op，闭合失败不切换 current pointer；
- D1 先创建或复用同 hash staging manifest/route/asset-verification rows 并分块补齐；finalize 以条件 SQL 复核完整性、检查 `expectedCurrentBundleHash` 并原子切换 current bundle；
- staging admission/finalize 维持每站点 `8` 个 inactive bundle、`64 MiB` inactive route bytes 的硬上限；staging 24 小时、never-activated ready 7 天、退出 current/previous 的旧 activated bundle按冻结规则每请求最多清理一组；容量不足在新增 row/pointer switch 前稳定失败；
- pointer SQL 在切换前再次拒绝 target asset 与既有 public registry 同 key metadata 冲突，不能让 `ON CONFLICT DO NOTHING` 掩盖竞态；
- 同 `bundleHash`/manifest/body 可安全重放；相同 hash 对应不同 bytes 必须稳定拒绝；
- response loss 后查询 current/staging 并补齐或 finalize 原 bundle，不能重新编译出另一个身份猜测重发；
- 恢复以明确、已验证的本地旧 bundle 为目标，并以当前线上 bundle 为新 base；失败不得破坏当前 last-known-good；
- recording provider 与逐点 fault injection 覆盖每个远程/事务边界；真实 staging 覆盖指定恢复场景。

## 4. 非目标

- 多人实时编辑、自动冲突合并、多设备草稿同步；
- R2 媒体管理/转换、长期全版本浏览或无限历史；
- Worker 热更新、插件/模板代码部署或多云；
- 自定义域名迁移、Mallok SaaS 控制面或计费；
- 让普通用户选择数据库、migration、CAS 或部署策略。

## 5. 可测试验收

- `AC-04-01`：Studio 发布文章更改后公网正文、canonical、内部链接和 sitemap 同步更新；下线后 URL 从 sitemap 消失，通用 Worker 无需重新部署，用户不需理解 D1。
- `AC-04-02`：对编译、R2 conditional create/HEAD、staging manifest、HTML/robots/sitemap route body、完整性检查、public-registry conflict guard、base guard、current 切换和 response 各点故障注入；访客始终只看到旧或新完整 bundle，不会看到跨版本抓取集合。
- `AC-04-03`：重复点击、响应丢失、应用重启均观察/补齐/完成同一 `bundleHash`；8/9 candidate、64 MiB±1、24h/7d、prospective pointer switch 与每请求一组 cleanup 边界均通过，base 变化时不静默覆盖。
- `AC-04-04`：新图片成功闭合后才允许 pointer 切换；precondition fail、timeout、缺失 checksum、bytes/MIME mismatch 和同 key public metadata race 全部稳定拒绝，线上旧内容不破图。
- `AC-04-05`：本地旧 bundle 的 hash、恢复目标、影响和公开结果可核验；恢复失败维持 last-known-good 或进入准确人工状态。
- `AC-04-06`：主界面只要求理解发布更改、重试、恢复上一版本、需要处理；技术详情不是继续前提。
- `AC-04-07`：获授权 staging 覆盖普通更新、下线、response loss、应用重启和上一版本恢复，且证据脱敏、cleanup 按 ownership。
- `AC-04-08`：发布历史状态准确；Studio 和 CLI 调用同一 runtime-upgrade use case，普通 publish 不隐式升级，升级失败 current bundle 不变。
- 适用 `AC-X-*`：共享 service、SQL/secret/ownership 安全、确定性、错误与证据不变量保持。

## 6. 精确验证类别

本任务必须通过：`DOCS`、`STATIC`、`UNIT`、`COMPONENT`、`FLOW-LOCAL`、`FLOW-EXPORT`、`CLOUD-CONTRACT`、`FLOW-FIRST-PUBLISH`、`FLOW-UPDATE`、`RECOVERY`、`SECURITY`、`DETERMINISM`、`A11Y-STUDIO`、`A11Y-SITE`、`SEO-SITE`、`PAGESPEED-LOCAL`。

`FLOW-UPDATE` 与包含真实 Cloudflare/D1 的 `RECOVERY` 只在逐项授权 staging 标记 `VERIFIED_STAGING`；local recording/fault injection 必须单独记录为 `VERIFIED_LOCAL`。证据必须列出精确注入点、预期不变量、实际 test path/命令/结果、授权、环境和 verified SHA。

## 7. 停止条件

- 任一步失败会让访客读到半 bundle、错误 current pointer 或引用未就绪资产；
- retry 会改变 `bundleHash`，或相同 hash/不同 bytes 不能稳定拒绝；
- 无条件 R2 PUT、先 HEAD 后可覆盖 PUT、容量失败后留下第 9 个候选，或 pointer guard 未复核 public-asset metadata；
- response unknown 时系统直接宣称成功/失败或盲目重发；
- 恢复目标不在本地、hash 无法复核、不能证明曾公开正常，或失败会破坏当前线上版本；
- Studio 要求用户操作 SQL、D1、migration、CAS、binding 或重新部署 Worker；
- credential/正文/SQL/绝对路径进入日志、错误或证据；
- 没有有效 staging 授权却准备远程 mutation，或 cleanup 需要删除 ownership 不明资源。

## 8. 完成报告

除通用报告外，附 bundle/staging/current 不变量、全部 fault-injection 点、同 hash 重放与 hash 冲突用例、资产闭合矩阵、response-unknown 与重启录像、本地旧 bundle 复核、staging 公网 before/after/restore 证据、未清理资源及人工处置。只有完整 staging 证据被接受后才能进入 Task 05。
