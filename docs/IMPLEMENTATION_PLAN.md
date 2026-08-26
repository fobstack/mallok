# Mallok 实施计划

## 工作方式

每一阶段遵循同一个闭环：

```text
主代理冻结阶段契约
  -> Claude Code 实现
  -> 主代理检查 diff、类型、测试与安全边界
  -> 主代理生成精确修订指令
  -> Claude Code 修订
  -> 主代理验收并进入下一阶段
```

Claude Code 不自行扩展范围，不部署、不提交、不决定破坏性公共 API。

## Phase 0：产品与架构基线

交付：PRD、架构、验收标准、ADR、Claude 实施约束。

退出条件：

- 静态与 D1 动态模式没有逻辑矛盾；
- P0/P1/非目标明确；
- 安全边界和云端副作用写入契约；
- 每个后续阶段存在可运行的验收方法。

## Phase 1A：仓库基础与核心纯函数

范围：

- pnpm workspace、TypeScript strict ESM、测试和 lint 基线；
- `@mallok/core` 的输入/规范化/编译模型、错误、slug、HTML 上下文安全和 URL 工具；
- Markdown 到 `SafeHtml`；
- 内容规范化、发布过滤、确定性 route plan；
- 分离的 source/published repository contract、纯内存实现和单元测试。

明确不做：文件系统、CLI、开发服务器、Cloudflare、D1、部署、GUI。

退出条件：见 `.claude/prompts/01-foundation-core.md`。

## Phase 1B：静态构建与 CLI

范围：

- Node 文件内容 repository；
- `mallok.config.mjs` 加载与验证；
- Theme API 和基础主题；
- 临时目录构建与安全输出；
- `init`、`new article`、`build`、`doctor`；
- `examples/basic-blog` 端到端构建。

退出条件：通过 workspace-local CLI 从空目录初始化后可生成首页、文章页、404、RSS、sitemap，且无客户端 JavaScript。Theme API 在此阶段标记为 experimental。

## Phase 1C：本地开发体验

范围：

- `mallok dev`、文件监听和错误覆盖页；
- `mallok preview`；
- loopback 默认绑定；
- 内容/主题/配置变更重建；
- 重建失败保留最后一次成功页面。

退出条件：开发流程在 macOS/Linux 演练通过，无开放局域网默认值。

## Phase 2A：Cloudflare 与 D1 读取

范围：

- `@mallok/cloudflare`；
- Wrangler 生成配置；
- D1 migrations 和 repository；
- Worker 公开路由；
- D1 驱动的首页、RSS 和 sitemap；
- Workers Static Assets 回退；
- 静态与动态主题一致性测试。

退出条件：本地 Cloudflare 测试环境可以从 D1 渲染已发布文章，草稿不可访问。

## Phase 2B：安全内容更新

范围：

- 管理 API；
- revision；
- `mallok publish/unpublish` 与内容 diff；
- 原子 CAS、idempotency 和 revision/ETag 缓存语义；
- token secret 约束；
- 请求大小、schema、错误和日志安全；
- 缓存正确性。

退出条件：内容更新无需重建 Worker，XSS/SQL 注入/未授权测试通过。

## Phase 2C：部署编排

范围：

- deploy plan；
- 独立的 `provision` 计划与状态；
- `mallok deploy --dry-run`；
- 显式确认后调用本地 Wrangler；
- database binding 与 migration 检查；
- CI 非交互模式。

退出条件：不登录真实账号也能完整验证 dry-run；真实副作用只在用户明确授权后发生。此阶段不单凭 dry-run 宣称真实部署已验证。

## Phase 3：发布候选

范围：

- `create-mallok`；
- 全新环境文档演练；
- API 文档、迁移策略和版本信息；
- 性能基线、依赖审计和安全复核；
- 许可证与贡献指南。

发布候选还必须在受控 Cloudflare staging 账号完成一次有明确授权的 `provision -> migrate -> deploy -> health -> publish -> public GET -> cleanup` smoke，并保存脱敏证据；没有凭据时该门保持未完成，不能以本地模拟替代。

## Phase 4：Mallok Studio

进入条件：Phase 3 完成，管理 API 稳定，且已确定视觉方向与认证模型。

范围另写 PRD。不得直接复用长期 CLI token 作为浏览器身份。Studio 的视觉方案必须先提供三个可比较方向并由产品负责人选择。

## 暂缓项

- 插件市场；
- 多租户；
- 在线运行第三方主题；
- 可视化拖拽页面搭建；
- R2 媒体工作流；
- 多数据库适配；
- 增量静态再生。
