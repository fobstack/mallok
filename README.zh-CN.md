# Mallok

**开源、Cloudflare 原生的内容网站产品。内容存在 D1 里，改完即时生效，不需要构建，随时可以带走。首个垂直是外贸 B2B 企业站：一键建站、多语言、产品目录、询盘直达邮箱，从 0 元起步。**

> WordPress 的编辑体验，边缘网络的性能，开源且不锁定你的内容。

[English](README.md)

## 它解决什么

内容网站今天有两条路，各有一个结构性缺陷：

- **CMS（WordPress、Ghost）**：编辑体验好、改完即生效。代价是你得养服务器、数据库和持续的安全更新。
- **静态生成（Astro、Hugo）**：性能和输出质量极好。代价是改一个错别字要提交、跑 CI、等构建、重新部署，非技术的人根本进不来。

外贸企业站是这两个缺陷最集中的地方：多语言、产品目录、每天更新的行业动态、一个必须可靠的询盘表单，今天大多跑在过时的 WordPress 模板或按年收费的建站 SaaS 上。Mallok 认为这些代价都不是必须付的。

## 它是怎么做的

部署一个 Worker 到你自己的 Cloudflare 账号。内容以 Markdown 存在 D1，图片存在 R2 并由 R2 自定义域直出。保存内容时 Worker 把 Markdown 渲染成片段缓存在 D1；访客请求时只套主题模板并写入边缘缓存，几乎全部请求由缓存直接返回。保存文章 = 写一行数据库 + 清一次缓存，几秒内生效。

- 三级建站入口：`npx mallok create`、官网的 Deploy to Cloudflare 按钮、（1.0）托管部署助手

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/JasonYv/mallok)

> 按钮要求仓库是公开的 GitHub 或 GitLab 仓库。它按 `wrangler.jsonc` 里的名字创建 D1 与 R2，并按 `package.json` 的 `cloudflare.bindings` 说明提示你填 `MALLOK_SECRET`。

- 多语言进内容模型：每条内容有语言与翻译组，URL 按语言分前缀，自动 hreflang
- 内容类型由主题声明：外贸 Starter 自带产品、分类、案例、FAQ、新闻
- 询盘插件：原生表单 + Turnstile 防刷 + 落库 + Resend 双向邮件 + 后台列表 + CSV 导出
- 内容、设置、主题配置项、插件开关即时生效；主题、插件、升级住在源码目录，需要重新部署——界面如实这么说，不做成一键操作
- CLI 从本地批量发布文章包（`index.md` + `images/`），对接 AI 内容管线
- 一键导出成普通 `.md` 文件夹和 `inquiries.csv`，随时能搬去 Astro、Hugo、Obsidian
- 所有依赖都有免费档；升级只有一档 Workers Paid（5 美元/月），不换架构

## 现状

**功能本地齐了，但生产环境未验证。** 渲染内核、数据库 schema、Worker 请求路径、边缘缓存、管理 API、媒体管线、SEO 端点、多语言模型、插件运行时与官方询盘插件、五个零 JS 主题、完整后台、导入导出、CLI、`trade-b2b` Starter 与安装向导都已存在，有 308 个测试覆盖。

**但没有任何东西在真实 Cloudflare 账号上跑过。** [`docs/ACCEPTANCE.md §14`](docs/ACCEPTANCE.md) 是诚实的现状：76 条验收里 48 条本地已验、28 条无证据、**0 条真实基础设施已验**。`mallok create` 写完了但从没执行过，Lighthouse 从没跑过，也没发布到 npm。请把它当成一个可以试的代码库，不是一个可以部署的产品。

```sh
pnpm install
pnpm test          # Node 单元测试 + workerd 内的集成测试
pnpm dev           # wrangler dev，http://127.0.0.1:8787
```

设计文档：

- [产品愿景](docs/PRODUCT_VISION.md)
- [架构](docs/ARCHITECTURE.md)
- [技术栈](docs/TECH_STACK.md)
- [内容格式](docs/CONTENT_FORMAT.md)
- [数据模型](docs/DATA_MODEL.md)
- [Cloudflare 资源规划](docs/CLOUDFLARE_RESOURCES.md)

贡献指南与代码风格见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[Apache-2.0](LICENSE)。相比 MIT 多了显式专利授权与专利报复条款——企业法务
评审通常更认这一条。

## 参与贡献

代码风格与改动必须通过的检查见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。
安全问题请走
[私密安全公告](https://github.com/JasonYv/mallok/security/advisories/new)，
不要开公开 issue，详见 [`SECURITY.md`](SECURITY.md)。
