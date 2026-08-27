# Mallok

Mallok 是一套从零构建的、内容优先的网站产品。它的长期目标，是让第一次做内容网站的人也能从模板出发完成创建、编辑、预览、发布和更新，而不必先学习前端框架。

Mallok 不依赖 Astro、Next.js 或其他站点框架，使用同一套内容模型和主题契约，同时支持：

- 将本地 Markdown 编译为纯静态 HTML；
- 在 Cloudflare Workers 上读取 D1 并动态渲染文章；
- 通过可替换主题控制页面结构与视觉；
- 通过 CLI 完成初始化、开发、构建、内容同步和部署；
- 为长期面向非开发者的 Mallok Studio 保留清晰 application/API 边界；Studio 是长期核心界面，但 MVP 暂不实现 GUI。

项目当前处于 **Phase 0 文档基线，主分支尚无可发布实现**。完整入口见 [开发文档导航](docs/README.md)，当前事实见 [项目状态](docs/STATUS.md)。不要把下面的目标命令当作已经可运行的功能。

## 核心原则

1. **HTML 优先**：默认不向访问者发送客户端 JavaScript。
2. **双运行模式**：纯静态与 D1 动态模式共享内容和主题，但不伪装成同一种部署形态。
3. **安全边界**：MVP 固定移除 Markdown 原始 HTML，动态内容在进入模板前经过清洗。
4. **可移植内核**：核心包不依赖 Node.js、Cloudflare 或某个 UI 框架。
5. **先 CLI、后 Studio**：CLI-first 是交付顺序和自动化接口，不是长期易用性的终点；Studio 与 CLI 最终共享同一应用能力。

## Mallok 要在哪条路上更好

Mallok 不声称全面取代 Astro。它只针对博客、新闻、文档和中小企业内容站，追求把“选模板 → 填内容 → 预览 → 发布 → 持续更新”做得概念更少、步骤更少、默认输出更轻。

Astro 已经具备零客户端 JS、静态/按需渲染和内容集合等能力；Mallok 的差异不是复刻这些 feature，而是把内容发布、D1 revision、诊断和可恢复部署整合成一条意见明确的产品路径。比较数据出来前，“更轻、更容易”是待验证目标，不是现状宣传。完整边界见 [产品愿景](docs/PRODUCT_VISION.md)。

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

## 计划公开归属

- 计划 GitHub 维护者：`JasonYv`；
- 计划公开仓库：`github.com/JasonYv/mallok`；
- 当前本地仓库尚未配置 Git remote，也尚未公开发布。许可证和仓库所有权在发布前必须核实。
