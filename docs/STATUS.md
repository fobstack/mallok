# Mallok 当前状态

- 日期：2026-08-27
- 产品阶段：Studio-first 0.1 产品与开发文档基线完成，待提交
- 实现状态：`NOT_STARTED`
- 发行状态：`NOT_AVAILABLE`

## 1. 现在已经确定的事实

- Mallok 0.1 的主产品是本地 Mallok Studio；GUI 不是后续附加项。
- 普通用户的默认路径必须是 0 次终端操作、0 个手写配置文件，并且不要求理解或预装 Node、pnpm、Git、D1、Wrangler。
- Markdown 是可携带的内容格式，不是用户完成建站的知识门槛。
- Studio、CLI 和测试 adapter 必须调用同一 application service；CLI 不能成为 Studio 的子进程或隐藏依赖。
- 静态导出和 Cloudflare 发布使用同一 compiler 与 PublishBundle contract；相同 `canonicalOrigin` 时消费完全相同的 bundle，不同 origin 会产生各自确定的 bundle；“导出完成”不等于“公网发布成功”。
- sitemap、robots、canonical/metadata 和受管图片优化由 compiler 统一生成；官方模板必须通过 `SEO_PERFORMANCE.md` 的固定 Lighthouse/PSI 门，但这不等于保证搜索收录、排名或任何用户内容永远 100 分。
- 0.1 只计划支持一个经批准的 Cloudflare 发布路径。
- 计划中的公开仓库归属是 `JasonYv/mallok`。这只是目标归属；本文不声称远端仓库已创建、代码已推送或版本已发布。

## 2. 当前不存在的交付物

当前仓库没有可验证的产品实现，因此以下能力都不能被描述为可用：

- 可启动的 Mallok Studio 或可工作的 CLI；
- 建站、模板、编辑、预览、静态导出或恢复流程；
- Cloudflare 授权、发布、D1 更新或公网 URL；
- 稳定的 build/dev/install/test 命令；
- 自包含安装包、签名、自动更新或正式 0.1 release；
- 绑定候选 SHA 的 staging、package、accessibility 或真人用户证据。

测试类别的名称和质量门已经在 [TESTING.md](TESTING.md) 中定义，但在真实 runner、test path 和命令被实现前均为 `NOT_AVAILABLE`。

## 3. 活动路线

| 顺序 | 任务 | 状态 | 完成后的用户结果 |
| --- | --- | --- | --- |
| 01 | [Studio walking skeleton](tasks/01-walking-skeleton.md) | `READY_FOR_IMPLEMENTATION` | 建站、选模板、编辑、内嵌预览 |
| 02 | [完整本地产品](tasks/02-local-product.md) | `BLOCKED_BY_01` | 三模板、图片优化、SEO/sitemap、PageSpeed 门、静态导出、本地恢复 |
| 03 | [首次 Cloudflare 公网发布](tasks/03-cloudflare-publish.md) | `BLOCKED_BY_02_AND_OAUTH_CLIENT` | 连接托管并获得经过 smoke 的公网 URL |
| 04 | [更新与恢复](tasks/04-update-recovery.md) | `BLOCKED_BY_03` | 更新文章、原子切换、安全重试、恢复上一版本 |
| 05 | [自包含发行](tasks/05-release.md) | `BLOCKED_BY_04` | 在干净机器安装并由目标用户验证完整路径 |

任务必须依序接受，不能把底层模块或 CLI 测试通过当成前一阶段的 Studio 用户结果。

## 4. 已冻结的实现前提与仍缺的外部准备

- Studio 宿主：TypeScript + Bun 自包含 application core，在 loopback 提供嵌入式 Studio；Tier-1 仅附一个无业务逻辑、同 release 签名的 Swift Keychain helper；
- 0.1 首发平台：macOS 13+ Apple Silicon，签名并公证的 `Mallok.app`/DMG；
- 项目格式：`PROJECT_FORMAT.md` 的数据型目录；
- 模板边界：内置 Journal、Docs、Company，成熟 Liquid 引擎的受限声明式 profile；
- 技术栈：[TECH_STACK.md](TECH_STACK.md) 的 TypeScript + Bun、Preact Studio、可视/Markdown 编辑、单编译管线与批准依赖；
- 模板视觉：[TEMPLATE_VISUALS.md](TEMPLATE_VISUALS.md) 的 Journal、Docs、Company 范围；
- 搜索与性能：[SEO_PERFORMANCE.md](SEO_PERFORMANCE.md) 的 sitemap/head/robots、单输出图片优化、Lighthouse/PSI 与 CrUX 证据边界；
- Cloudflare 架构方向：用户自有账号、公共 OAuth client + PKCE、generic Worker + D1 + R2、单一 PublishBundle；精确 provider contract 在 OAuth/`workers.dev` 真实 spike 通过前仍为 Proposed。

Task 01 可按已冻结技术/视觉契约开始，但首个 dependency-only diff 仍必须锁定 Bun 与直接依赖 exact version、源码/测试路径和 lockfile。Task 03 前必须由 `JasonYv` 完成 `mallok.dev` OAuth publisher domain 验证、公共客户端注册、最小 scope、desktop callback 与 `workers.dev` 实测。Task 05 前必须具备 Apple Developer 签名/公证身份并完成许可证选择。

如果这些决定缺失，实现者必须停下请求负责人决定，不能自行选择并把选择伪装成既定产品事实。

## 5. 文档迁移边界

- 0.1 的活动入口是 [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) 中的五个垂直任务及本文件列出的任务页。
- 旧 CLI-first 路线及其 AC 只具有历史价值，不得作为当前任务的完成证据。
- 文档迁移期间如 `TRACEABILITY.md`、导航页或领域文档仍引用旧编号，以 [ACCEPTANCE.md](ACCEPTANCE.md) 的 `AC-00-*`、`AC-01-*` 至 `AC-05-*`、`AC-X-*` 为当前验收真相，并必须先修复冲突再编码。
- 公开 GitHub、域名、Cloudflare 资源、许可证或发行事实必须由实际远端/制品证据确认；计划名称不能替代核实。

## 6. 下一步

先完成 Task 01 的前置决策与允许路径审查，再实现最薄的 Studio 建站→模板→编辑→预览闭环。任何只产出 core、CLI 或文档、却没有可操作 Studio 主路径的提交，都不能关闭 Task 01。
