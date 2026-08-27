# Mallok

Mallok 是一套从零构建的、内容优先的网站引擎。它不依赖 Astro、Next.js 或其他站点框架，使用同一套内容模型和主题契约，同时支持：

- 将本地 Markdown 编译为纯静态 HTML；
- 在 Cloudflare Workers 上读取 D1 并动态渲染文章；
- 通过可替换主题控制页面结构与视觉；
- 通过 CLI 完成初始化、开发、构建、内容同步和部署；
- 为未来可选的可视化管理界面保留清晰 API 边界，但 MVP 不实现 GUI。

项目当前处于 **Phase 0 文档基线，主分支尚无可发布实现**。完整入口见 [开发文档导航](docs/README.md)，当前事实见 [项目状态](docs/STATUS.md)。不要把下面的目标命令当作已经可运行的功能。

## 核心原则

1. **HTML 优先**：默认不向访问者发送客户端 JavaScript。
2. **双运行模式**：纯静态与 D1 动态模式共享内容和主题，但不伪装成同一种部署形态。
3. **安全边界**：MVP 固定移除 Markdown 原始 HTML，动态内容在进入模板前经过清洗。
4. **可移植内核**：核心包不依赖 Node.js、Cloudflare 或某个 UI 框架。
5. **先 CLI、后 GUI**：先验证完整发布链路，再构建可视化外壳。

## 计划中的命令

```bash
mallok init my-site
mallok new article
mallok dev
mallok validate
mallok build
mallok preview
mallok publish content/articles/hello.md
mallok unpublish --file content/articles/hello.md
mallok db migrate
mallok provision
mallok deploy
mallok doctor
```

准确的参数以 [CLI 契约](docs/CLI.md) 为准，例如下线使用 `mallok unpublish --id <uuid>` 或 `--file <path>`，不接受歧义 slug。以上命令是产品契约，不代表当前已经实现。

## 关键取舍

- static target 生成可交给任意静态托管的目录，但 MVP 不声称无需选择托管商即可“一键部署到所有平台”；
- cloudflare target 在资源和 secret 已配置后，由一个 deploy 命令完成 migration、Worker/asset 发布和 smoke；
- Markdown/Git 是作者源，D1 是发布投影；删除文件不会自动下线线上文章；
- GUI/Studio、R2 媒体库、多语言和插件市场均不属于 MVP。
