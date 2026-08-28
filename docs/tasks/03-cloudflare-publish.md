# Task 03：首次 Cloudflare 公网发布

- 状态：`BLOCKED_BY_02_AND_OAUTH_CLIENT`
- 依赖：Task 02 已接受；Cloudflare 架构方向已选定，provider contract 必须在公共 OAuth/`workers.dev` spike 后转为 Accepted；`SEO_PERFORMANCE.md` 的公开 origin、抓取文件、header 和资产合同已冻结
- 用户可见退出结果：在 Studio 连接托管、查看并确认计划、发布，得到经过 health 与公开 GET 验证的公网 URL
- 验收映射：`AC-03-01` 至 `AC-03-06`，以及适用的 `AC-X-*`

## 1. 目标

实现唯一一条批准的 Cloudflare 首次发布路径。普通用户不复制 token、不创建 `.dev.vars`、不运行 Wrangler，也不进入 Cloudflare 控制台手工创建 Worker、D1 或 binding。Studio 必须诚实展示谁托管、连接哪个账号、将产生哪些资源/费用和失败后的下一步。

## 2. 开始前依赖

架构与安全路线已经冻结为用户自有 Cloudflare、公共 OAuth client + Authorization Code with PKCE、generic Worker + D1 + R2。进入真实实现前还必须完成并记录：

- `mallok.dev` publisher domain 验证、公共 OAuth client、PKCE S256、exact redirect/origin allowlist 与最小 scope 的真实注册证据；
- 锁定账号对 `workers.dev` subdomain 的存在/创建、script subdomain 启用和公网 origin 的真实 API 证据；
- 新用户可在系统浏览器中创建 Cloudflare account、完成邮箱验证/条款并回到 OAuth 流程的真实证据；已有账号与新建账号最终都必须得到同样的站点/资源 ownership 证明；
- 首次发布要创建的 Worker、D1、静态资产或等价资源及生命周期；
- 平台默认公网 URL、名称冲突规则、免费/可能付费行为和明确确认点；
- credential 的系统安全存储、撤销、过期、日志/诊断脱敏边界；
- recording provider 与 staging 授权、资源命名、限时 authorization、cleanup 规则。

上述任一项未接受，禁止远程实现和真实 mutation。

## 3. 范围

### Studio 流程

1. “发布网站”先解释 Cloudflare 托管责任和账号连接，不显示 token 教程。
2. 连接成功后只读检查账号、权限、名称、资源冲突和费用风险。
3. 展示可审阅计划：目标、资源类别、默认 URL、可能费用、取消与失败边界。
4. 用户明确确认后才允许 mutation；create 前写 provision intent，每个已创建资源立即原子写入有限 receipt 并校验 D1/R2/Worker ownership marker，不建立通用部署状态机，也不从动画猜测进度。
5. 成功必须验证部署结果、health 与匿名公开 GET；public smoke 覆盖 homepage、一个 page、一个 article、404、robots、root sitemap、全部 sitemap shard 和一个受管图片，并核对 status、content type、cache/CSP/nosniff、canonical 集合、robots sitemap URL 与 asset bytes/hash，全部通过后才显示可复制/打开的 URL。
6. 认证失效、名称冲突、权限不足、网络中断、partial create、smoke 失败和关闭窗口都有真实状态与继续/重试入口。

### 应用与 provider 能力

- connect account、plan first publish、confirm/execute、observe/resume 四类 application use case；
- credential broker/store 与普通项目数据隔离，secret 不进入 argv、环境文件、日志、错误、snapshot 或证据；
- 一个 Cloudflare provider adapter，拥有 read/mutation 分类、稳定错误、确定性资源身份、ownership 和 recording fake；
- PublishBundle 作为发布输入；provider 不重新编译 Markdown 或模板；
- staging manifest 先创建 route/asset-verification rows，asset 与 route 均以最多 32 项的请求分块处理；R2 只用 conditional create，existing/timeout 经 HEAD 的 checksum/bytes/MIME exact 才 no-op；不在单次 Worker invocation 扫全部 R2；
- 每个远程创建结果先持久化 ownership，再进入下一步；未知归属资源不 adopt/delete；
- 本地/recording 测试为默认实现门；真实 staging 必须单独获得绑定 SHA、账号、资源前缀、期限和 cleanup 范围的人工授权。

## 4. 非目标

- 已发布内容的 D1 增量更新、下线和上一版本恢复（Task 04）；
- 自定义域名、DNS 迁移、多账号管理或多云；
- Mallok 自建 SaaS 账号、计费或 `*.mallok.dev` 托管承诺；
- R2 媒体库、图片转换、第三方模板市场；
- 在 UI 暴露 Wrangler、binding、migration、Worker/D1 调试作为主路径。

## 5. 可测试验收

- `AC-03-01`：确认前展示托管商、目标、资源类别、默认 URL、权限与费用；recording 证明 mutation=0。
- `AC-03-02`：默认连接路径无需复制 token/运行 Wrangler/手写 ID，secret 扫描覆盖项目、argv、日志、错误、诊断和证据。
- `AC-03-03`：获授权 staging 从未发布项目完成 Studio 首发；R2 conditional create/HEAD 与 D1 activated public-asset gate 通过，部署、health、匿名公开 GET、technical SEO/sitemap 闭包与受管图片验证全部通过后才显示成功。
- `AC-03-04`：认证、权限、冲突、partial create、网络与 smoke 失败不显示成功且不误删未知资源；从每个 create 后崩溃重启都只能用 receipt + remote marker 恢复。
- `AC-03-05`：取消、关闭和响应丢失后重开可观察、继续或安全重试；重复执行不无界建资源。
- `AC-03-06`：只有一个批准 provider/default URL；主路径不要求自定义域名、多云或 Mallok 账号。
- 适用 `AC-X-*`：credential、ownership、错误、确定性与共享 application service 有证据。

## 6. 精确验证类别

默认实现会话必须通过：`DOCS`、`STATIC`、`UNIT`、`COMPONENT`、`FLOW-LOCAL`、`FLOW-EXPORT`、`CLOUD-CONTRACT`、`SECURITY`、`DETERMINISM`、`A11Y-STUDIO`、`A11Y-SITE`、`SEO-SITE`、`PAGESPEED-LOCAL`。

只有逐项授权的真实 staging 才运行并标记 `FLOW-FIRST-PUBLISH`。凭据存在、recording 通过或公开 URL 文本出现都不能冒充该类别。每项证据写出 test path、实际命令/人工步骤、退出码/结果、环境、授权 ID 和 verified SHA。

## 7. 停止条件

- 账号连接或首发要求用户复制 raw token、配置环境变量、运行 Wrangler 或手填资源 ID；
- scope、费用、资源归属、默认 URL、清理责任或系统安全存储仍未接受；
- 用户确认前发生 mutation，或 remote action 没有绑定明确 intent/target；
- partial/unknown 结果会自动重做、adopt 或删除 ownership 不明资源；
- asset 使用无条件覆盖 PUT，或未证明 checksum/bytes/MIME exact 就把 D1 row 标为 verified；
- provider 返回成功就直接显示“已发布”，未做 health 和匿名公开 GET；
- 需要第二 provider、自定义域名、Mallok SaaS 或任务外能力才能闭环；
- 没有有效 staging 授权却准备执行真实远程写入。

## 8. 完成报告

报告区分 local/recording/staging，列出确认前零 mutation 证据、权限/费用计划、脱敏审计、所有远程 attempt/ownership、公开 URL smoke、失败矩阵、剩余资源和 cleanup 结果。staging 未授权时任务可以完成本地实现，但 `AC-03-03` 仍为 `NOT_RUN`，Task 03 不能被最终接受或解锁 Task 04。
