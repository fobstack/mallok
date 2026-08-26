# Mallok

Mallok 是一套从零构建的、内容优先的网站引擎。它不依赖 Astro、Next.js 或其他站点框架，使用同一套内容模型和主题契约，同时支持：

- 将本地 Markdown 编译为纯静态 HTML；
- 在 Cloudflare Workers 上读取 D1 并动态渲染文章；
- 通过可替换主题控制页面结构与视觉；
- 通过 CLI 完成初始化、开发、构建、内容同步和部署；
- 在内核稳定后提供可视化管理界面。

项目当前处于 **MVP 设计与内核实现阶段**。产品范围见 [PRD](docs/PRD.md)，技术方案见 [架构文档](docs/ARCHITECTURE.md)，开发顺序见 [实施计划](docs/IMPLEMENTATION_PLAN.md)。

## 核心原则

1. **HTML 优先**：默认不向访问者发送客户端 JavaScript。
2. **双运行模式**：纯静态与 D1 动态模式共享内容和主题，但不伪装成同一种部署形态。
3. **安全默认值**：Markdown 原始 HTML 默认关闭，动态内容在进入模板前经过清洗。
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
mallok unpublish hello
mallok db migrate
mallok provision
mallok deploy
mallok doctor
```

以上命令是产品契约，不代表当前已经全部实现。
